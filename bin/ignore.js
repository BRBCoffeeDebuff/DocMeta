#!/usr/bin/env node
/**
 * docmeta ignore - Manage ignore patterns
 *
 * Usage:
 *   docmeta ignore                     # List all ignore patterns
 *   docmeta ignore --add-dir <name>    # Add directory to ignore
 *   docmeta ignore --add-file <name>   # Add file pattern to ignore
 *   docmeta ignore --add-pattern <pat> # Add regex pattern to ignore
 *   docmeta ignore --remove <name>     # Remove from custom ignores
 *   docmeta ignore --reset             # Reset to defaults (remove custom)
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, DEFAULT_CONFIG } = require('./lib/config');
const { getIgnorePatterns, DEFAULT_IGNORE_DIRS, DEFAULT_IGNORE_FILES } = require('./lib/ignores');

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

function printHeader(msg) {
  print(`\n${colors.bright}${colors.blue}${msg}${colors.reset}\n`);
}

function parseArgs(args) {
  const result = {
    addDir: null,
    addFile: null,
    addPattern: null,
    remove: null,
    reset: false,
    list: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--add-dir' || arg === '-d') {
      result.addDir = args[++i];
    } else if (arg === '--add-file' || arg === '-f') {
      result.addFile = args[++i];
    } else if (arg === '--add-pattern' || arg === '-p') {
      result.addPattern = args[++i];
    } else if (arg === '--remove' || arg === '-r') {
      result.remove = args[++i];
    } else if (arg === '--reset') {
      result.reset = true;
    } else if (arg === '--list' || arg === '-l') {
      result.list = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    }
  }

  // Default to list if no action specified
  if (!result.addDir && !result.addFile && !result.addPattern &&
      !result.remove && !result.reset && !result.help) {
    result.list = true;
  }

  return result;
}

// ============================================================================
// Actions
// ============================================================================

function listIgnores(rootPath) {
  const config = loadConfig(rootPath);
  const ignores = getIgnorePatterns(rootPath, {
    customIgnoreDirs: config.customIgnoreDirs,
    customIgnoreFiles: config.customIgnoreFiles,
    customIgnorePatterns: config.customIgnorePatterns,
  });

  printHeader('DocMeta Ignore Patterns');

  // Show custom ignores first (user-added)
  const customDirs = config.customIgnoreDirs || [];
  const customFiles = config.customIgnoreFiles || [];
  const customPatterns = config.customIgnorePatterns || [];

  if (customDirs.length > 0 || customFiles.length > 0 || customPatterns.length > 0) {
    print(`${colors.cyan}Custom ignores${colors.reset} (from .docmetarc.json):`);
    if (customDirs.length > 0) {
      print(`  Directories: ${customDirs.join(', ')}`);
    }
    if (customFiles.length > 0) {
      print(`  Files: ${customFiles.join(', ')}`);
    }
    if (customPatterns.length > 0) {
      print(`  Patterns: ${customPatterns.join(', ')}`);
    }
    print('');
  }

  // Show summary of all ignores
  print(`${colors.cyan}All ignored directories${colors.reset} (${ignores.dirs.length} total):`);
  print(`  ${colors.dim}${ignores.dirs.slice(0, 15).join(', ')}${ignores.dirs.length > 15 ? `, ... +${ignores.dirs.length - 15} more` : ''}${colors.reset}`);
  print('');

  print(`${colors.cyan}All ignored files${colors.reset} (${ignores.files.length} total):`);
  print(`  ${colors.dim}${ignores.files.slice(0, 10).join(', ')}${ignores.files.length > 10 ? `, ... +${ignores.files.length - 10} more` : ''}${colors.reset}`);
  print('');

  print(`${colors.cyan}Ignore patterns${colors.reset} (${ignores.patterns.length} regex patterns)`);
  print('');

  // Check for .gitignore
  const gitignorePath = path.join(rootPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    print(`${colors.dim}Also loading patterns from .gitignore${colors.reset}`);
  }

  print('');
  print('To add custom ignores:');
  print(`  ${colors.bright}docmeta ignore --add-dir <name>${colors.reset}     Add directory`);
  print(`  ${colors.bright}docmeta ignore --add-file <pattern>${colors.reset}  Add file pattern`);
  print(`  ${colors.bright}docmeta ignore --add-pattern <regex>${colors.reset} Add regex pattern`);
  print('');
}

function addIgnore(rootPath, type, value) {
  const config = loadConfig(rootPath);

  // Initialize arrays if needed
  if (!config.customIgnoreDirs) config.customIgnoreDirs = [];
  if (!config.customIgnoreFiles) config.customIgnoreFiles = [];
  if (!config.customIgnorePatterns) config.customIgnorePatterns = [];

  let targetArray;
  let typeName;

  switch (type) {
    case 'dir':
      targetArray = config.customIgnoreDirs;
      typeName = 'directory';
      break;
    case 'file':
      targetArray = config.customIgnoreFiles;
      typeName = 'file pattern';
      break;
    case 'pattern':
      targetArray = config.customIgnorePatterns;
      typeName = 'pattern';
      // Validate regex
      try {
        new RegExp(value);
      } catch (e) {
        printError(`Invalid regex pattern: ${e.message}`);
        return false;
      }
      break;
  }

  if (targetArray.includes(value)) {
    printError(`"${value}" is already in custom ${typeName}s`);
    return false;
  }

  targetArray.push(value);
  saveConfig(config, rootPath);

  printSuccess(`Added "${value}" to custom ${typeName}s`);
  print(`  Saved to .docmetarc.json`);

  return true;
}

function removeIgnore(rootPath, value) {
  const config = loadConfig(rootPath);

  let found = false;

  // Try to remove from each list
  for (const key of ['customIgnoreDirs', 'customIgnoreFiles', 'customIgnorePatterns']) {
    if (config[key] && config[key].includes(value)) {
      config[key] = config[key].filter(v => v !== value);
      found = true;
    }
  }

  if (!found) {
    printError(`"${value}" not found in custom ignores`);
    print('');
    print('Note: You can only remove custom ignores, not defaults.');
    print('To see custom ignores, run: docmeta ignore --list');
    return false;
  }

  saveConfig(config, rootPath);
  printSuccess(`Removed "${value}" from custom ignores`);

  return true;
}

function resetIgnores(rootPath) {
  const config = loadConfig(rootPath);

  config.customIgnoreDirs = [];
  config.customIgnoreFiles = [];
  config.customIgnorePatterns = [];

  saveConfig(config, rootPath);
  printSuccess('Reset custom ignores to empty');
  print('  Default ignores still apply');

  return true;
}

// ============================================================================
// Main
// ============================================================================

const HELP = `
docmeta ignore - Manage ignore patterns

Usage:
  docmeta ignore                        List all ignore patterns
  docmeta ignore --add-dir <name>       Add directory to ignore
  docmeta ignore --add-file <pattern>   Add file pattern to ignore
  docmeta ignore --add-pattern <regex>  Add regex pattern to ignore
  docmeta ignore --remove <name>        Remove from custom ignores
  docmeta ignore --reset                Reset custom ignores to empty

Options:
  --add-dir, -d      Add a directory name to ignore (e.g., "vendor", "lib")
  --add-file, -f     Add a file pattern to ignore (e.g., "*.generated.ts")
  --add-pattern, -p  Add a regex pattern to ignore (e.g., "\\.stories\\.")
  --remove, -r       Remove a pattern from custom ignores
  --reset            Clear all custom ignores (keeps defaults)
  --list, -l         List all ignore patterns (default)
  --help, -h         Show this help

Examples:
  docmeta ignore --add-dir vendor           # Ignore vendor/ directories
  docmeta ignore --add-file "*.gen.ts"      # Ignore generated TS files
  docmeta ignore --add-pattern "\\.story\\." # Ignore Storybook files
  docmeta ignore --remove vendor            # Stop ignoring vendor/

Custom ignores are saved to .docmetarc.json and merged with:
  - Default ignores (node_modules, dist, .env, etc.)
  - Patterns from .gitignore (auto-loaded)
`;

function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    print(HELP);
    return;
  }

  const rootPath = process.cwd();

  if (options.addDir) {
    addIgnore(rootPath, 'dir', options.addDir);
  } else if (options.addFile) {
    addIgnore(rootPath, 'file', options.addFile);
  } else if (options.addPattern) {
    addIgnore(rootPath, 'pattern', options.addPattern);
  } else if (options.remove) {
    removeIgnore(rootPath, options.remove);
  } else if (options.reset) {
    resetIgnores(rootPath);
  } else if (options.list) {
    listIgnores(rootPath);
  }
}

main();
