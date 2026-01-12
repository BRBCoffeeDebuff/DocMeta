# DocMeta

**Know what breaks before you break it.**

DocMeta answers the questions you ask before touching unfamiliar code:

| Question | Command |
|----------|---------|
| "What does this file do?" | `docmeta lookup src/auth.ts` |
| "What breaks if I change this?" | `docmeta graph --blast-radius src/auth.ts` |
| "Is this code dead?" | `docmeta graph --orphans` |
| "Are there circular dependencies?" | `docmeta graph --cycles` |
| "Where does execution start?" | `docmeta graph --entry-points` |

No API keys. No external services. Just JSON files that track what code does and what depends on what.

## The Problem

AI coding agents read your files to understand them. For large codebases, this means:
- Reading hundreds of lines to find what a file does
- Missing dependencies and breaking things downstream
- No way to know if code is even used anymore
- Circular dependencies hiding in plain sight

## The Solution

A `.docmeta.json` file in each folder with:
- **Purpose** — What this code does (skip reading the whole file)
- **usedBy** — What breaks if you change this (blast radius)
- **uses** — What this code depends on

Plus a `docmeta graph` command that builds the full dependency picture:

```bash
$ docmeta graph

DocMeta Graph Analysis

Entry Points (4):
  /bin/cli.js
  /bin/mcp-server.js
  /bin/setup.js
  /app/page.tsx

Orphans (2 files with no dependents - dead code candidates):
  /lib/deprecated/old-auth.ts
  /utils/unused-helper.js

Cycles (1 circular dependency):
  /lib/a.ts -> /lib/b.ts -> /lib/c.ts -> /lib/a.ts

Summary: 47 files, 4 entry points, 2 orphans, 1 cycle
```

## Quick Start

```bash
npx @brbcoffeedebuff/docmeta setup
```

The setup wizard:
1. Adds MCP tools to Claude Code
2. Creates `.docmeta.json` scaffolds
3. Builds the dependency graph
4. Installs the auto-sync agent

Or manually:

```bash
npx @brbcoffeedebuff/docmeta init      # Create scaffolds
npx @brbcoffeedebuff/docmeta usedby    # Build dependency graph
npx @brbcoffeedebuff/docmeta graph     # Analyze the graph
```

## CLI Commands

### Graph Analysis (the good stuff)

```bash
docmeta graph                          # Full analysis: entry points, orphans, cycles
docmeta graph --blast-radius src/api   # What breaks if I change this? (transitive)
docmeta graph --orphans                # Dead code candidates
docmeta graph --cycles                 # Circular dependencies
docmeta graph --entry-points           # Where execution starts
docmeta graph --output graph.json      # Export for tooling
```

### Documentation Management

```bash
docmeta init [path]                    # Create .docmeta.json scaffolds
docmeta usedby [path]                  # Populate usedBy fields (imports)
docmeta calls [path]                   # Populate calls/calledBy fields (HTTP APIs)
docmeta update <file> --purpose "..."  # Set a file's purpose
docmeta update <file> --history "..."  # Add a history entry
docmeta update --sync                  # Sync with filesystem
docmeta crawl                          # Fill in [purpose] placeholders
docmeta check                          # Find stale/incomplete docs
```

### HTTP API Dependencies (Next.js, etc.)

For frameworks like Next.js where components call API routes via `fetch`/`axios`:

```bash
docmeta calls                          # Scan for fetch/axios calls to /api/*
```

This creates bidirectional links:
- `calls` — API routes this file calls (e.g., `["/app/api/users/route.ts"]`)
- `calledBy` — Files that call this route via HTTP

The graph analysis uses both import dependencies (`usedBy`) and HTTP dependencies (`calledBy`) to find dead code and calculate blast radius.

### MCP Server

```bash
docmeta mcp                            # Start MCP server for Claude Code
```

## The Schema

```json
{
  "v": 3,
  "purpose": "User authentication and session management",
  "files": {
    "auth.ts": {
      "purpose": "JWT token generation, validation, and refresh logic",
      "exports": ["createToken", "validateToken", "refreshToken"],
      "uses": ["./config", "@/lib/crypto"],
      "usedBy": ["/app/api/login/route.ts", "/middleware.ts"],
      "calls": ["/app/api/session/route.ts"],
      "calledBy": []
    }
  },
  "history": [
    ["2025-01-10T14:30:00Z", "Added refresh token support", ["auth.ts"]]
  ],
  "updated": "2025-01-10T14:30:00Z"
}
```

**Dependency fields:**
- `uses` / `usedBy` — Import dependencies (what this file imports / what imports this)
- `calls` / `calledBy` — HTTP dependencies (API routes called via fetch/axios)

### The Key Field: `usedBy`

When you see:
```json
"usedBy": ["/app/api/login/route.ts", "/middleware.ts"]
```

You know exactly what breaks if you change this file. The `docmeta graph --blast-radius` command follows these chains transitively to show the full impact.

## Language Support

DocMeta works with any language. The CLI auto-detects imports/exports for:
- TypeScript/JavaScript
- Python
- Go
- Rust

For other languages, scaffolds are created and Claude fills in the details.

### TypeScript Path Aliases

DocMeta supports common TypeScript path aliases out of the box:
- `@/` → project root (e.g., `@/lib/auth` → `/lib/auth.ts`)
- `~/` → project root (e.g., `~/utils` → `/utils/index.ts`)

**Limitation:** DocMeta does not read `tsconfig.json`. Custom path mappings like `@components/*` or non-root `baseUrl` settings are not automatically resolved. Files using custom aliases will show as unresolved imports.

For projects with custom aliases, you can:
1. Use the standard `@/` convention pointing to project root
2. Manually update the `uses`/`usedBy` fields for files with custom aliases

## MCP Integration

Claude Code gets these tools automatically after setup:

| Tool | What it does |
|------|--------------|
| `docmeta_lookup` | Get metadata for a file or folder |
| `docmeta_blast_radius` | Find all files affected by a change |
| `docmeta_graph` | Analyze cycles, orphans, entry points |
| `docmeta_search` | Find files by purpose |

Add manually if needed (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "docmeta": {
      "command": "npx",
      "args": ["@brbcoffeedebuff/docmeta", "mcp"]
    }
  }
}
```

## Auto-Sync Agent

The setup wizard installs a subagent that automatically updates documentation after code changes:
- Syncs new/deleted files
- Fills in missing purposes
- Rebuilds dependency graph
- Reports issues

## Configuration

Create `.docmetarc.json` in your project root:

```json
{
  "maxHistoryEntries": 15,
  "customIgnoreDirs": ["generated", "vendor"],
  "customIgnoreFiles": ["*.generated.ts"],
  "customEntryPointPatterns": [
    "app/**/page.tsx",
    "app/**/route.ts",
    "app/**/layout.tsx"
  ]
}
```

### Entry Point Patterns

Entry points are files that don't need to be imported (frameworks call them directly). Configure patterns to prevent false positives in dead code detection:

```json
{
  "customEntryPointPatterns": [
    "app/**/page.tsx",
    "app/**/route.ts",
    "app/**/layout.tsx",
    "scripts/**/*.ts",
    "bin/**/*.js"
  ]
}
```

Patterns support:
- `**` — matches zero or more directories
- `*` — matches any filename characters

## FAQ

**Why not just let the AI read the code?**

It does. But checking a 3-sentence purpose is faster than reading 300 lines. And `usedBy` gives dependency info that isn't obvious from reading one file.

**Why not use embeddings?**

Embeddings are opaque and probabilistic. DocMeta is visible, deterministic, and version-controlled. You can read it, edit it, and trust it.

**Should I commit `.docmeta.json`?**

Yes. Review it in PRs like code.

**What about stale docs?**

The auto-sync agent handles this. Run `docmeta check` to verify.

## See Also

- [SCHEMA.md](./SCHEMA.md) — Complete field reference
- [CRUD.md](./CRUD.md) — Lifecycle workflows

## License

Apache 2.0
