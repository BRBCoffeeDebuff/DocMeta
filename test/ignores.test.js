/**
 * Tests for lib/ignores.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILES,
  DEFAULT_IGNORE_PATTERNS,
  parseGitignore,
  loadGitignorePatterns,
  getIgnorePatterns,
  shouldIgnore,
  shouldSkipDir
} = require('../bin/lib/ignores');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('DEFAULT_IGNORE_DIRS', () => {
  test('includes common dependency directories', () => {
    expect(DEFAULT_IGNORE_DIRS).toContain('node_modules');
    expect(DEFAULT_IGNORE_DIRS).toContain('vendor');
    expect(DEFAULT_IGNORE_DIRS).toContain('.pnpm');
  });

  test('includes build output directories', () => {
    expect(DEFAULT_IGNORE_DIRS).toContain('dist');
    expect(DEFAULT_IGNORE_DIRS).toContain('build');
    expect(DEFAULT_IGNORE_DIRS).toContain('.next');
  });

  test('includes version control directories', () => {
    expect(DEFAULT_IGNORE_DIRS).toContain('.git');
    expect(DEFAULT_IGNORE_DIRS).toContain('.svn');
  });

  test('includes virtual environment directories', () => {
    expect(DEFAULT_IGNORE_DIRS).toContain('venv');
    expect(DEFAULT_IGNORE_DIRS).toContain('.venv');
  });
});

describe('DEFAULT_IGNORE_FILES', () => {
  test('includes secret files', () => {
    expect(DEFAULT_IGNORE_FILES).toContain('.env');
    expect(DEFAULT_IGNORE_FILES).toContain('secrets.json');
    expect(DEFAULT_IGNORE_FILES).toContain('credentials.json');
  });

  test('includes lock files', () => {
    expect(DEFAULT_IGNORE_FILES).toContain('package-lock.json');
    expect(DEFAULT_IGNORE_FILES).toContain('yarn.lock');
    expect(DEFAULT_IGNORE_FILES).toContain('Cargo.lock');
  });

  test('includes OS files', () => {
    expect(DEFAULT_IGNORE_FILES).toContain('.DS_Store');
    expect(DEFAULT_IGNORE_FILES).toContain('Thumbs.db');
  });
});

describe('DEFAULT_IGNORE_PATTERNS', () => {
  test('includes test file patterns', () => {
    const testPatterns = DEFAULT_IGNORE_PATTERNS.filter(p =>
      p.test('foo.test.js') || p.test('bar.spec.ts')
    );
    expect(testPatterns.length).toBeGreaterThan(0);
  });

  test('matches test files correctly', () => {
    const hasTestMatch = DEFAULT_IGNORE_PATTERNS.some(p => p.test('utils.test.js'));
    const hasSpecMatch = DEFAULT_IGNORE_PATTERNS.some(p => p.test('utils.spec.ts'));
    expect(hasTestMatch).toBe(true);
    expect(hasSpecMatch).toBe(true);
  });

  test('does not match regular source files', () => {
    const matches = DEFAULT_IGNORE_PATTERNS.some(p => p.test('utils.js'));
    expect(matches).toBe(false);
  });
});

describe('parseGitignore', () => {
  test('parses simple patterns', () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules\ndist\n');
    const patterns = parseGitignore(path.join(testDir, '.gitignore'));
    expect(patterns).toContain('node_modules');
    expect(patterns).toContain('dist');
  });

  test('ignores comments', () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), '# Comment\nnode_modules\n');
    const patterns = parseGitignore(path.join(testDir, '.gitignore'));
    expect(patterns).not.toContain('# Comment');
    expect(patterns).toContain('node_modules');
  });

  test('ignores empty lines', () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'a\n\nb\n   \nc');
    const patterns = parseGitignore(path.join(testDir, '.gitignore'));
    expect(patterns).toEqual(['a', 'b', 'c']);
  });

  test('ignores negation patterns', () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'dist\n!dist/keep.js');
    const patterns = parseGitignore(path.join(testDir, '.gitignore'));
    expect(patterns).toContain('dist');
    expect(patterns).not.toContain('!dist/keep.js');
  });

  test('returns empty array for non-existent file', () => {
    const patterns = parseGitignore(path.join(testDir, 'nonexistent'));
    expect(patterns).toEqual([]);
  });
});

describe('loadGitignorePatterns', () => {
  test('loads patterns from .gitignore', () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules\ndist');
    const patterns = loadGitignorePatterns(testDir);
    expect(patterns).toContain('node_modules');
    expect(patterns).toContain('dist');
  });

  test('loads patterns from .dockerignore', () => {
    fs.writeFileSync(path.join(testDir, '.dockerignore'), 'Dockerfile\n*.log');
    const patterns = loadGitignorePatterns(testDir);
    expect(patterns).toContain('Dockerfile');
    expect(patterns).toContain('*.log');
  });

  test('deduplicates patterns from both files', () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'node_modules');
    fs.writeFileSync(path.join(testDir, '.dockerignore'), 'node_modules');
    const patterns = loadGitignorePatterns(testDir);
    expect(patterns.filter(p => p === 'node_modules').length).toBe(1);
  });

  test('returns empty array when no ignore files exist', () => {
    const patterns = loadGitignorePatterns(testDir);
    expect(patterns).toEqual([]);
  });
});

describe('getIgnorePatterns', () => {
  test('includes default dirs, files, and patterns', () => {
    const ignores = getIgnorePatterns(testDir);
    expect(ignores.dirs).toContain('node_modules');
    expect(ignores.files).toContain('.env');
    expect(ignores.patterns.length).toBeGreaterThan(0);
  });

  test('merges gitignore patterns', () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'custom-build/');
    const ignores = getIgnorePatterns(testDir);
    expect(ignores.dirs).toContain('custom-build');
  });

  test('includes custom dirs from options', () => {
    const ignores = getIgnorePatterns(testDir, {
      customIgnoreDirs: ['my-custom-dir']
    });
    expect(ignores.dirs).toContain('my-custom-dir');
  });

  test('includes custom files from options', () => {
    const ignores = getIgnorePatterns(testDir, {
      customIgnoreFiles: ['my-secret.json']
    });
    expect(ignores.files).toContain('my-secret.json');
  });

  test('converts custom pattern strings to RegExp', () => {
    const ignores = getIgnorePatterns(testDir, {
      customIgnorePatterns: ['\\.custom$']
    });
    const hasPattern = ignores.patterns.some(p => p.test('file.custom'));
    expect(hasPattern).toBe(true);
  });

  test('handles invalid regex in custom patterns', () => {
    // Invalid regex should be escaped and treated as literal
    const ignores = getIgnorePatterns(testDir, {
      customIgnorePatterns: ['[invalid']
    });
    expect(ignores.patterns.length).toBeGreaterThan(DEFAULT_IGNORE_PATTERNS.length);
  });
});

describe('shouldIgnore', () => {
  let ignores;

  beforeEach(() => {
    ignores = getIgnorePatterns(testDir);
  });

  test('ignores files in ignored directories', () => {
    expect(shouldIgnore('node_modules/package/index.js', ignores)).toBe(true);
    expect(shouldIgnore('src/node_modules/lib.js', ignores)).toBe(true);
  });

  test('ignores exact file matches', () => {
    expect(shouldIgnore('.DS_Store', ignores)).toBe(true);
    expect(shouldIgnore('package-lock.json', ignores)).toBe(true);
  });

  test('ignores files matching glob patterns', () => {
    expect(shouldIgnore('debug.log', ignores)).toBe(true);
    expect(shouldIgnore('app.min.js', ignores)).toBe(true);
  });

  test('ignores files matching regex patterns', () => {
    expect(shouldIgnore('utils.test.js', ignores)).toBe(true);
    expect(shouldIgnore('component.spec.tsx', ignores)).toBe(true);
  });

  test('does not ignore regular source files', () => {
    expect(shouldIgnore('src/index.js', ignores)).toBe(false);
    expect(shouldIgnore('lib/utils.ts', ignores)).toBe(false);
  });

  test('handles paths with directory prefix', () => {
    expect(shouldIgnore('dist/bundle.js', ignores)).toBe(true);
    expect(shouldIgnore('coverage/lcov.info', ignores)).toBe(true);
  });
});

describe('shouldSkipDir', () => {
  let ignores;

  beforeEach(() => {
    ignores = getIgnorePatterns(testDir);
  });

  test('skips ignored directories', () => {
    expect(shouldSkipDir('node_modules', ignores)).toBe(true);
    expect(shouldSkipDir('dist', ignores)).toBe(true);
    expect(shouldSkipDir('.git', ignores)).toBe(true);
  });

  test('skips hidden directories (starting with .)', () => {
    expect(shouldSkipDir('.hidden', ignores)).toBe(true);
    expect(shouldSkipDir('.config', ignores)).toBe(true);
  });

  test('does not skip regular directories', () => {
    expect(shouldSkipDir('src', ignores)).toBe(false);
    expect(shouldSkipDir('lib', ignores)).toBe(false);
    expect(shouldSkipDir('components', ignores)).toBe(false);
  });
});
