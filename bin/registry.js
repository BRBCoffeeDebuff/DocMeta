#!/usr/bin/env node
/**
 * docmeta registry - Cross-repository reference management
 *
 * Usage:
 *   docmeta registry add <repo>       Add a repository to track
 *   docmeta registry remove <repo>    Remove a repository
 *   docmeta registry list             List registered repositories
 *   docmeta registry sync             Sync all repositories (placeholder)
 *   docmeta registry export           Export current project's docmeta
 *   docmeta registry import <file>    Import a docmeta bundle
 */

const fs = require('fs');
const path = require('path');
const {
  parseReference,
  addRepository,
  removeRepository,
  listRepositories,
  loadRegistry,
  exportDocmetaBundle,
  importDocmetaBundle,
  loadCachedDocmeta,
  DOCMETA_DIR,
  CACHE_DIR
} = require('./lib/registry');

// ============================================================================
// CLI Helpers
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function print(msg = '') {
  console.log(msg);
}

function printSuccess(msg) {
  print(`${colors.green}✓${colors.reset} ${msg}`);
}

function printError(msg) {
  print(`${colors.red}✗${colors.reset} ${msg}`);
}

function printInfo(msg) {
  print(`${colors.cyan}ℹ${colors.reset} ${msg}`);
}

function printHeader(msg) {
  print(`\n${colors.bright}${colors.blue}${msg}${colors.reset}\n`);
}

// ============================================================================
// Commands
// ============================================================================

function cmdAdd(repoRef, options) {
  if (!repoRef) {
    printError('Missing repository reference');
    print('Usage: docmeta registry add <repo>');
    print('Example: docmeta registry add github:myorg/my-service');
    process.exit(1);
  }

  const result = addRepository(repoRef, options);

  if (result.success) {
    printSuccess(`Added ${result.repoId} to registry`);
    print(`\nNext steps:`);
    print(`  1. Get the docmeta bundle from the repository`);
    print(`  2. Import it: docmeta registry import <bundle.json> --repo ${result.repoId}`);
    print(`\nOr if you have local access:`);
    print(`  docmeta registry import /path/to/repo --repo ${result.repoId}`);
  } else {
    printError(result.error);
    process.exit(1);
  }
}

function cmdRemove(repoRef) {
  if (!repoRef) {
    printError('Missing repository reference');
    process.exit(1);
  }

  const result = removeRepository(repoRef);

  if (result.success) {
    printSuccess(`Removed ${result.repoId} from registry`);
  } else {
    printError(result.error);
    process.exit(1);
  }
}

function cmdList() {
  const repos = listRepositories();

  if (repos.length === 0) {
    print('No repositories registered.');
    print('\nAdd one with: docmeta registry add github:org/repo');
    return;
  }

  printHeader('Registered Repositories');

  for (const repo of repos) {
    const status = repo.cached ? `${colors.green}cached${colors.reset}` : `${colors.yellow}not synced${colors.reset}`;
    const lastSync = repo.lastSync
      ? `synced ${new Date(repo.lastSync).toLocaleDateString()}`
      : 'never synced';

    print(`${colors.cyan}${repo.id}${colors.reset}`);
    print(`  Branch: ${repo.branch}`);
    print(`  Status: ${status} (${lastSync})`);
    if (repo.source) {
      print(`  Source: ${repo.source}`);
    }
    print('');
  }

  print(`Registry: ${DOCMETA_DIR}`);
}

function cmdSync() {
  printHeader('Registry Sync');

  const repos = listRepositories();

  if (repos.length === 0) {
    print('No repositories registered.');
    return;
  }

  print('Sync is currently manual. For each repository:');
  print('');

  for (const repo of repos) {
    print(`${colors.cyan}${repo.id}${colors.reset}:`);

    if (repo.source) {
      print(`  docmeta registry import "${repo.source}" --repo ${repo.id}`);
    } else {
      print(`  # Get bundle from CI artifacts or export from repo`);
      print(`  docmeta registry import <bundle.json> --repo ${repo.id}`);
    }
    print('');
  }

  printInfo('Future versions will support automatic sync via GitHub API or CI artifacts.');
}

function cmdExport(options) {
  const rootPath = options.path || process.cwd();
  const outputPath = options.output || 'docmeta-bundle.json';

  print(`Exporting docmeta from: ${rootPath}`);

  const bundle = exportDocmetaBundle(rootPath);
  const folderCount = Object.keys(bundle.folders).length;

  if (folderCount === 0) {
    printError('No .docmeta.json files found');
    process.exit(1);
  }

  fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2) + '\n');

  printSuccess(`Exported ${folderCount} folders to ${outputPath}`);
  print(`\nShare this file with other repos to enable cross-repo tracking.`);
  print(`They can import it with: docmeta registry import ${outputPath} --repo <your-repo-id>`);
}

function cmdImport(source, options) {
  if (!source) {
    printError('Missing source (file path or directory)');
    process.exit(1);
  }

  if (!options.repo) {
    printError('Missing --repo flag. Specify which repo this bundle is from.');
    print('Example: docmeta registry import bundle.json --repo github:org/repo');
    process.exit(1);
  }

  // Check if source is a directory (export on the fly) or a file
  let bundle;

  if (fs.existsSync(source)) {
    const stat = fs.statSync(source);

    if (stat.isDirectory()) {
      print(`Exporting from directory: ${source}`);
      bundle = exportDocmetaBundle(source);
    } else {
      print(`Reading bundle: ${source}`);
      try {
        const content = fs.readFileSync(source, 'utf-8');
        bundle = JSON.parse(content);
      } catch (err) {
        printError(`Failed to read bundle: ${err.message}`);
        process.exit(1);
      }
    }
  } else {
    printError(`Source not found: ${source}`);
    process.exit(1);
  }

  // First ensure repo is registered
  const parsed = parseReference(options.repo);
  if (!parsed || (parsed.type !== 'github' && parsed.type !== 'gitlab')) {
    printError('Invalid repository reference. Use format: github:org/repo');
    process.exit(1);
  }

  // Add to registry if not exists
  addRepository(options.repo, { force: true, source });

  // Import the bundle
  const result = importDocmetaBundle(options.repo, bundle);

  if (result.success) {
    printSuccess(`Imported ${result.folderCount} folders for ${result.repoId}`);
  } else {
    printError(result.error);
    process.exit(1);
  }
}

function cmdShow(repoRef) {
  if (!repoRef) {
    printError('Missing repository reference');
    process.exit(1);
  }

  const parsed = parseReference(repoRef);
  const repoId = `${parsed.type}:${parsed.repo}`;
  const cached = loadCachedDocmeta(repoId);

  if (!cached) {
    printError(`Repository ${repoId} not in cache`);
    print('Sync it first: docmeta registry import <bundle> --repo ' + repoRef);
    process.exit(1);
  }

  printHeader(`DocMeta for ${repoId}`);

  print(`Exported: ${cached.exportedAt}`);
  print(`Folders: ${Object.keys(cached.folders).length}`);
  print('');

  for (const [folderPath, meta] of Object.entries(cached.folders)) {
    print(`${colors.cyan}${folderPath}${colors.reset}`);
    print(`  ${colors.dim}${meta.purpose}${colors.reset}`);

    if (meta.files) {
      const fileCount = Object.keys(meta.files).length;
      print(`  Files: ${fileCount}`);
    }

    if (meta.contracts) {
      const contractCount = Object.keys(meta.contracts).length;
      print(`  Contracts: ${contractCount}`);
    }

    print('');
  }
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(args) {
  const options = {
    command: null,
    target: null,
    output: null,
    path: null,
    repo: null,
    force: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--path' || arg === '-p') {
      options.path = args[++i];
    } else if (arg === '--repo' || arg === '-r') {
      options.repo = args[++i];
    } else if (!options.command) {
      options.command = arg;
    } else if (!options.target) {
      options.target = arg;
    }
  }

  return options;
}

// ============================================================================
// Help
// ============================================================================

const HELP = `
docmeta registry - Cross-repository reference management

Usage:
  docmeta registry add <repo>                Add a repository to track
  docmeta registry remove <repo>             Remove a repository from registry
  docmeta registry list                      List all registered repositories
  docmeta registry sync                      Show sync instructions
  docmeta registry export [--output <file>]  Export current project's docmeta
  docmeta registry import <source> --repo <id>  Import a docmeta bundle
  docmeta registry show <repo>               Show cached docmeta for a repo

Repository formats:
  github:org/repo       GitHub repository
  gitlab:org/repo       GitLab repository

Examples:
  docmeta registry add github:myorg/shared-lib
  docmeta registry export -o bundle.json
  docmeta registry import ./bundle.json --repo github:myorg/service
  docmeta registry import /path/to/repo --repo github:myorg/other-service
  docmeta registry show github:myorg/shared-lib

Options:
  --output, -o    Output file for export (default: docmeta-bundle.json)
  --repo, -r      Repository ID for import
  --force, -f     Force overwrite existing entries
  --help, -h      Show this help

The registry is stored at: ~/.docmeta/
`;

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || !options.command) {
    print(HELP);
    return;
  }

  switch (options.command) {
    case 'add':
      cmdAdd(options.target, options);
      break;

    case 'remove':
    case 'rm':
      cmdRemove(options.target);
      break;

    case 'list':
    case 'ls':
      cmdList();
      break;

    case 'sync':
      cmdSync();
      break;

    case 'export':
      cmdExport(options);
      break;

    case 'import':
      cmdImport(options.target, options);
      break;

    case 'show':
      cmdShow(options.target);
      break;

    default:
      printError(`Unknown command: ${options.command}`);
      print(HELP);
      process.exit(1);
  }
}

main();
