/**
 * Shared configuration and utilities for DocMeta CLI
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  maxHistoryEntries: 10,

  // User-customizable ignore lists (added to defaults in ignores.js)
  customIgnoreDirs: [],      // Extra directories to ignore
  customIgnoreFiles: [],     // Extra files to ignore
  customIgnorePatterns: [],  // Extra patterns (strings, converted to regex)

  // Entry point patterns for cluster detection (framework-specific)
  // Files matching these patterns are considered entry points even if nothing imports them
  // Default patterns cover common frameworks (Next.js, etc.)
  entryPointPatterns: [
    // Next.js / App Router
    'app/**/route.ts',       // API routes
    'app/**/route.js',
    'app/**/page.tsx',       // Pages
    'app/**/page.jsx',
    'app/**/layout.tsx',     // Layouts
    'app/**/layout.jsx',
    'pages/**/*.tsx',        // Pages Router
    'pages/**/*.jsx',
    'pages/api/**/*.ts',     // API routes (Pages Router)
    'pages/api/**/*.js',
    // CLI and scripts
    'bin/**/*.js',
    'scripts/**/*.js',
    'scripts/**/*.ts',
    // Common entry files
    '**/cli.js',
    '**/cli.ts',
    '**/main.js',
    '**/main.ts',
    '**/index.js',
    '**/index.ts',
    '**/server.js',
    '**/server.ts',
    '**/app.js',
    '**/app.ts',
  ],

  // User-customizable entry point patterns (added to defaults)
  customEntryPointPatterns: [],

  // Legacy config (used by init.js directly)
  ignoreDirs: [
    'node_modules', '.git', '.next', 'dist', 'build', '.vercel',
    '__pycache__', '.pytest_cache', 'venv', '.venv', 'target',
    'coverage', '.nyc_output', '.cache'
  ],
  codeExtensions: [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyw',
    '.go',
    '.rs',
    '.java', '.kt', '.scala',
    '.rb',
    '.php',
    '.cs',
    '.swift',
  ],
  ignoreFiles: [
    '.DS_Store', 'thumbs.db',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'poetry.lock', 'Cargo.lock', 'go.sum'
  ],
  ignorePatterns: [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /_test\.go$/,
    /_test\.py$/,
    /test_.*\.py$/,
  ]
};

// ============================================================================
// TypeScript Path Alias Resolution
// ============================================================================

/**
 * Load path aliases from tsconfig.json or jsconfig.json
 * @param {string} rootPath - Project root directory
 * @returns {Object} Map of alias patterns to resolved paths
 */
function loadPathAliases(rootPath) {
  const aliases = {
    // Default aliases (always available)
    '@/*': ['/*'],
    '~/*': ['/*']
  };

  // Try tsconfig.json first, then jsconfig.json
  const configFiles = ['tsconfig.json', 'jsconfig.json'];

  for (const configFile of configFiles) {
    const configPath = path.join(rootPath, configFile);

    try {
      if (!fs.existsSync(configPath)) continue;

      const content = fs.readFileSync(configPath, 'utf-8');
      // Remove comments (JSON with comments support)
      const cleanedContent = content
        .replace(/\/\*[\s\S]*?\*\//g, '')  // Block comments
        .replace(/\/\/.*$/gm, '');          // Line comments

      const config = JSON.parse(cleanedContent);

      // Get baseUrl (defaults to '.')
      const baseUrl = config.compilerOptions?.baseUrl || '.';

      // Get paths mapping
      const paths = config.compilerOptions?.paths || {};

      // Convert paths to our format
      for (const [pattern, targets] of Object.entries(paths)) {
        if (Array.isArray(targets) && targets.length > 0) {
          // Resolve targets relative to baseUrl
          const resolvedTargets = targets.map(target => {
            // If baseUrl is '.', the target is relative to project root
            // If baseUrl is 'src', target './utils' becomes '/src/utils'
            if (baseUrl === '.') {
              return target.startsWith('./') ? target.slice(1) : '/' + target;
            } else {
              const base = '/' + baseUrl.replace(/^\.\//, '');
              return target.startsWith('./')
                ? base + target.slice(1)
                : base + '/' + target;
            }
          });
          aliases[pattern] = resolvedTargets;
        }
      }

      // Found and parsed a config, stop looking
      break;
    } catch (err) {
      // Invalid JSON or other error, continue to next file
      continue;
    }
  }

  return aliases;
}

/**
 * Resolve an import path using path aliases
 * @param {string} importPath - The import path to resolve (e.g., '@components/Button')
 * @param {Object} aliases - Path aliases from loadPathAliases()
 * @param {string} fromDir - Directory the import is from (for relative resolution)
 * @param {string} rootPath - Project root
 * @returns {string|null} Resolved absolute path or null if not resolvable
 */
function resolvePathAlias(importPath, aliases, fromDir, rootPath) {
  // Handle relative imports directly
  if (importPath.startsWith('.')) {
    const fromRelative = '/' + path.relative(rootPath, fromDir).replace(/\\/g, '/');
    return path.posix.normalize(path.posix.join(fromRelative, importPath));
  }

  // Try each alias pattern
  for (const [pattern, targets] of Object.entries(aliases)) {
    // Pattern is like '@/*' or '@components/*' or 'utils'
    const isWildcard = pattern.endsWith('/*');
    const patternBase = isWildcard ? pattern.slice(0, -2) : pattern;

    if (isWildcard) {
      // Wildcard pattern: @/* matches @/anything
      if (importPath.startsWith(patternBase + '/')) {
        const remainder = importPath.slice(patternBase.length + 1);
        // Use first target (most common case)
        const target = targets[0];
        const targetBase = target.endsWith('/*') ? target.slice(0, -2) : target;
        return targetBase + '/' + remainder;
      }
    } else {
      // Exact match pattern
      if (importPath === patternBase) {
        const target = targets[0];
        return target.endsWith('/*') ? target.slice(0, -2) : target;
      }
    }
  }

  // Not a recognized alias
  return null;
}

// ============================================================================
// Config File Management
// ============================================================================

// DOCMETA_CONFIG: Override the config filename (default: .docmetarc.json)
const CONFIG_FILENAME = process.env.DOCMETA_CONFIG || '.docmetarc.json';

/**
 * Load configuration from .docmetarc.json or return defaults
 * Returns a deep copy to prevent mutation of defaults
 */
function loadConfig(rootPath = process.cwd()) {
  const configPath = path.join(rootPath, CONFIG_FILENAME);

  // Deep clone default config to prevent mutation
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG, (key, value) => {
    // RegExp objects can't be JSON serialized, handle them specially
    if (value instanceof RegExp) {
      return { __regexp: value.source, __flags: value.flags };
    }
    return value;
  }));

  // Restore RegExp objects
  if (config.ignorePatterns) {
    config.ignorePatterns = config.ignorePatterns.map(p =>
      p.__regexp ? new RegExp(p.__regexp, p.__flags) : p
    );
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(content);
    return { ...config, ...userConfig };
  } catch {
    return config;
  }
}

/**
 * Save configuration to .docmetarc.json
 */
function saveConfig(config, rootPath = process.cwd()) {
  const configPath = path.join(rootPath, CONFIG_FILENAME);

  // Only save non-default values
  const toSave = {};
  for (const [key, value] of Object.entries(config)) {
    if (JSON.stringify(value) !== JSON.stringify(DEFAULT_CONFIG[key])) {
      toSave[key] = value;
    }
  }

  if (Object.keys(toSave).length > 0) {
    fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2) + '\n');
  }
}

// ============================================================================
// History Management
// ============================================================================

/**
 * Add a history entry and trim to max length
 * @param {Object} docMeta - The .docmeta.json content
 * @param {string} summary - Change summary
 * @param {string[]} files - Files that changed
 * @param {Object} config - Configuration (for maxHistoryEntries)
 * @returns {Object} Updated docMeta
 */
function addHistoryEntry(docMeta, summary, files, config = DEFAULT_CONFIG) {
  const timestamp = new Date().toISOString();
  const entry = [timestamp, summary, files];

  if (!docMeta.history) {
    docMeta.history = [];
  }

  // Add new entry at the beginning
  docMeta.history.unshift(entry);

  // Trim to max length
  const maxEntries = config.maxHistoryEntries || DEFAULT_CONFIG.maxHistoryEntries;
  if (docMeta.history.length > maxEntries) {
    docMeta.history = docMeta.history.slice(0, maxEntries);
  }

  // Update timestamp
  docMeta.updated = new Date().toISOString();

  return docMeta;
}

/**
 * Trim existing history to max length
 * @param {Object} docMeta - The .docmeta.json content
 * @param {Object} config - Configuration
 * @returns {Object} Updated docMeta
 */
function trimHistory(docMeta, config = DEFAULT_CONFIG) {
  if (!docMeta.history) return docMeta;

  const maxEntries = config.maxHistoryEntries || DEFAULT_CONFIG.maxHistoryEntries;
  if (docMeta.history.length > maxEntries) {
    docMeta.history = docMeta.history.slice(0, maxEntries);
  }

  return docMeta;
}

// ============================================================================
// DocMeta File Operations
// ============================================================================

/**
 * Read a .docmeta.json file
 * @param {string} docMetaPath - Path to .docmeta.json
 * @returns {Object|null} Parsed content or null if not found/invalid
 */
function readDocMeta(docMetaPath) {
  try {
    const content = fs.readFileSync(docMetaPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write a .docmeta.json file
 * @param {string} docMetaPath - Path to .docmeta.json
 * @param {Object} docMeta - Content to write
 */
function writeDocMeta(docMetaPath, docMeta) {
  docMeta.updated = new Date().toISOString();
  fs.writeFileSync(docMetaPath, JSON.stringify(docMeta, null, 2) + '\n');
}

/**
 * Find .docmeta.json for a given file or directory
 * @param {string} targetPath - Path to file or directory
 * @returns {string|null} Path to .docmeta.json or null
 */
function findDocMetaFor(targetPath) {
  const stat = fs.statSync(targetPath);
  const dir = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  const docMetaPath = path.join(dir, '.docmeta.json');

  if (fs.existsSync(docMetaPath)) {
    return docMetaPath;
  }

  return null;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  DEFAULT_CONFIG,
  CONFIG_FILENAME,
  loadConfig,
  saveConfig,
  addHistoryEntry,
  trimHistory,
  readDocMeta,
  writeDocMeta,
  findDocMetaFor,
  loadPathAliases,
  resolvePathAlias
};
