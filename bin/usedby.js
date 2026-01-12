#!/usr/bin/env node
/**
 * docmeta usedby - Populate usedBy fields by resolving uses references
 * 
 * Usage: docmeta usedby [path]
 * 
 * Reads all .docmeta.json files, looks at each file's `uses` array,
 * and populates the corresponding `usedBy` in the target files.
 * 
 * This creates the bidirectional dependency graph.
 */

const fs = require('fs');
const path = require('path');
const { loadPathAliases, resolvePathAlias } = require('./lib/config');

const IGNORE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build'];

/**
 * Find all .docmeta.json files in the project
 */
function findDocMetaFiles(rootPath) {
  const results = [];
  
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (IGNORE_DIRS.includes(entry.name)) continue;
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name === '.docmeta.json') {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
  
  walk(rootPath);
  return results;
}

/**
 * Resolve an import path to an absolute project path
 * Now uses tsconfig.json/jsconfig.json path aliases when available
 */
function resolveImportPath(importPath, fromDir, rootPath, aliases) {
  // Use the shared alias resolver from config
  return resolvePathAlias(importPath, aliases, fromDir, rootPath);
}

/**
 * Normalize a path for lookup (remove extension, handle index files)
 */
function normalizeForLookup(p) {
  // Remove common extensions
  return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/, '');
}

/**
 * Main function
 */
function main() {
  const rootPath = path.resolve(process.argv[2] || '.');

  console.log('\n🔗 DocMeta UsedBy Resolver\n');
  console.log(`Scanning: ${rootPath}\n`);

  // Load path aliases from tsconfig.json/jsconfig.json
  const aliases = loadPathAliases(rootPath);
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

  const docMetaFiles = findDocMetaFiles(rootPath);
  console.log(`Found ${docMetaFiles.length} .docmeta.json files\n`);

  if (docMetaFiles.length === 0) {
    console.log('No .docmeta.json files found. Run "docmeta init" first.\n');
    return;
  }
  
  // Step 1: Load all docmeta and build file index
  const docMetas = new Map();  // docMetaPath -> content
  const fileIndex = new Map(); // normalized path -> { docMetaPath, fileName }
  
  for (const docMetaPath of docMetaFiles) {
    try {
      const content = JSON.parse(fs.readFileSync(docMetaPath, 'utf-8'));
      const dir = path.dirname(docMetaPath);
      const folderPath = '/' + path.relative(rootPath, dir).replace(/\\/g, '/');
      
      docMetas.set(docMetaPath, { content, dir, folderPath });
      
      // Index each file in this docmeta
      for (const fileName of Object.keys(content.files || {})) {
        const filePath = path.posix.join(folderPath, fileName);
        const normalized = normalizeForLookup(filePath);
        
        fileIndex.set(normalized, { docMetaPath, fileName });
        
        // Also index without leading slash
        if (normalized.startsWith('/')) {
          fileIndex.set(normalized.slice(1), { docMetaPath, fileName });
        }
        
        // Index folder path for index files
        if (/^index\.(ts|tsx|js|jsx|mjs|py)$/.test(fileName)) {
          fileIndex.set(normalizeForLookup(folderPath), { docMetaPath, fileName });
          fileIndex.set(normalizeForLookup(folderPath).slice(1), { docMetaPath, fileName });
        }
      }
    } catch (err) {
      console.error(`⚠️  Error reading ${docMetaPath}: ${err.message}`);
    }
  }
  
  // Step 2: Clear all usedBy arrays
  for (const [docMetaPath, { content }] of docMetas) {
    for (const fileName of Object.keys(content.files || {})) {
      content.files[fileName].usedBy = [];
    }
  }
  
  // Step 3: Walk through all uses and populate usedBy
  let linksCreated = 0;
  const unresolved = new Map(); // target -> [sources]
  
  for (const [docMetaPath, { content, dir, folderPath }] of docMetas) {
    for (const [fileName, fileData] of Object.entries(content.files || {})) {
      const thisFilePath = path.posix.join(folderPath, fileName);
      const uses = fileData.uses || [];
      
      for (const usePath of uses) {
        // Resolve the import path using tsconfig aliases
        const resolved = resolveImportPath(usePath, dir, rootPath, aliases);
        if (!resolved) continue;
        
        const normalized = normalizeForLookup(resolved);
        
        // Find the target in our index
        const target = fileIndex.get(normalized) || 
                       fileIndex.get(normalized.slice(1)) ||
                       fileIndex.get(normalized.replace(/^\//, ''));
        
        if (target) {
          const targetDoc = docMetas.get(target.docMetaPath);
          const targetFile = targetDoc.content.files[target.fileName];
          
          if (!targetFile.usedBy.includes(thisFilePath)) {
            targetFile.usedBy.push(thisFilePath);
            linksCreated++;
          }
        } else {
          // Track unresolved for reporting
          if (!unresolved.has(usePath)) {
            unresolved.set(usePath, []);
          }
          unresolved.get(usePath).push(thisFilePath);
        }
      }
    }
  }
  
  // Step 4: Sort usedBy arrays for consistency
  for (const [docMetaPath, { content }] of docMetas) {
    for (const fileData of Object.values(content.files || {})) {
      fileData.usedBy.sort();
    }
  }
  
  // Step 5: Write back all docmeta files
  for (const [docMetaPath, { content }] of docMetas) {
    content.updated = new Date().toISOString();
    fs.writeFileSync(docMetaPath, JSON.stringify(content, null, 2) + '\n');
  }
  
  console.log(`✅ Created ${linksCreated} usedBy links\n`);
  
  // Report unresolved
  if (unresolved.size > 0) {
    console.log(`⚠️  ${unresolved.size} import targets not found in any .docmeta.json:\n`);
    
    const sorted = [...unresolved.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 15);
    
    for (const [target, sources] of sorted) {
      console.log(`   ${target}`);
      console.log(`      ← used by ${sources.length} file(s)`);
    }
    
    if (unresolved.size > 15) {
      console.log(`\n   ... and ${unresolved.size - 15} more`);
    }
    
    console.log('\n   These targets either:');
    console.log('   - Are external packages (expected, ignore these)');
    console.log('   - Are in directories without .docmeta.json (run "docmeta init")');
    console.log('   - Use path aliases not in tsconfig.json/jsconfig.json\n');
  }
  
  console.log('💡 The usedBy fields now show what files depend on each file.');
  console.log('   This is your "blast radius" - what might break if you change something.\n');
}

main();
