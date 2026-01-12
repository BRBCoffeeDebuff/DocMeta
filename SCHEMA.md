# DocMeta Schema Reference

Version: 3

> **DocMeta is designed for AI coding agents like Claude Code.** The schema captures exactly what AI needs to understand and safely modify your codebase.

## Philosophy

Store only what saves the agent from reading code. Every field must answer: **"Does this prevent a file read or prevent a mistake?"**

## File Location

One `.docmeta.json` per documented folder, co-located with the code it describes.

```
/app/intake/
├── page.tsx
├── schema.ts
├── actions.ts
└── .docmeta.json    ← documents this folder
```

## Complete Schema

```json
{
  "v": 3,
  "purpose": "1-3 sentences describing what this folder handles.",
  "files": {
    "filename.ts": {
      "purpose": "1-3 sentences describing what this file does.",
      "exports": ["namedExport", "AnotherExport", "default"],
      "uses": ["@/lib/internal-dep", "@/components/Thing"],
      "usedBy": ["/app/other/page.tsx", "/lib/consumer.ts"],
      "calls": ["/app/api/users/route.ts"],
      "calledBy": []
    }
  },
  "contracts": {
    "api:/v1/users": {
      "purpose": "User CRUD REST endpoints",
      "visibility": "public",
      "consumers": ["github:myorg/frontend#main", "external:unknown"]
    }
  },
  "history": [
    ["2025-01-10", "Description of what changed", ["file1.ts", "file2.ts"]]
  ],
  "updated": "2025-01-10T14:30:00Z"
}
```

## Field Definitions

### `v` (required)
- **Type:** `number`
- **Value:** `2`
- **Purpose:** Schema version for forward compatibility

### `purpose` (required)
- **Type:** `string`
- **Length:** 1-3 sentences
- **Purpose:** What this folder is responsible for
- **Answers:** "Should I look in this folder for X functionality?"

**Good examples:**
```
"Handles new client intake form submission and validation. Creates client nodes in Neo4j. Sends confirmation emails on success."

"Database connection pooling and query utilities. Manages PostgreSQL connections with automatic retry on failure."

"Shared React components for form inputs. Includes text fields, selects, checkboxes, and date pickers with consistent styling."
```

**Bad examples:**
```
"Intake stuff"  // Too vague
"This folder contains the page.tsx file which renders..."  // Describing structure, not purpose
```

### `files` (required)
- **Type:** `object`
- **Purpose:** Map of filename → file metadata
- **Keys:** Filenames without path (e.g., `page.tsx`, not `/app/intake/page.tsx`)

### `files.*.purpose` (required)
- **Type:** `string`
- **Length:** 1-3 sentences
- **Purpose:** What this specific file does
- **Answers:** "Do I need to read this file for my task?"

**Good examples:**
```
"Renders the multi-step intake form. Validates each step before allowing progression. Submits to API on final step."

"Zod schemas for form validation. Includes custom refinements for phone numbers and addresses."

"Neo4j query functions for client operations. Handles create, read, update with transaction support."
```

### `files.*.exports` (required)
- **Type:** `string[]`
- **Purpose:** Public interface of this file
- **Include:** Named exports, type exports, `"default"` if applicable
- **Answers:** "What can I import from this file?"

```json
"exports": ["intakeSchema", "validateIntake", "IntakeFormData", "default"]
```

### `files.*.uses` (required)
- **Type:** `string[]`
- **Purpose:** Dependencies (internal and cross-repo)
- **Exclude:** External packages (react, zod, lodash, etc.)
- **Answers:** "What does this file depend on?"

**Reference formats:**

| Format | Example | Description |
|--------|---------|-------------|
| Local path | `@/lib/neo4j`, `./utils` | Same repo, path as written in code |
| Cross-repo | `github:org/repo#branch:path/file.ts` | File in another repository |
| npm package | `@org/package:src/utils.ts` | Specific file in npm package |
| API contract | `api:service-name/v1/endpoint` | REST/GraphQL endpoint |
| Proto/schema | `proto:package.v1.Message` | Protobuf or schema type |
| gRPC | `grpc:service-name/Method` | gRPC service method |

```json
"uses": [
  "@/lib/neo4j",
  "github:myorg/shared-lib#main:src/utils.ts",
  "api:user-service/v1/users",
  "proto:myorg.users.v1.User"
]
```

**Cross-repo references** require registry sync to resolve (see `docmeta registry`).

### `files.*.usedBy` (required) ⭐ MOST IMPORTANT
- **Type:** `string[]`
- **Purpose:** Files that import this file
- **Format:** Absolute paths from project root
- **Answers:** "What breaks if I change this file?"

```json
"usedBy": ["/app/dashboard/page.tsx", "/app/api/clients/route.ts"]
```

**This is the blast radius.** Before changing a file, Claude checks `usedBy` to understand the impact.

### `files.*.calls` (optional)
- **Type:** `string[]`
- **Purpose:** API routes this file calls via HTTP (fetch, axios, etc.)
- **Format:** Absolute paths to route files
- **Answers:** "What API routes does this file depend on?"

```json
"calls": ["/app/api/users/route.ts", "/app/api/auth/login/route.ts"]
```

Populated by `docmeta calls`. Tracks HTTP dependencies in frameworks like Next.js where components call API routes via fetch/axios.

### `files.*.calledBy` (optional)
- **Type:** `string[]`
- **Purpose:** Files that call this route via HTTP
- **Format:** Absolute paths from project root
- **Answers:** "What files make HTTP calls to this API route?"

```json
"calledBy": ["/app/dashboard/page.tsx", "/src/components/UserList.tsx"]
```

Populated by `docmeta calls`. The HTTP equivalent of `usedBy` - shows which files would be affected if this API route changes.

### `contracts` (optional)
- **Type:** `object`
- **Purpose:** Public interfaces that external systems consume
- **Keys:** Contract identifiers (API endpoints, proto messages, events)
- **Answers:** "What's my public surface area? Who depends on me externally?"

Contracts represent the boundaries where your code meets the outside world. Unlike `usedBy` which tracks internal consumers, contracts track external consumers that may be in other repos or unknown entirely.

```json
"contracts": {
  "api:/v1/users": {
    "purpose": "User CRUD REST endpoints",
    "visibility": "public",
    "consumers": ["github:myorg/frontend#main", "external:unknown"]
  },
  "api:/v1/users/{id}": {
    "purpose": "Get/update/delete single user",
    "visibility": "internal",
    "consumers": ["github:myorg/admin-dashboard#main"]
  },
  "proto:myorg.users.v1.UserCreated": {
    "purpose": "Event published when user is created",
    "visibility": "public",
    "consumers": ["github:myorg/notification-service#main", "github:myorg/analytics#main"]
  },
  "grpc:UserService/GetUser": {
    "purpose": "Get user by ID via gRPC",
    "visibility": "internal",
    "consumers": ["github:myorg/gateway#main"]
  }
}
```

### `contracts.*.purpose` (required)
- **Type:** `string`
- **Purpose:** What this contract does

### `contracts.*.visibility` (required)
- **Type:** `"public" | "internal" | "deprecated"`
- **Values:**
  - `public` - External consumers, unknown blast radius, treat changes as high-risk
  - `internal` - Only known internal consumers, can trace blast radius
  - `deprecated` - Being phased out, warn on new usage

### `contracts.*.consumers` (required)
- **Type:** `string[]`
- **Purpose:** Known consumers of this contract
- **Format:** Same as `uses` references, plus special values:
  - `external:unknown` - Public API with unknown consumers
  - `external:partner-name` - Known external partner integration

**Why contracts matter:**

When an agent is about to change an API endpoint, the contract tells it:
1. Is this public? (high risk - unknown consumers)
2. Who are the known consumers? (can notify/check them)
3. Is it deprecated? (maybe safe to remove)

Without contracts, the agent has no way to know "this REST endpoint is called by 5 external services I can't see."

### `history` (optional but recommended)
- **Type:** `array` of `[timestamp, summary, files[]]` tuples
- **Purpose:** Semantic change log (the "why", not just the "what")
- **Keep:** Last 5-10 entries (configurable via `maxHistoryEntries` in `.docmetarc.json`)
- **Answers:** "Why is this code the way it is?"

```json
"history": [
  ["2025-01-10T14:30:00Z", "Added phone validation with libphonenumber", ["schema.ts"]],
  ["2025-01-08T09:15:00Z", "Split form into multi-step wizard for better UX", ["page.tsx"]],
  ["2025-01-05T11:00:00Z", "Initial implementation", ["page.tsx", "schema.ts"]]
]
```

**Note:** Timestamps are ISO 8601 format in UTC (Zulu time). This enables precise ordering and makes it easy to correlate with git history, CI logs, and other tooling.

**Good summaries:**
- "Added retry logic for transient Neo4j failures"
- "BREAKING: Renamed validateEmail to validateEmailFormat"
- "Refactored to use server actions instead of API route"

**Bad summaries:**
- "Updated file" (meaningless)
- "Fixed bug" (which bug?)

### `updated` (required)
- **Type:** `string` (ISO 8601 timestamp)
- **Purpose:** Last modification time for drift detection

```json
"updated": "2025-01-10T14:30:00Z"
```

## What We Deliberately Exclude

| Field | Why not |
|-------|---------|
| `linesOfCode` | Doesn't help agent decide anything |
| `complexity` | Subjective, not actionable |
| `type` (page/component/etc) | Inferrable from path and filename |
| `external imports` | Agent doesn't need to know you use React |
| `function signatures` | If you need this detail, read the code |
| `tags` | Purpose + path is sufficient for search |
| `author` | Git has this |

## Bidirectional Dependency Tracking

DocMeta tracks two types of dependencies, each with bidirectional links:

### Import Dependencies: `uses` / `usedBy`

```
/lib/validation/index.ts
  uses: []
  usedBy: ["/app/intake/page.tsx", "/app/api/clients/route.ts"]

/app/intake/page.tsx
  uses: ["@/lib/validation"]
  usedBy: ["/app/dashboard/page.tsx"]
```

When you add an import:
1. Add to `uses` in the importing file
2. Add to `usedBy` in the imported file

### HTTP Dependencies: `calls` / `calledBy`

For frameworks like Next.js where components call API routes via fetch/axios:

```
/app/api/users/route.ts
  calledBy: ["/app/dashboard/page.tsx", "/src/components/UserList.tsx"]

/app/dashboard/page.tsx
  calls: ["/app/api/users/route.ts", "/app/api/stats/route.ts"]
```

Run `docmeta calls` to populate these fields automatically by scanning for:
- `fetch('/api/...')` calls
- `axios.get('/api/...')` and similar
- `useSWR('/api/...')` hooks
- Other HTTP client patterns

This bidirectional tracking is the main maintenance burden, but it's also the main value.

## Language Support

DocMeta is optimized for **TypeScript/JavaScript** with full automatic detection. Other languages have basic support.

### Feature Support by Language

| Feature | TypeScript/JS | Python | Go | Rust | Others |
|---------|:-------------:|:------:|:--:|:----:|:------:|
| Export detection | ✅ Full | ✅ Basic | ✅ Basic | ✅ Basic | ❌ Manual |
| Import detection | ✅ Full | ⚠️ Relative only | ⚠️ Internal only | ✅ Basic | ❌ Manual |
| HTTP calls (`calls`/`calledBy`) | ✅ Full | ❌ | ❌ | ❌ | ❌ |
| Path aliases (tsconfig.json) | ✅ | ❌ | ❌ | ❌ | ❌ |

### TypeScript/JavaScript (Full Support)

The CLI automatically detects:
- **Exports:** `export const`, `export function`, `export class`, `export type`, `export interface`, `export { }`, `export default`
- **Imports:** `import ... from`, `require()` — filters to internal paths only
- **HTTP calls:** `fetch('/api/...')`, `axios.get/post/...`, `useSWR`, `useQuery` patterns
- **Path aliases:** Reads from `tsconfig.json`/`jsconfig.json` (defaults: `@/` and `~/` → project root)

### Python (Basic Support)

- **Exports:** `__all__` arrays, public function/class names (no underscore prefix)
- **Imports:** Relative imports only (e.g., `from .module import`)
- **Not detected:** Absolute imports, HTTP calls

### Go (Basic Support)

- **Exports:** Public identifiers starting with uppercase letter
- **Imports:** Internal package paths (not standard library or external modules)
- **Not detected:** Standard library imports, HTTP calls

### Rust (Basic Support)

- **Exports:** `pub fn`, `pub struct`, `pub enum`, `pub trait`, `pub type`, `pub const`, `pub mod`
- **Imports:** `use crate::`, `use super::`, `use self::`, `mod` declarations
- **Not detected:** External crate usage, HTTP calls

### Other Languages

The CLI creates scaffolds with empty `exports` and `uses` arrays. Fill these in manually or let Claude Code populate them during code work.

### Conventions by Language

| Language | exports format | uses format |
|----------|----------------|-------------|
| TypeScript/JS | Named exports, `"default"` | `"@/path"`, `"./relative"` |
| Python | Function/class names, `__all__` items | `".module"`, `"..parent"` |
| Go | Capitalized public names | `"project/internal/pkg"` |
| Rust | `pub` item names | `"crate::module"`, `"./submod"` |

The key is consistency within your project, not cross-project standards.

## Cross-Repository References

DocMeta supports tracking dependencies across repository boundaries. This is the key differentiator from static analysis tools - you can document relationships that no tool can infer.

### Reference Format

All cross-repo references follow a URI-like format with a prefix indicating the type:

```
prefix:identifier
```

| Prefix | Format | Example |
|--------|--------|---------|
| `github:` | `org/repo#branch:path` | `github:myorg/shared-lib#main:src/utils.ts` |
| `gitlab:` | `org/repo#branch:path` | `gitlab:myorg/service#develop:api/users.go` |
| `api:` | `service-name/version/path` | `api:user-service/v1/users` |
| `proto:` | `package.version.Type` | `proto:myorg.users.v1.User` |
| `grpc:` | `Service/Method` | `grpc:UserService/GetUser` |
| `event:` | `topic-or-event-name` | `event:user.created` |
| `external:` | `identifier` | `external:unknown`, `external:partner-acme` |

### The Registry

Cross-repo references require a **registry** to resolve. The registry is a local cache of `.docmeta.json` files from other repositories.

```
~/.docmeta/
├── registry.json           # Maps repo identifiers to metadata
└── cache/
    ├── myorg-user-service.json
    ├── myorg-shared-lib.json
    └── myorg-frontend.json
```

**Registry commands:**

```bash
# Add a repository to track
docmeta registry add github:myorg/user-service

# Sync all registered repositories (fetches latest .docmeta.json)
docmeta registry sync

# List registered repositories
docmeta registry list

# Remove a repository
docmeta registry remove github:myorg/user-service

# Export current repo for others to consume
docmeta registry export --output docmeta-bundle.json
```

### Cross-Repo Blast Radius

With a synced registry, you can trace impact across repositories:

```bash
docmeta blast-radius --cross-repo ./src/api/users.ts
```

Output:
```
./src/api/users.ts
├── Local consumers:
│   └── /app/admin/page.tsx
├── Cross-repo consumers:
│   └── github:myorg/frontend#main:src/api/userClient.ts
└── Contract consumers:
    └── api:/v1/users
        ├── github:myorg/mobile-app#main
        └── external:unknown (PUBLIC - high risk)
```

### CI Integration

To keep registries in sync across teams, export your docmeta bundle in CI:

```yaml
# .github/workflows/docmeta.yml
name: DocMeta Export
on:
  push:
    branches: [main]
    paths: ['**/.docmeta.json']

jobs:
  export:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @brbcoffeedebuff/docmeta registry export -o docmeta-bundle.json
      - uses: actions/upload-artifact@v4
        with:
          name: docmeta-bundle
          path: docmeta-bundle.json
```

Then other repos can sync from your CI artifacts or a shared storage location.

### Unknown Consumers

The hardest problem: knowing who calls *you* when you don't control their code.

**Strategies:**

1. **Flag public APIs** with `visibility: "public"` in contracts
2. **Use `external:unknown`** to mark "someone out there uses this"
3. **Import from observability** - if you have API gateway logs, import real callers
4. **Consumer registration** - consumers add your contract to their `uses`, registry syncs bidirectionally

There's no perfect solution. The goal is to make the unknown *visible* so agents treat those changes with appropriate caution.

## Minimal Valid Example

```json
{
  "v": 3,
  "purpose": "User authentication utilities.",
  "files": {
    "auth.ts": {
      "purpose": "JWT token generation and validation.",
      "exports": ["generateToken", "validateToken"],
      "uses": ["@/lib/config"],
      "usedBy": ["/app/api/login/route.ts"],
      "calls": [],
      "calledBy": []
    }
  },
  "history": [],
  "updated": "2025-01-11T00:00:00Z"
}
```

## Full Example with Contracts

```json
{
  "v": 3,
  "purpose": "User management API endpoints and business logic.",
  "files": {
    "routes.ts": {
      "purpose": "Express route handlers for user CRUD operations.",
      "exports": ["userRouter"],
      "uses": [
        "@/lib/db",
        "proto:myorg.users.v1.User",
        "github:myorg/shared-validation#main:src/schemas/user.ts"
      ],
      "usedBy": ["/app/server.ts"]
    },
    "service.ts": {
      "purpose": "Business logic for user operations.",
      "exports": ["UserService"],
      "uses": ["@/lib/db", "@/lib/events"],
      "usedBy": ["./routes.ts"]
    }
  },
  "contracts": {
    "api:/v1/users": {
      "purpose": "User CRUD REST endpoints",
      "visibility": "public",
      "consumers": ["github:myorg/frontend#main", "external:unknown"]
    },
    "event:user.created": {
      "purpose": "Published when a new user is created",
      "visibility": "internal",
      "consumers": [
        "github:myorg/notification-service#main",
        "github:myorg/analytics#main"
      ]
    }
  },
  "history": [
    ["2025-01-15", "Added email verification to user creation", ["service.ts"]],
    ["2025-01-10", "Initial API implementation", ["routes.ts", "service.ts"]]
  ],
  "updated": "2025-01-15T10:30:00Z"
}
```
