/**
 * Tests for init.js functionality
 *
 * Since init.js is a CLI script without module exports,
 * we test its functionality by running it as a subprocess.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-init-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function runInit(args = '') {
  return execSync(`node ${CLI_PATH} init ${args}`, {
    cwd: testDir,
    encoding: 'utf-8',
    timeout: 30000
  });
}

describe('docmeta init', () => {
  test('creates .docmeta.json for directory with JS files', () => {
    // Create a source directory with JS files
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), 'export const foo = 1;');
    fs.writeFileSync(path.join(srcDir, 'utils.js'), 'export function bar() {}');

    runInit('.');

    // Check that .docmeta.json was created
    const docMetaPath = path.join(srcDir, '.docmeta.json');
    expect(fs.existsSync(docMetaPath)).toBe(true);

    const docMeta = JSON.parse(fs.readFileSync(docMetaPath, 'utf-8'));
    expect(docMeta.v).toBe(2);
    expect(docMeta.files['index.js']).toBeDefined();
    expect(docMeta.files['utils.js']).toBeDefined();
  });

  test('extracts exports from JS files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'exports.js'),
      `export const foo = 1;
       export function bar() {}
       export class Baz {}
       export default function main() {}`
    );

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );
    const exports = docMeta.files['exports.js'].exports;

    expect(exports).toContain('foo');
    expect(exports).toContain('bar');
    expect(exports).toContain('Baz');
    expect(exports).toContain('default');
  });

  test('extracts internal imports from JS files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'imports.js'),
      `import { foo } from './utils';
       import bar from '@/lib/bar';
       const baz = require('./baz');
       import external from 'lodash';`  // External should be excluded
    );
    fs.writeFileSync(path.join(srcDir, 'utils.js'), '');
    fs.writeFileSync(path.join(srcDir, 'baz.js'), '');

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );
    const uses = docMeta.files['imports.js'].uses;

    expect(uses).toContain('./utils');
    expect(uses).toContain('@/lib/bar');
    expect(uses).toContain('./baz');
    expect(uses).not.toContain('lodash');
  });

  test('extracts exports from Python files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'module.py'),
      `def hello():
    pass

class MyClass:
    pass

def _private():  # Should not be included (starts with _)
    pass`
    );

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );
    const exports = docMeta.files['module.py'].exports;

    expect(exports).toContain('hello');
    expect(exports).toContain('MyClass');
  });

  test('respects __all__ in Python files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'explicit.py'),
      `__all__ = ['foo', 'bar']

def foo():
    pass

def bar():
    pass

def baz():  # Not in __all__
    pass`
    );

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );
    const exports = docMeta.files['explicit.py'].exports;

    expect(exports).toContain('foo');
    expect(exports).toContain('bar');
    expect(exports).not.toContain('baz');
  });

  test('skips node_modules directory', () => {
    const nmDir = path.join(testDir, 'node_modules', 'pkg');
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, 'index.js'), 'export default {}');

    runInit('.');

    expect(fs.existsSync(path.join(nmDir, '.docmeta.json'))).toBe(false);
  });

  test('skips directories starting with dot', () => {
    const hiddenDir = path.join(testDir, '.hidden');
    fs.mkdirSync(hiddenDir);
    fs.writeFileSync(path.join(hiddenDir, 'secret.js'), 'export default {}');

    runInit('.');

    expect(fs.existsSync(path.join(hiddenDir, '.docmeta.json'))).toBe(false);
  });

  test('skips test files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), 'export default {}');
    fs.writeFileSync(path.join(srcDir, 'index.test.js'), 'test("works", () => {})');
    fs.writeFileSync(path.join(srcDir, 'index.spec.ts'), 'it("works", () => {})');

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );

    expect(docMeta.files['index.js']).toBeDefined();
    expect(docMeta.files['index.test.js']).toBeUndefined();
    expect(docMeta.files['index.spec.ts']).toBeUndefined();
  });

  test('does not overwrite existing .docmeta.json', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    // Create existing docmeta
    const existingDocMeta = { v: 3, purpose: 'Existing', files: {} };
    fs.writeFileSync(
      path.join(srcDir, '.docmeta.json'),
      JSON.stringify(existingDocMeta)
    );

    runInit('.');

    // Should not be overwritten
    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );
    expect(docMeta.purpose).toBe('Existing');
  });

  test('sets purpose to [purpose] placeholder', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), 'export default {}');

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );

    expect(docMeta.purpose).toBe('[purpose]');
    expect(docMeta.files['index.js'].purpose).toBe('[purpose]');
  });

  test('adds initial history entry', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );

    expect(docMeta.history.length).toBe(1);
    expect(docMeta.history[0][1]).toBe('Initial documentation scaffold');
  });

  test('initializes usedBy as empty array', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );

    expect(docMeta.files['index.js'].usedBy).toEqual([]);
  });

  test('handles nested directories', () => {
    // Create nested structure
    const srcDir = path.join(testDir, 'src');
    const libDir = path.join(srcDir, 'lib');
    const utilsDir = path.join(libDir, 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'index.js'), '');
    fs.writeFileSync(path.join(libDir, 'main.js'), '');
    fs.writeFileSync(path.join(utilsDir, 'helpers.js'), '');

    runInit('.');

    expect(fs.existsSync(path.join(srcDir, '.docmeta.json'))).toBe(true);
    expect(fs.existsSync(path.join(libDir, '.docmeta.json'))).toBe(true);
    expect(fs.existsSync(path.join(utilsDir, '.docmeta.json'))).toBe(true);
  });

  test('handles TypeScript files', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'types.ts'),
      `export interface User {
         name: string;
       }
       export type ID = string | number;
       export enum Status { Active, Inactive }`
    );

    runInit('.');

    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );
    const exports = docMeta.files['types.ts'].exports;

    expect(exports).toContain('User');
    expect(exports).toContain('ID');
    expect(exports).toContain('Status');
  });
});
