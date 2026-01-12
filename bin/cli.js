#!/usr/bin/env node
/**
 * docmeta - Living documentation for AI-assisted coding
 * 
 * Usage:
 *   docmeta init [path]     Create .docmeta.json scaffolds
 *   docmeta usedby [path]   Populate usedBy fields from uses references
 *   docmeta check [path]    Find stale or incomplete documentation
 *   docmeta --help          Show help
 */

const HELP = `
docmeta - Living documentation for AI-assisted coding

Usage:
  docmeta setup           Interactive setup wizard (recommended for new users)
  docmeta init [path]     Create .docmeta.json scaffolds for code directories
  docmeta usedby [path]   Populate usedBy fields by resolving uses references
  docmeta graph           Analyze dependency graph (cycles, orphans, blast radius)
  docmeta update <target> Update file/folder metadata (--purpose, --history, --sync)
  docmeta crawl           Find files needing purposes, process in batches
  docmeta ignore          Manage ignore patterns (--add-dir, --add-file, --remove)
  docmeta registry <cmd>  Cross-repo reference management (add, list, sync, export)
  docmeta check [path]    Find stale or incomplete documentation
  docmeta mcp             Start MCP server for Claude Code integration

Graph Analysis:
  docmeta graph                        Full analysis (entry points, orphans, cycles)
  docmeta graph --blast-radius <file>  What breaks if I change this file?
  docmeta graph --orphans              Find dead code candidates
  docmeta graph --cycles               Find circular dependencies
  docmeta graph --entry-points         Find where execution starts
  docmeta graph --output <file>        Export graph to JSON

Options:
  --help, -h              Show this help message
  --version, -v           Show version

Examples:
  docmeta init                         # Bootstrap docs for current directory
  docmeta usedby                       # Resolve all usedBy references
  docmeta graph                        # Full graph analysis
  docmeta graph --blast-radius src/api # What breaks if I change src/api?
  docmeta check                        # Find documentation issues

MCP Integration:
  Add to your Claude Code settings (~/.claude/settings.json):
  {
    "mcpServers": {
      "docmeta": {
        "command": "npx",
        "args": ["@brbcoffeedebuff/docmeta", "mcp"]
      }
    }
  }

Workflow:
  1. docmeta setup         # Interactive setup (or use commands below)
  2. docmeta init          # Create scaffolds
  3. docmeta usedby        # Build dependency graph
  4. docmeta graph         # Analyze for issues
  5. docmeta crawl         # Fill in purposes (batched)

Learn more: https://github.com/anthropic-community/docmeta
`;

const VERSION = '1.0.0';

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'setup':
      process.argv = ['node', 'setup.js', ...args.slice(1)];
      require('./setup.js');
      break;

    case 'init':
      process.argv = ['node', 'init.js', args[1] || '.'];
      require('./init.js');
      break;

    case 'usedby':
      process.argv = ['node', 'usedby.js', args[1] || '.'];
      require('./usedby.js');
      break;

    case 'graph':
      process.argv = ['node', 'graph.js', ...args.slice(1)];
      require('./graph.js');
      break;

    case 'update':
      process.argv = ['node', 'update.js', ...args.slice(1)];
      require('./update.js');
      break;

    case 'ignore':
      process.argv = ['node', 'ignore.js', ...args.slice(1)];
      require('./ignore.js');
      break;

    case 'check':
      process.argv = ['node', 'check.js', args[1] || '.'];
      require('./check.js');
      break;

    case 'crawl':
      process.argv = ['node', 'crawl.js', ...args.slice(1)];
      require('./crawl.js');
      break;

    case 'mcp':
      require('./mcp-server.js');
      break;

    case 'registry':
      process.argv = ['node', 'registry.js', ...args.slice(1)];
      require('./registry.js');
      break;

    case '--version':
    case '-v':
      console.log(`docmeta v${VERSION}`);
      break;

    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;

    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main();
