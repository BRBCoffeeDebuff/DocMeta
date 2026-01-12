## DocMeta Documentation

This project uses DocMeta for living documentation. Each folder with code has a `.docmeta.json` file.

### MANDATORY: Update Documentation After Code Changes

**You MUST invoke the `docmeta-updater` agent after ANY of these operations:**
- Creating new code files
- Modifying existing code files
- Deleting code files
- Changing imports or exports

**This is not optional.** Use the Task tool to spawn the docmeta-updater agent:

```
Task tool with subagent_type: "docmeta-updater"
Prompt: "Sync documentation after [describe what you changed]"
```

The agent will run the full workflow:
1. `docmeta update --sync` - Add new files, remove deleted
2. `docmeta usedby` - Rebuild import dependency graph
3. `docmeta calls` - Rebuild HTTP API dependency graph (fetch/axios calls)
4. `docmeta graph` - Check for cycles, orphans, clusters, entry points
5. `docmeta check` - Verify documentation health

### Before Modifying Code

1. Check the `.docmeta.json` in the target folder
2. Read the `usedBy` array to understand what depends on this code
3. Note any breaking changes you'll need to communicate

### Manual Commands (if not using the agent)

```bash
docmeta update <file> --history "what changed"  # Add history entry
docmeta update <file> --purpose "description"   # Update purpose
docmeta update --sync                           # Sync with filesystem
docmeta usedby                                  # Rebuild import dependencies
docmeta calls                                 # Rebuild HTTP API dependencies
docmeta graph                                   # Find cycles, orphans, clusters, entry points
docmeta graph --blast-radius <file>             # What breaks if I change this?
docmeta graph --clusters                        # Find isolated dead code groups
docmeta check                                   # Find issues
```

### Key Insight: usedBy and calledBy

The `usedBy` field shows import dependencies - what might break if you change this file's exports.
The `calledBy` field shows HTTP API callers - what frontend code calls this route via fetch/axios.

Both contribute to the **blast radius** - always check before making breaking changes.

### Why This Matters

Without documentation sync:
- New files won't have purposes filled in
- The `usedBy` graph becomes stale and misleading
- Future AI agents won't understand what code does
- Breaking changes go unnoticed

**The docmeta-updater agent exists precisely for this. Use it.**
