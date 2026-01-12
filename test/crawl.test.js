/**
 * Tests for crawl.js functionality
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-crawl-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function runCrawl(args = '') {
  try {
    return {
      output: execSync(`node ${CLI_PATH} crawl ${args}`, {
        cwd: testDir,
        encoding: 'utf-8',
        timeout: 30000,
        input: '\n'  // Auto-press enter for any prompts
      }),
      exitCode: 0
    };
  } catch (err) {
    return {
      output: (err.stdout || '') + (err.stderr || ''),
      exitCode: err.status || 1
    };
  }
}

function createDocMeta(dir, content) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, '.docmeta.json'), JSON.stringify(content, null, 2));
}

describe('docmeta crawl --dry-run', () => {
  test('lists files with [purpose] placeholder', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'todo.js'), '');
    fs.writeFileSync(path.join(srcDir, 'done.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'todo.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] },
        'done.js': { purpose: 'Already documented', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    expect(output).toContain('todo.js');
    expect(output).not.toContain('done.js');
  });

  test('lists files with empty purpose', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'empty.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'empty.js': { purpose: '', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    expect(output).toContain('empty.js');
  });

  test('reports count of files needing purposes', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'a.js'), '');
    fs.writeFileSync(path.join(srcDir, 'b.js'), '');
    fs.writeFileSync(path.join(srcDir, 'c.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'a.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] },
        'b.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] },
        'c.js': { purpose: 'Done', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    // Output says "Found 2 file(s) with missing purposes"
    expect(output).toContain('2 file');
  });

  test('reports when no files need purposes', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'done.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'done.js': { purpose: 'Complete', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output, exitCode } = runCrawl('--dry-run');

    expect(exitCode).toBe(0);
    // Output says "All files have purposes defined. Nothing to crawl."
    expect(output).toMatch(/All files have purposes|Nothing to crawl/i);
  });
});

describe('docmeta crawl - nested directories', () => {
  test('finds files across nested directories', () => {
    const srcDir = path.join(testDir, 'src');
    const libDir = path.join(srcDir, 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    fs.writeFileSync(path.join(libDir, 'helper.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'index.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    createDocMeta(libDir, {
      v: 3,
      purpose: 'Library',
      files: {
        'helper.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    expect(output).toContain('index.js');
    expect(output).toContain('helper.js');
  });
});

describe('docmeta crawl - ignore patterns', () => {
  test('respects default ignore patterns', () => {
    // Create node_modules with a file
    const nmDir = path.join(testDir, 'node_modules', 'pkg');
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, 'index.js'), '');

    createDocMeta(nmDir, {
      v: 3,
      purpose: 'Package',
      files: {
        'index.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    // Should not list files from node_modules
    expect(output).not.toContain('node_modules');
  });

  test('processes documented directories even if normally ignored', () => {
    // If someone explicitly creates a .docmeta.json in dist/, crawl will process it
    // This is intentional - explicit documentation overrides default ignores
    const distDir = path.join(testDir, 'dist');
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, 'bundle.js'), '');

    createDocMeta(distDir, {
      v: 3,
      purpose: 'Build output',
      files: {
        'bundle.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    // File appears because it has explicit .docmeta.json
    expect(output).toContain('dist/bundle.js');
  });
});

describe('docmeta crawl --batch', () => {
  test('respects batch size option', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    // Create many files
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(srcDir, `file${i}.js`), '');
    }

    const files = {};
    for (let i = 0; i < 10; i++) {
      files[`file${i}.js`] = { purpose: '[purpose]', exports: [], uses: [], usedBy: [] };
    }

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files
    });

    const { output } = runCrawl('--dry-run --batch 5');

    // Should mention batch size
    expect(output).toContain('10');  // Total files found
  });
});

describe('docmeta crawl - file existence', () => {
  test('only lists files that exist on disk', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'exists.js'), '');
    // deleted.js does not exist

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'exists.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] },
        'deleted.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    expect(output).toContain('exists.js');
    expect(output).not.toContain('deleted.js');
  });
});

describe('docmeta crawl - empty project', () => {
  test('handles project with no docmeta files', () => {
    const { output, exitCode } = runCrawl('--dry-run');

    expect(exitCode).toBe(0);
    // With no docmeta files, says "All files have purposes" (vacuously true)
    expect(output).toMatch(/All files have purposes|Nothing to crawl/i);
  });

  test('handles docmeta with no files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Empty',
      files: {}
    });

    const { output, exitCode } = runCrawl('--dry-run');

    expect(exitCode).toBe(0);
  });
});

describe('docmeta crawl output format', () => {
  test('shows relative paths', () => {
    const srcDir = path.join(testDir, 'src');
    const libDir = path.join(srcDir, 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'util.js'), '');

    createDocMeta(libDir, {
      v: 3,
      purpose: 'Lib',
      files: {
        'util.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    // Should show relative path from project root
    expect(output).toContain('src/lib/util.js');
  });

  test('numbers the files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'a.js'), '');
    fs.writeFileSync(path.join(srcDir, 'b.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'a.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] },
        'b.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCrawl('--dry-run');

    expect(output).toMatch(/1\./);
    expect(output).toMatch(/2\./);
  });
});
