/**
 * Cross-repository reference registry for DocMeta
 *
 * Manages a local cache of .docmeta.json files from other repositories,
 * enabling cross-repo blast radius analysis and dependency tracking.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================================
// Registry Paths (configurable via environment variables)
// ============================================================================

// DOCMETA_HOME: Override the default ~/.docmeta directory
// Useful for CI, testing, or custom installations
const DOCMETA_DIR = process.env.DOCMETA_HOME || path.join(os.homedir(), '.docmeta');

// DOCMETA_REGISTRY: Override the registry file location
const REGISTRY_PATH = process.env.DOCMETA_REGISTRY || path.join(DOCMETA_DIR, 'registry.json');

// DOCMETA_CACHE: Override the cache directory
const CACHE_DIR = process.env.DOCMETA_CACHE || path.join(DOCMETA_DIR, 'cache');

// ============================================================================
// Reference Parsing
// ============================================================================

/**
 * Parse a cross-repo reference into its components
 * @param {string} ref - Reference string like "github:org/repo#branch:path/file.ts"
 * @returns {Object|null} Parsed reference or null if invalid
 */
function parseReference(ref) {
  if (!ref || typeof ref !== 'string') return null;

  // Local references (no prefix or starts with ./ or @/)
  if (!ref.includes(':') || ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('@/')) {
    return { type: 'local', path: ref };
  }

  const colonIndex = ref.indexOf(':');
  const prefix = ref.substring(0, colonIndex);
  const rest = ref.substring(colonIndex + 1);

  switch (prefix) {
    case 'github':
    case 'gitlab': {
      // github:org/repo#branch:path/file.ts
      const hashIndex = rest.indexOf('#');
      const pathColonIndex = rest.lastIndexOf(':');

      if (hashIndex === -1) {
        // github:org/repo (no branch or path)
        return { type: prefix, repo: rest, branch: 'main', path: null };
      }

      const repo = rest.substring(0, hashIndex);
      const afterHash = rest.substring(hashIndex + 1);

      if (pathColonIndex > hashIndex) {
        const branch = rest.substring(hashIndex + 1, pathColonIndex);
        const filePath = rest.substring(pathColonIndex + 1);
        return { type: prefix, repo, branch, path: filePath };
      } else {
        return { type: prefix, repo, branch: afterHash, path: null };
      }
    }

    case 'api': {
      // api:service-name/v1/endpoint
      const parts = rest.split('/');
      return {
        type: 'api',
        service: parts[0],
        version: parts[1] || null,
        endpoint: parts.slice(2).join('/') || null,
        full: rest
      };
    }

    case 'proto': {
      // proto:package.v1.MessageType
      const parts = rest.split('.');
      return {
        type: 'proto',
        package: parts.slice(0, -1).join('.'),
        message: parts[parts.length - 1],
        full: rest
      };
    }

    case 'grpc': {
      // grpc:ServiceName/MethodName
      const slashIndex = rest.indexOf('/');
      return {
        type: 'grpc',
        service: slashIndex > 0 ? rest.substring(0, slashIndex) : rest,
        method: slashIndex > 0 ? rest.substring(slashIndex + 1) : null,
        full: rest
      };
    }

    case 'event': {
      // event:topic.name
      return { type: 'event', topic: rest, full: rest };
    }

    case 'external': {
      // external:unknown or external:partner-name
      return { type: 'external', identifier: rest, full: rest };
    }

    default:
      // Unknown prefix, treat as opaque
      return { type: 'unknown', prefix, value: rest, full: ref };
  }
}

/**
 * Check if a reference is cross-repo (not local)
 * @param {string} ref - Reference string
 * @returns {boolean}
 */
function isCrossRepoReference(ref) {
  const parsed = parseReference(ref);
  return parsed && parsed.type !== 'local';
}

/**
 * Get the repository identifier from a parsed reference
 * @param {Object} parsed - Parsed reference from parseReference()
 * @returns {string|null} Repository identifier or null
 */
function getRepoIdentifier(parsed) {
  if (!parsed) return null;

  if (parsed.type === 'github' || parsed.type === 'gitlab') {
    return `${parsed.type}:${parsed.repo}`;
  }

  return null;
}

// ============================================================================
// Registry Management
// ============================================================================

/**
 * Ensure registry directories exist
 */
function ensureRegistryDirs() {
  if (!fs.existsSync(DOCMETA_DIR)) {
    fs.mkdirSync(DOCMETA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Load the registry index
 * @returns {Object} Registry data
 */
function loadRegistry() {
  ensureRegistryDirs();

  try {
    const content = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      version: 1,
      repositories: {},
      lastSync: null
    };
  }
}

/**
 * Save the registry index
 * @param {Object} registry - Registry data
 */
function saveRegistry(registry) {
  ensureRegistryDirs();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Add a repository to the registry
 * @param {string} repoRef - Repository reference (e.g., "github:org/repo")
 * @param {Object} options - Additional options
 * @returns {Object} Result with success status
 */
function addRepository(repoRef, options = {}) {
  const parsed = parseReference(repoRef);

  if (!parsed || (parsed.type !== 'github' && parsed.type !== 'gitlab')) {
    return {
      success: false,
      error: 'Invalid repository reference. Use format: github:org/repo or gitlab:org/repo'
    };
  }

  const registry = loadRegistry();
  const repoId = getRepoIdentifier(parsed);

  if (registry.repositories[repoId] && !options.force) {
    return {
      success: false,
      error: `Repository ${repoId} already registered. Use --force to update.`
    };
  }

  registry.repositories[repoId] = {
    type: parsed.type,
    repo: parsed.repo,
    branch: parsed.branch || options.branch || 'main',
    addedAt: new Date().toISOString(),
    lastSync: null,
    source: options.source || null  // URL or path to fetch from
  };

  saveRegistry(registry);

  return { success: true, repoId };
}

/**
 * Remove a repository from the registry
 * @param {string} repoRef - Repository reference
 * @returns {Object} Result with success status
 */
function removeRepository(repoRef) {
  const parsed = parseReference(repoRef);
  const repoId = getRepoIdentifier(parsed);

  if (!repoId) {
    return { success: false, error: 'Invalid repository reference' };
  }

  const registry = loadRegistry();

  if (!registry.repositories[repoId]) {
    return { success: false, error: `Repository ${repoId} not found in registry` };
  }

  delete registry.repositories[repoId];
  saveRegistry(registry);

  // Also remove cached data
  const cacheFile = getCacheFilePath(repoId);
  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
  }

  return { success: true, repoId };
}

/**
 * List all registered repositories
 * @returns {Object[]} Array of repository info
 */
function listRepositories() {
  const registry = loadRegistry();

  return Object.entries(registry.repositories).map(([id, info]) => ({
    id,
    ...info,
    cached: fs.existsSync(getCacheFilePath(id))
  }));
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Get the cache file path for a repository
 * @param {string} repoId - Repository identifier
 * @returns {string} File path
 */
function getCacheFilePath(repoId) {
  // Convert github:org/repo to github-org-repo.json
  const safeName = repoId.replace(/[:/]/g, '-');
  return path.join(CACHE_DIR, `${safeName}.json`);
}

/**
 * Load cached docmeta for a repository
 * @param {string} repoId - Repository identifier
 * @returns {Object|null} Cached docmeta bundle or null
 */
function loadCachedDocmeta(repoId) {
  const cacheFile = getCacheFilePath(repoId);

  try {
    const content = fs.readFileSync(cacheFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save docmeta bundle to cache
 * @param {string} repoId - Repository identifier
 * @param {Object} bundle - DocMeta bundle data
 */
function saveCachedDocmeta(repoId, bundle) {
  ensureRegistryDirs();
  const cacheFile = getCacheFilePath(repoId);
  fs.writeFileSync(cacheFile, JSON.stringify(bundle, null, 2) + '\n');

  // Update registry lastSync
  const registry = loadRegistry();
  if (registry.repositories[repoId]) {
    registry.repositories[repoId].lastSync = new Date().toISOString();
    saveRegistry(registry);
  }
}

/**
 * Export current project's docmeta as a bundle
 * @param {string} rootPath - Project root
 * @returns {Object} DocMeta bundle
 */
function exportDocmetaBundle(rootPath) {
  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: rootPath,
    folders: {}
  };

  // Find all .docmeta.json files
  function scanDir(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        // Skip common ignore directories
        if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        scanDir(fullPath, relPath);
      } else if (entry.name === '.docmeta.json') {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const docmeta = JSON.parse(content);
          bundle.folders[relativePath || '/'] = docmeta;
        } catch {
          // Skip invalid files
        }
      }
    }
  }

  scanDir(rootPath);

  return bundle;
}

/**
 * Import a docmeta bundle into the cache
 * @param {string} repoId - Repository identifier to associate with
 * @param {Object|string} bundleOrPath - Bundle object or path to bundle file
 * @returns {Object} Result with success status
 */
function importDocmetaBundle(repoId, bundleOrPath) {
  let bundle;

  if (typeof bundleOrPath === 'string') {
    try {
      const content = fs.readFileSync(bundleOrPath, 'utf-8');
      bundle = JSON.parse(content);
    } catch (err) {
      return { success: false, error: `Failed to read bundle: ${err.message}` };
    }
  } else {
    bundle = bundleOrPath;
  }

  if (!bundle.folders) {
    return { success: false, error: 'Invalid bundle format: missing folders' };
  }

  saveCachedDocmeta(repoId, bundle);

  return {
    success: true,
    repoId,
    folderCount: Object.keys(bundle.folders).length
  };
}

// ============================================================================
// Cross-Repo Lookup
// ============================================================================

/**
 * Resolve a cross-repo reference to its docmeta entry
 * @param {string} ref - Reference string
 * @returns {Object|null} Resolved docmeta entry or null
 */
function resolveReference(ref) {
  const parsed = parseReference(ref);

  if (!parsed || parsed.type === 'local') {
    return null;
  }

  const repoId = getRepoIdentifier(parsed);

  if (!repoId) {
    // Non-repo references (api:, proto:, etc.) - can't resolve to docmeta
    return { parsed, resolved: false, reason: 'Not a repository reference' };
  }

  const cached = loadCachedDocmeta(repoId);

  if (!cached) {
    return { parsed, resolved: false, reason: `Repository ${repoId} not in cache` };
  }

  if (!parsed.path) {
    // Just the repo, return all folders
    return { parsed, resolved: true, bundle: cached };
  }

  // Find the specific file/folder
  const targetDir = path.dirname(parsed.path);
  const targetFile = path.basename(parsed.path);

  const folderMeta = cached.folders[targetDir] || cached.folders['/' + targetDir];

  if (!folderMeta) {
    return { parsed, resolved: false, reason: `Folder ${targetDir} not found in cache` };
  }

  const fileMeta = folderMeta.files?.[targetFile];

  if (!fileMeta) {
    return { parsed, resolved: false, reason: `File ${targetFile} not found in folder ${targetDir}` };
  }

  return {
    parsed,
    resolved: true,
    folder: folderMeta,
    file: fileMeta
  };
}

/**
 * Find all consumers of a reference across the registry
 * @param {string} ref - Reference to find consumers of
 * @returns {Object[]} Array of consumer references
 */
function findCrossRepoConsumers(ref) {
  const consumers = [];
  const registry = loadRegistry();

  for (const repoId of Object.keys(registry.repositories)) {
    const cached = loadCachedDocmeta(repoId);
    if (!cached) continue;

    for (const [folderPath, folderMeta] of Object.entries(cached.folders)) {
      if (!folderMeta.files) continue;

      for (const [fileName, fileMeta] of Object.entries(folderMeta.files)) {
        if (!fileMeta.uses) continue;

        for (const use of fileMeta.uses) {
          if (use === ref || use.includes(ref)) {
            consumers.push({
              repo: repoId,
              folder: folderPath,
              file: fileName,
              reference: use
            });
          }
        }
      }

      // Also check contracts
      if (folderMeta.contracts) {
        for (const [contractId, contract] of Object.entries(folderMeta.contracts)) {
          if (contract.consumers) {
            for (const consumer of contract.consumers) {
              if (consumer === ref || consumer.includes(ref)) {
                consumers.push({
                  repo: repoId,
                  folder: folderPath,
                  contract: contractId,
                  reference: consumer
                });
              }
            }
          }
        }
      }
    }
  }

  return consumers;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Paths
  DOCMETA_DIR,
  REGISTRY_PATH,
  CACHE_DIR,

  // Parsing
  parseReference,
  isCrossRepoReference,
  getRepoIdentifier,

  // Registry
  loadRegistry,
  saveRegistry,
  addRepository,
  removeRepository,
  listRepositories,

  // Cache
  getCacheFilePath,
  loadCachedDocmeta,
  saveCachedDocmeta,
  exportDocmetaBundle,
  importDocmetaBundle,

  // Lookup
  resolveReference,
  findCrossRepoConsumers
};
