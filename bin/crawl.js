#!/usr/bin/env node
/**
 * docmeta crawl - Crawl codebase to fill in missing purposes
 *
 * Usage: docmeta crawl [options]
 *
 * Options:
 *   --batch <n>     Number of files to process before pausing (default: 20)
 *   --auto          Don't pause between batches (for CI/automation)
 *   --dry-run       Show what would be processed without making changes
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { readDocMeta } = require('./lib/config');
const { getIgnorePatterns, shouldIgnore } = require('./lib/ignores');

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_BATCH_SIZE = 20;

// ============================================================================
// Helpers
// ============================================================================

function parseArgs(args) {
  const options = {
    batchSize: DEFAULT_BATCH_SIZE,
    auto: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--batch' && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1], 10) || DEFAULT_BATCH_SIZE;
      i++;
    } else if (arg === '--auto') {
      options.auto = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

async function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y') || answer === '');
    });
  });
}

// ============================================================================
// Crawl Logic
// ============================================================================

/**
 * Find all .docmeta.json files in the project
 */
function findDocMetaFiles(rootPath) {
  const ignores = getIgnorePatterns(rootPath);
  const results = [];

  function scan(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        if (!shouldIgnore(relativePath, ignores)) {
          scan(fullPath);
        }
      } else if (entry.name === '.docmeta.json') {
        results.push(fullPath);
      }
    }
  }

  scan(rootPath);
  return results;
}

function findTodoFiles(rootDir) {
  const docMetaFiles = findDocMetaFiles(rootDir);
  const todoFiles = [];

  for (const docMetaPath of docMetaFiles) {
    const docMeta = readDocMeta(docMetaPath);
    if (!docMeta || !docMeta.files) continue;

    const dir = path.dirname(docMetaPath);

    for (const [filename, fileData] of Object.entries(docMeta.files)) {
      if (fileData.purpose === '[purpose]' || !fileData.purpose) {
        const fullPath = path.join(dir, filename);
        if (fs.existsSync(fullPath)) {
          todoFiles.push({
            file: fullPath,
            relativePath: path.relative(rootDir, fullPath),
            docMetaPath,
          });
        }
      }
    }
  }

  return todoFiles;
}

function formatBatch(files, startIndex) {
  const lines = [];
  files.forEach((f, i) => {
    lines.push(`  ${startIndex + i + 1}. ${f.relativePath}`);
  });
  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  const rootDir = process.cwd();

  console.log('🔍 DocMeta Crawl\n');

  // Find all files needing purposes
  const todoFiles = findTodoFiles(rootDir);

  if (todoFiles.length === 0) {
    console.log('✅ All files have purposes defined. Nothing to crawl.\n');
    return;
  }

  console.log(`Found ${todoFiles.length} file(s) with missing purposes.\n`);

  if (options.dryRun) {
    console.log('Files that would be processed:\n');
    todoFiles.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.relativePath}`);
    });
    console.log('\nRun without --dry-run to process these files.');
    return;
  }

  // Process in batches
  const batches = [];
  for (let i = 0; i < todoFiles.length; i += options.batchSize) {
    batches.push(todoFiles.slice(i, i + options.batchSize));
  }

  console.log(`Will process in ${batches.length} batch(es) of up to ${options.batchSize} files.\n`);
  console.log('─'.repeat(60));
  console.log('');
  console.log('For each file, read the code and update its purpose using:');
  console.log('');
  console.log('  docmeta update <file> --purpose "description of what it does"');
  console.log('');
  console.log('─'.repeat(60));

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const startIndex = batchIndex * options.batchSize;

    console.log(`\n📦 Batch ${batchIndex + 1}/${batches.length} (${batch.length} files):\n`);
    console.log(formatBatch(batch, startIndex));
    console.log('');

    // Output file list in a format easy for an agent to process
    console.log('Files to process:');
    batch.forEach(f => {
      console.log(`  - ${f.file}`);
    });
    console.log('');

    if (!options.auto && batchIndex < batches.length - 1) {
      const remaining = todoFiles.length - (startIndex + batch.length);
      const shouldContinue = await confirm(
        `\nPress Enter to continue to next batch (${remaining} files remaining), or 'n' to stop: `
      );

      if (!shouldContinue) {
        console.log('\n⏸️  Crawl paused. Run again to continue.\n');
        return;
      }
    }
  }

  console.log('\n✅ All batches listed. Update purposes for these files, then run:\n');
  console.log('  docmeta usedby    # Rebuild dependencies');
  console.log('  docmeta check     # Verify everything is documented\n');
}

main().catch(err => {
  console.error('Crawl failed:', err.message);
  process.exit(1);
});
