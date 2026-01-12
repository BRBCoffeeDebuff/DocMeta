/**
 * Tests for check.js functionality
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-check-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function runCheck(args = '.') {
  try {
    return {
      output: execSync(`node ${CLI_PATH} check ${args}`, {
        cwd: testDir,
        encoding: 'utf-8',
        timeout: 30000
      }),
      exitCode: 0
    };
  } catch (err) {
    return {
      output: err.stdout + err.stderr,
      exitCode: err.status
    };
  }
}

function createDocMeta(dir, content) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, '.docmeta.json'), JSON.stringify(content, null, 2));
}

describe('docmeta check - healthy documentation', () => {
  test('passes when all files have purposes', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source code',
      files: {
        'index.js': {
          purpose: 'Main entry point',
          exports: [],
          uses: [],
          usedBy: []
        }
      }
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(0);
    expect(output).toContain('✅');
    expect(output).toContain('look good');
  });

  test('reports correct file counts', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'a.js'), '');
    fs.writeFileSync(path.join(srcDir, 'b.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'a.js': { purpose: 'File A', exports: [], uses: [], usedBy: [] },
        'b.js': { purpose: 'File B', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCheck();

    expect(output).toContain('2/2');
    expect(output).toContain('code files covered');
  });
});

describe('docmeta check - missing purposes', () => {
  test('detects [purpose] placeholders', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'todo.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'todo.js': {
          purpose: '[purpose]',
          exports: [],
          uses: [],
          usedBy: []
        }
      }
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(1);
    expect(output).toContain('missing purpose');
    expect(output).toContain('todo.js');
  });

  test('detects empty purposes', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'empty.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'empty.js': {
          purpose: '',
          exports: [],
          uses: [],
          usedBy: []
        }
      }
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(1);
    expect(output).toContain('empty.js');
  });

  test('detects folder missing purpose', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: '[purpose]',  // Folder purpose missing
      files: {
        'index.js': { purpose: 'Index', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(1);
    expect(output).toContain('folder purpose');
  });
});

describe('docmeta check - undocumented files', () => {
  test('detects files not in .docmeta.json', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'documented.js'), '');
    fs.writeFileSync(path.join(srcDir, 'undocumented.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'documented.js': { purpose: 'Documented', exports: [], uses: [], usedBy: [] }
        // undocumented.js not in files
      }
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(1);
    expect(output).toContain('undocumented');
    expect(output).toContain('undocumented.js');
  });

  test('ignores test files in undocumented check', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    fs.writeFileSync(path.join(srcDir, 'index.test.js'), '');  // Test file

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'index.js': { purpose: 'Index', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output, exitCode } = runCheck();

    // Should pass - test file is ignored
    expect(exitCode).toBe(0);
    expect(output).not.toContain('index.test.js');
  });
});

describe('docmeta check - stale entries', () => {
  test('detects files in docmeta that no longer exist', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'exists.js'), '');
    // deleted.js does not exist on disk

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'exists.js': { purpose: 'Exists', exports: [], uses: [], usedBy: [] },
        'deleted.js': { purpose: 'Deleted', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(1);
    expect(output).toContain('stale');
    expect(output).toContain('deleted.js');
  });
});

describe('docmeta check - shared code without usedBy', () => {
  test('passes for exported code with empty usedBy (not enforced)', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'utils.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'utils.js': {
          purpose: 'Utilities',
          exports: ['helper', 'format'],  // Has exports
          uses: [],
          usedBy: []  // But no consumers - this is OK
        }
      }
    });

    const { output, exitCode } = runCheck();

    // Empty usedBy is not an error - it might be intentional
    expect(exitCode).toBe(0);
    expect(output).toContain('look good');
  });
});

describe('docmeta check - multiple issues', () => {
  test('reports all issues found', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'good.js'), '');
    fs.writeFileSync(path.join(srcDir, 'undocumented.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: '[purpose]',  // Missing folder purpose
      files: {
        'good.js': { purpose: 'Good file', exports: [], uses: [], usedBy: [] },
        'todo.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] },  // Stale + missing purpose
      }
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(1);
    // Should report multiple types of issues
    const issueTypes = ['purpose', 'undocumented', 'stale'].filter(
      type => output.toLowerCase().includes(type)
    );
    expect(issueTypes.length).toBeGreaterThan(1);
  });
});

describe('docmeta check - nested directories', () => {
  test('checks all nested directories', () => {
    const srcDir = path.join(testDir, 'src');
    const libDir = path.join(srcDir, 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    fs.writeFileSync(path.join(libDir, 'helper.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'index.js': { purpose: 'Index', exports: [], uses: [], usedBy: [] }
      }
    });

    createDocMeta(libDir, {
      v: 3,
      purpose: 'Library',
      files: {
        'helper.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }  // Missing purpose
      }
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(1);
    expect(output).toContain('helper.js');
  });

  test('reports folder count correctly', () => {
    const srcDir = path.join(testDir, 'src');
    const libDir = path.join(srcDir, 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    fs.writeFileSync(path.join(libDir, 'util.js'), '');

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Source',
      files: {
        'index.js': { purpose: 'Index', exports: [], uses: [], usedBy: [] }
      }
    });

    createDocMeta(libDir, {
      v: 3,
      purpose: 'Lib',
      files: {
        'util.js': { purpose: 'Util', exports: [], uses: [], usedBy: [] }
      }
    });

    const { output } = runCheck();

    expect(output).toContain('2 folders');
  });
});

describe('docmeta check - empty project', () => {
  test('handles project with no docmeta files', () => {
    // No docmeta files created

    const { output, exitCode } = runCheck();

    // Should report no docmeta files found
    expect(exitCode).toBe(0);
    expect(output).toContain('No .docmeta.json');
  });

  test('handles project with empty docmeta', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);

    createDocMeta(srcDir, {
      v: 3,
      purpose: 'Empty',
      files: {}
    });

    const { output, exitCode } = runCheck();

    expect(exitCode).toBe(0);
  });
});
