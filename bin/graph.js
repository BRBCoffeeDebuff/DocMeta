#!/usr/bin/env node
/**
 * docmeta graph - Analyze the dependency graph
 *
 * Usage:
 *   docmeta graph                          # Full analysis
 *   docmeta graph --blast-radius <file>    # What breaks if I change this?
 *   docmeta graph --orphans                # Dead code candidates
 *   docmeta graph --cycles                 # Circular dependencies
 *   docmeta graph --entry-points           # Where execution starts
 *   docmeta graph --clusters               # Isolated dead code clusters
 *   docmeta graph --output <file>          # Export graph to JSON
 *   docmeta graph --json                   # Output all results as JSON
 *
 * Features:
 *   - Cycle detection: Find circular dependencies
 *   - Orphan detection: Find files with no dependents (dead code candidates)
 *   - Cluster detection: Find isolated groups of dead code (files only referencing each other)
 *   - Transitive blast radius: Full chain of what breaks if you change a file
 *   - Entry point detection: Files that are used but use nothing (roots)
 */

const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', 'venv', '.venv'];

// ============================================================================
// DocMeta Loading (similar to usedby.js and mcp-server.js)
// ============================================================================

/**
 * Find all .docmeta.json files in the project
 */
function findDocMetaFiles(rootPath) {
  const results = [];

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Check for .docmeta.json first (before skipping hidden files)
        if (entry.name === '.docmeta.json') {
          results.push(fullPath);
          continue;
        }

        // Skip ignored and hidden directories
        if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  // Check root for .docmeta.json
  const rootDocMeta = path.join(rootPath, '.docmeta.json');
  if (fs.existsSync(rootDocMeta)) {
    results.push(rootDocMeta);
  }

  walk(rootPath);
  return results;
}

/**
 * Build the dependency graph from all .docmeta.json files
 */
function buildGraph(rootPath) {
  const docMetaFiles = findDocMetaFiles(rootPath);

  // nodes: Map of filePath -> { purpose, exports, uses, usedBy }
  const nodes = new Map();

  for (const docMetaPath of docMetaFiles) {
    try {
      const content = JSON.parse(fs.readFileSync(docMetaPath, 'utf-8'));
      const dir = path.dirname(docMetaPath);
      const folderPath = '/' + path.relative(rootPath, dir).replace(/\\/g, '/');
      const normalizedFolderPath = folderPath === '/' ? '' : folderPath;

      for (const [fileName, fileData] of Object.entries(content.files || {})) {
        const filePath = normalizedFolderPath + '/' + fileName;
        nodes.set(filePath, {
          purpose: fileData.purpose || '',
          exports: fileData.exports || [],
          uses: fileData.uses || [],
          usedBy: fileData.usedBy || []
        });
      }
    } catch {
      // Skip invalid files
    }
  }

  return nodes;
}

// ============================================================================
// Graph Analysis Functions
// ============================================================================

/**
 * Find all cycles in the dependency graph using DFS
 * Returns an array of cycles, where each cycle is an array of file paths
 */
function findCycles(nodes) {
  const cycles = [];
  const visited = new Set();
  const recursionStack = new Set();
  const path = [];

  function dfs(node) {
    if (recursionStack.has(node)) {
      // Found a cycle - extract it from path
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart).concat(node);
        // Normalize cycle to start with lexicographically smallest node
        const minIdx = cycle.slice(0, -1).reduce((min, val, idx, arr) =>
          val < arr[min] ? idx : min, 0);
        const normalizedCycle = cycle.slice(minIdx, -1).concat(cycle.slice(0, minIdx + 1));

        // Check if we already have this cycle
        const cycleKey = normalizedCycle.join(' -> ');
        if (!cycles.some(c => c.join(' -> ') === cycleKey)) {
          cycles.push(normalizedCycle);
        }
      }
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const nodeData = nodes.get(node);
    if (nodeData) {
      // Follow usedBy edges (what uses this file)
      for (const dependent of nodeData.usedBy) {
        if (nodes.has(dependent)) {
          dfs(dependent);
        }
      }
    }

    path.pop();
    recursionStack.delete(node);
  }

  // Also check using 'uses' direction for more complete cycle detection
  function dfsUses(node) {
    if (recursionStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart).concat(node);
        const minIdx = cycle.slice(0, -1).reduce((min, val, idx, arr) =>
          val < arr[min] ? idx : min, 0);
        const normalizedCycle = cycle.slice(minIdx, -1).concat(cycle.slice(0, minIdx + 1));
        const cycleKey = normalizedCycle.join(' -> ');
        if (!cycles.some(c => c.join(' -> ') === cycleKey)) {
          cycles.push(normalizedCycle);
        }
      }
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const nodeData = nodes.get(node);
    if (nodeData) {
      // Follow uses edges (resolve to actual file paths)
      for (const dep of nodeData.uses) {
        // Try to find the actual file this refers to
        for (const [filePath] of nodes) {
          if (filePath.endsWith(dep) || filePath.includes(dep)) {
            dfsUses(filePath);
            break;
          }
        }
      }
    }

    path.pop();
    recursionStack.delete(node);
  }

  // Run DFS from each node
  for (const [node] of nodes) {
    visited.clear();
    recursionStack.clear();
    path.length = 0;
    dfsUses(node);
  }

  return cycles;
}

/**
 * Find orphan files - files that have no usedBy (not used by anything)
 * Excludes entry points (CLI tools, main files, etc.)
 */
function findOrphans(nodes) {
  const orphans = [];

  // Patterns that indicate entry points (not orphans even if unused)
  const entryPointPatterns = [
    /\/cli\.[jt]sx?$/,
    /\/main\.[jt]sx?$/,
    /\/index\.[jt]sx?$/,
    /\/server\.[jt]sx?$/,
    /\/app\.[jt]sx?$/,
    /\/page\.[jt]sx?$/,
    /^\/bin\//,
    /^\/app\//,
    /^\/pages\//,
    /\/route\.[jt]sx?$/,
  ];

  for (const [filePath, data] of nodes) {
    // No one uses this file
    if (data.usedBy.length === 0) {
      // Check if it's an entry point pattern
      const isEntryPoint = entryPointPatterns.some(p => p.test(filePath));
      if (isEntryPoint) continue;

      // But it uses other files (so it's not a leaf utility)
      // This is a dead code candidate
      const hasInternalDeps = data.uses.some(u =>
        u.startsWith('.') || u.startsWith('@/') || u.startsWith('~/')
      );

      if (hasInternalDeps) {
        orphans.push({
          path: filePath,
          purpose: data.purpose,
          uses: data.uses.length
        });
      }
    }
  }

  return orphans.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Find entry points - files that are used by others but don't use internal files
 * These are the "roots" of the dependency tree
 */
function findEntryPoints(nodes) {
  const entryPoints = [];

  for (const [filePath, data] of nodes) {
    // Check if this file uses no internal dependencies
    const hasInternalDeps = data.uses.some(u =>
      u.startsWith('.') || u.startsWith('@/') || u.startsWith('~/')
    );

    if (!hasInternalDeps) {
      // This file doesn't depend on internal files
      // Could be an entry point (CLI, main, etc.) or a leaf utility

      // Entry points are typically: cli, main, index at root, server, app
      const isLikelyEntry = /\/(cli|main|index|server|app|page)\.[jt]sx?$/.test(filePath) ||
                           filePath.startsWith('/bin/') ||
                           filePath.startsWith('/app/') ||
                           data.usedBy.length > 0;  // Or if something uses it

      if (isLikelyEntry || data.usedBy.length === 0) {
        entryPoints.push({
          path: filePath,
          purpose: data.purpose,
          dependents: data.usedBy.length
        });
      }
    }
  }

  // Sort by number of dependents (most important first)
  return entryPoints.sort((a, b) => b.dependents - a.dependents);
}

/**
 * Find isolated clusters - groups of files that only reference each other
 * with no path to any entry point. These are dead code groups.
 *
 * Algorithm:
 * 1. Find all entry points (files that are reachable from outside or are CLI/main files)
 * 2. Traverse the graph from entry points following 'uses' to find all reachable files
 * 3. Files not reachable from any entry point are isolated
 * 4. Group isolated files by their connected components
 */
function findClusters(nodes) {
  // Patterns that indicate entry points
  const entryPointPatterns = [
    /\/cli\.[jt]sx?$/,
    /\/main\.[jt]sx?$/,
    /\/index\.[jt]sx?$/,
    /\/server\.[jt]sx?$/,
    /\/app\.[jt]sx?$/,
    /\/page\.[jt]sx?$/,
    /^\/bin\//,
    /^\/app\//,
    /^\/pages\//,
    /\/route\.[jt]sx?$/,
  ];

  // Step 1: Identify entry points
  const entryPoints = new Set();
  for (const [filePath, data] of nodes) {
    const isEntryPattern = entryPointPatterns.some(p => p.test(filePath));
    // Entry point if: matches pattern, OR has no usedBy (external entry), OR is explicitly not using internal deps
    if (isEntryPattern) {
      entryPoints.add(filePath);
    }
  }

  // Also include files with no usedBy that don't use internal deps (leaf entry points)
  for (const [filePath, data] of nodes) {
    if (data.usedBy.length === 0) {
      const hasInternalDeps = data.uses.some(u =>
        u.startsWith('.') || u.startsWith('@/') || u.startsWith('~/')
      );
      if (!hasInternalDeps) {
        entryPoints.add(filePath);
      }
    }
  }

  // Build a lookup for resolving import paths to actual file paths
  function resolveImport(importPath, fromDir) {
    // Try exact match first
    for (const [filePath] of nodes) {
      if (filePath === importPath) return filePath;
    }

    // Handle relative imports
    if (importPath.startsWith('.')) {
      // Convert relative to absolute based on fromDir
      const baseName = importPath.replace(/^\.\//, '').replace(/^\.\.\//, '');
      for (const [filePath] of nodes) {
        if (filePath.endsWith('/' + baseName + '.js') ||
            filePath.endsWith('/' + baseName + '.ts') ||
            filePath.endsWith('/' + baseName + '.tsx') ||
            filePath.endsWith('/' + baseName) ||
            filePath.endsWith('/' + baseName + '/index.js') ||
            filePath.endsWith('/' + baseName + '/index.ts')) {
          return filePath;
        }
      }
    }

    // Try partial match
    for (const [filePath] of nodes) {
      if (filePath.includes(importPath)) return filePath;
    }

    return null;
  }

  // Step 2: Find all files reachable from entry points (following 'uses')
  const reachable = new Set();

  function traverse(filePath, visited = new Set()) {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    reachable.add(filePath);

    const node = nodes.get(filePath);
    if (!node) return;

    // Follow 'uses' to find what this file depends on
    for (const dep of node.uses) {
      const resolved = resolveImport(dep, filePath);
      if (resolved && nodes.has(resolved)) {
        traverse(resolved, visited);
      }
    }
  }

  for (const ep of entryPoints) {
    traverse(ep);
  }

  // Step 3: Find isolated files (not reachable from any entry point)
  const isolated = new Set();
  for (const [filePath] of nodes) {
    if (!reachable.has(filePath)) {
      isolated.add(filePath);
    }
  }

  if (isolated.size === 0) {
    return [];
  }

  // Step 4: Group isolated files into connected components (clusters)
  const clusters = [];
  const assigned = new Set();

  function buildCluster(startFile) {
    const cluster = new Set();
    const queue = [startFile];

    while (queue.length > 0) {
      const file = queue.shift();
      if (cluster.has(file) || !isolated.has(file)) continue;

      cluster.add(file);
      assigned.add(file);

      const node = nodes.get(file);
      if (!node) continue;

      // Add files this one uses (if they're also isolated)
      for (const dep of node.uses) {
        const resolved = resolveImport(dep, file);
        if (resolved && isolated.has(resolved) && !cluster.has(resolved)) {
          queue.push(resolved);
        }
      }

      // Add files that use this one (if they're also isolated)
      for (const user of node.usedBy) {
        if (isolated.has(user) && !cluster.has(user)) {
          queue.push(user);
        }
      }
    }

    return cluster;
  }

  for (const file of isolated) {
    if (!assigned.has(file)) {
      const cluster = buildCluster(file);
      if (cluster.size > 0) {
        // Convert to array with file info
        const clusterFiles = Array.from(cluster).map(f => ({
          path: f,
          purpose: nodes.get(f)?.purpose || '',
          uses: nodes.get(f)?.uses?.length || 0,
          usedBy: nodes.get(f)?.usedBy?.length || 0
        })).sort((a, b) => a.path.localeCompare(b.path));

        clusters.push({
          size: clusterFiles.length,
          files: clusterFiles
        });
      }
    }
  }

  // Sort clusters by size (largest first)
  return clusters.sort((a, b) => b.size - a.size);
}

/**
 * Calculate transitive blast radius - all files affected by changing this file
 */
function calculateBlastRadius(nodes, targetPath) {
  // Normalize the target path
  let normalized = targetPath.startsWith('/') ? targetPath : '/' + targetPath;

  // Find the actual node (might need to match partially)
  let actualPath = null;
  if (nodes.has(normalized)) {
    actualPath = normalized;
  } else {
    // Try to find a match
    for (const [filePath] of nodes) {
      if (filePath.endsWith(targetPath) || filePath.includes(targetPath)) {
        actualPath = filePath;
        break;
      }
    }
  }

  if (!actualPath) {
    return { error: `File not found in graph: ${targetPath}` };
  }

  const visited = new Set();
  const result = {
    file: actualPath,
    purpose: nodes.get(actualPath)?.purpose || '',
    direct: [],
    transitive: [],
    total: 0
  };

  function collectDependents(filePath, depth) {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    const node = nodes.get(filePath);
    if (!node) return;

    for (const dependent of node.usedBy) {
      if (!visited.has(dependent)) {
        if (depth === 0) {
          result.direct.push(dependent);
        } else {
          result.transitive.push(dependent);
        }
        collectDependents(dependent, depth + 1);
      }
    }
  }

  collectDependents(actualPath, 0);

  result.total = result.direct.length + result.transitive.length;
  result.direct.sort();
  result.transitive.sort();

  return result;
}

/**
 * Generate full graph analysis
 */
function analyzeGraph(nodes) {
  return {
    totalFiles: nodes.size,
    entryPoints: findEntryPoints(nodes),
    orphans: findOrphans(nodes),
    cycles: findCycles(nodes),
    clusters: findClusters(nodes)
  };
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatAnalysis(analysis, jsonOutput = false) {
  if (jsonOutput) {
    return JSON.stringify(analysis, null, 2);
  }

  const lines = [];
  lines.push('\nDocMeta Graph Analysis\n');

  // Entry Points
  lines.push(`Entry Points (${analysis.entryPoints.length}):`);
  if (analysis.entryPoints.length === 0) {
    lines.push('  (none found)');
  } else {
    for (const ep of analysis.entryPoints.slice(0, 10)) {
      const deps = ep.dependents > 0 ? ` (${ep.dependents} dependents)` : '';
      lines.push(`  ${ep.path}${deps}`);
    }
    if (analysis.entryPoints.length > 10) {
      lines.push(`  ... and ${analysis.entryPoints.length - 10} more`);
    }
  }
  lines.push('');

  // Orphans
  lines.push(`Orphans (${analysis.orphans.length} files with no dependents - dead code candidates):`);
  if (analysis.orphans.length === 0) {
    lines.push('  (none found - all files are used!)');
  } else {
    for (const orphan of analysis.orphans.slice(0, 10)) {
      lines.push(`  ${orphan.path}`);
    }
    if (analysis.orphans.length > 10) {
      lines.push(`  ... and ${analysis.orphans.length - 10} more`);
    }
  }
  lines.push('');

  // Cycles
  lines.push(`Cycles (${analysis.cycles.length} circular ${analysis.cycles.length === 1 ? 'dependency' : 'dependencies'}):`);
  if (analysis.cycles.length === 0) {
    lines.push('  (none found - no circular dependencies!)');
  } else {
    for (const cycle of analysis.cycles.slice(0, 5)) {
      lines.push(`  ${cycle.join(' -> ')}`);
    }
    if (analysis.cycles.length > 5) {
      lines.push(`  ... and ${analysis.cycles.length - 5} more`);
    }
  }
  lines.push('');

  // Clusters
  const clusterFileCount = analysis.clusters.reduce((sum, c) => sum + c.size, 0);
  lines.push(`Clusters (${analysis.clusters.length} isolated groups with ${clusterFileCount} total files):`);
  if (analysis.clusters.length === 0) {
    lines.push('  (none found - all code reachable from entry points!)');
  } else {
    for (const cluster of analysis.clusters.slice(0, 3)) {
      const fileList = cluster.files.slice(0, 3).map(f => f.path).join(', ');
      const more = cluster.files.length > 3 ? ` + ${cluster.files.length - 3} more` : '';
      lines.push(`  Cluster (${cluster.size} files): ${fileList}${more}`);
    }
    if (analysis.clusters.length > 3) {
      lines.push(`  ... and ${analysis.clusters.length - 3} more clusters`);
    }
  }
  lines.push('');

  // Summary
  lines.push(`Summary: ${analysis.totalFiles} files, ${analysis.entryPoints.length} entry points, ${analysis.orphans.length} orphans, ${analysis.cycles.length} cycles, ${analysis.clusters.length} clusters`);
  lines.push('');

  return lines.join('\n');
}

function formatBlastRadius(result, jsonOutput = false) {
  if (result.error) {
    if (jsonOutput) {
      return JSON.stringify({ error: result.error }, null, 2);
    }
    return `\nError: ${result.error}\n`;
  }

  if (jsonOutput) {
    return JSON.stringify(result, null, 2);
  }

  const lines = [];
  lines.push('\nBlast Radius Analysis\n');
  lines.push(`File: ${result.file}`);
  if (result.purpose && result.purpose !== '[purpose]') {
    lines.push(`Purpose: ${result.purpose}`);
  }
  lines.push('');

  lines.push(`Direct dependents (${result.direct.length}):`);
  if (result.direct.length === 0) {
    lines.push('  (none - this file is not used by anything)');
  } else {
    for (const dep of result.direct) {
      lines.push(`  ${dep}`);
    }
  }
  lines.push('');

  lines.push(`Transitive dependents (${result.transitive.length}):`);
  if (result.transitive.length === 0) {
    lines.push('  (none)');
  } else {
    for (const dep of result.transitive.slice(0, 20)) {
      lines.push(`  ${dep}`);
    }
    if (result.transitive.length > 20) {
      lines.push(`  ... and ${result.transitive.length - 20} more`);
    }
  }
  lines.push('');

  lines.push(`Total blast radius: ${result.total} files`);
  lines.push('');

  return lines.join('\n');
}

function formatOrphans(orphans, jsonOutput = false) {
  if (jsonOutput) {
    return JSON.stringify({ count: orphans.length, orphans }, null, 2);
  }

  const lines = [];
  lines.push('\nOrphan Files (dead code candidates)\n');

  if (orphans.length === 0) {
    lines.push('No orphans found - all files are used!');
  } else {
    lines.push(`Found ${orphans.length} files that are not used by anything:\n`);
    for (const orphan of orphans) {
      lines.push(`  ${orphan.path}`);
      if (orphan.purpose && orphan.purpose !== '[purpose]') {
        lines.push(`    Purpose: ${orphan.purpose}`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

function formatCycles(cycles, jsonOutput = false) {
  if (jsonOutput) {
    return JSON.stringify({ count: cycles.length, cycles }, null, 2);
  }

  const lines = [];
  lines.push('\nCircular Dependencies\n');

  if (cycles.length === 0) {
    lines.push('No circular dependencies found!');
  } else {
    lines.push(`Found ${cycles.length} circular ${cycles.length === 1 ? 'dependency' : 'dependencies'}:\n`);
    for (const cycle of cycles) {
      lines.push(`  ${cycle.join(' -> ')}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

function formatEntryPoints(entryPoints, jsonOutput = false) {
  if (jsonOutput) {
    return JSON.stringify({ count: entryPoints.length, entryPoints }, null, 2);
  }

  const lines = [];
  lines.push('\nEntry Points\n');

  if (entryPoints.length === 0) {
    lines.push('No entry points found.');
  } else {
    lines.push(`Found ${entryPoints.length} entry points:\n`);
    for (const ep of entryPoints) {
      const deps = ep.dependents > 0 ? ` (${ep.dependents} dependents)` : '';
      lines.push(`  ${ep.path}${deps}`);
      if (ep.purpose && ep.purpose !== '[purpose]') {
        lines.push(`    Purpose: ${ep.purpose}`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

function formatClusters(clusters, jsonOutput = false) {
  if (jsonOutput) {
    const totalFiles = clusters.reduce((sum, c) => sum + c.size, 0);
    return JSON.stringify({ count: clusters.length, totalFiles, clusters }, null, 2);
  }

  const lines = [];
  lines.push('\nIsolated Clusters (dead code groups)\n');

  if (clusters.length === 0) {
    lines.push('No isolated clusters found - all code is reachable from entry points!');
  } else {
    const totalFiles = clusters.reduce((sum, c) => sum + c.size, 0);
    lines.push(`Found ${clusters.length} isolated ${clusters.length === 1 ? 'cluster' : 'clusters'} with ${totalFiles} total files:\n`);

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      lines.push(`Cluster ${i + 1} (${cluster.size} files):`);
      for (const file of cluster.files) {
        const info = file.usedBy > 0 ? ` (used by ${file.usedBy} in cluster)` : '';
        lines.push(`  ${file.path}${info}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2);
  const rootPath = process.cwd();

  // Parse arguments
  const flags = {
    blastRadius: null,
    orphans: false,
    cycles: false,
    entryPoints: false,
    clusters: false,
    output: null,
    json: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--blast-radius' || arg === '-b') {
      flags.blastRadius = args[++i];
    } else if (arg === '--orphans' || arg === '-o') {
      flags.orphans = true;
    } else if (arg === '--cycles' || arg === '-c') {
      flags.cycles = true;
    } else if (arg === '--entry-points' || arg === '-e') {
      flags.entryPoints = true;
    } else if (arg === '--clusters' || arg === '--islands') {
      flags.clusters = true;
    } else if (arg === '--output') {
      flags.output = args[++i];
    } else if (arg === '--json' || arg === '-j') {
      flags.json = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    }
  }

  if (flags.help) {
    console.log(`
docmeta graph - Analyze the dependency graph

Usage:
  docmeta graph                          Full analysis (entry points, orphans, cycles, clusters)
  docmeta graph --blast-radius <file>    What breaks if I change this file?
  docmeta graph --orphans                Find dead code candidates
  docmeta graph --cycles                 Find circular dependencies
  docmeta graph --entry-points           Find where execution starts
  docmeta graph --clusters               Find isolated dead code groups
  docmeta graph --output <file>          Export full graph to JSON
  docmeta graph --json                   Output results as JSON

Options:
  -b, --blast-radius <file>   Calculate transitive blast radius for a file
  -o, --orphans               List files with no dependents
  -c, --cycles                List circular dependencies
  -e, --entry-points          List entry points (roots of dependency tree)
  --clusters, --islands       Find isolated clusters (dead code groups not reachable from entry points)
  --output <file>             Export graph data to JSON file
  -j, --json                  Output results as JSON
  -h, --help                  Show this help message
`);
    return;
  }

  // Build the graph
  const nodes = buildGraph(rootPath);

  if (nodes.size === 0) {
    console.log('\nNo .docmeta.json files found. Run "docmeta init" first.\n');
    return;
  }

  // Handle specific queries
  if (flags.blastRadius) {
    const result = calculateBlastRadius(nodes, flags.blastRadius);
    console.log(formatBlastRadius(result, flags.json));
    return;
  }

  if (flags.orphans) {
    const orphans = findOrphans(nodes);
    console.log(formatOrphans(orphans, flags.json));
    return;
  }

  if (flags.cycles) {
    const cycles = findCycles(nodes);
    console.log(formatCycles(cycles, flags.json));
    return;
  }

  if (flags.entryPoints) {
    const entryPoints = findEntryPoints(nodes);
    console.log(formatEntryPoints(entryPoints, flags.json));
    return;
  }

  if (flags.clusters) {
    const clusters = findClusters(nodes);
    console.log(formatClusters(clusters, flags.json));
    return;
  }

  // Full analysis
  const analysis = analyzeGraph(nodes);

  // Output to file if requested
  if (flags.output) {
    const graphData = {
      generated: new Date().toISOString(),
      root: rootPath,
      ...analysis,
      nodes: Object.fromEntries(nodes)
    };
    fs.writeFileSync(flags.output, JSON.stringify(graphData, null, 2) + '\n');
    console.log(`\nGraph exported to ${flags.output}\n`);
  }

  console.log(formatAnalysis(analysis, flags.json));
}

main();
