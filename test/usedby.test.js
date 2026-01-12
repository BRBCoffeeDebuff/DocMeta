/**
 * Tests for usedby.js functionality
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-usedby-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function runUsedBy(args = '') {
  return execSync(`node ${CLI_PATH} usedby ${args}`, {
    cwd: testDir,
    encoding: 'utf-8',
    timeout: 30000
  });
}

function createDocMeta(dir, content) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, '.docmeta.json'), JSON.stringify(content, null, 2));
}

function readDocMeta(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.docmeta.json'), 'utf-8'));
}

describe('docmeta usedby', () => {
  test('populates usedBy for simple dependency', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    // main.js imports utils.js
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'main.js': {
          purpose: 'Main',
          exports: ['start'],
          uses: ['./utils'],
          usedBy: []
        },
        'utils.js': {
          purpose: 'Utils',
          exports: ['helper'],
          uses: [],
          usedBy: []
        }
      }
    });

    runUsedBy('.');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['utils.js'].usedBy).toContain('/src/main.js');
  });

  test('clears stale usedBy entries', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    // utils.js has stale usedBy entry
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'main.js': {
          purpose: 'Main',
          exports: [],
          uses: [],  // No longer imports utils
          usedBy: []
        },
        'utils.js': {
          purpose: 'Utils',
          exports: ['helper'],
          uses: [],
          usedBy: ['/src/main.js']  // Stale entry
        }
      }
    });

    runUsedBy('.');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['utils.js'].usedBy).toEqual([]);
  });

  test('handles cross-directory dependencies', () => {
    // src/app.js -> src/lib/helper.js
    const srcDir = path.join(testDir, 'src');
    const libDir = path.join(srcDir, 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'App',
      files: {
        'app.js': {
          purpose: 'App',
          exports: [],
          uses: ['./lib/helper'],
          usedBy: []
        }
      }
    });

    createDocMeta(libDir, {
      v: 3,
      purpose: 'Lib',
      files: {
        'helper.js': {
          purpose: 'Helper',
          exports: ['help'],
          uses: [],
          usedBy: []
        }
      }
    });

    runUsedBy('.');

    const libDocMeta = readDocMeta(libDir);
    expect(libDocMeta.files['helper.js'].usedBy).toContain('/src/app.js');
  });

  test('handles @/ path aliases', () => {
    const srcDir = path.join(testDir, 'src');
    const libDir = path.join(testDir, 'lib');
    fs.mkdirSync(srcDir);
    fs.mkdirSync(libDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'App',
      files: {
        'app.js': {
          purpose: 'App',
          exports: [],
          uses: ['@/lib/utils'],
          usedBy: []
        }
      }
    });

    createDocMeta(libDir, {
      v: 3,
      purpose: 'Lib',
      files: {
        'utils.js': {
          purpose: 'Utils',
          exports: [],
          uses: [],
          usedBy: []
        }
      }
    });

    runUsedBy('.');

    const libDocMeta = readDocMeta(libDir);
    expect(libDocMeta.files['utils.js'].usedBy).toContain('/src/app.js');
  });

  test('resolves index.js for directory imports', () => {
    const srcDir = path.join(testDir, 'src');
    const componentsDir = path.join(srcDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });

    // app.js imports ./components (should resolve to ./components/index.js)
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'App',
      files: {
        'app.js': {
          purpose: 'App',
          exports: [],
          uses: ['./components'],
          usedBy: []
        }
      }
    });

    createDocMeta(componentsDir, {
      v: 3,
      purpose: 'Components',
      files: {
        'index.js': {
          purpose: 'Index',
          exports: ['Button'],
          uses: [],
          usedBy: []
        }
      }
    });

    runUsedBy('.');

    const compDocMeta = readDocMeta(componentsDir);
    expect(compDocMeta.files['index.js'].usedBy).toContain('/src/app.js');
  });

  test('handles multiple importers', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'a.js': {
          purpose: 'A',
          exports: [],
          uses: ['./shared'],
          usedBy: []
        },
        'b.js': {
          purpose: 'B',
          exports: [],
          uses: ['./shared'],
          usedBy: []
        },
        'shared.js': {
          purpose: 'Shared',
          exports: ['util'],
          uses: [],
          usedBy: []
        }
      }
    });

    runUsedBy('.');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['shared.js'].usedBy).toContain('/src/a.js');
    expect(docMeta.files['shared.js'].usedBy).toContain('/src/b.js');
    expect(docMeta.files['shared.js'].usedBy.length).toBe(2);
  });

  test('handles circular dependencies', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    // a.js <-> b.js circular import
    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'a.js': {
          purpose: 'A',
          exports: ['fromA'],
          uses: ['./b'],
          usedBy: []
        },
        'b.js': {
          purpose: 'B',
          exports: ['fromB'],
          uses: ['./a'],
          usedBy: []
        }
      }
    });

    // Should not hang or error
    runUsedBy('.');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['a.js'].usedBy).toContain('/src/b.js');
    expect(docMeta.files['b.js'].usedBy).toContain('/src/a.js');
  });

  test('handles TypeScript extensions', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'app.ts': {
          purpose: 'App',
          exports: [],
          uses: ['./types'],  // No extension
          usedBy: []
        },
        'types.ts': {
          purpose: 'Types',
          exports: ['User'],
          uses: [],
          usedBy: []
        }
      }
    });

    runUsedBy('.');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['types.ts'].usedBy).toContain('/src/app.ts');
  });

  test('handles mixed extensions (.js importing .ts)', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'app.js': {
          purpose: 'App',
          exports: [],
          uses: ['./config'],
          usedBy: []
        },
        'config.ts': {
          purpose: 'Config',
          exports: ['config'],
          uses: [],
          usedBy: []
        }
      }
    });

    runUsedBy('.');

    const docMeta = readDocMeta(srcDir);
    // Should resolve ./config to config.ts
    expect(docMeta.files['config.ts'].usedBy).toContain('/src/app.js');
  });

  test('preserves other docmeta fields', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'My purpose',
      files: {
        'main.js': {
          purpose: 'Main entry point',
          exports: ['main'],
          uses: [],
          usedBy: []
        }
      },
      history: [
        ['2025-01-01T00:00:00Z', 'Initial', ['main.js']]
      ],
      updated: '2025-01-01T00:00:00Z'
    });

    runUsedBy('.');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.purpose).toBe('My purpose');
    expect(docMeta.files['main.js'].purpose).toBe('Main entry point');
    expect(docMeta.files['main.js'].exports).toContain('main');
    expect(docMeta.history.length).toBe(1);
  });

  test('creates usedBy links count output', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'main.js': {
          purpose: 'Main',
          exports: [],
          uses: ['./utils'],
          usedBy: []
        },
        'utils.js': {
          purpose: 'Utils',
          exports: [],
          uses: [],
          usedBy: []
        }
      }
    });

    const output = runUsedBy('.');

    expect(output).toContain('usedBy links');
  });
});

describe('docmeta usedby edge cases', () => {
  test('handles empty project', () => {
    // No docmeta files at all
    const output = runUsedBy('.');
    expect(output).toContain('0');
  });

  test('handles files with no imports', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'standalone.js': {
          purpose: 'Standalone',
          exports: ['thing'],
          uses: [],
          usedBy: []
        }
      }
    });

    runUsedBy('.');

    const docMeta = readDocMeta(srcDir);
    expect(docMeta.files['standalone.js'].usedBy).toEqual([]);
  });

  test('handles unresolvable imports gracefully', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'app.js': {
          purpose: 'App',
          exports: [],
          uses: ['./nonexistent'],  // Points to file that doesn't exist
          usedBy: []
        }
      }
    });

    // Should not throw
    expect(() => runUsedBy('.')).not.toThrow();
  });
});
