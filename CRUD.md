# DocMeta CRUD Lifecycle

How to maintain documentation at each stage of code changes.

## CREATE — New File

When you create a new code file:

### Steps

1. Add entry to `.docmeta.json` in the same directory
2. Fill in: `purpose`, `exports`, `uses`
3. Set `usedBy` to empty array (will be populated by consumers)
4. Update `usedBy` in every file you import from
5. Add history entry
6. Update timestamp

### Example

Creating `/app/intake/validation.ts`:

```json
// /app/intake/.docmeta.json
{
  "v": 2,
  "purpose": "Client intake form and submission handling.",
  "files": {
    "page.tsx": { ... },
    "validation.ts": {
      "purpose": "Zod schemas for intake form. Validates email, phone, and address fields.",
      "exports": ["intakeSchema", "validateIntake"],
      "uses": ["@/lib/phone-utils"],
      "usedBy": []
    }
  },
  "history": [
    ["2025-01-11", "Added validation schemas for intake form", ["validation.ts"]],
    ...
  ],
  "updated": "2025-01-11T10:00:00Z"
}
```

Then update the imported file:

```json
// /lib/phone-utils/.docmeta.json
{
  "files": {
    "index.ts": {
      "usedBy": [..., "/app/intake/validation.ts"]  // Add this
    }
  }
}
```

### If directory has no .docmeta.json

Create one:

```json
{
  "v": 2,
  "purpose": "_TODO: Describe this folder_",
  "files": {
    "newfile.ts": {
      "purpose": "What this file does.",
      "exports": ["yourExports"],
      "uses": [],
      "usedBy": []
    }
  },
  "history": [
    ["2025-01-11", "Initial documentation", ["newfile.ts"]]
  ],
  "updated": "2025-01-11T00:00:00Z"
}
```

---

## READ — Before Working on Code

Before modifying any folder:

### Steps

1. Check if folder has `.docmeta.json`
2. If yes, read it to understand:
   - `purpose` — Confirm you're in the right place
   - `usedBy` — Understand blast radius before making changes
   - `history` — Get context on recent changes
3. If no `.docmeta.json`, read code directly

### Decision Flow

```
Has .docmeta.json?
│
├─ Yes
│   ├─ Read purpose — "Is this the right folder for my task?"
│   ├─ Read files.*.purpose — "Which file do I need to modify?"
│   ├─ Read usedBy — "What might break if I change this?"
│   └─ Read history — "Any recent context I should know?"
│
└─ No
    ├─ Read code directly
    └─ Consider creating .docmeta.json after completing work
```

### What usedBy Tells You

Before editing `/lib/validation/index.ts`:

```json
"usedBy": [
  "/app/intake/page.tsx",
  "/app/api/clients/route.ts",
  "/app/dashboard/components/ClientForm.tsx"
]
```

This means: **3 files import this code. Changes here could break them.**

Check these files if you:
- Change function signatures
- Rename exports
- Change return types
- Remove functionality

---

## UPDATE — After Modifying Code

### Internals Only (no interface change)

When you change implementation but exports stay the same:

```json
{
  "history": [
    ["2025-01-11", "Fixed null check in email validation", ["validation.ts"]],
    ...existing
  ],
  "updated": "2025-01-11T10:00:00Z"
}
```

That's it — no other fields affected.

### Exports Changed

When you add, remove, or rename exports:

```json
{
  "files": {
    "validation.ts": {
      "exports": ["intakeSchema", "validateIntake", "validateEmail"]  // Added validateEmail
    }
  },
  "history": [
    ["2025-01-11", "Added validateEmail helper", ["validation.ts"]],
    ...
  ]
}
```

If you **removed** an export, check `usedBy` — those files may now be broken. Add a note:

```json
["2025-01-11", "BREAKING: Removed deprecated validatePhone, use validateIntake instead", ["validation.ts"]]
```

### Import Added

When you add an import to a file:

**Step 1:** Update `uses` in the importing file

```json
// /app/intake/.docmeta.json
{
  "files": {
    "page.tsx": {
      "uses": ["@/lib/validation", "@/lib/neo4j"]  // Added @/lib/neo4j
    }
  }
}
```

**Step 2:** Update `usedBy` in the imported file

```json
// /lib/neo4j/.docmeta.json
{
  "files": {
    "index.ts": {
      "usedBy": [..., "/app/intake/page.tsx"]  // Add consumer
    }
  }
}
```

**Step 3:** Add history entry in the importing file's folder

### Import Removed

Reverse of above:

1. Remove from `uses` in the importing file
2. Remove from `usedBy` in the formerly-imported file
3. Add history entry

### Purpose Changed

When file behavior changes significantly:

```json
{
  "files": {
    "page.tsx": {
      "purpose": "Renders multi-step intake wizard. Validates each step. Saves progress to localStorage. Submits on completion."
    }
  },
  "history": [
    ["2025-01-11", "Converted to multi-step wizard with progress saving", ["page.tsx"]]
  ]
}
```

---

## DELETE — Removing Files

### Steps

1. Find the file's `uses` — you need to update those files' `usedBy`
2. Find the file's `usedBy` — those files may now be broken
3. Remove entry from `.docmeta.json`
4. Update `usedBy` in all files that were imported
5. Add history entry

### Example

Deleting `/lib/deprecated/old-validation.ts`:

**1. Check what it imported:**
```json
"uses": ["@/lib/config", "@/lib/phone-utils"]
```

**2. Check what imported it:**
```json
"usedBy": ["/app/intake/page.tsx"]
```

⚠️ **Warning:** `/app/intake/page.tsx` may now be broken.

**3. Remove from `/lib/deprecated/.docmeta.json`:**
```json
{
  "files": {
    // Remove old-validation.ts entry entirely
  },
  "history": [
    ["2025-01-11", "Removed deprecated old-validation.ts", ["old-validation.ts"]]
  ]
}
```

**4. Update `/lib/config/.docmeta.json` and `/lib/phone-utils/.docmeta.json`:**
```json
{
  "files": {
    "index.ts": {
      "usedBy": [...]  // Remove /lib/deprecated/old-validation.ts
    }
  }
}
```

---

## RENAME / MOVE

Treat as DELETE + CREATE:

1. **DELETE** from old location (update all `usedBy` references)
2. **CREATE** at new location (new entry, update `usedBy` in imported files)
3. **Update all consumers:** Files that imported the old path need their `uses` updated

Add a single history entry:

```json
["2025-01-11", "Moved validation.ts from /lib/deprecated to /lib/validation", ["validation.ts"]]
```

---

## Handling Missing Documentation

If you encounter a folder without `.docmeta.json`:

**During READ:** Work without it, proceed normally.

**After completing work:** Create `.docmeta.json` covering at least:
- Folder purpose
- Files you touched with purposes
- Basic `uses`/`usedBy` for those files

Don't try to document the entire folder — just what you can verify.

---

## Handling Stale Documentation

If you notice docs don't match code:

1. Fix the specific inaccuracy you found
2. Add history entry: `"Fixed stale docs: updated exports list"`
3. Don't try to fix everything at once

---

## Quick Reference

| Action | Update these |
|--------|--------------|
| Create file | `files[new].*`, target `usedBy`, `history`, `updated` |
| Modify internals | `history`, `updated` |
| Change exports | `files[x].exports`, `history`, `updated` |
| Add import | `files[x].uses`, target `usedBy`, `history`, `updated` |
| Remove import | `files[x].uses`, target `usedBy`, `history`, `updated` |
| Delete file | Remove `files[x]`, all target `usedBy`, `history`, `updated` |
| Rename/move | Treat as delete + create |

---

## The Golden Rule

**`usedBy` is the most important field.**

It answers "what breaks if I change this?" — which is the question that prevents mistakes.

Keeping `usedBy` accurate across files is the main maintenance burden, but it's also the main value. An accurate dependency graph is worth more than perfect prose descriptions.
