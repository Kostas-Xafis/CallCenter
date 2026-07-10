# Project Structure

A **Bun HTTP server** phone directory app backed by **SQLite** (`bun:sqlite`). It exposes a small REST API over ~1 054 phone records, and serves a single-page frontend from `/public`. Originally a Cloudflare Worker + D1 project; now fully self-hosted.

---

## Directory Tree

```
callcenter/
├── server.ts                   # Bun HTTP server entry point (fetch handler)
├── db.ts                       # SQLite database init + migration runner
├── package.json
├── tsconfig.json
├── phones.csv                  # Raw phone data (seed source)
│
├── types/
│   └── types.ts                # Shared TypeScript types (Env, ApiRoute, …)
│
├── src/
│   ├── auth.ts                 # Password hashing + session management
│   ├── phone_repository.ts     # SQLite data-access layer (bun:sqlite)
│   └── routes/
│       ├── index.ts            # Route registry (Map<string, handler>)
│       ├── phonerecords.ts     # Route handler definitions
│       └── utils.ts            # CORS, trycatch, URL helpers
│
├── migrations/
│   ├── 0001_schema.sql         # Table + index DDL
│   ├── 0002_seed.sql           # 1 054 INSERT statements
│   └── 0006_auth.sql           # Users + sessions tables
│
├── public/
│   ├── index.html              # SPA — search, filters, pagination, dark mode
│   ├── login.html              # Login page
│   ├── manifest.json           # PWA manifest
│   ├── sw.js                   # Service worker
│   └── icons/                  # App icons (16, 32, 180 px)
│
├── scripts/
│   └── create-user.ts          # CLI tool to create/update user credentials
│
└── sqlite/
    ├── callcenter.db           # Runtime SQLite database (auto-created by db.ts)
    ├── callcenter.sql          # Legacy schema reference
    └── drop.sql                # Legacy drop script
```

---

## Request Flow

```
Incoming Request
  └─ server.ts  (Bun.serve fetch handler)
       ├─ OPTIONS ──────────────────────────────► handleCors() → 200 preflight
       ├─ /auth/login  ─────────────────────────► handleLogin()  → session cookie
       ├─ /auth/logout ─────────────────────────► handleLogout() → clears session
       ├─ /api/*  ──► routes Map lookup
       │                └─ src/routes/phonerecords.ts  (handler)
       │                       └─ PhoneRepository       (bun:sqlite queries)
       └─ anything else ────────────────────────► serveStatic() → Bun.file()
                                                      └─ fallback → /public/index.html
```

---

## Key Files

### `server.ts` — Entry Point

Bun HTTP server using `Bun.serve()`.

- **Port**: `3000` (configurable via `PORT` env var).
- Handles `OPTIONS` preflight via `handleCors()`.
- Auth endpoints (`/auth/login`, `/auth/logout`) bypass session guard.
- Session guard protects all other paths (except `/login`, `/login.html`, `/auth/login`).
  - Unauthenticated API calls → `401` JSON.
  - Unauthenticated page requests → `302` redirect to `/login`.
- Looks up `"METHOD:/pathname"` in the `routes` Map for API calls.
- Serves static files from `./public` directory via `Bun.file()`.
- Falls back to `index.html` for SPA-style client-side routing.
- Registers `SIGINT`/`SIGTERM` handlers for graceful shutdown (closes DB).

### `db.ts` — Database & Migrations

Initializes a **singleton** SQLite database at `sqlite/callcenter.db`.

- Enables WAL mode and foreign keys.
- Runs all `.sql` files from `migrations/` in sorted order on first startup.
- Tracks applied migrations in a `_migrations` table (idempotent via `INSERT OR IGNORE`).
- Exports `getDb()` for the singleton and `closeDb()` for graceful shutdown.

### `types/types.ts` — Shared Types

```typescript
import type { Database } from 'bun:sqlite';

type Env = {
    DB: Database;  // bun:sqlite Database instance
};

type ApiRoute = {
    url: string;
    method: string;
    handler: (request: Request, env: Env) => Promise<Response>;
};

type ApiRouteParent = {
    url: string;       // base prefix for a group of routes
    routes: ApiRoute[];
};
```

---

### `src/phone_repository.ts` — Data Access Layer

Wraps `bun:sqlite` queries. Receives a `Database` instance at construction time.

| Method | SQL / behaviour |
|--------|-----------------|
| `getAll()` | `SELECT * FROM phone_records ORDER BY id` |
| `getTableHash()` | `SELECT value FROM table_meta WHERE key = 'records_version'` — cache invalidation token |
| `getUniqueTypes()` | `SELECT DISTINCT type … ORDER BY type` |
| `getCount()` | `SELECT COUNT(*) FROM phone_records` |
| `getStatsByType()` | `GROUP BY type ORDER BY count DESC` |
| `getLatest()` | Latest 5 most-clicked records for today from `latest_requests` |
| `trackLatest(type, service, code)` | Upsert click count for a record (today's date) |
| `deleteLatest(type, service, code)` | Remove a record from today's latest list |

All queries use `db.query(sql).get()/.all()/.run()` (Bun's modern SQLite API).

---

### `src/auth.ts` — Authentication

Password hashing via **PBKDF2 / SHA-256** (Web Crypto API, 100 000 iterations). Session-based auth with HttpOnly cookies.

| Export | Purpose |
|--------|---------|
| `hashPassword(pw)` | Returns `{ hash, salt }` hex strings |
| `verifyPassword(pw, salt, hash)` | Returns `boolean` |
| `getSessionCookie(request)` | Extracts session ID from Cookie header |
| `validateSession(db, sessionId)` | Checks session exists and hasn't expired |
| `handleLogin(request, env)` | Validates credentials → sets session cookie |
| `handleLogout(request, env)` | Deletes session → clears cookie |

Uses `as BufferSource` casts at `crypto.subtle` API boundaries to resolve Bun's `Uint8Array<ArrayBufferLike>` vs standard `BufferSource` type mismatch.

---

### `src/routes/index.ts` — Route Registry

Aggregates all `ApiRouteParent` groups, prefixes each route with `/api` + parent prefix, and builds:

```
Map<"METHOD:/api/path", (req, env) => Promise<Response>>
```

Current keys: `GET:/api/records`, `GET:/api/stats`, `GET:/api/records/hash`, `GET:/api/latest`, `POST:/api/latest`, `DELETE:/api/latest`.

---

### `src/routes/phonerecords.ts` — Route Handlers

Each handler instantiates `PhoneRepository(env.DB)` and returns JSON. All wrapped in `trycatch` for error handling.

| Route | Method | Path | Action |
|-------|--------|------|--------|
| `phonerecordsRoute` | GET | `/api/records` | All phone records |
| `statsRoute` | GET | `/api/stats` | `{ total, uniqueTypes, types[], statsByType[] }` |
| `tableHashRoute` | GET | `/api/records/hash` | `{ hash }` — cache version token |
| `getLatestRoute` | GET | `/api/latest` | Today's top-5 most-clicked records |
| `trackLatestRoute` | POST | `/api/latest` | Track a click; body: `{ type, service, code }` |
| `deleteLatestRoute` | DELETE | `/api/latest` | Remove from today's latest; body: `{ type, service, code }` |

---

### `src/routes/utils.ts` — Utilities

| Export | Purpose |
|--------|---------|
| `trycatch(fn, errorMsg)` | Wraps a handler; catches errors → `500` JSON response |
| `headers` | Standard CORS headers (`Access-Control-Allow-*`) |
| `handleCors(request)` | Returns `200` preflight `Response` for `OPTIONS`, else `null` |
| `requestUrlToString(request)` | Normalises to `"METHOD:/pathname"` key format |

---

### `scripts/create-user.ts` — User Management CLI

Creates or updates a user directly in the local SQLite database.

```bash
bun run scripts/create-user.ts <username> <password>
# or via npm script:
bun run user:create <username> <password>
```

- Uses the same PBKDF2/SHA-256 algorithm as `src/auth.ts` for password hashing.
- Auto-creates the `users` table if migrations haven't been run yet.
- Upserts: overwrites existing user with the same username.

---

### `migrations/` — Database Schema

**`0001_schema.sql`** — Phone records table + indexes + metadata table + latest requests tracking:

```sql
CREATE TABLE IF NOT EXISTS phone_records (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    type    TEXT    NOT NULL,
    service TEXT    NOT NULL,
    code    TEXT    NOT NULL,
    merged  INTEGER NOT NULL DEFAULT 0
);
-- plus indexes, table_meta, and latest_requests tables
```

**`0002_seed.sql`** — 1 054 `INSERT` statements across multiple record types.

**`0006_auth.sql`** — Users and sessions tables for authentication.

All migrations are applied automatically on first startup by `db.ts`, tracked via the `_migrations` table for idempotency.

---

### `public/index.html` — Frontend SPA

Single self-contained HTML file; no build step.

**Layout** — two-column (desktop) / stacked (mobile):
- **Left panel** — brand card + search section + Latest island
- **Right panel** — results table with sticky thead, pagination
- Dark mode support via CSS custom properties
- PWA-ready with manifest and service worker

---

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start server with hot reload (`--watch`) |
| `bun run start` | Start server (production) |
| `bun run user:create <user> <pass>` | Create or update a user account |

**Features:**
| Feature | Implementation |
|---------|---------------|
| Fuzzy search | Debounced `input` → `GET /api/search?q=&threshold=` |
| Type filter | `<select>` → `GET /api/records/type?type=` |
| Threshold selector | 4 levels (Very Strict → Very Fuzzy) passed to `/api/search` |
| EN→GR keyboard mapping | Standard Greek layout map applied client-side; "Searching as: …" hint shown |
| Match highlighting | `matchesIdx` from API used to wrap characters in `<span class="highlight">` |
| Pagination | 100 rows/page, purely client-side; `«‹ Page X of Y ›»` controls |
| Dark mode | CSS custom-property swap; preference saved in `localStorage` |
| Latest island | Top 5 most-clicked records today; stored in `localStorage` (daily reset); clicking a Latest item re-runs the search |

**localStorage keys:**

| Key | Contents |
|-----|----------|
| `callcenter-theme` | `"light"` \| `"dark"` |
| `callcenter-latest` | `{ date: "YYYY-MM-DD", counts: { "type\|service\|code": { type, service, code, count } } }` |

---

## npm Scripts

| Script | Command |
|--------|---------|
| `dev` | `wrangler dev` (local dev on port 3000) |
| `deploy` | `wrangler deploy` |
| `d1:create` | Create the remote D1 database |
| `d1:migrate` | Apply migrations to remote D1 |
| `d1:migrate:local` | Apply migrations to local D1 |
| `d1:seed` | Seed remote D1 from `0002_seed.sql` |
| `d1:seed:local` | Seed local D1 |

---

## Dependencies

No runtime npm dependencies. Dev only:

| Package | Purpose |
|---------|---------|
| `wrangler` | CLI for deploying / local dev |
| `@cloudflare/workers-types` | TypeScript types for `D1Database`, `Fetcher`, etc. |
| `@types/bun` | Bun runtime types (for scripts) |
| `typescript` | Peer dependency |
