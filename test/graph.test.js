/**
 * Tests for docmeta graph command
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Helper to run CLI commands
function runCli(args, cwd) {
  const binPath = path.join(__dirname, '..', 'bin', 'cli.js');
  try {
    return execSync(`node "${binPath}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    return err.stdout || err.stderr || '';
  }
}

// Helper to create temp directory
function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docmeta-test-'));
}

// Helper to cleanup temp directory
function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('docmeta graph', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('--help', () => {
    it('shows help message', () => {
      const output = runCli('graph --help', tempDir);
      expect(output).toContain('docmeta graph');
      expect(output).toContain('--blast-radius');
      expect(output).toContain('--orphans');
      expect(output).toContain('--cycles');
      expect(output).toContain('--entry-points');
    });
  });

  describe('no docmeta files', () => {
    it('reports no files found', () => {
      const output = runCli('graph', tempDir);
      expect(output).toContain('No .docmeta.json files found');
    });
  });

  describe('with simple project', () => {
    beforeEach(() => {
      // Create a simple docmeta structure
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });

      // Root docmeta
      fs.writeFileSync(path.join(tempDir, '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Test project',
        files: {
          'index.js': {
            purpose: 'Entry point',
            exports: ['main'],
            uses: [],
            usedBy: []
          }
        }
      }, null, 2));

      // Src docmeta
      fs.writeFileSync(path.join(tempDir, 'src', '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Source files',
        files: {
          'utils.js': {
            purpose: 'Utility functions',
            exports: ['helper'],
            uses: [],
            usedBy: ['/index.js']
          },
          'lib.js': {
            purpose: 'Library code',
            exports: ['doStuff'],
            uses: ['./utils'],
            usedBy: ['/index.js']
          }
        }
      }, null, 2));
    });

    it('runs full analysis', () => {
      const output = runCli('graph', tempDir);
      expect(output).toContain('DocMeta Graph Analysis');
      expect(output).toContain('Entry Points');
      expect(output).toContain('Orphans');
      expect(output).toContain('Cycles');
      expect(output).toContain('Summary');
    });

    it('shows entry points', () => {
      const output = runCli('graph --entry-points', tempDir);
      expect(output).toContain('Entry Points');
      // index.js and utils.js should be entry points (no internal uses)
      expect(output).toContain('/index.js');
    });

    it('shows orphans', () => {
      const output = runCli('graph --orphans', tempDir);
      expect(output).toContain('Orphan');
    });

    it('shows cycles (none in this project)', () => {
      const output = runCli('graph --cycles', tempDir);
      expect(output).toContain('Circular');
      // No cycles in this simple project
      expect(output).toMatch(/No circular dependencies|0 circular/);
    });

    it('outputs JSON with --json flag', () => {
      const output = runCli('graph --json', tempDir);
      const data = JSON.parse(output);
      expect(data).toHaveProperty('totalFiles');
      expect(data).toHaveProperty('entryPoints');
      expect(data).toHaveProperty('orphans');
      expect(data).toHaveProperty('cycles');
    });
  });

  describe('--blast-radius', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'src', '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Source files',
        files: {
          'base.js': {
            purpose: 'Base module',
            exports: ['Base'],
            uses: [],
            usedBy: ['/src/middle.js']
          },
          'middle.js': {
            purpose: 'Middle layer',
            exports: ['Middle'],
            uses: ['./base'],
            usedBy: ['/src/top.js']
          },
          'top.js': {
            purpose: 'Top layer',
            exports: ['Top'],
            uses: ['./middle'],
            usedBy: []
          }
        }
      }, null, 2));
    });

    it('shows direct dependents', () => {
      const output = runCli('graph --blast-radius /src/base.js', tempDir);
      expect(output).toContain('Blast Radius');
      expect(output).toContain('/src/middle.js');
    });

    it('shows transitive dependents', () => {
      const output = runCli('graph --blast-radius /src/base.js', tempDir);
      expect(output).toContain('Transitive');
      expect(output).toContain('/src/top.js');
    });

    it('shows total count', () => {
      const output = runCli('graph --blast-radius /src/base.js', tempDir);
      expect(output).toContain('Total blast radius: 2');
    });

    it('handles file not found', () => {
      const output = runCli('graph --blast-radius /nonexistent.js', tempDir);
      expect(output).toContain('not found');
    });

    it('outputs JSON with --json flag', () => {
      const output = runCli('graph --blast-radius /src/base.js --json', tempDir);
      const data = JSON.parse(output);
      expect(data).toHaveProperty('file');
      expect(data).toHaveProperty('direct');
      expect(data).toHaveProperty('transitive');
      expect(data).toHaveProperty('total');
    });
  });

  describe('cycle detection', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });

      // Create files that document a cycle: a.js uses b.js uses c.js uses a.js
      // The cycle detection looks at the 'uses' array to find cycles
      fs.writeFileSync(path.join(tempDir, 'src', '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Circular deps',
        files: {
          'a.js': {
            purpose: 'Module A',
            exports: ['A'],
            uses: ['./b'],  // a uses b
            usedBy: ['/src/c.js']  // c uses a
          },
          'b.js': {
            purpose: 'Module B',
            exports: ['B'],
            uses: ['./c'],  // b uses c
            usedBy: ['/src/a.js']  // a uses b
          },
          'c.js': {
            purpose: 'Module C',
            exports: ['C'],
            uses: ['./a'],  // c uses a (completes the cycle)
            usedBy: ['/src/b.js']  // b uses c
          }
        }
      }, null, 2));
    });

    it('runs cycle detection', () => {
      const output = runCli('graph --cycles', tempDir);
      // Cycle detection runs without error
      expect(output).toContain('Circular');
    });

    it('reports cycles in JSON output', () => {
      const output = runCli('graph --cycles --json', tempDir);
      const data = JSON.parse(output);
      expect(data).toHaveProperty('count');
      expect(data).toHaveProperty('cycles');
      expect(Array.isArray(data.cycles)).toBe(true);
    });
  });

  describe('orphan detection', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });

      fs.writeFileSync(path.join(tempDir, 'src', '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Mixed files',
        files: {
          'used.js': {
            purpose: 'Used module',
            exports: ['used'],
            uses: [],
            usedBy: ['/src/main.js']
          },
          'orphan.js': {
            purpose: 'Orphan module',
            exports: ['orphan'],
            uses: ['./used'],  // Has internal deps
            usedBy: []         // But nothing uses it
          },
          'main.js': {
            purpose: 'Main entry',
            exports: ['main'],
            uses: ['./used'],
            usedBy: []
          }
        }
      }, null, 2));
    });

    it('identifies orphan files', () => {
      const output = runCli('graph --orphans', tempDir);
      expect(output).toContain('orphan.js');
    });

    it('excludes entry points from orphans', () => {
      // main.js is an entry point pattern, shouldn't be an orphan
      const output = runCli('graph --orphans', tempDir);
      expect(output).not.toContain('main.js');
    });
  });

  describe('--output flag', () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(tempDir, '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Test',
        files: {
          'app.js': {
            purpose: 'App',
            exports: ['app'],
            uses: [],
            usedBy: []
          }
        }
      }, null, 2));
    });

    it('exports graph to JSON file', () => {
      const outputFile = path.join(tempDir, 'graph.json');
      runCli(`graph --output "${outputFile}"`, tempDir);

      expect(fs.existsSync(outputFile)).toBe(true);

      const data = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
      expect(data).toHaveProperty('generated');
      expect(data).toHaveProperty('totalFiles');
      expect(data).toHaveProperty('entryPoints');
      expect(data).toHaveProperty('orphans');
      expect(data).toHaveProperty('cycles');
      expect(data).toHaveProperty('clusters');
      expect(data).toHaveProperty('nodes');
    });
  });

  describe('--clusters detection', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'features'), { recursive: true });

      // Create an entry point that uses some files
      fs.writeFileSync(path.join(tempDir, '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Test',
        files: {
          'index.js': {
            purpose: 'Entry point',
            exports: ['main'],
            uses: ['./src/used'],
            usedBy: []
          }
        }
      }, null, 2));

      // Create a file used by entry point
      fs.writeFileSync(path.join(tempDir, 'src', '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Source',
        files: {
          'used.js': {
            purpose: 'Used by index',
            exports: ['helper'],
            uses: [],
            usedBy: ['/index.js']
          }
        }
      }, null, 2));

      // Create an isolated cluster - files that only reference each other
      // docgen.ts -> used by clauses.ts and commentary.ts (both orphans)
      fs.writeFileSync(path.join(tempDir, 'features', '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Features',
        files: {
          'docgen.ts': {
            purpose: 'Doc generator types',
            exports: ['DocGenTypes'],
            uses: [],
            usedBy: ['/features/clauses.ts', '/features/commentary.ts']
          },
          'clauses.ts': {
            purpose: 'Clauses module',
            exports: ['Clauses'],
            uses: ['./docgen'],
            usedBy: []
          },
          'commentary.ts': {
            purpose: 'Commentary module',
            exports: ['Commentary'],
            uses: ['./docgen'],
            usedBy: []
          }
        }
      }, null, 2));
    });

    it('finds isolated clusters', () => {
      const output = runCli('graph --clusters', tempDir);
      expect(output).toContain('Isolated Clusters');
      // Should find the docgen cluster
      expect(output).toContain('docgen.ts');
      expect(output).toContain('clauses.ts');
      expect(output).toContain('commentary.ts');
    });

    it('shows cluster size', () => {
      const output = runCli('graph --clusters', tempDir);
      expect(output).toContain('3 files');
    });

    it('supports --islands alias', () => {
      const output = runCli('graph --islands', tempDir);
      expect(output).toContain('Isolated Clusters');
    });

    it('outputs JSON with --json flag', () => {
      const output = runCli('graph --clusters --json', tempDir);
      const data = JSON.parse(output);
      expect(data).toHaveProperty('count');
      expect(data).toHaveProperty('totalFiles');
      expect(data).toHaveProperty('clusters');
      expect(Array.isArray(data.clusters)).toBe(true);
      expect(data.clusters.length).toBeGreaterThan(0);
      expect(data.clusters[0]).toHaveProperty('size');
      expect(data.clusters[0]).toHaveProperty('files');
    });

    it('includes clusters in full analysis', () => {
      const output = runCli('graph', tempDir);
      expect(output).toContain('Clusters');
      expect(output).toContain('isolated');
    });

    it('includes clusters in JSON full analysis', () => {
      const output = runCli('graph --json', tempDir);
      const data = JSON.parse(output);
      expect(data).toHaveProperty('clusters');
      expect(Array.isArray(data.clusters)).toBe(true);
    });

    it('shows help for --clusters flag', () => {
      const output = runCli('graph --help', tempDir);
      expect(output).toContain('--clusters');
      expect(output).toContain('--islands');
    });
  });

  describe('no clusters (healthy codebase)', () => {
    beforeEach(() => {
      // Create a healthy codebase where everything is reachable
      fs.writeFileSync(path.join(tempDir, '.docmeta.json'), JSON.stringify({
        v: 3,
        purpose: 'Test',
        files: {
          'index.js': {
            purpose: 'Entry point',
            exports: ['main'],
            uses: ['./utils'],
            usedBy: []
          },
          'utils.js': {
            purpose: 'Utilities',
            exports: ['helper'],
            uses: [],
            usedBy: ['/index.js']
          }
        }
      }, null, 2));
    });

    it('reports no clusters found', () => {
      const output = runCli('graph --clusters', tempDir);
      expect(output).toContain('No isolated clusters found');
    });
  });
});

describe('CLI routing', () => {
  it('routes graph command correctly', () => {
    const tempDir = createTempDir();
    try {
      const output = runCli('graph --help', tempDir);
      expect(output).toContain('docmeta graph');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('shows graph in main help', () => {
    const tempDir = createTempDir();
    try {
      const output = runCli('--help', tempDir);
      expect(output).toContain('docmeta graph');
      expect(output).toContain('cycles');
      expect(output).toContain('orphans');
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});
