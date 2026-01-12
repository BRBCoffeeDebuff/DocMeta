#!/usr/bin/env node
/**
 * docmeta calls - Resolve HTTP API calls to route files
 *
 * Usage: docmeta calls [path]
 *
 * Scans source files for fetch/axios calls to /api/* endpoints and resolves
 * them to actual route files. Updates both directions:
 *   - `calls` arrays in caller files (what routes does this file call?)
 *   - `calledBy` arrays in route files (who calls this route?)
 *
 * This creates a bidirectional HTTP dependency graph, similar to uses/usedBy
 * for import dependencies.
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, readDocMeta, writeDocMeta, addHistoryEntry } = require('./lib/config');

// ============================================================================
// Route Resolution
// ============================================================================

/**
 * Find all potential route files in the project
 * Supports Next.js App Router and Pages Router patterns
 */
function findRouteFiles(rootPath) {
  const routes = new Map(); // endpoint -> file path

  function walk(dir, prefix = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        // Skip common ignored directories
        if (entry.isDirectory()) {
          if (['node_modules', '.git', '.next', 'dist', 'build', '.vercel'].includes(entry.name)) {
            continue;
          }
          walk(fullPath, prefix);
          continue;
        }

        // Next.js App Router: app/api/auth/route.ts -> /api/auth
        if (relativePath.match(/^app\/api\/.*\/route\.[jt]sx?$/)) {
          const endpoint = relativePath
            .replace(/^app/, '')
            .replace(/\/route\.[jt]sx?$/, '');
          routes.set(endpoint, '/' + relativePath);
        }

        // Next.js Pages Router: pages/api/auth.ts -> /api/auth
        // or pages/api/auth/index.ts -> /api/auth
        if (relativePath.match(/^pages\/api\/.*\.[jt]sx?$/)) {
          let endpoint = '/' + relativePath
            .replace(/^pages/, '')
            .replace(/\/index\.[jt]sx?$/, '')
            .replace(/\.[jt]sx?$/, '');
          routes.set(endpoint, '/' + relativePath);
        }

        // Express/Fastify style: routes/api/*.ts or src/routes/*.ts
        // These are harder to map automatically, but we can try common patterns
        if (relativePath.match(/(?:routes|controllers)\/.*\.[jt]sx?$/)) {
          // Extract potential endpoint from filename
          const basename = path.basename(relativePath, path.extname(relativePath));
          if (basename !== 'index') {
            const possibleEndpoint = '/api/' + basename;
            // Only add if not already mapped
            if (!routes.has(possibleEndpoint)) {
              routes.set(possibleEndpoint, '/' + relativePath);
            }
          }
        }
      }
    } catch (err) {
      // Skip unreadable directories
    }
  }

  walk(rootPath);
  return routes;
}

/**
 * Find all .docmeta.json files recursively
 */
function findDocMetaFiles(rootPath) {
  const files = [];

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) {
            continue;
          }
          walk(fullPath);
        } else if (entry.name === '.docmeta.json') {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walk(rootPath);
  return files;
}

/**
 * Normalize an API endpoint for matching
 * - Removes trailing slashes
 * - Handles dynamic segments like [id] or :id
 */
function normalizeEndpoint(endpoint) {
  return endpoint
    .replace(/\/+$/, '')  // Remove trailing slashes
    .replace(/\/\[.*?\]/g, '')  // Remove Next.js dynamic segments for prefix matching
    .replace(/\/:[^/]+/g, '');  // Remove Express-style params
}

/**
 * Find the best matching route for an endpoint
 */
function findMatchingRoute(endpoint, routes) {
  // Direct match
  if (routes.has(endpoint)) {
    return routes.get(endpoint);
  }

  // Try normalized match
  const normalized = normalizeEndpoint(endpoint);
  if (routes.has(normalized)) {
    return routes.get(normalized);
  }

  // Try prefix match (for dynamic routes)
  // e.g., /api/users/123 should match /api/users/[id]
  for (const [routeEndpoint, routePath] of routes) {
    const routeNormalized = normalizeEndpoint(routeEndpoint);
    if (normalized.startsWith(routeNormalized) || routeNormalized.startsWith(normalized)) {
      return routePath;
    }
  }

  return null;
}

// ============================================================================
// HTTP Call Detection (scans source files directly)
// ============================================================================

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const IGNORE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '.vercel', '__pycache__', 'coverage'];

/**
 * Extract HTTP API calls from JavaScript/TypeScript file content
 */
function extractJSCalls(content) {
  const calls = new Set();

  // fetch('/api/...') or fetch("/api/...")
  const fetchMatches = content.matchAll(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const match of fetchMatches) {
    const url = match[1];
    if (url.startsWith('/api/') || url.startsWith('api/')) {
      calls.add(url.startsWith('/') ? url : '/' + url);
    }
  }

  // fetch(`/api/...`) with template literals
  const templateFetchMatches = content.matchAll(/fetch\s*\(\s*`([^`]+)`/g);
  for (const match of templateFetchMatches) {
    const url = match[1];
    const staticPart = url.split('${')[0];
    if (staticPart.startsWith('/api/') || staticPart.startsWith('api/')) {
      let normalized = staticPart.startsWith('/') ? staticPart : '/' + staticPart;
      if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      if (normalized.length > 1) {
        calls.add(normalized);
      }
    }
  }

  // axios.get/post/put/delete('/api/...')
  const axiosMatches = content.matchAll(/axios\.(?:get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const match of axiosMatches) {
    const url = match[1];
    if (url.startsWith('/api/') || url.startsWith('api/')) {
      calls.add(url.startsWith('/') ? url : '/' + url);
    }
  }

  // axios({ url: '/api/...' })
  const axiosObjMatches = content.matchAll(/axios\s*\(\s*\{[^}]*url\s*:\s*['"`]([^'"`]+)['"`]/g);
  for (const match of axiosObjMatches) {
    const url = match[1];
    if (url.startsWith('/api/') || url.startsWith('api/')) {
      calls.add(url.startsWith('/') ? url : '/' + url);
    }
  }

  // useSWR('/api/...') or useSWR("/api/...")
  const swrMatches = content.matchAll(/useSWR\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const match of swrMatches) {
    const url = match[1];
    if (url.startsWith('/api/') || url.startsWith('api/')) {
      calls.add(url.startsWith('/') ? url : '/' + url);
    }
  }

  // useQuery queryKey patterns
  const queryKeyMatches = content.matchAll(/queryKey\s*:\s*\[['"`]([^'"`]+)['"`]\]/g);
  for (const match of queryKeyMatches) {
    const key = match[1];
    if (key.startsWith('/api/') || key.startsWith('api/')) {
      calls.add(key.startsWith('/') ? key : '/' + key);
    }
  }

  return [...calls];
}

/**
 * Find all source files and extract their HTTP calls
 */
function findSourceFilesWithCalls(rootPath) {
  const fileCallsMap = new Map(); // filePath -> Set of endpoints

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) {
            continue;
          }
          walk(fullPath);
          continue;
        }

        // Check if it's a code file
        const ext = path.extname(entry.name);
        if (!CODE_EXTENSIONS.includes(ext)) continue;

        // Read and extract calls
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const calls = extractJSCalls(content);

          if (calls.length > 0) {
            const relativePath = '/' + path.relative(rootPath, fullPath).replace(/\\/g, '/');
            fileCallsMap.set(relativePath, new Set(calls));
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  walk(rootPath);
  return fileCallsMap;
}

// ============================================================================
// Main Resolution Logic
// ============================================================================

/**
 * Build the calledBy graph by scanning source files directly
 */
function buildCalledByGraph(rootPath) {
  const routes = findRouteFiles(rootPath);

  // Map: route file path -> Set of calling file paths
  const calledByMap = new Map();

  // Initialize all route files with empty sets
  for (const routePath of routes.values()) {
    calledByMap.set(routePath, new Set());
  }

  // Scan all source files for HTTP calls
  const fileCallsMap = findSourceFilesWithCalls(rootPath);

  for (const [callerPath, endpoints] of fileCallsMap) {
    for (const endpoint of endpoints) {
      const routePath = findMatchingRoute(endpoint, routes);
      if (routePath) {
        if (!calledByMap.has(routePath)) {
          calledByMap.set(routePath, new Set());
        }
        calledByMap.get(routePath).add(callerPath);
      }
    }
  }

  return { routes, calledByMap, fileCallsMap };
}

/**
 * Update .docmeta.json files with calledBy information (routes) and calls information (callers)
 * This creates bidirectional links just like uses/usedBy
 */
function updateDocMetaFiles(rootPath, calledByMap, fileCallsMap, routes, config) {
  const docMetaFiles = findDocMetaFiles(rootPath);
  let updatedCount = 0;
  let totalCalledBy = 0;
  let totalCalls = 0;

  for (const docMetaPath of docMetaFiles) {
    const docMeta = readDocMeta(docMetaPath);
    if (!docMeta || !docMeta.files) continue;

    const docMetaDir = path.dirname(docMetaPath);
    const relativeDir = '/' + path.relative(rootPath, docMetaDir).replace(/\\/g, '/');
    let modified = false;
    const modifiedFiles = [];

    for (const [fileName, fileMeta] of Object.entries(docMeta.files)) {
      const filePath = relativeDir === '/' ? `/${fileName}` : `${relativeDir}/${fileName}`;

      // Update calledBy for route files (reverse direction: who calls this route?)
      if (calledByMap.has(filePath)) {
        const callers = [...calledByMap.get(filePath)].sort();
        const oldCalledBy = fileMeta.calledBy || [];

        // Check if calledBy changed
        if (JSON.stringify(oldCalledBy.sort()) !== JSON.stringify(callers)) {
          fileMeta.calledBy = callers;
          modified = true;
          if (!modifiedFiles.includes(fileName)) modifiedFiles.push(fileName);
          totalCalledBy += callers.length;
        }
      }

      // Update calls for caller files (forward direction: what routes does this file call?)
      if (fileCallsMap.has(filePath)) {
        const endpoints = fileCallsMap.get(filePath);
        const resolvedCalls = [];

        // Resolve each endpoint to its route file path
        for (const endpoint of endpoints) {
          const routePath = findMatchingRoute(endpoint, routes);
          if (routePath) {
            resolvedCalls.push(routePath);
          }
        }

        const sortedCalls = [...new Set(resolvedCalls)].sort();
        const oldCalls = fileMeta.calls || [];

        // Check if calls changed
        if (JSON.stringify(oldCalls.sort()) !== JSON.stringify(sortedCalls)) {
          if (sortedCalls.length > 0) {
            fileMeta.calls = sortedCalls;
          } else if (fileMeta.calls) {
            delete fileMeta.calls; // Remove empty calls array
          }
          modified = true;
          if (!modifiedFiles.includes(fileName)) modifiedFiles.push(fileName);
          totalCalls += sortedCalls.length;
        }
      }
    }

    if (modified) {
      // Update version to v3 if needed
      if (!docMeta.v || docMeta.v < 3) {
        docMeta.v = 3;
      }

      // Add history entry
      addHistoryEntry(
        docMeta,
        `Resolved ${modifiedFiles.length} file(s) with HTTP API references`,
        modifiedFiles,
        config
      );

      writeDocMeta(docMetaPath, docMeta);
      updatedCount++;
    }
  }

  return { updatedCount, totalCalledBy, totalCalls };
}

// ============================================================================
// CLI
// ============================================================================

function main() {
  const targetPath = path.resolve(process.argv[2] || '.');
  const config = loadConfig(targetPath);

  console.log('\n📡 DocMeta Calls - Resolving HTTP API dependencies\n');
  console.log(`Scanning: ${targetPath}\n`);

  // Find routes and calls
  const { routes, calledByMap, fileCallsMap } = buildCalledByGraph(targetPath);

  console.log(`Found ${routes.size} API route files`);

  if (routes.size > 0) {
    console.log('\nRoute mappings:');
    const routeList = [...routes.entries()].slice(0, 10);
    for (const [endpoint, filePath] of routeList) {
      console.log(`  ${endpoint} -> ${filePath}`);
    }
    if (routes.size > 10) {
      console.log(`  ... and ${routes.size - 10} more`);
    }
  }

  // Show files with HTTP calls
  console.log(`\nFound ${fileCallsMap.size} files with HTTP API calls`);
  if (fileCallsMap.size > 0) {
    const callsList = [...fileCallsMap.entries()].slice(0, 5);
    for (const [filePath, endpoints] of callsList) {
      console.log(`  ${filePath} -> ${[...endpoints].slice(0, 3).join(', ')}${endpoints.size > 3 ? '...' : ''}`);
    }
    if (fileCallsMap.size > 5) {
      console.log(`  ... and ${fileCallsMap.size - 5} more files`);
    }
  }

  // Count total calls resolved to routes
  let totalCalls = 0;
  for (const callers of calledByMap.values()) {
    totalCalls += callers.size;
  }

  console.log(`\nResolved ${totalCalls} HTTP call references to routes`);

  // Update docmeta files (bidirectional: calledBy in routes, calls in callers)
  const { updatedCount, totalCalledBy, totalCalls: totalCallsUpdated } = updateDocMetaFiles(targetPath, calledByMap, fileCallsMap, routes, config);

  console.log(`\n📊 Summary:`);
  console.log(`   Routes found: ${routes.size}`);
  console.log(`   Files with calls: ${fileCallsMap.size}`);
  console.log(`   calledBy links updated: ${totalCalledBy}`);
  console.log(`   calls links updated: ${totalCallsUpdated}`);
  console.log(`   DocMeta files updated: ${updatedCount}`);

  if (updatedCount > 0) {
    console.log('\n💡 Bidirectional HTTP API links updated:');
    console.log('   - Route files have "calledBy" arrays (who calls this route)');
    console.log('   - Caller files have "calls" arrays (what routes they call)');
    console.log('   Run "docmeta graph" to see the full dependency analysis.');
  } else if (fileCallsMap.size === 0) {
    console.log('\n💡 No HTTP API calls found (fetch, axios, etc.).');
    console.log('   Make sure your code uses fetch("/api/...") patterns.');
  } else if (totalCalls === 0) {
    console.log('\n💡 Found API calls but none matched known routes.');
    console.log('   Check that your routes follow Next.js conventions (app/api/**/route.ts).');
  }

  console.log('');
}

main();
