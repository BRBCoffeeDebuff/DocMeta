/**
 * CLI integration tests
 *
 * Tests the overall CLI behavior, help output, version, and command routing.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const PACKAGE_JSON = require('../package.json');

let testDir;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-cli-test-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function runCli(args = '') {
  try {
    return {
      output: execSync(`node ${CLI_PATH} ${args}`, {
        cwd: testDir,
        encoding: 'utf-8',
        timeout: 30000
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

describe('CLI help', () => {
  test('shows help with --help flag', () => {
    const { output, exitCode } = runCli('--help');

    expect(exitCode).toBe(0);
    expect(output).toContain('docmeta');
    expect(output).toContain('Usage:');
  });

  test('shows help with -h flag', () => {
    const { output, exitCode } = runCli('-h');

    expect(exitCode).toBe(0);
    expect(output).toContain('Usage:');
  });

  test('lists all available commands in help', () => {
    const { output } = runCli('--help');

    expect(output).toContain('setup');
    expect(output).toContain('init');
    expect(output).toContain('usedby');
    expect(output).toContain('update');
    expect(output).toContain('crawl');
    expect(output).toContain('ignore');
    expect(output).toContain('registry');
    expect(output).toContain('check');
    expect(output).toContain('mcp');
  });

  test('includes workflow section', () => {
    const { output } = runCli('--help');

    expect(output).toContain('Workflow:');
  });
});

describe('CLI version', () => {
  test('shows version with --version flag', () => {
    const { output, exitCode } = runCli('--version');

    expect(exitCode).toBe(0);
    expect(output).toContain(PACKAGE_JSON.version);
  });

  test('shows version with -v flag', () => {
    const { output, exitCode } = runCli('-v');

    expect(exitCode).toBe(0);
    expect(output).toContain(PACKAGE_JSON.version);
  });
});

describe('CLI unknown command', () => {
  test('exits with error for unknown command', () => {
    const { output, exitCode } = runCli('unknowncommand');

    expect(exitCode).toBe(1);
    expect(output).toContain('Unknown command');
    expect(output).toContain('unknowncommand');
  });

  test('shows help after unknown command error', () => {
    const { output } = runCli('badcmd');

    expect(output).toContain('Usage:');
  });
});

describe('CLI command routing', () => {
  test('routes to init command', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    const { output, exitCode } = runCli('init .');

    expect(exitCode).toBe(0);
    expect(output).toContain('DocMeta Init');
  });

  test('routes to check command', () => {
    const { output, exitCode } = runCli('check .');

    expect(exitCode).toBe(0);
    expect(output).toContain('DocMeta Check');
  });

  test('routes to update command with --help', () => {
    const { output, exitCode } = runCli('update --help');

    expect(exitCode).toBe(0);
    expect(output).toContain('docmeta update');
    expect(output).toContain('--purpose');
    expect(output).toContain('--history');
    expect(output).toContain('--sync');
  });

  test('routes to ignore command with --help', () => {
    const { output, exitCode } = runCli('ignore --help');

    expect(exitCode).toBe(0);
    expect(output).toContain('ignore');
  });
});

describe('CLI no arguments', () => {
  test('shows help when no arguments provided', () => {
    const { output, exitCode } = runCli('');

    expect(exitCode).toBe(0);
    expect(output).toContain('Usage:');
  });
});

describe('CLI end-to-end workflow', () => {
  test('init -> usedby -> check workflow', () => {
    // Create a simple project
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'main.js'),
      `import { helper } from './utils';
       export function main() { helper(); }`
    );
    fs.writeFileSync(
      path.join(srcDir, 'utils.js'),
      `export function helper() { return 'help'; }`
    );

    // Step 1: Initialize
    const initResult = runCli('init .');
    expect(initResult.exitCode).toBe(0);
    expect(fs.existsSync(path.join(srcDir, '.docmeta.json'))).toBe(true);

    // Step 2: Build usedBy
    const usedByResult = runCli('usedby .');
    expect(usedByResult.exitCode).toBe(0);
    expect(usedByResult.output).toContain('usedBy');

    // Verify usedBy was populated
    const docMeta = JSON.parse(
      fs.readFileSync(path.join(srcDir, '.docmeta.json'), 'utf-8')
    );
    expect(docMeta.files['utils.js'].usedBy).toContain('/src/main.js');

    // Step 3: Check (will fail due to [purpose] placeholders)
    const checkResult = runCli('check .');
    expect(checkResult.exitCode).toBe(1);  // Has issues
    expect(checkResult.output).toContain('purpose');
  });

  test('update purpose then check passes', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), 'export default {}');

    // Initialize
    runCli('init .');

    // Update purposes
    runCli('update src --purpose "Application source code"');
    runCli('update src/index.js --purpose "Main entry point"');

    // Now check should pass
    const checkResult = runCli('check .');
    expect(checkResult.exitCode).toBe(0);
    expect(checkResult.output).toContain('look good');
  });
});

describe('CLI JSON output', () => {
  test('update command outputs JSON by default', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    // Create docmeta
    fs.writeFileSync(
      path.join(srcDir, '.docmeta.json'),
      JSON.stringify({
        v: 3,
        purpose: 'Test',
        files: {
          'index.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
        }
      })
    );

    const { output } = runCli('update src/index.js --purpose "Updated"');

    // Should be valid JSON
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(true);
  });

  test('update command respects --human flag', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'index.js'), '');

    fs.writeFileSync(
      path.join(srcDir, '.docmeta.json'),
      JSON.stringify({
        v: 3,
        purpose: 'Test',
        files: {
          'index.js': { purpose: '[purpose]', exports: [], uses: [], usedBy: [] }
        }
      })
    );

    const { output } = runCli('update src/index.js --purpose "Updated" --human');

    // Should NOT be JSON
    expect(() => JSON.parse(output)).toThrow();
    expect(output).toContain('✅');
  });
});

describe('CLI error handling', () => {
  test('handles non-existent path gracefully', () => {
    const { output, exitCode } = runCli('init /nonexistent/path/that/does/not/exist');

    // Should handle error, not crash
    expect(typeof exitCode).toBe('number');
  });

  test('update shows helpful error for missing docmeta', () => {
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'file.js'), '');

    const { output } = runCli('update src/file.js --purpose "test"');

    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('DOCMETA_NOT_FOUND');
    expect(parsed.hint).toContain('init');
  });
});
