#!/usr/bin/env node
/**
 * docmeta ignore - Manage ignore and entry point patterns
 *
 * Usage:
 *   docmeta ignore                       # List all ignore patterns
 *   docmeta ignore --add-dir <name>      # Add directory to ignore
 *   docmeta ignore --add-file <name>     # Add file pattern to ignore
 *   docmeta ignore --add-pattern <pat>   # Add regex pattern to ignore
 *   docmeta ignore --add-entry <pattern> # Add entry point pattern (glob)
 *   docmeta ignore --remove <name>       # Remove from custom ignores/entries
 *   docmeta ignore --reset               # Reset to defaults (remove custom)
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
    addEntry: null,
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
    } else if (arg === '--add-entry' || arg === '-e') {
      result.addEntry = args[++i];
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
      !result.addEntry && !result.remove && !result.reset && !result.help) {
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

  printHeader('DocMeta Ignore & Entry Point Patterns');

  // Show custom ignores first (user-added)
  const customDirs = config.customIgnoreDirs || [];
  const customFiles = config.customIgnoreFiles || [];
  const customPatterns = config.customIgnorePatterns || [];
  const customEntryPoints = config.customEntryPointPatterns || [];

  if (customDirs.length > 0 || customFiles.length > 0 || customPatterns.length > 0 || customEntryPoints.length > 0) {
    print(`${colors.cyan}Custom settings${colors.reset} (from .docmetarc.json):`);
    if (customDirs.length > 0) {
      print(`  Ignored directories: ${customDirs.join(', ')}`);
    }
    if (customFiles.length > 0) {
      print(`  Ignored files: ${customFiles.join(', ')}`);
    }
    if (customPatterns.length > 0) {
      print(`  Ignored patterns: ${customPatterns.join(', ')}`);
    }
    if (customEntryPoints.length > 0) {
      print(`  Entry point patterns: ${customEntryPoints.join(', ')}`);
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

  // Show entry point patterns
  const defaultEntryPoints = config.entryPointPatterns || DEFAULT_CONFIG.entryPointPatterns || [];
  const allEntryPoints = [...defaultEntryPoints, ...customEntryPoints];
  print(`${colors.cyan}Entry point patterns${colors.reset} (${allEntryPoints.length} patterns for graph analysis):`);
  print(`  ${colors.dim}${allEntryPoints.slice(0, 8).join(', ')}${allEntryPoints.length > 8 ? `, ... +${allEntryPoints.length - 8} more` : ''}${colors.reset}`);
  print('');

  // Check for .gitignore
  const gitignorePath = path.join(rootPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    print(`${colors.dim}Also loading patterns from .gitignore${colors.reset}`);
  }

  print('');
  print('Commands:');
  print(`  ${colors.bright}docmeta ignore --add-dir <name>${colors.reset}       Add ignored directory`);
  print(`  ${colors.bright}docmeta ignore --add-file <pattern>${colors.reset}   Add ignored file pattern`);
  print(`  ${colors.bright}docmeta ignore --add-pattern <regex>${colors.reset}  Add ignored regex pattern`);
  print(`  ${colors.bright}docmeta ignore --add-entry <glob>${colors.reset}     Add entry point pattern (e.g., "api/**/handler.ts")`);
  print('');
}

function addIgnore(rootPath, type, value) {
  const config = loadConfig(rootPath);

  // Initialize arrays if needed
  if (!config.customIgnoreDirs) config.customIgnoreDirs = [];
  if (!config.customIgnoreFiles) config.customIgnoreFiles = [];
  if (!config.customIgnorePatterns) config.customIgnorePatterns = [];
  if (!config.customEntryPointPatterns) config.customEntryPointPatterns = [];

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
    case 'entry':
      targetArray = config.customEntryPointPatterns;
      typeName = 'entry point pattern';
      // Validate glob pattern (basic check)
      if (!value || value.trim().length === 0) {
        printError('Entry point pattern cannot be empty');
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

  if (type === 'entry') {
    print(`  Files matching this pattern will be treated as entry points in graph analysis.`);
  }

  return true;
}

function removeIgnore(rootPath, value) {
  const config = loadConfig(rootPath);

  let found = false;

  // Try to remove from each list (including entry point patterns)
  for (const key of ['customIgnoreDirs', 'customIgnoreFiles', 'customIgnorePatterns', 'customEntryPointPatterns']) {
    if (config[key] && config[key].includes(value)) {
      config[key] = config[key].filter(v => v !== value);
      found = true;
    }
  }

  if (!found) {
    printError(`"${value}" not found in custom settings`);
    print('');
    print('Note: You can only remove custom ignores/entry patterns, not defaults.');
    print('To see custom settings, run: docmeta ignore --list');
    return false;
  }

  saveConfig(config, rootPath);
  printSuccess(`Removed "${value}" from custom settings`);

  return true;
}

function resetIgnores(rootPath) {
  const config = loadConfig(rootPath);

  config.customIgnoreDirs = [];
  config.customIgnoreFiles = [];
  config.customIgnorePatterns = [];
  config.customEntryPointPatterns = [];

  saveConfig(config, rootPath);
  printSuccess('Reset custom ignores and entry points to empty');
  print('  Default ignores and entry point patterns still apply');

  return true;
}

// ============================================================================
// Main
// ============================================================================

const HELP = `
docmeta ignore - Manage ignore and entry point patterns

Usage:
  docmeta ignore                        List all patterns
  docmeta ignore --add-dir <name>       Add directory to ignore
  docmeta ignore --add-file <pattern>   Add file pattern to ignore
  docmeta ignore --add-pattern <regex>  Add regex pattern to ignore
  docmeta ignore --add-entry <glob>     Add entry point pattern (for graph analysis)
  docmeta ignore --remove <name>        Remove from custom settings
  docmeta ignore --reset                Reset custom settings to empty

Options:
  --add-dir, -d      Add a directory name to ignore (e.g., "vendor", "lib")
  --add-file, -f     Add a file pattern to ignore (e.g., "*.generated.ts")
  --add-pattern, -p  Add a regex pattern to ignore (e.g., "\\.stories\\.")
  --add-entry, -e    Add an entry point pattern (glob) for graph analysis
  --remove, -r       Remove a pattern from custom settings
  --reset            Clear all custom settings (keeps defaults)
  --list, -l         List all patterns (default)
  --help, -h         Show this help

Examples:
  docmeta ignore --add-dir vendor                  # Ignore vendor/ directories
  docmeta ignore --add-file "*.gen.ts"             # Ignore generated TS files
  docmeta ignore --add-pattern "\\.story\\."       # Ignore Storybook files
  docmeta ignore --add-entry "api/**/handler.ts"   # Mark as entry points
  docmeta ignore --add-entry "workers/**/*.js"     # Workers are entry points
  docmeta ignore --remove vendor                   # Remove custom setting

Entry Point Patterns:
  Entry points are files that frameworks call directly (Next.js routes, workers, etc.).
  They don't need to be imported by other code to be considered "used".
  Default patterns include: app/**/route.ts, app/**/page.tsx, bin/**/*.js, etc.
  Add custom patterns for framework-specific entry points in your project.

Custom settings are saved to .docmetarc.json and merged with:
  - Default ignores (node_modules, dist, .env, etc.)
  - Default entry point patterns (Next.js routes, etc.)
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
  } else if (options.addEntry) {
    addIgnore(rootPath, 'entry', options.addEntry);
  } else if (options.remove) {
    removeIgnore(rootPath, options.remove);
  } else if (options.reset) {
    resetIgnores(rootPath);
  } else if (options.list) {
    listIgnores(rootPath);
  }
}

main();
