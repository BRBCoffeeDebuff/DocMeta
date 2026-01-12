#!/usr/bin/env node
/**
 * docmeta init - Create .docmeta.json scaffolds for code directories
 * 
 * Usage: docmeta init [path]
 * 
 * Scans for directories containing code files and creates initial
 * .docmeta.json files with structure to be filled in.
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, addHistoryEntry, loadPathAliases } = require('./lib/config');

// Configuration - now loaded from shared config
const CONFIG = {
  ignoreDirs: [
    'node_modules', '.git', '.next', 'dist', 'build', '.vercel',
    '__pycache__', '.pytest_cache', 'venv', '.venv', 'target',
    'coverage', '.nyc_output', '.cache'
  ],
  codeExtensions: [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',  // JavaScript/TypeScript
    '.py', '.pyw',                                   // Python
    '.go',                                           // Go
    '.rs',                                           // Rust
    '.java', '.kt', '.scala',                        // JVM
    '.rb',                                           // Ruby
    '.php',                                          // PHP
    '.cs',                                           // C#
    '.swift',                                        // Swift
  ],
  ignoreFiles: [
    '.DS_Store', 'thumbs.db',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'poetry.lock', 'Cargo.lock', 'go.sum'
  ],
  ignorePatterns: [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /_test\.go$/,
    /_test\.py$/,
    /test_.*\.py$/,
  ]
};

/**
 * Check if a file should be documented
 */
function shouldDocumentFile(filename) {
  if (CONFIG.ignoreFiles.includes(filename)) return false;
  if (CONFIG.ignorePatterns.some(p => p.test(filename))) return false;
  const ext = path.extname(filename);
  return CONFIG.codeExtensions.includes(ext);
}

/**
 * Get code files in a directory
 */
function getCodeFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => {
      const stat = fs.statSync(path.join(dir, f));
      return stat.isFile() && shouldDocumentFile(f);
    });
  } catch {
    return [];
  }
}

/**
 * Extract exports from JavaScript/TypeScript file
 */
function extractJSExports(content) {
  const exports = new Set();
  
  // Named exports: export const/function/class/type/interface Name
  const namedExports = content.matchAll(
    /export\s+(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g
  );
  for (const match of namedExports) {
    exports.add(match[1]);
  }
  
  // Named exports: export { Name, Other }
  const bracketExports = content.matchAll(/export\s*\{([^}]+)\}/g);
  for (const match of bracketExports) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    names.forEach(n => n && exports.add(n));
  }
  
  // Default export
  if (/export\s+default\s/.test(content)) {
    exports.add('default');
  }
  
  return [...exports];
}

/**
 * Check if an import path matches any configured alias
 */
function isInternalImport(importPath, aliases) {
  // Relative imports are always internal
  if (importPath.startsWith('.')) return true;

  // Check if it matches any alias pattern
  for (const pattern of Object.keys(aliases)) {
    const isWildcard = pattern.endsWith('/*');
    const patternBase = isWildcard ? pattern.slice(0, -2) : pattern;

    if (isWildcard) {
      if (importPath.startsWith(patternBase + '/')) return true;
    } else {
      if (importPath === patternBase) return true;
    }
  }

  return false;
}

/**
 * Extract internal imports from JavaScript/TypeScript file
 * Uses tsconfig.json/jsconfig.json path aliases when available
 */
function extractJSImports(content, aliases = {}) {
  const imports = new Set();

  // import ... from 'path'
  const importMatches = content.matchAll(/from\s+['"]([^'"]+)['"]/g);
  for (const match of importMatches) {
    const importPath = match[1];
    // Only internal imports (relative or matching an alias)
    if (isInternalImport(importPath, aliases)) {
      imports.add(importPath);
    }
  }

  // require('path')
  const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of requireMatches) {
    const importPath = match[1];
    if (isInternalImport(importPath, aliases)) {
      imports.add(importPath);
    }
  }

  return [...imports];
}

/**
 * Extract HTTP API calls from JavaScript/TypeScript file
 * Detects fetch(), axios, and other common HTTP client patterns
 */
function extractJSCalls(content) {
  const calls = new Set();

  // fetch('/api/...') or fetch("/api/...")
  const fetchMatches = content.matchAll(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const match of fetchMatches) {
    const url = match[1];
    // Only internal API calls (starting with / or relative)
    if (url.startsWith('/api/') || url.startsWith('api/')) {
      calls.add(url.startsWith('/') ? url : '/' + url);
    }
  }

  // fetch(`/api/...`) with template literals (simple cases)
  const templateFetchMatches = content.matchAll(/fetch\s*\(\s*`([^`]+)`/g);
  for (const match of templateFetchMatches) {
    const url = match[1];
    // Extract the static part before any ${} interpolation
    const staticPart = url.split('${')[0];
    if (staticPart.startsWith('/api/') || staticPart.startsWith('api/')) {
      // Normalize: add leading slash, remove trailing dynamic parts
      let normalized = staticPart.startsWith('/') ? staticPart : '/' + staticPart;
      // Remove trailing slash if it ends with one (before interpolation)
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

  // Next.js server actions or API route patterns
  // useSWR('/api/...') or useSWR("/api/...")
  const swrMatches = content.matchAll(/useSWR\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const match of swrMatches) {
    const url = match[1];
    if (url.startsWith('/api/') || url.startsWith('api/')) {
      calls.add(url.startsWith('/') ? url : '/' + url);
    }
  }

  // useQuery with queryFn that calls fetch (common pattern)
  // This is harder to detect reliably, so we look for queryKey patterns
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
 * Extract exports from Python file
 */
function extractPythonExports(content) {
  const exports = new Set();
  
  // __all__ = ['name1', 'name2']
  const allMatch = content.match(/__all__\s*=\s*\[([^\]]+)\]/);
  if (allMatch) {
    const names = allMatch[1].match(/['"](\w+)['"]/g);
    if (names) {
      names.forEach(n => exports.add(n.replace(/['"]/g, '')));
    }
    return [...exports];
  }
  
  // def function_name / class ClassName (public = no underscore prefix)
  const defs = content.matchAll(/^(?:def|class)\s+([a-zA-Z]\w*)/gm);
  for (const match of defs) {
    exports.add(match[1]);
  }
  
  return [...exports];
}

/**
 * Extract imports from Python file
 */
function extractPythonImports(content) {
  const imports = new Set();

  // from .module import ... (relative imports)
  const relativeImports = content.matchAll(/from\s+(\.+\w*)/g);
  for (const match of relativeImports) {
    imports.add(match[1]);
  }

  return [...imports];
}

/**
 * Extract exports from Go file
 * In Go, exported identifiers start with an uppercase letter
 */
function extractGoExports(content) {
  const exports = new Set();

  // func FunctionName (exported functions start with uppercase)
  const funcMatches = content.matchAll(/^func\s+(?:\([^)]+\)\s+)?([A-Z]\w*)/gm);
  for (const match of funcMatches) {
    exports.add(match[1]);
  }

  // type TypeName (exported types start with uppercase)
  const typeMatches = content.matchAll(/^type\s+([A-Z]\w*)/gm);
  for (const match of typeMatches) {
    exports.add(match[1]);
  }

  // var/const VarName (exported vars/consts start with uppercase)
  const varMatches = content.matchAll(/^(?:var|const)\s+([A-Z]\w*)/gm);
  for (const match of varMatches) {
    exports.add(match[1]);
  }

  // const block: const ( VarName = ... )
  const constBlocks = content.matchAll(/^const\s*\(\s*([\s\S]*?)\)/gm);
  for (const block of constBlocks) {
    const names = block[1].matchAll(/^\s*([A-Z]\w*)/gm);
    for (const name of names) {
      exports.add(name[1]);
    }
  }

  // var block: var ( VarName = ... )
  const varBlocks = content.matchAll(/^var\s*\(\s*([\s\S]*?)\)/gm);
  for (const block of varBlocks) {
    const names = block[1].matchAll(/^\s*([A-Z]\w*)/gm);
    for (const name of names) {
      exports.add(name[1]);
    }
  }

  return [...exports];
}

/**
 * Extract imports from Go file
 */
function extractGoImports(content) {
  const imports = new Set();

  // Single import: import "path"
  const singleImports = content.matchAll(/^import\s+"([^"]+)"/gm);
  for (const match of singleImports) {
    // Only track relative/local imports (not standard library)
    const importPath = match[1];
    if (importPath.startsWith('.') || importPath.includes('/internal/') || !importPath.includes('.')) {
      // Skip standard library imports (no dots in path like "fmt", "os")
      if (importPath.includes('/')) {
        imports.add(importPath);
      }
    }
  }

  // Import block: import ( "path1" "path2" )
  const importBlocks = content.matchAll(/^import\s*\(\s*([\s\S]*?)\)/gm);
  for (const block of importBlocks) {
    const paths = block[1].matchAll(/(?:\w+\s+)?"([^"]+)"/g);
    for (const pathMatch of paths) {
      const importPath = pathMatch[1];
      // Track project-internal imports (contain the module path)
      if (importPath.includes('/') && !importPath.startsWith('golang.org') &&
          !importPath.startsWith('github.com/') && !importPath.startsWith('gopkg.in')) {
        // This is a simplification - in real Go projects you'd check against go.mod
        imports.add(importPath);
      }
    }
  }

  return [...imports];
}

/**
 * Extract exports from Rust file
 * In Rust, pub items are exported
 */
function extractRustExports(content) {
  const exports = new Set();

  // pub fn function_name
  const pubFnMatches = content.matchAll(/pub\s+(?:async\s+)?fn\s+(\w+)/g);
  for (const match of pubFnMatches) {
    exports.add(match[1]);
  }

  // pub struct StructName
  const pubStructMatches = content.matchAll(/pub\s+struct\s+(\w+)/g);
  for (const match of pubStructMatches) {
    exports.add(match[1]);
  }

  // pub enum EnumName
  const pubEnumMatches = content.matchAll(/pub\s+enum\s+(\w+)/g);
  for (const match of pubEnumMatches) {
    exports.add(match[1]);
  }

  // pub trait TraitName
  const pubTraitMatches = content.matchAll(/pub\s+trait\s+(\w+)/g);
  for (const match of pubTraitMatches) {
    exports.add(match[1]);
  }

  // pub type TypeName
  const pubTypeMatches = content.matchAll(/pub\s+type\s+(\w+)/g);
  for (const match of pubTypeMatches) {
    exports.add(match[1]);
  }

  // pub const/static CONST_NAME
  const pubConstMatches = content.matchAll(/pub\s+(?:const|static)\s+(\w+)/g);
  for (const match of pubConstMatches) {
    exports.add(match[1]);
  }

  // pub mod module_name
  const pubModMatches = content.matchAll(/pub\s+mod\s+(\w+)/g);
  for (const match of pubModMatches) {
    exports.add(match[1]);
  }

  return [...exports];
}

/**
 * Extract imports from Rust file
 */
function extractRustImports(content) {
  const imports = new Set();

  // use crate::module::item
  const crateImports = content.matchAll(/use\s+crate::([^;{]+)/g);
  for (const match of crateImports) {
    imports.add('crate::' + match[1].trim().split('::')[0]);
  }

  // use super::module
  const superImports = content.matchAll(/use\s+super::([^;{]+)/g);
  for (const match of superImports) {
    imports.add('super::' + match[1].trim().split('::')[0]);
  }

  // use self::module (within same module)
  const selfImports = content.matchAll(/use\s+self::([^;{]+)/g);
  for (const match of selfImports) {
    imports.add('self::' + match[1].trim().split('::')[0]);
  }

  // mod module_name; (declares submodule)
  const modDecls = content.matchAll(/^mod\s+(\w+)\s*;/gm);
  for (const match of modDecls) {
    imports.add('./' + match[1]);
  }

  return [...imports];
}

/**
 * Analyze a file and extract metadata
 * @param {string} filePath - Path to file
 * @param {Object} aliases - Path aliases from tsconfig.json/jsconfig.json
 */
function analyzeFile(filePath, aliases = {}) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);
    const lines = content.split('\n').length;

    let exports = [];
    let uses = [];
    let calls = [];

    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      exports = extractJSExports(content);
      uses = extractJSImports(content, aliases);
      calls = extractJSCalls(content);
    } else if (['.py', '.pyw'].includes(ext)) {
      exports = extractPythonExports(content);
      uses = extractPythonImports(content);
    } else if (ext === '.go') {
      exports = extractGoExports(content);
      uses = extractGoImports(content);
    } else if (ext === '.rs') {
      exports = extractRustExports(content);
      uses = extractRustImports(content);
    }
    // Other languages: leave empty, to be filled manually or by Claude

    return { exports, uses, calls, lines };
  } catch {
    return { exports: [], uses: [], calls: [], lines: 0 };
  }
}

/**
 * Create a .docmeta.json structure for a directory
 * @param {string} dir - Directory to document
 * @param {string} rootPath - Project root
 * @param {Object} config - DocMeta configuration
 * @param {Object} aliases - Path aliases from tsconfig.json/jsconfig.json
 */
function createDocMeta(dir, rootPath, config, aliases = {}) {
  const relativePath = path.relative(rootPath, dir);
  const docPath = '/' + relativePath.replace(/\\/g, '/');
  const codeFiles = getCodeFiles(dir);

  const files = {};
  for (const fileName of codeFiles) {
    const filePath = path.join(dir, fileName);
    const analysis = analyzeFile(filePath, aliases);

    const fileEntry = {
      purpose: '[purpose]',
      exports: analysis.exports,
      uses: analysis.uses,
      usedBy: []  // Will be populated by 'usedby' command
    };

    // Only add calls/calledBy if there are HTTP calls detected
    // This keeps the schema minimal for files without API calls
    if (analysis.calls && analysis.calls.length > 0) {
      fileEntry.calls = analysis.calls;
      fileEntry.calledBy = [];  // Will be populated by 'calls' command
    }

    files[fileName] = fileEntry;
  }

  let docMeta = {
    v: 3,  // v3 adds calls/calledBy for HTTP API dependencies
    purpose: '[purpose]',
    files,
    history: [],
    updated: new Date().toISOString()
  };

  // Add initial history entry (respects maxHistoryEntries from config)
  docMeta = addHistoryEntry(docMeta, 'Initial documentation scaffold', codeFiles, config);

  return docMeta;
}

/**
 * Recursively find directories to document
 */
function findDirectories(rootPath) {
  const results = [];
  
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (CONFIG.ignoreDirs.includes(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        
        const fullPath = path.join(dir, entry.name);
        const codeFiles = getCodeFiles(fullPath);
        
        if (codeFiles.length > 0) {
          results.push(fullPath);
        }
        
        walk(fullPath);
      }
    } catch (err) {
      // Skip unreadable directories
    }
  }
  
  // Check root directory too
  if (getCodeFiles(rootPath).length > 0) {
    results.push(rootPath);
  }
  
  walk(rootPath);
  return results;
}

/**
 * Main function
 */
function main() {
  const targetPath = path.resolve(process.argv[2] || '.');

  // Load configuration
  const config = loadConfig(targetPath);

  // Load path aliases from tsconfig.json/jsconfig.json
  const aliases = loadPathAliases(targetPath);

  console.log('\n📚 DocMeta Init\n');
  console.log(`Scanning: ${targetPath}\n`);

  // Report loaded aliases
  const aliasCount = Object.keys(aliases).length;
  const hasCustomAliases = aliasCount > 2; // More than just @/* and ~/*
  if (hasCustomAliases) {
    console.log(`📦 Loaded ${aliasCount} path aliases from tsconfig.json/jsconfig.json`);
    const customAliases = Object.keys(aliases).filter(k => k !== '@/*' && k !== '~/*');
    if (customAliases.length > 0) {
      console.log(`   Custom: ${customAliases.slice(0, 5).join(', ')}${customAliases.length > 5 ? '...' : ''}`);
    }
    console.log('');
  }

  const directories = findDirectories(targetPath);
  console.log(`Found ${directories.length} directories with code files\n`);

  let created = 0;
  let skipped = 0;

  for (const dir of directories) {
    const metaPath = path.join(dir, '.docmeta.json');
    const relativePath = path.relative(targetPath, dir) || '.';

    // Skip if already exists
    if (fs.existsSync(metaPath)) {
      console.log(`⏭️  ${relativePath}/`);
      skipped++;
      continue;
    }

    // Create docmeta with path alias support
    const docMeta = createDocMeta(dir, targetPath, config, aliases);
    const fileCount = Object.keys(docMeta.files).length;

    fs.writeFileSync(metaPath, JSON.stringify(docMeta, null, 2) + '\n');
    console.log(`✅ ${relativePath}/ (${fileCount} files)`);
    created++;
  }

  console.log(`\n📊 Summary: ${created} created, ${skipped} skipped\n`);

  if (created > 0) {
    console.log('💡 Next steps:');
    console.log('   1. Run: docmeta usedby');
    console.log('      (Resolves dependency graph, populates usedBy fields)');
    console.log('   2. Fill in [purpose] purposes in .docmeta.json files');
    console.log('   3. Copy docs/DOCMETA.md to your project for Claude Code');
    console.log('');
  }
}

main();
