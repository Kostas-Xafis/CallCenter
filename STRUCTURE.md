# Project Structure

A **Bun HTTP server** phone directory app backed by **SQLite** (`bun:sqlite`). It exposes a REST API over ~1 054 phone records, serves a multi-page frontend from `/public`, and supports invitation-based signup with role-based access control (admin/user). Originally a Cloudflare Worker + D1 project; now fully self-hosted.

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
│   └── types.ts                # Shared TypeScript types (Env, ApiRoute, SessionUser, …)
│
├── src/
│   ├── auth.ts                 # Password hashing + session management + signup
│   ├── phone_repository.ts     # SQLite data-access layer (bun:sqlite)
│   └── routes/
│       ├── index.ts            # Route registry — merges all route groups into a Map
│       ├── phonerecords.ts     # Phone record endpoints (GET records, stats, hash)
│       ├── admin.ts            # Admin endpoints (create-user invitation, upload-data)
│       ├── signup.ts           # Signup invitation validation endpoint
│       └── utils.ts            # CORS, trycatch, JSON response helpers, toHex
│
├── migrations/
│   ├── 0001_schema.sql         # Table + index DDL
│   ├── 0002_seed.sql           # 1 054 INSERT statements
│   ├── 0006_auth.sql           # Users + sessions tables
│   ├── 0007_roles.sql          # Role-based access control (admin / user)
│   └── 0008_signup_invitations.sql  # Invitation codes for signup flow
│
├── public/
│   ├── index.html              # Main SPA — search, type filter, pagination, dark mode
│   ├── login.html              # Login page
│   ├── signup.html             # Signup page (invitation-based registration)
│   ├── manifest.json           # PWA manifest
│   ├── sw.js                   # Service worker (offline caching)
│   ├── logo.png                # App logo
│   ├── icons/                  # App icons (16, 32, 180 px)
│   ├── admin/
│   │   ├── index.html          # Admin panel page
│   │   ├── css/main.css        # Admin panel styles
│   │   └── js/admin.js         # Admin panel logic
│   ├── css/
│   │   ├── index/main.css      # Main page styles
│   │   ├── login/main.css      # Login page styles
│   │   ├── signup/main.css     # Signup page styles
│   │   └── shared/
│   │       ├── reset.css       # CSS reset/normalize
│   │       └── theme.css       # Light/dark theme variables
│   └── js/
│       ├── index/
│       │   ├── app.js          # Main application logic
│       │   ├── db.js           # IndexedDB helpers (cache layer)
│       │   ├── fuzzy-search.js # Client-side fuzzy search engine
│       │   └── greek-layout.js # Greek keyboard layout mapping
│       ├── login/login.js      # Login page logic
│       ├── signup/signup.js    # Signup page logic
│       └── shared/
│           ├── dev-logger.js   # Development logging utilities
│           ├── sw.js           # Service worker registration
│           └── theme.js        # Theme toggle logic
│
├── scripts/
│   ├── create-user.ts          # CLI tool to create/update user credentials
│   └── invalidate-cache.ts     # Bump service worker cache version
│
├── tests/
│   └── session.test.ts         # Session validation tests
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
       ├─ /auth/login  ─────────────────────────► handleLogin()  → session cookie (+ role)
       ├─ /auth/logout ─────────────────────────► handleLogout() → clears session
       ├─ /auth/signup ─────────────────────────► handleSignup() → creates user from invitation
       ├─ /api/*  ──► session guard → role check (write ops = admin only)
       │                ├─ src/routes/phonerecords.ts  (phone record handlers)
       │                ├─ src/routes/admin.ts         (admin handlers)
       │                └─ src/routes/signup.ts        (signup validation)
       │                       └─ PhoneRepository       (bun:sqlite queries)
       └─ anything else ────────────────────────► serveStatic() → Bun.file()
            ├─ /login    → /public/login.html
            ├─ /signup   → /public/signup.html
            ├─ /admin    → /public/admin/index.html (admin only)
            └─ fallback  → /public/index.html
```

---

### Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `create-user.ts` | `bun run user:create <user> <pass> [--admin]` | Create/update a user directly in the SQLite database |
| `invalidate-cache.ts` | `bun run cache:invalidate` | Bump the service worker `CACHE_NAME` version to force client cache refresh |

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
- **Role-based access control**: after authentication, write operations (`POST`/`PUT`/`PATCH`/`DELETE`) on `/api/*` are restricted to users with the `admin` role. Non-admin users receive `403 Forbidden`.
- **Admin page guard**: `/admin` and `/admin/*` paths are restricted to admin users; others are redirected to `/`.
- Static non-HTML assets (icons, manifest, JS, CSS) bypass the session guard so the login page can load without redirects.
- Explicitly maps clean URLs: `/login` → `/public/login.html`, `/signup` → `/public/signup.html`, `/admin` → `/public/admin/index.html`.
- Looks up `"METHOD:/pathname"` in the `routes` Map for API calls.
- Serves static files from `./public` directory via `Bun.file()` with `Cache-Control` headers.
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

type UserRole = 'admin' | 'user';

type SessionUser = {
    sessionId: string;
    username: string;
    role: UserRole;
};

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
| `getTableHash()` | Computes a lightweight content fingerprint (`COUNT:MAX(id):SUM(lengths)`) for cache invalidation |
| `getUniqueTypes()` | `SELECT DISTINCT type … ORDER BY type` |
| `getCount()` | `SELECT COUNT(*) FROM phone_records` |
| `getStatsByType()` | `GROUP BY type ORDER BY count DESC` |

All queries use `db.query(sql).get()/.all()/.run()` (Bun's modern SQLite API).

---

### `src/auth.ts` — Authentication & Signup

Password hashing via **PBKDF2 / SHA-256** (Web Crypto API, 100 000 iterations). Session-based auth with HttpOnly cookies. Includes the invitation-based signup flow.

| Export | Purpose |
|--------|---------|
| `hashPassword(pw)` | Returns `{ hash, salt }` hex strings |
| `verifyPassword(pw, salt, hash)` | Returns `boolean` |
| `getSessionCookie(request)` | Extracts session ID from Cookie header |
| `validateSession(db, sessionId)` | Returns `SessionUser \| null` (includes `username` and `role`) |
| `getSessionUser(db, request)` | Convenience: extracts cookie + validates in one call |
| `handleLogin(request, env)` | Validates credentials → sets session cookie; returns `{ ok, role }` |
| `handleLogout(request, env)` | Deletes session → clears cookie |
| `handleSignup(request, env)` | Validates invitation → hashes password → creates user → deletes invitation |

Uses `as BufferSource` casts at `crypto.subtle` API boundaries to resolve Bun's `Uint8Array<ArrayBufferLike>` vs standard `BufferSource` type mismatch.

---

### `src/routes/index.ts` — Route Registry

Aggregates all `ApiRouteParent` groups (`PhoneRecordRoutes`, `AdminRoutes`, `SignupRoutes`), prefixes each route with `/api` + parent prefix, and builds:

```
Map<"METHOD:/api/path", (req, env) => Promise<Response>>
```

Current keys: `GET:/api/records`, `GET:/api/stats`, `GET:/api/records/hash`, `POST:/api/admin/create-user`, `POST:/api/admin/upload-data`, `GET:/api/signup/validate`.

---

### `src/routes/phonerecords.ts` — Phone Record Handlers

Each handler instantiates `PhoneRepository(env.DB)` and returns JSON. All wrapped in `trycatch` for error handling.

| Route | Method | Path | Action |
|-------|--------|------|--------|
| `phonerecordsRoute` | GET | `/api/records` | All phone records |
| `statsRoute` | GET | `/api/stats` | `{ total, uniqueTypes, types[], statsByType[] }` |
| `tableHashRoute` | GET | `/api/records/hash` | `{ hash }` — content fingerprint for IndexedDB cache invalidation |

### `src/routes/admin.ts` — Admin Handlers

Admin-only endpoints. Both handlers use `trycatch` for error handling.

| Route | Method | Path | Action |
|-------|--------|------|--------|
| `createUserRoute` | POST | `/api/admin/create-user` | Create a signup invitation; body: `{ username, role }` |
| `uploadDataRoute` | POST | `/api/admin/upload-data` | Replace all phone records from an `.xlsx` file (multipart) |

### `src/routes/signup.ts` — Signup Validation

| Route | Method | Path | Action |
|-------|--------|------|--------|
| `validateInvitationRoute` | GET | `/api/signup/validate?id=<hex>` | Validate invitation code; returns `{ username }` or error |

---

### `src/routes/utils.ts` — Utilities

| Export | Purpose |
|--------|---------|
| `trycatch(fn, errorMsg)` | Wraps a handler; catches errors → `500` JSON response |
| `jsonSuccess(data, status?)` | Returns a JSON success response |
| `jsonError(message, status?)` | Returns a JSON error response |
| `toHex(bytes)` | Converts `Uint8Array` to hex string |
| `headers` | Standard CORS headers (`Access-Control-Allow-*`) |
| `handleCors(request)` | Returns `200` preflight `Response` for `OPTIONS`, else `null` |
| `requestUrlToString(request)` | Normalises to `"METHOD:/pathname"` key format |

---

### `scripts/create-user.ts` — User Management CLI

Creates or updates a user directly in the local SQLite database.

```bash
bun run scripts/create-user.ts <username> <password> [--admin]
# or via npm script:
bun run user:create <username> <password>
```

- Uses the same PBKDF2/SHA-256 algorithm as `src/auth.ts` for password hashing.
- `--admin` flag grants administrator privileges (full API access); default role is `user` (read-only API access).
- Auto-creates the `users` table (and the `role` column if migration hasn't run yet).
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

**`0007_roles.sql`** — Adds `role` column (`'admin'` or `'user'`) to both `users` and `sessions` tables for role-based access control.

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
| `bun run user:create <user> <pass>` | Create a regular user (read-only) |
| `bun run scripts/create-user.ts <user> <pass> --admin` | Create an admin user (full access) |

---

## Dependencies

No runtime npm dependencies. Dev only:

| Package | Purpose |
|---------|---------|
| `@types/bun` | Bun runtime types |
| `typescript` | Peer dependency |

---
