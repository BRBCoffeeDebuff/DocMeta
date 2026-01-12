#!/usr/bin/env node
/**
 * docmeta check - Find stale or incomplete documentation
 * 
 * Usage: docmeta check [path]
 * 
 * Checks for:
 * - Missing purposes ([purpose])
 * - Undocumented code files
 * - Documented files that no longer exist
 * - Stale documentation (not updated in 30+ days)
 * - Empty usedBy on shared code
 */

const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__'];
const CODE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.go', '.rs', '.java', '.kt', '.rb', '.php'
];
const IGNORE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.go$/,
  /_test\.py$/,
  /test_.*\.py$/,
];

/**
 * Find all .docmeta.json files
 */
function findDocMetaFiles(rootPath) {
  const results = [];
  
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Check for .docmeta.json files first (before skipping dot-files)
        if (entry.name === '.docmeta.json') {
          results.push(fullPath);
          continue;
        }

        // Skip hidden directories and ignored directories
        if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        }
      }
    } catch {
      // Skip unreadable
    }
  }
  
  walk(rootPath);
  return results;
}

/**
 * Get code files in a directory
 */
function getCodeFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => {
      if (IGNORE_PATTERNS.some(p => p.test(f))) return false;
      const ext = path.extname(f);
      return CODE_EXTENSIONS.includes(ext);
    });
  } catch {
    return [];
  }
}

/**
 * Check if a path looks like shared code (lib, utils, components)
 */
function isSharedCode(folderPath) {
  const lower = folderPath.toLowerCase();
  return lower.includes('/lib/') || 
         lower.includes('/utils/') || 
         lower.includes('/helpers/') ||
         lower.includes('/components/') ||
         lower.includes('/shared/') ||
         lower.includes('/common/');
}

/**
 * Main function
 */
function main() {
  const rootPath = path.resolve(process.argv[2] || '.');
  
  console.log('\n🔍 DocMeta Check\n');
  console.log(`Scanning: ${rootPath}\n`);
  
  const docMetaFiles = findDocMetaFiles(rootPath);
  
  if (docMetaFiles.length === 0) {
    console.log('No .docmeta.json files found. Run "docmeta init" first.\n');
    return;
  }
  
  const issues = [];
  let totalFiles = 0;
  let documentedFiles = 0;
  
  for (const docMetaPath of docMetaFiles) {
    const dir = path.dirname(docMetaPath);
    const relativePath = path.relative(rootPath, dir) || '.';
    const folderIssues = [];
    
    // Parse docmeta
    let content;
    try {
      content = JSON.parse(fs.readFileSync(docMetaPath, 'utf-8'));
    } catch (err) {
      folderIssues.push(`Invalid JSON: ${err.message}`);
      issues.push({ path: relativePath, issues: folderIssues });
      continue;
    }
    
    // Check folder purpose
    if (!content.purpose || 
        content.purpose.includes('[purpose]') || 
        content.purpose === '[purpose]' ||
        content.purpose.toLowerCase() === 'todo') {
      folderIssues.push('Missing folder purpose');
    }
    
    // Compare documented files vs actual files
    const actualFiles = getCodeFiles(dir);
    const documentedFileNames = Object.keys(content.files || {});
    
    totalFiles += actualFiles.length;
    documentedFiles += documentedFileNames.filter(f => actualFiles.includes(f)).length;
    
    // Check for undocumented files
    for (const file of actualFiles) {
      if (!documentedFileNames.includes(file)) {
        folderIssues.push(`Undocumented file: ${file}`);
      }
    }
    
    // Check for stale entries (documented but deleted)
    for (const file of documentedFileNames) {
      if (!actualFiles.includes(file)) {
        folderIssues.push(`Stale entry: ${file} (file deleted?)`);
      }
    }
    
    // Check each file's metadata
    for (const [fileName, fileData] of Object.entries(content.files || {})) {
      // Check purpose - only flag if purpose IS a placeholder, not if it mentions placeholders
      if (!fileData.purpose ||
          fileData.purpose === '[purpose]' ||
          fileData.purpose.startsWith('[purpose]') ||
          fileData.purpose.toLowerCase() === 'todo') {
        folderIssues.push(`Missing purpose: ${fileName}`);
      }
      
      // Check usedBy on shared code
      if (isSharedCode(relativePath)) {
        if (!fileData.usedBy || fileData.usedBy.length === 0) {
          // Only warn if file still exists
          if (actualFiles.includes(fileName)) {
            folderIssues.push(`No usedBy: ${fileName} (run 'docmeta usedby'?)`);
          }
        }
      }
    }
    
    // Check staleness
    if (content.updated) {
      const lastUpdate = new Date(content.updated);
      const daysSince = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSince > 30) {
        folderIssues.push(`Stale docs: last updated ${Math.floor(daysSince)} days ago`);
      }
    }
    
    if (folderIssues.length > 0) {
      issues.push({ path: relativePath, issues: folderIssues });
    }
  }
  
  // Output results
  if (issues.length === 0) {
    console.log(`✅ All ${docMetaFiles.length} documented folders look good!\n`);
  } else {
    console.log(`Found issues in ${issues.length} of ${docMetaFiles.length} folders:\n`);
    
    for (const { path: p, issues: iss } of issues) {
      console.log(`⚠️  ${p}/`);
      for (const issue of iss.slice(0, 5)) {
        console.log(`   - ${issue}`);
      }
      if (iss.length > 5) {
        console.log(`   - ... and ${iss.length - 5} more`);
      }
    }
    console.log('');
  }
  
  // Summary stats
  const todoCount = issues.reduce((n, i) => 
    n + i.issues.filter(x => x.includes('Missing purpose')).length, 0);
  const undocCount = issues.reduce((n, i) => 
    n + i.issues.filter(x => x.includes('Undocumented file')).length, 0);
  const staleCount = issues.reduce((n, i) => 
    n + i.issues.filter(x => x.includes('Stale')).length, 0);
  const usedByCount = issues.reduce((n, i) =>
    n + i.issues.filter(x => x.includes('No usedBy')).length, 0);
  
  console.log('📊 Summary:');
  console.log(`   ${docMetaFiles.length} folders documented`);
  console.log(`   ${documentedFiles}/${totalFiles} code files covered`);
  
  if (todoCount > 0) console.log(`   ${todoCount} missing purposes (fill in [purpose])`);
  if (undocCount > 0) console.log(`   ${undocCount} undocumented files`);
  if (staleCount > 0) console.log(`   ${staleCount} stale entries`);
  if (usedByCount > 0) console.log(`   ${usedByCount} missing usedBy (run 'docmeta usedby')`);
  
  console.log('');
  
  // Exit code for CI
  if (issues.length > 0) {
    process.exit(1);
  }
}

main();
