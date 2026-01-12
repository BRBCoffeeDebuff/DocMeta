#!/usr/bin/env node
/**
 * docmeta update - Update .docmeta.json files
 *
 * Usage:
 *   docmeta update <file> --purpose "New purpose"
 *   docmeta update <file> --history "What changed"
 *   docmeta update <folder> --purpose "Folder purpose"
 *   docmeta update --sync              # Sync all: add new files, remove deleted
 *
 * Output is JSON by default for agent consumption. Use --human for readable output.
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, addHistoryEntry, trimHistory, readDocMeta, writeDocMeta } = require('./lib/config');

// ============================================================================
// File Analysis (shared logic with init.js)
// ============================================================================

/**
 * Extract exports from JavaScript/TypeScript file
 */
function extractJSExports(content) {
  const exports = new Set();

  // Named exports: export const/function/class/type/interface Name
  const namedExports = content.matchAll(
    /export\s+(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g
  );
  for (const match of namedExports) {
    exports.add(match[1]);
  }

  // Named exports: export { Name, Other }
  const bracketExports = content.matchAll(/export\s*\{([^}]+)\}/g);
  for (const match of bracketExports) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    names.forEach(n => n && exports.add(n));
  }

  // Default export
  if (/export\s+default\s/.test(content)) {
    exports.add('default');
  }

  return [...exports];
}

/**
 * Extract internal imports from JavaScript/TypeScript file
 */
function extractJSImports(content) {
  const imports = new Set();

  // import ... from 'path'
  const importMatches = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
  for (const match of importMatches) {
    const importPath = match[1];
    // Only internal imports (relative, @/, ~/)
    if (importPath.startsWith('.') ||
        importPath.startsWith('@/') ||
        importPath.startsWith('~/')) {
      imports.add(importPath);
    }
  }

  // require('path')
  const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of requireMatches) {
    const importPath = match[1];
    if (importPath.startsWith('.') ||
        importPath.startsWith('@/') ||
        importPath.startsWith('~/')) {
      imports.add(importPath);
    }
  }

  return [...imports];
}

/**
 * Extract exports from Python file
 */
function extractPythonExports(content) {
  const exports = new Set();

  // __all__ = ['name1', 'name2']
  const allMatch = content.match(/__all__\s*=\s*\[([^\]]+)\]/);
  if (allMatch) {
    const names = allMatch[1].match(/['"](\w+)['"]/g);
    if (names) {
      names.forEach(n => exports.add(n.replace(/['"]/g, '')));
    }
    return [...exports];
  }

  // def function_name / class ClassName (public = no underscore prefix)
  const defs = content.matchAll(/^(?:def|class)\s+([a-zA-Z]\w*)/gm);
  for (const match of defs) {
    exports.add(match[1]);
  }

  return [...exports];
}

/**
 * Extract imports from Python file
 */
function extractPythonImports(content) {
  const imports = new Set();

  // from .module import ... (relative imports)
  const relativeImports = content.matchAll(/from\s+(\.+\w*)/g);
  for (const match of relativeImports) {
    imports.add(match[1]);
  }

  return [...imports];
}

/**
 * Analyze a file and extract metadata
 */
function analyzeFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);

    let exports = [];
    let uses = [];

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      exports = extractJSExports(content);
      uses = extractJSImports(content);
    } else if (['.py', '.pyw'].includes(ext)) {
      exports = extractPythonExports(content);
      uses = extractPythonImports(content);
    }

    return { exports, uses };
  } catch {
    return { exports: [], uses: [] };
  }
}

// ============================================================================
// Configuration
// ============================================================================

const CODE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.go', '.rs', '.java', '.kt', '.rb', '.php'
];

const IGNORE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.go$/,
  /_test\.py$/,
  /test_.*\.py$/,
];

// Error types for structured output
const ErrorType = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  DOCMETA_NOT_FOUND: 'DOCMETA_NOT_FOUND',
  INVALID_DOCMETA: 'INVALID_DOCMETA',
  MISSING_TARGET: 'MISSING_TARGET',
  WRITE_FAILED: 'WRITE_FAILED',
};

// ============================================================================
// Output Helpers
// ============================================================================

let humanMode = false;

function output(result) {
  if (humanMode) {
    if (result.success) {
      console.log('\n📝 DocMeta Update\n');
      for (const op of result.operations || []) {
        if (op.type === 'purpose') {
          console.log(`✅ Updated purpose for ${op.file}`);
        } else if (op.type === 'history') {
          console.log(`✅ Added history entry`);
        } else if (op.type === 'added') {
          console.log(`✅ Added ${op.file} to documentation`);
        } else if (op.type === 'sync') {
          const parts = [`+${op.added}`, `-${op.removed}`];
          if (op.refreshed) parts.push(`~${op.refreshed}`);
          console.log(`✅ ${op.path}: ${parts.join(' ')}`);
        }
      }
      if (result.operations?.length === 0) {
        console.log('✅ All documentation is in sync');
      }
      console.log('');
    } else {
      console.error(`\n❌ ${result.message}\n`);
      if (result.hint) {
        console.error(`   ${result.hint}\n`);
      }
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

function success(operations = []) {
  return { success: true, operations };
}

function error(type, message, details = {}) {
  return { success: false, error: type, message, ...details };
}

// ============================================================================
// Helpers
// ============================================================================

function isCodeFile(filename) {
  if (IGNORE_PATTERNS.some(p => p.test(filename))) return false;
  const ext = path.extname(filename);
  return CODE_EXTENSIONS.includes(ext);
}

function getCodeFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => {
      const stat = fs.statSync(path.join(dir, f));
      return stat.isFile() && isCodeFile(f);
    });
  } catch {
    return [];
  }
}

function parseArgs(args) {
  const result = {
    target: null,
    purpose: null,
    history: null,
    sync: false,
    refresh: false,
    human: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--purpose' || arg === '-p') {
      result.purpose = args[++i];
    } else if (arg === '--history' || arg === '-h') {
      result.history = args[++i];
    } else if (arg === '--sync' || arg === '-s') {
      result.sync = true;
    } else if (arg === '--refresh' || arg === '-r') {
      result.refresh = true;
    } else if (arg === '--human') {
      result.human = true;
    } else if (arg === '--help') {
      result.help = true;
    } else if (!arg.startsWith('-')) {
      result.target = arg;
    }
  }

  return result;
}

// ============================================================================
// Update Operations
// ============================================================================

/**
 * Update a specific file's metadata
 */
function updateFile(targetPath, options, config) {
  const absPath = path.resolve(targetPath);
  const dir = path.dirname(absPath);
  const fileName = path.basename(absPath);
  const docMetaPath = path.join(dir, '.docmeta.json');
  const operations = [];

  if (!fs.existsSync(docMetaPath)) {
    return error(ErrorType.DOCMETA_NOT_FOUND, `No .docmeta.json found in ${dir}`, {
      hint: 'Run "docmeta init" first.',
      path: dir
    });
  }

  const docMeta = readDocMeta(docMetaPath);

  if (!docMeta.files[fileName]) {
    // File not documented yet - add it with analysis
    const analysis = analyzeFile(absPath);
    docMeta.files[fileName] = {
      purpose: options.purpose || '[purpose]',
      exports: analysis.exports,
      uses: analysis.uses,
      usedBy: []
    };
    operations.push({ type: 'added', file: fileName });
  } else if (options.purpose) {
    // Update existing file's purpose
    docMeta.files[fileName].purpose = options.purpose;
    operations.push({ type: 'purpose', file: fileName, value: options.purpose });
  }

  // Add history entry if provided
  if (options.history) {
    addHistoryEntry(docMeta, options.history, [fileName], config);
    operations.push({ type: 'history', file: fileName, entry: options.history });
  }

  // Trim history and save
  try {
    trimHistory(docMeta, config);
    writeDocMeta(docMetaPath, docMeta);
  } catch (err) {
    return error(ErrorType.WRITE_FAILED, `Failed to write ${docMetaPath}`, {
      path: docMetaPath,
      details: err.message
    });
  }

  return success(operations);
}

/**
 * Update a folder's metadata
 */
function updateFolder(targetPath, options, config) {
  const absPath = path.resolve(targetPath);
  const docMetaPath = path.join(absPath, '.docmeta.json');
  const operations = [];

  if (!fs.existsSync(docMetaPath)) {
    return error(ErrorType.DOCMETA_NOT_FOUND, `No .docmeta.json found in ${absPath}`, {
      hint: 'Run "docmeta init" first.',
      path: absPath
    });
  }

  const docMeta = readDocMeta(docMetaPath);

  if (options.purpose) {
    docMeta.purpose = options.purpose;
    operations.push({ type: 'purpose', file: absPath, value: options.purpose });
  }

  if (options.history) {
    const files = Object.keys(docMeta.files);
    addHistoryEntry(docMeta, options.history, files, config);
    operations.push({ type: 'history', file: absPath, entry: options.history });
  }

  try {
    trimHistory(docMeta, config);
    writeDocMeta(docMetaPath, docMeta);
  } catch (err) {
    return error(ErrorType.WRITE_FAILED, `Failed to write ${docMetaPath}`, {
      path: docMetaPath,
      details: err.message
    });
  }

  return success(operations);
}

/**
 * Sync a .docmeta.json with actual files (add new, remove deleted, optionally refresh)
 */
function syncFolder(docMetaPath, config, refresh = false) {
  const dir = path.dirname(docMetaPath);
  const docMeta = readDocMeta(docMetaPath);

  if (!docMeta) {
    return { error: ErrorType.INVALID_DOCMETA, path: docMetaPath };
  }

  const actualFiles = getCodeFiles(dir);
  const documentedFiles = Object.keys(docMeta.files || {});

  let added = 0;
  let removed = 0;
  let refreshed = 0;
  const changes = [];

  // Add new files
  for (const file of actualFiles) {
    if (!documentedFiles.includes(file)) {
      const filePath = path.join(dir, file);
      const analysis = analyzeFile(filePath);
      docMeta.files[file] = {
        purpose: '[purpose]',
        exports: analysis.exports,
        uses: analysis.uses,
        usedBy: []
      };
      added++;
      changes.push(file);
    } else if (refresh) {
      // Re-analyze existing files to update exports/uses
      const filePath = path.join(dir, file);
      const analysis = analyzeFile(filePath);
      const existing = docMeta.files[file];
      const oldExports = JSON.stringify(existing.exports || []);
      const oldUses = JSON.stringify(existing.uses || []);
      const newExports = JSON.stringify(analysis.exports);
      const newUses = JSON.stringify(analysis.uses);

      if (oldExports !== newExports || oldUses !== newUses) {
        existing.exports = analysis.exports;
        existing.uses = analysis.uses;
        refreshed++;
        changes.push(file);
      }
    }
  }

  // Remove deleted files
  for (const file of documentedFiles) {
    if (!actualFiles.includes(file)) {
      delete docMeta.files[file];
      removed++;
      changes.push(file);
    }
  }

  if (added > 0 || removed > 0 || refreshed > 0) {
    const summary = [];
    if (added > 0) summary.push(`added ${added} file(s)`);
    if (removed > 0) summary.push(`removed ${removed} file(s)`);
    if (refreshed > 0) summary.push(`refreshed ${refreshed} file(s)`);

    addHistoryEntry(docMeta, `Sync: ${summary.join(', ')}`, changes, config);
    trimHistory(docMeta, config);
    writeDocMeta(docMetaPath, docMeta);

    return { added, removed, refreshed, path: dir };
  }

  return null;
}

/**
 * Sync all .docmeta.json files in a directory tree
 */
function syncAll(rootPath, config, refresh = false) {
  const IGNORE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__'];
  const operations = [];
  const errors = [];

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.name === '.docmeta.json') {
          const result = syncFolder(fullPath, config, refresh);
          if (result) {
            if (result.error) {
              errors.push(result);
            } else {
              operations.push({
                type: 'sync',
                path: path.relative(rootPath, result.path) || '.',
                added: result.added,
                removed: result.removed,
                refreshed: result.refreshed || 0
              });
            }
          }
          continue;
        }

        if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        }
      }
    } catch {
      // Skip unreadable
    }
  }

  walk(rootPath);

  if (errors.length > 0) {
    return error(ErrorType.INVALID_DOCMETA, `${errors.length} invalid .docmeta.json file(s)`, {
      errors,
      operations
    });
  }

  return success(operations);
}

// ============================================================================
// Main
// ============================================================================

const HELP = `
docmeta update - Update .docmeta.json files

Usage:
  docmeta update <file> --purpose "description"   Update a file's purpose
  docmeta update <file> --history "what changed"  Add history entry for a file
  docmeta update <folder> --purpose "description" Update a folder's purpose
  docmeta update --sync                           Sync all: add new files, remove deleted
  docmeta update --sync --refresh                 Re-analyze all files' exports/uses

Options:
  --purpose, -p    Set purpose description
  --history, -h    Add a history entry
  --sync, -s       Sync documentation with actual files
  --refresh, -r    Re-analyze exports/uses for all files (use with --sync)
  --human          Human-readable output (default is JSON)
  --help           Show this help

Output:
  Default output is JSON for agent consumption:
  {"success": true, "operations": [...]}
  {"success": false, "error": "ERROR_TYPE", "message": "..."}

Examples:
  docmeta update src/auth.ts --purpose "JWT token generation and validation"
  docmeta update src/auth.ts --history "Added refresh token support"
  docmeta update src/lib --purpose "Shared utility functions"
  docmeta update --sync
  docmeta update --sync --refresh  # Re-analyze all imports/exports

Configuration:
  Set maxHistoryEntries in .docmetarc.json (default: 10)
`;

function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  humanMode = options.human;

  if (options.help || (args.length === 0)) {
    console.log(HELP);
    return;
  }

  const rootPath = process.cwd();
  const config = loadConfig(rootPath);
  let result;

  // Sync mode (with optional refresh)
  if (options.sync) {
    result = syncAll(rootPath, config, options.refresh);
    output(result);
    process.exit(result.success ? 0 : 1);
    return;
  }

  // Target required for other operations
  if (!options.target) {
    result = error(ErrorType.MISSING_TARGET, 'Please specify a file or folder to update', {
      hint: 'Run "docmeta update --help" for usage'
    });
    output(result);
    process.exit(1);
    return;
  }

  const targetPath = path.resolve(options.target);

  if (!fs.existsSync(targetPath)) {
    result = error(ErrorType.FILE_NOT_FOUND, `Not found: ${targetPath}`, {
      path: targetPath
    });
    output(result);
    process.exit(1);
    return;
  }

  const stat = fs.statSync(targetPath);

  if (stat.isDirectory()) {
    result = updateFolder(targetPath, options, config);
  } else {
    result = updateFile(targetPath, options, config);
  }

  output(result);
  process.exit(result.success ? 0 : 1);
}

main();
