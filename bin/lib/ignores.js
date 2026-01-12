/**
 * Smart ignore patterns for DocMeta
 *
 * Combines:
 * - Project .gitignore (if present)
 * - Default patterns for build artifacts, dependencies, secrets
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Default Ignore Patterns
// ============================================================================

/**
 * Directories to always ignore (dependencies, build output, caches)
 */
const DEFAULT_IGNORE_DIRS = [
  // Package managers / dependencies
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  '.pnpm',

  // Build output
  'dist',
  'build',
  'out',
  'output',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '_site',
  'public/build',
  '.parcel-cache',
  '.turbo',

  // Compiled/generated
  '__pycache__',
  '*.egg-info',
  '.eggs',
  'target',          // Rust/Java
  'bin/Debug',       // .NET
  'bin/Release',
  'obj',

  // Version control
  '.git',
  '.svn',
  '.hg',

  // IDE/Editor
  '.idea',
  '.vscode',
  '.vs',
  '*.swp',
  '*.swo',
  '.project',
  '.settings',

  // Virtual environments
  'venv',
  '.venv',
  'env',
  '.env',            // Also a secrets file pattern
  'virtualenv',
  '.virtualenv',
  'conda-env',

  // Test/Coverage
  'coverage',
  '.nyc_output',
  'htmlcov',
  '.pytest_cache',
  '.tox',
  '.nox',
  '__snapshots__',

  // Misc caches
  '.cache',
  '.sass-cache',
  '.eslintcache',
  '.stylelintcache',
  'tmp',
  'temp',
  '.temp',
  '.tmp',

  // Cloud/Deploy
  '.vercel',
  '.netlify',
  '.serverless',
  '.aws-sam',
  'cdk.out',

  // Mobile
  'Pods',            // iOS
  '.gradle',         // Android
  'build',

  // Documentation generators
  '_build',
  'site',
  'docs/_build',
];

/**
 * Files to always ignore (secrets, locks, logs, configs with secrets)
 */
const DEFAULT_IGNORE_FILES = [
  // Secrets and environment
  '.env',
  '.env.*',
  '*.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  'local.settings.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  '.secrets',
  '*.pem',
  '*.key',
  '*.crt',
  '*.p12',
  '*.pfx',
  'credentials.json',
  'service-account.json',
  'serviceAccountKey.json',
  '.netrc',
  '.npmrc',           // Can contain tokens
  '.pypirc',

  // Lock files (no value in documenting)
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
  'pubspec.lock',
  'Pipfile.lock',

  // Logs
  '*.log',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  'lerna-debug.log*',
  '.pnpm-debug.log*',

  // OS files
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',

  // Misc
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.chunk.js',
  '*.bundle.js',
];

/**
 * Patterns to always ignore (regex-style)
 */
const DEFAULT_IGNORE_PATTERNS = [
  // Test files (optional - configurable)
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.go$/,
  /_test\.py$/,
  /test_.*\.py$/,
  /__tests__/,
  /__mocks__/,

  // Generated files
  /\.generated\./,
  /\.g\.[^/]+$/,      // .g.dart, .g.cs, etc.
  /\.freezed\./,

  // Minified
  /\.min\.[^/]+$/,

  // Source maps
  /\.map$/,
];

// ============================================================================
// Gitignore Parser
// ============================================================================

/**
 * Parse a .gitignore file and extract patterns
 * @param {string} gitignorePath - Path to .gitignore
 * @returns {string[]} Array of ignore patterns
 */
function parseGitignore(gitignorePath) {
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    const patterns = [];

    for (let line of content.split('\n')) {
      line = line.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) continue;

      // Skip negation patterns (we don't support them)
      if (line.startsWith('!')) continue;

      patterns.push(line);
    }

    return patterns;
  } catch {
    return [];
  }
}

/**
 * Find and parse all .gitignore files from root to target
 * @param {string} rootPath - Project root
 * @returns {string[]} Combined patterns
 */
function loadGitignorePatterns(rootPath) {
  const patterns = [];

  // Check for .gitignore in root
  const gitignorePath = path.join(rootPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    patterns.push(...parseGitignore(gitignorePath));
  }

  // Also check for .dockerignore (often has similar patterns)
  const dockerignorePath = path.join(rootPath, '.dockerignore');
  if (fs.existsSync(dockerignorePath)) {
    patterns.push(...parseGitignore(dockerignorePath));
  }

  return [...new Set(patterns)]; // Dedupe
}

// ============================================================================
// Combined Ignore Logic
// ============================================================================

/**
 * Get all ignore patterns for a project
 * @param {string} rootPath - Project root
 * @param {Object} options - Options including custom ignores from config
 * @param {string[]} options.customIgnoreDirs - Extra directories to ignore
 * @param {string[]} options.customIgnoreFiles - Extra files to ignore
 * @param {string[]} options.customIgnorePatterns - Extra patterns (strings)
 * @returns {Object} { dirs: string[], files: string[], patterns: RegExp[] }
 */
function getIgnorePatterns(rootPath, options = {}) {
  const gitignorePatterns = loadGitignorePatterns(rootPath);

  // Separate gitignore patterns into dirs and files
  const gitignoreDirs = [];
  const gitignoreFiles = [];

  for (const pattern of gitignorePatterns) {
    // Patterns ending with / are directories
    if (pattern.endsWith('/')) {
      gitignoreDirs.push(pattern.slice(0, -1));
    } else if (pattern.includes('/')) {
      // Path patterns - could be dir or file
      gitignoreDirs.push(pattern);
    } else if (pattern.includes('.') || pattern.includes('*')) {
      gitignoreFiles.push(pattern);
    } else {
      // Bare names are usually directories
      gitignoreDirs.push(pattern);
    }
  }

  // Get custom ignores from options (usually from .docmetarc.json)
  const customDirs = options.customIgnoreDirs || [];
  const customFiles = options.customIgnoreFiles || [];
  const customPatternStrings = options.customIgnorePatterns || [];

  // Convert custom pattern strings to RegExp
  const customPatterns = customPatternStrings.map(p => {
    try {
      return new RegExp(p);
    } catch {
      // If invalid regex, treat as literal string match
      return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  });

  return {
    dirs: [...new Set([...DEFAULT_IGNORE_DIRS, ...gitignoreDirs, ...customDirs])],
    files: [...new Set([...DEFAULT_IGNORE_FILES, ...gitignoreFiles, ...customFiles])],
    patterns: [...DEFAULT_IGNORE_PATTERNS, ...customPatterns],
  };
}

/**
 * Check if a path should be ignored
 * @param {string} filePath - Path to check (relative to root)
 * @param {Object} ignores - From getIgnorePatterns()
 * @returns {boolean}
 */
function shouldIgnore(filePath, ignores) {
  const fileName = path.basename(filePath);
  const dirName = path.dirname(filePath);

  // Check directory ignores
  for (const dir of ignores.dirs) {
    if (filePath.includes(`/${dir}/`) ||
        filePath.startsWith(`${dir}/`) ||
        dirName === dir ||
        dirName.endsWith(`/${dir}`)) {
      return true;
    }
  }

  // Check file ignores (simple glob matching)
  for (const pattern of ignores.files) {
    if (pattern.includes('*')) {
      // Simple glob: *.log, .env.*
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );
      if (regex.test(fileName)) return true;
    } else if (fileName === pattern) {
      return true;
    }
  }

  // Check regex patterns
  for (const pattern of ignores.patterns) {
    if (pattern.test(filePath) || pattern.test(fileName)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a directory should be skipped entirely
 * @param {string} dirName - Directory name (not full path)
 * @param {Object} ignores - From getIgnorePatterns()
 * @returns {boolean}
 */
function shouldSkipDir(dirName, ignores) {
  return ignores.dirs.includes(dirName) || dirName.startsWith('.');
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILES,
  DEFAULT_IGNORE_PATTERNS,
  parseGitignore,
  loadGitignorePatterns,
  getIgnorePatterns,
  shouldIgnore,
  shouldSkipDir,
};
