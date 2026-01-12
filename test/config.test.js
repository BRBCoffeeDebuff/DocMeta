/**
 * Tests for lib/config.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  addHistoryEntry,
  trimHistory,
  readDocMeta,
  writeDocMeta,
  findDocMetaFor
} = require('../bin/lib/config');

// Create a temporary directory for each test
let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  test('returns default config when no .docmetarc.json exists', () => {
    const config = loadConfig(testDir);
    expect(config.maxHistoryEntries).toBe(10);
    expect(config.customIgnoreDirs).toEqual([]);
  });

  test('merges user config with defaults', () => {
    const userConfig = { maxHistoryEntries: 20, customIgnoreDirs: ['mydir'] };
    fs.writeFileSync(
      path.join(testDir, '.docmetarc.json'),
      JSON.stringify(userConfig)
    );

    const config = loadConfig(testDir);
    expect(config.maxHistoryEntries).toBe(20);
    expect(config.customIgnoreDirs).toEqual(['mydir']);
    expect(config.ignoreDirs).toEqual(DEFAULT_CONFIG.ignoreDirs); // default preserved
  });

  test('handles invalid JSON gracefully', () => {
    fs.writeFileSync(path.join(testDir, '.docmetarc.json'), 'not json');
    const config = loadConfig(testDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});

describe('saveConfig', () => {
  test('saves non-default values only', () => {
    const config = { ...DEFAULT_CONFIG, maxHistoryEntries: 15 };
    saveConfig(config, testDir);

    const saved = JSON.parse(
      fs.readFileSync(path.join(testDir, '.docmetarc.json'), 'utf-8')
    );
    expect(saved).toEqual({ maxHistoryEntries: 15 });
  });

  test('does not create file if all values are default', () => {
    saveConfig(DEFAULT_CONFIG, testDir);
    expect(fs.existsSync(path.join(testDir, '.docmetarc.json'))).toBe(false);
  });
});

describe('addHistoryEntry', () => {
  test('adds entry at beginning of history', () => {
    const docMeta = { v: 3, files: {}, history: [] };
    const result = addHistoryEntry(docMeta, 'Test change', ['file.js']);

    expect(result.history.length).toBe(1);
    expect(result.history[0][1]).toBe('Test change');
    expect(result.history[0][2]).toEqual(['file.js']);
  });

  test('creates history array if missing', () => {
    const docMeta = { v: 3, files: {} };
    const result = addHistoryEntry(docMeta, 'Test', ['file.js']);

    expect(Array.isArray(result.history)).toBe(true);
    expect(result.history.length).toBe(1);
  });

  test('trims history to maxHistoryEntries', () => {
    const docMeta = { v: 3, files: {}, history: [] };
    const config = { maxHistoryEntries: 3 };

    // Add 5 entries
    for (let i = 0; i < 5; i++) {
      addHistoryEntry(docMeta, `Change ${i}`, ['file.js'], config);
    }

    expect(docMeta.history.length).toBe(3);
    expect(docMeta.history[0][1]).toBe('Change 4'); // Most recent first
  });

  test('uses ISO 8601 timestamps', () => {
    const docMeta = { v: 3, files: {}, history: [] };
    const result = addHistoryEntry(docMeta, 'Test', ['file.js']);

    const timestamp = result.history[0][0];
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('updates the updated field', () => {
    const docMeta = { v: 3, files: {}, history: [] };
    const result = addHistoryEntry(docMeta, 'Test', ['file.js']);

    expect(result.updated).toBeDefined();
    expect(result.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('trimHistory', () => {
  test('trims history to max entries', () => {
    const docMeta = {
      v: 3,
      files: {},
      history: [
        ['2025-01-01T00:00:00Z', 'Entry 1', ['a.js']],
        ['2025-01-02T00:00:00Z', 'Entry 2', ['b.js']],
        ['2025-01-03T00:00:00Z', 'Entry 3', ['c.js']],
      ]
    };
    const config = { maxHistoryEntries: 2 };

    const result = trimHistory(docMeta, config);
    expect(result.history.length).toBe(2);
  });

  test('handles missing history gracefully', () => {
    const docMeta = { v: 3, files: {} };
    const result = trimHistory(docMeta);
    expect(result.history).toBeUndefined();
  });
});

describe('readDocMeta', () => {
  test('reads and parses valid .docmeta.json', () => {
    const docMeta = { v: 3, purpose: 'Test', files: {} };
    fs.writeFileSync(
      path.join(testDir, '.docmeta.json'),
      JSON.stringify(docMeta)
    );

    const result = readDocMeta(path.join(testDir, '.docmeta.json'));
    expect(result).toEqual(docMeta);
  });

  test('returns null for non-existent file', () => {
    const result = readDocMeta(path.join(testDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    fs.writeFileSync(path.join(testDir, '.docmeta.json'), 'invalid');
    const result = readDocMeta(path.join(testDir, '.docmeta.json'));
    expect(result).toBeNull();
  });
});

describe('writeDocMeta', () => {
  test('writes formatted JSON with newline', () => {
    const docMeta = { v: 3, purpose: 'Test', files: {} };
    const docMetaPath = path.join(testDir, '.docmeta.json');

    writeDocMeta(docMetaPath, docMeta);

    const content = fs.readFileSync(docMetaPath, 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
    expect(JSON.parse(content).purpose).toBe('Test');
  });

  test('updates the updated timestamp', () => {
    const docMeta = { v: 3, purpose: 'Test', files: {} };
    const docMetaPath = path.join(testDir, '.docmeta.json');

    writeDocMeta(docMetaPath, docMeta);

    const content = JSON.parse(fs.readFileSync(docMetaPath, 'utf-8'));
    expect(content.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('findDocMetaFor', () => {
  test('finds .docmeta.json for a file', () => {
    // Create directory structure
    const subDir = path.join(testDir, 'src');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, '.docmeta.json'), '{}');
    fs.writeFileSync(path.join(subDir, 'index.js'), '');

    const result = findDocMetaFor(path.join(subDir, 'index.js'));
    expect(result).toBe(path.join(subDir, '.docmeta.json'));
  });

  test('finds .docmeta.json for a directory', () => {
    const subDir = path.join(testDir, 'src');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, '.docmeta.json'), '{}');

    const result = findDocMetaFor(subDir);
    expect(result).toBe(path.join(subDir, '.docmeta.json'));
  });

  test('returns null when no .docmeta.json exists', () => {
    const subDir = path.join(testDir, 'src');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'index.js'), '');

    const result = findDocMetaFor(path.join(subDir, 'index.js'));
    expect(result).toBeNull();
  });
});
