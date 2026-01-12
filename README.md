# DocMeta

**Living documentation for AI-assisted coding.**

Lightweight metadata files that help Claude Code (and other AI coding agents) understand your codebase faster. No API keys, no external services — just JSON files that track what code does and what depends on what.

## The Problem

AI coding agents read your files to understand them. For large codebases, this means:
- Reading hundreds of lines to find the right place to work
- Missing dependencies and breaking things downstream
- No memory of why code is structured the way it is

## The Solution

A `.docmeta.json` file in each folder with:
- **Purpose** — What this code does (skip reading the whole file)
- **usedBy** — What breaks if you change this (blast radius)
- **uses** — What this code depends on
- **history** — Why recent changes were made

```json
{
  "v": 3,
  "purpose": "Handles client intake form submission and validation. Creates new client nodes in Neo4j. Sends confirmation emails on success.",
  "files": {
    "page.tsx": {
      "purpose": "Renders the multi-step intake form. Validates each step before progression. Submits to API on completion.",
      "exports": ["default"],
      "uses": ["@/lib/neo4j", "@/lib/validation", "@/components/Form"],
      "usedBy": ["/app/dashboard/page.tsx", "/app/api/webhooks/route.ts"]
    },
    "schema.ts": {
      "purpose": "Zod schemas for intake form validation. Includes email, phone, and address validation rules.",
      "exports": ["intakeSchema", "validateIntake", "IntakeFormData"],
      "uses": [],
      "usedBy": ["/app/intake/page.tsx", "/app/api/clients/route.ts"]
    }
  },
  "history": [
    ["2025-01-10T14:30:00Z", "Added phone validation with libphonenumber", ["schema.ts"]],
    ["2025-01-08T09:15:00Z", "Split form into multi-step wizard", ["page.tsx"]]
  ],
  "updated": "2025-01-10T14:30:00Z"
}
```

## Language Support

DocMeta is language-agnostic. The schema works for any codebase:
- TypeScript/JavaScript
- Python
- Go
- Rust
- Any language with imports/exports

The CLI tools have basic support for JS/TS and Python import detection. For other languages, the structure is created and Claude fills in the details on first use.

## Quick Start

### Option A: Interactive Setup (Recommended)

```bash
npx @brbcoffeedebuff/docmeta setup
```

The setup wizard will guide you through:
1. **MCP Configuration** — Add DocMeta tools to Claude Code (global or per-project)
2. **Initialize Documentation** — Create `.docmeta.json` scaffolds
3. **Build Dependency Graph** — Populate `usedBy` fields
4. **Install Subagent** — Add the DocMeta updater agent for automatic documentation sync

Choose **Default** mode for automatic configuration, or **Advanced** mode to customize each step.

### Option B: Manual Setup

```bash
npx @brbcoffeedebuff/docmeta init      # Create scaffolds
npx @brbcoffeedebuff/docmeta usedby    # Build dependency graph
```

Then manually add the MCP server to your Claude settings (see below).

### After Setup

1. Start a new Claude Code session to load the agent
2. Run `docmeta crawl` to fill in `[purpose]` placeholders (or let Claude do it)
3. Claude will now have access to `docmeta_lookup`, `docmeta_blast_radius`, and `docmeta_search`

## CLI Commands

```bash
docmeta setup              # Interactive setup wizard
docmeta init [path]        # Create .docmeta.json scaffolds
docmeta usedby [path]      # Populate usedBy by resolving uses references
docmeta update <target>    # Update metadata (--purpose, --history, --sync, --refresh)
docmeta crawl              # Find files needing purposes, process in batches
docmeta ignore             # Manage ignore patterns (--add-dir, --add-file, --remove)
docmeta registry <cmd>     # Cross-repo reference management
docmeta check [path]       # Find stale or incomplete documentation
docmeta mcp                # Start MCP server for Claude Code
```

### Update Command

The `update` command is central to maintaining documentation:

```bash
# Update a file's purpose
docmeta update src/auth.ts --purpose "JWT token generation and validation"

# Add a history entry
docmeta update src/auth.ts --history "Added refresh token support"

# Sync documentation with filesystem (add new files, remove deleted)
docmeta update --sync

# Re-analyze all files' imports and exports
docmeta update --sync --refresh
```

**Output:** All commands output JSON by default for agent consumption. Use `--human` for readable output.

```json
{"success": true, "operations": [{"type": "purpose", "file": "auth.ts", "value": "..."}]}
```

Error types: `FILE_NOT_FOUND`, `DOCMETA_NOT_FOUND`, `INVALID_DOCMETA`, `MISSING_TARGET`, `WRITE_FAILED`

### Crawl Command

Find and fill in missing purposes in batches:

```bash
docmeta crawl              # Interactive mode with pauses every 20 files
docmeta crawl --batch 50   # Pause every 50 files
docmeta crawl --auto       # No pauses (for automation)
docmeta crawl --dry-run    # Show what would be processed
```

### Workflow

The typical workflow after code changes:

```bash
docmeta update --sync      # Add new files, remove deleted ones
docmeta usedby             # Rebuild the dependency graph
docmeta check              # Verify documentation health
```

If imports changed in existing files:

```bash
docmeta update --sync --refresh   # Re-analyze all imports/exports
docmeta usedby                    # Rebuild dependencies
```

## MCP Server Integration

DocMeta includes an MCP server that exposes tools to Claude Code:

| Tool | Purpose |
|------|---------|
| `docmeta_lookup` | Get metadata for a file or folder |
| `docmeta_blast_radius` | Find all files that depend on a file (recursive, with cross-repo support) |
| `docmeta_contracts` | List API/SDK contracts and their consumers |
| `docmeta_search` | Search files by purpose description |

### Setup

Add to your Claude Code settings (`~/.claude/settings.json`):

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

Or for a specific project, add to `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "docmeta": {
      "command": "npx",
      "args": ["@brbcoffeedebuff/docmeta", "mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Once configured, Claude Code will automatically have access to DocMeta tools and can query your documentation before making changes.

## Subagent Configuration

The setup wizard installs a specialized DocMeta subagent (`.claude/agents/docmeta-updater.md`) that:

- **Syncs documentation after code changes** — Automatically updates `.docmeta.json` files
- **Fills in missing purposes** — Reads source files and writes meaningful 1-3 sentence descriptions
- **Rebuilds dependencies** — Keeps `usedBy` relationships accurate
- **Reports issues** — Runs `docmeta check` and attempts fixes

The agent is triggered automatically after file modifications by other agents.

Also installed:
- **CLAUDE.md** — Instructions for Claude on how to maintain documentation
- **docs/DOCMETA.md** — Full agent guide with workflows and examples

The subagent is configured with:
- **Smart ignore patterns** — Auto-loads `.gitignore` plus defaults for dependencies, build output, and secrets
- **Security boundaries** — Never reads `.env`, `secrets.json`, credentials, or other sensitive files
- **Focused scope** — Only modifies `.docmeta.json` files, not source code

## Cross-Repo Registry

Track dependencies across repositories:

```bash
# Add a repository to track
docmeta registry add github:myorg/other-service

# Export your documentation for others to import
docmeta registry export ./docmeta-bundle.json

# Import another repo's documentation
docmeta registry import ./their-bundle.json --repo github:myorg/other-service

# Check cross-repo blast radius
docmeta blast-radius --cross-repo ./src/api.ts
```

## Configuration

Create `.docmetarc.json` in your project root to customize:

```json
{
  "maxHistoryEntries": 15,
  "customIgnoreDirs": ["generated", "vendor"],
  "customIgnoreFiles": ["*.generated.ts"]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `maxHistoryEntries` | 10 | Max history entries per file (oldest trimmed) |
| `customIgnoreDirs` | `[]` | Additional directories to ignore |
| `customIgnoreFiles` | `[]` | Additional file patterns to ignore |
| `customIgnorePatterns` | `[]` | Additional regex patterns to ignore |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCMETA_HOME` | `~/.docmeta` | Base directory for registry and cache |
| `DOCMETA_REGISTRY` | `$DOCMETA_HOME/registry.json` | Registry file location |
| `DOCMETA_CACHE` | `$DOCMETA_HOME/cache` | Cache directory for cross-repo data |
| `DOCMETA_CONFIG` | `.docmetarc.json` | Config file name |

## Schema Reference

See [SCHEMA.md](./SCHEMA.md) for the complete field reference.

### Quick Reference

| Field | Type | Purpose |
|-------|------|---------|
| `v` | number | Schema version (currently 3) |
| `purpose` | string | Folder purpose, 1-3 sentences |
| `files` | object | Map of filename → metadata |
| `files.*.purpose` | string | File purpose, 1-3 sentences |
| `files.*.exports` | string[] | Public exports |
| `files.*.uses` | string[] | Internal imports only |
| `files.*.usedBy` | string[] | Files that import this one |
| `contracts` | object | API/SDK contracts with consumers |
| `history` | array | Recent changes as `[timestamp, summary, files[]]` |
| `updated` | string | ISO 8601 timestamp of last update |

### The Key Insight: `usedBy`

The `usedBy` field is the most valuable. It answers: **"What breaks if I change this?"**

When Claude sees:
```json
"usedBy": ["/app/dashboard/page.tsx", "/app/api/clients/route.ts"]
```

It knows those files depend on this code and should be checked after changes.

## CRUD Lifecycle

See [CRUD.md](./CRUD.md) for detailed workflows. Summary:

| Action | What to update |
|--------|----------------|
| Create file | Add entry, update usedBy in imported files |
| Modify internals | Add history entry, update timestamp |
| Change exports | Update exports array, note breaking changes |
| Add import | Update uses + target's usedBy |
| Remove import | Update uses + target's usedBy |
| Delete file | Remove entry, clean up usedBy references |

## FAQ

**Why not just let the AI read the code?**

It does. But checking a 3-sentence purpose is faster than reading 300 lines. And `usedBy` gives dependency info that isn't obvious from reading one file.

**Why not use embeddings/indexing?**

Those are opaque and probabilistic. DocMeta is visible, deterministic, and version-controlled. You can read it, edit it, and trust it.

**What about documentation drift?**

Keep the schema minimal — less to maintain. Run `docmeta check` periodically. The main defense is the docmeta-updater agent that syncs documentation after every code change.

**Should I commit `.docmeta.json`?**

Yes. Review it in PRs like code. It's documentation that lives with the code it describes.

**Per-file or per-folder?**

Per-folder with file entries. Reduces file count, keeps related docs together, and the folder-level purpose helps with discovery.

**What's the `[purpose]` placeholder?**

New files are added with `[purpose]` as a placeholder. Run `docmeta crawl` or let the docmeta-updater agent fill these in by reading the source code.

## Performance

For most projects (< 500 folders), file I/O is fine. If you have 1000+ documented folders, consider:
- SQLite index for search
- Daemon with in-memory graph (future roadmap)

## Contributing

Apache 2.0 licensed. PRs welcome.

Ideas:
- Language-specific parsers (Go, Rust, Java)
- VS Code extension showing doc status
- GitHub Action for drift detection
- SQLite/Rust daemon for large codebases

## License

Apache 2.0
