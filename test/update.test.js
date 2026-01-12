/**
 * Tests for update.js functionality
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-update-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function runUpdate(args) {
  try {
    return execSync(`node ${CLI_PATH} update ${args}`, {
      cwd: testDir,
      encoding: 'utf-8',
      timeout: 30000
    });
  } catch (err) {
    // Return stdout+stderr even on non-zero exit
    return err.stdout + err.stderr;
  }
}

function runUpdateJson(args) {
  const output = runUpdate(args);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Failed to parse JSON: ${output}`);
  }
}

function createDocMeta(dir, content) {
  const docMetaPath = path.join(dir, '.docmeta.json');
  fs.writeFileSync(docMetaPath, JSON.stringify(content, null, 2));
  return docMetaPath;
}

function readDocMeta(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.docmeta.json'), 'utf-8'));
}

describe('docmeta update --purpose', () => {
  test('updates file purpose', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    createDocMeta(srcDir, {
      v: 3,
      purpose: '[purpose]',
      files: {
        'index.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    const result = runUpdateJson('src/index.js --purpose "Main entry point"');

    expect(result.success).toBe(true);
    expect(result.operations).toContainEqual(
      expect.objectContaining({ type: 'purpose', file: 'index.js' })
    );

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['index.js'].purpose).toBe('Main entry point');
  });

  test('updates folder purpose', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    createDocMeta(srcDir, {
      v: 3,
      purpose: '[purpose]',
      files: {}
    });

    const result = runUpdateJson('src --purpose "Source code directory"');

    expect(result.success).toBe(true);

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.purpose).toBe('Source code directory');
  });

  test('adds undocumented file with analysis', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'new.js'),
      `import { foo } from './foo';
       export const bar = 1;`
    );
    fs.writeFileSync(path.join(srcDir, 'foo.js'), '');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {}
    });

    const result = runUpdateJson('src/new.js --purpose "New module"');

    expect(result.success).toBe(true);
    expect(result.operations).toContainEqual(
      expect.objectContaining({ type: 'added', file: 'new.js' })
    );

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['new.js'].purpose).toBe('New module');
    expect(docMeta.files['new.js'].exports).toContain('bar');
    expect(docMeta.files['new.js'].uses).toContain('./foo');
  });
});

describe('docmeta update --history', () => {
  test('adds history entry', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'index.js': { purpose: 'Entry', exports: [], uses: [], usedBy: [] }
      },
      history: []
    });

    const result = runUpdateJson('src/index.js --history "Added feature X"');

    expect(result.success).toBe(true);
    expect(result.operations).toContainEqual(
      expect.objectContaining({ type: 'history' })
    );

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.history.length).toBe(1);
    expect(docMeta.history[0][1]).toBe('Added feature X');
    expect(docMeta.history[0][2]).toContain('index.js');
  });

  test('history entry has ISO 8601 timestamp', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'index.js': { purpose: 'Entry', exports: [], uses: [], usedBy: [] }
      },
      history: []
    });

    runUpdate('src/index.js --history "Test"');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.history[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('trims history to maxHistoryEntries', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    // Create config with max 3 entries
    fs.writeFileSync(
      path.join(testDir, '.docmetarc.json'),
      JSON.stringify({ maxHistoryEntries: 3 })
    );

    // Create docmeta with 3 existing entries
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'index.js': { purpose: 'Entry', exports: [], uses: [], usedBy: [] }
      },
      history: [
        ['2025-01-03T00:00:00Z', 'Entry 3', ['index.js']],
        ['2025-01-02T00:00:00Z', 'Entry 2', ['index.js']],
        ['2025-01-01T00:00:00Z', 'Entry 1', ['index.js']]
      ]
    });

    runUpdate('src/index.js --history "Entry 4"');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.history.length).toBe(3);
    expect(docMeta.history[0][1]).toBe('Entry 4');
    expect(docMeta.history[2][1]).toBe('Entry 2'); // Entry 1 trimmed
  });
});

describe('docmeta update --sync', () => {
  test('adds new files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'existing.js'), '');
    fs.writeFileSync(path.join(srcDir, 'new.js'), 'export const x = 1;');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'existing.js': { purpose: 'Existing', exports: [], uses: [], usedBy: [] }
      },
      history: []
    });

    const result = runUpdateJson('--sync');

    expect(result.success).toBe(true);
    expect(result.operations).toContainEqual(
      expect.objectContaining({ type: 'sync', added: 1 })
    );

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['new.js']).toBeDefined();
    expect(docMeta.files['new.js'].purpose).toBe('[purpose]');
    expect(docMeta.files['new.js'].exports).toContain('x');
  });

  test('removes deleted files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'remaining.js'), '');
    // Note: deleted.js does not exist on disk
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'remaining.js': { purpose: 'Remaining', exports: [], uses: [], usedBy: [] },
        'deleted.js': { purpose: 'Deleted', exports: [], uses: [], usedBy: [] }
      },
      history: []
    });

    const result = runUpdateJson('--sync');

    expect(result.success).toBe(true);
    expect(result.operations).toContainEqual(
      expect.objectContaining({ type: 'sync', removed: 1 })
    );

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['remaining.js']).toBeDefined();
    expect(docMeta.files['deleted.js']).toBeUndefined();
  });

  test('adds sync history entry', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'new.js'), '');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {},
      history: []
    });

    runUpdate('--sync');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.history.length).toBe(1);
    expect(docMeta.history[0][1]).toContain('Sync:');
    expect(docMeta.history[0][1]).toContain('added');
  });

  test('reports no changes when in sync', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'index.js': { purpose: 'Index', exports: [], uses: [], usedBy: [] }
      },
      history: []
    });

    const result = runUpdateJson('--sync');

    expect(result.success).toBe(true);
    expect(result.operations).toEqual([]);
  });
});

describe('docmeta update --sync --refresh', () => {
  test('re-analyzes existing files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    // File has exports but docmeta shows empty
    fs.writeFileSync(path.join(srcDir, 'module.js'), 'export const foo = 1;');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'module.js': { purpose: 'Module', exports: [], uses: [], usedBy: [] }
      },
      history: []
    });

    const result = runUpdateJson('--sync --refresh');

    expect(result.success).toBe(true);
    expect(result.operations).toContainEqual(
      expect.objectContaining({ type: 'sync', refreshed: 1 })
    );

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['module.js'].exports).toContain('foo');
  });

  test('updates uses array on refresh', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'main.js'),
      `import { helper } from './helper';`
    );
    fs.writeFileSync(path.join(srcDir, 'helper.js'), '');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'main.js': { purpose: 'Main', exports: [], uses: [], usedBy: [] },
        'helper.js': { purpose: 'Helper', exports: [], uses: [], usedBy: [] }
      },
      history: []
    });

    runUpdate('--sync --refresh');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['main.js'].uses).toContain('./helper');
  });

  test('does not refresh unchanged files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'unchanged.js'), 'export const x = 1;');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'unchanged.js': { purpose: 'Unchanged', exports: ['x'], uses: [], usedBy: [] }
      },
      history: []
    });

    const result = runUpdateJson('--sync --refresh');

    expect(result.success).toBe(true);
    // Should have no operations since exports/uses haven't changed
    expect(result.operations).toEqual([]);
  });
});

describe('docmeta update error handling', () => {
  test('returns error for missing target without --sync', () => {
    const result = runUpdateJson('--purpose "test"');

    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_TARGET');
  });

  test('returns error for non-existent file', () => {
    const result = runUpdateJson('nonexistent.js --purpose "test"');

    expect(result.success).toBe(false);
    expect(result.error).toBe('FILE_NOT_FOUND');
  });

  test('returns error when no .docmeta.json exists', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    const result = runUpdateJson('src/index.js --purpose "test"');

    expect(result.success).toBe(false);
    expect(result.error).toBe('DOCMETA_NOT_FOUND');
    expect(result.hint).toContain('init');
  });
});

describe('docmeta update --human', () => {
  test('outputs human-readable format', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Test',
      files: {
        'index.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
      }
    });

    const output = runUpdate('src/index.js --purpose "Updated" --human');

    expect(output).toContain('✅');
    expect(output).toContain('Updated purpose');
    // Should not be JSON
    expect(() => JSON.parse(output)).toThrow();
  });
});
