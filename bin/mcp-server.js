#!/usr/bin/env node
/**
 * DocMeta MCP Server
 *
 * Exposes DocMeta functionality as MCP tools for Claude Code and other AI agents.
 *
 * Tools:
 *   docmeta_lookup     - Get metadata for a file or folder
 *   docmeta_blast_radius - Find all files that depend on a given file (recursive)
 *   docmeta_search     - Search for files by purpose
 *
 * Usage:
 *   Add to Claude Code settings:
 *   {
 *     "mcpServers": {
 *       "docmeta": {
 *         "command": "npx",
 *         "args": ["@brbcoffeedebuff/docmeta", "mcp"]
 *       }
 *     }
 *   }
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  parseReference,
  isCrossRepoReference,
  loadRegistry,
  loadCachedDocmeta,
  findCrossRepoConsumers
} = require('./lib/registry');

const IGNORE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', 'venv', '.venv'];

// ============================================================================
// DocMeta Index - loads and caches all .docmeta.json files
// ============================================================================

class DocMetaIndex {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.docMetas = new Map();  // folderPath -> content
    this.fileIndex = new Map(); // filePath -> { folderPath, fileName, metadata }
  }

  load() {
    this.docMetas.clear();
    this.fileIndex.clear();
    this._walk(this.rootPath);
  }

  _walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.name === '.docmeta.json') {
          this._loadDocMeta(fullPath);
          continue;
        }

        if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          this._walk(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  _loadDocMeta(docMetaPath) {
    try {
      const content = JSON.parse(fs.readFileSync(docMetaPath, 'utf-8'));
      const dir = path.dirname(docMetaPath);
      const folderPath = '/' + path.relative(this.rootPath, dir).replace(/\\/g, '/');

      this.docMetas.set(folderPath === '/' ? '/' : folderPath, content);

      // Index each file
      for (const [fileName, fileData] of Object.entries(content.files || {})) {
        const filePath = path.posix.join(folderPath, fileName);
        this.fileIndex.set(filePath, {
          folderPath,
          fileName,
          metadata: fileData
        });
      }
    } catch {
      // Skip invalid files
    }
  }

  // Get metadata for a specific file or folder
  lookup(targetPath) {
    // Normalize path
    let normalized = targetPath.startsWith('/') ? targetPath : '/' + targetPath;
    normalized = normalized.replace(/\\/g, '/');

    // Try as file first
    if (this.fileIndex.has(normalized)) {
      const { folderPath, fileName, metadata } = this.fileIndex.get(normalized);
      const folderMeta = this.docMetas.get(folderPath);
      return {
        type: 'file',
        path: normalized,
        folder: {
          path: folderPath,
          purpose: folderMeta?.purpose
        },
        ...metadata
      };
    }

    // Try as folder
    if (this.docMetas.has(normalized)) {
      const content = this.docMetas.get(normalized);
      return {
        type: 'folder',
        path: normalized,
        purpose: content.purpose,
        files: Object.keys(content.files || {}),
        history: content.history,
        updated: content.updated
      };
    }

    // Try removing trailing slash
    const withoutSlash = normalized.replace(/\/$/, '');
    if (this.docMetas.has(withoutSlash)) {
      return this.lookup(withoutSlash);
    }

    return null;
  }

  // Get all files that depend on a given file (recursive blast radius)
  blastRadius(targetPath, visited = new Set()) {
    let normalized = targetPath.startsWith('/') ? targetPath : '/' + targetPath;
    normalized = normalized.replace(/\\/g, '/');

    if (visited.has(normalized)) return [];
    visited.add(normalized);

    const fileInfo = this.fileIndex.get(normalized);
    if (!fileInfo) return [];

    const directDependents = fileInfo.metadata.usedBy || [];
    const allDependents = [...directDependents];

    // Recursively find dependents of dependents
    for (const dep of directDependents) {
      const transitive = this.blastRadius(dep, visited);
      for (const t of transitive) {
        if (!allDependents.includes(t)) {
          allDependents.push(t);
        }
      }
    }

    return allDependents;
  }

  // Get cross-repo blast radius using the registry
  crossRepoBlastRadius(targetPath) {
    const result = {
      local: this.blastRadius(targetPath),
      crossRepo: [],
      contracts: []
    };

    // Find contracts that might expose this file
    const fileInfo = this.fileIndex.get(targetPath.startsWith('/') ? targetPath : '/' + targetPath);
    if (!fileInfo) return result;

    // Check all folders for contracts that might relate to this file
    for (const [folderPath, content] of this.docMetas) {
      if (!content.contracts) continue;

      for (const [contractId, contract] of Object.entries(content.contracts)) {
        // If the contract is in the same folder as the file, include it
        if (targetPath.startsWith(folderPath) || folderPath === '/') {
          result.contracts.push({
            id: contractId,
            purpose: contract.purpose,
            visibility: contract.visibility,
            consumers: contract.consumers || [],
            risk: contract.visibility === 'public' ? 'HIGH' : 'MEDIUM'
          });
        }
      }
    }

    // Query the cross-repo registry for external consumers
    try {
      const crossRepoConsumers = findCrossRepoConsumers(targetPath);
      result.crossRepo = crossRepoConsumers;
    } catch {
      // Registry not available or error
    }

    return result;
  }

  // Search files by purpose
  search(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [filePath, { folderPath, metadata }] of this.fileIndex) {
      const purpose = metadata.purpose || '';
      if (purpose.toLowerCase().includes(lowerQuery)) {
        results.push({
          path: filePath,
          purpose: metadata.purpose,
          exports: metadata.exports
        });
      }
    }

    // Also search folder purposes
    for (const [folderPath, content] of this.docMetas) {
      const purpose = content.purpose || '';
      if (purpose.toLowerCase().includes(lowerQuery)) {
        results.push({
          path: folderPath,
          type: 'folder',
          purpose: content.purpose
        });
      }
    }

    return results;
  }
}

// ============================================================================
// MCP Protocol Implementation
// ============================================================================

const TOOLS = [
  {
    name: 'docmeta_lookup',
    description: 'Get documentation metadata for a file or folder. Returns purpose, exports, dependencies (uses), and dependents (usedBy). Use this before modifying code to understand what it does and what depends on it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file or folder (e.g., "/src/lib/auth.ts" or "/src/components")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'docmeta_blast_radius',
    description: 'Find all files that depend on a given file, recursively. Returns the full "blast radius" - everything that might break if you change this file. Use cross_repo=true to include dependencies from other registered repositories and contracts.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to check dependents for'
        },
        cross_repo: {
          type: 'boolean',
          description: 'Include cross-repo consumers and contracts (default: false)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'docmeta_contracts',
    description: 'List all API contracts defined in the project. Contracts represent public interfaces (REST endpoints, gRPC methods, events) that external systems may depend on.',
    inputSchema: {
      type: 'object',
      properties: {
        visibility: {
          type: 'string',
          enum: ['public', 'internal', 'deprecated', 'all'],
          description: 'Filter by visibility (default: all)'
        }
      }
    }
  },
  {
    name: 'docmeta_search',
    description: 'Search for files and folders by their purpose description. Use this to find code related to a specific feature or functionality.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term to find in purpose descriptions (e.g., "authentication", "form validation")'
        }
      },
      required: ['query']
    }
  }
];

class MCPServer {
  constructor() {
    this.index = new DocMetaIndex(process.cwd());
    this.index.load();
  }

  handleRequest(request) {
    const { method, params, id } = request;

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'docmeta',
              version: '1.0.0'
            }
          }
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS }
        };

      case 'tools/call':
        return this.handleToolCall(params, id);

      case 'notifications/initialized':
        // No response needed for notifications
        return null;

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
    }
  }

  handleToolCall(params, id) {
    const { name, arguments: args } = params;

    // Refresh index on each tool call to pick up changes
    this.index.load();

    let result;

    switch (name) {
      case 'docmeta_lookup': {
        const metadata = this.index.lookup(args.path);
        if (metadata) {
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify(metadata, null, 2)
            }]
          };
        } else {
          result = {
            content: [{
              type: 'text',
              text: `No documentation found for: ${args.path}\n\nThis file/folder may not have a .docmeta.json file. Run "docmeta init" to create documentation scaffolds.`
            }]
          };
        }
        break;
      }

      case 'docmeta_blast_radius': {
        const metadata = this.index.lookup(args.path);

        if (!metadata) {
          result = {
            content: [{
              type: 'text',
              text: `No documentation found for: ${args.path}`
            }]
          };
        } else if (args.cross_repo) {
          // Full cross-repo blast radius
          const blastRadius = this.index.crossRepoBlastRadius(args.path);
          const response = {
            file: args.path,
            purpose: metadata.purpose,
            localDependents: blastRadius.local,
            crossRepoDependents: blastRadius.crossRepo,
            contracts: blastRadius.contracts,
            riskLevel: blastRadius.contracts.some(c => c.visibility === 'public') ? 'HIGH' : 'MEDIUM',
            summary: {
              localCount: blastRadius.local.length,
              crossRepoCount: blastRadius.crossRepo.length,
              contractCount: blastRadius.contracts.length,
              hasPublicContracts: blastRadius.contracts.some(c => c.visibility === 'public'),
              hasUnknownConsumers: blastRadius.contracts.some(c =>
                c.consumers.some(con => con.startsWith('external:'))
              )
            }
          };
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify(response, null, 2)
            }]
          };
        } else {
          // Local-only blast radius
          const dependents = this.index.blastRadius(args.path);
          const response = {
            file: args.path,
            purpose: metadata.purpose,
            directDependents: metadata.usedBy || [],
            totalBlastRadius: dependents.length,
            allDependents: dependents
          };
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify(response, null, 2)
            }]
          };
        }
        break;
      }

      case 'docmeta_contracts': {
        const contracts = [];
        const visibilityFilter = args.visibility || 'all';

        for (const [folderPath, content] of this.index.docMetas) {
          if (!content.contracts) continue;

          for (const [contractId, contract] of Object.entries(content.contracts)) {
            if (visibilityFilter !== 'all' && contract.visibility !== visibilityFilter) {
              continue;
            }

            contracts.push({
              id: contractId,
              folder: folderPath,
              purpose: contract.purpose,
              visibility: contract.visibility,
              consumers: contract.consumers || [],
              hasUnknownConsumers: (contract.consumers || []).some(c => c.startsWith('external:'))
            });
          }
        }

        result = {
          content: [{
            type: 'text',
            text: contracts.length > 0
              ? JSON.stringify({
                  count: contracts.length,
                  contracts
                }, null, 2)
              : 'No contracts found. Add contracts to your .docmeta.json files to track public APIs.'
          }]
        };
        break;
      }

      case 'docmeta_search': {
        const results = this.index.search(args.query);
        result = {
          content: [{
            type: 'text',
            text: results.length > 0
              ? JSON.stringify(results, null, 2)
              : `No files found matching: "${args.query}"`
          }]
        };
        break;
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Unknown tool: ${name}`
          }
        };
    }

    return {
      jsonrpc: '2.0',
      id,
      result
    };
  }
}

// ============================================================================
// Main - stdio transport
// ============================================================================

function main() {
  const server = new MCPServer();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    try {
      const request = JSON.parse(line);
      const response = server.handleRequest(request);

      if (response) {
        console.log(JSON.stringify(response));
      }
    } catch (err) {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
          data: err.message
        }
      }));
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main();
