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
2. `docmeta usedby` - Rebuild dependency graph
3. `docmeta check` - Verify documentation health

### Before Modifying Code

1. Check the `.docmeta.json` in the target folder
2. Read the `usedBy` array to understand what depends on this code
3. Note any breaking changes you'll need to communicate

### Manual Commands (if not using the agent)

```bash
docmeta update <file> --history "what changed"  # Add history entry
docmeta update <file> --purpose "description"   # Update purpose
docmeta update --sync                           # Sync with filesystem
docmeta usedby                                  # Rebuild dependencies
docmeta check                                   # Find issues
```

### Key Insight: usedBy

The `usedBy` field shows your **blast radius** - what might break if you change this file.
Always check it before making breaking changes to exports.

### Why This Matters

Without documentation sync:
- New files won't have purposes filled in
- The `usedBy` graph becomes stale and misleading
- Future AI agents won't understand what code does
- Breaking changes go unnoticed

**The docmeta-updater agent exists precisely for this. Use it.**
