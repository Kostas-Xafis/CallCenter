# Project Structure

A Cloudflare Worker phone directory app backed by Cloudflare D1 (SQLite). It exposes a small REST API over ~1 054 phone records with fuzzy search, and serves a single-page frontend from `/public`.

---

## Directory Tree

```
callcenter/
├── worker.ts                    # CF Worker entry point (fetch handler)
├── wrangler.toml                # Wrangler / Cloudflare configuration
├── package.json
├── tsconfig.json
├── phones.csv                   # Raw phone data (seed source)
│
├── types/
│   └── types.ts                 # Shared TypeScript types (Env, ApiRoute, …)
│
├── src/
│   ├── fuzzy_search.ts          # Custom fuzzy search engine (pure JS)
│   ├── phone_repository.ts      # D1 data-access layer
│   └── routes/
│       ├── index.ts             # Route registry (Map<string, handler>)
│       ├── phonerecords.ts      # Route handler definitions
│       └── utils.ts             # CORS, trycatch, URL helpers
│
├── migrations/
│   ├── 0001_schema.sql          # Table + index DDL
│   └── 0002_seed.sql            # 1 054 INSERT statements
│
├── public/
│   ├── index.html               # SPA — search, filters, pagination, dark mode
│   └── login.html
│
└── sqlite/                      # Legacy local SQLite artefacts (not used at runtime)
    ├── callcenter.db
    ├── callcenter.sql
    └── drop.sql
```

---

## Request Flow

```
Incoming Request
  └─ worker.ts  (fetch handler)
       ├─ OPTIONS ──────────────────────────────► handleCors() → 200 preflight
       ├─ /api/*  ──► routes Map lookup
       │                └─ src/routes/phonerecords.ts  (handler)
       │                       └─ PhoneRepository       (D1 queries / FuzzySearch)
       └─ anything else ────────────────────────► env.ASSETS.fetch()  (static files)
```

---

## Key Files

### `worker.ts` — Entry Point

Cloudflare Worker `fetch` handler.

- Handles `OPTIONS` preflight via `handleCors()`.
- Looks up `"METHOD:/pathname"` in the `routes` Map; calls the matching handler with `(request, env)`.
- Falls back to `env.ASSETS.fetch(request)` for all non-API paths (serves `/public`).

---

### `wrangler.toml` — Cloudflare Configuration

| Key | Value |
|-----|-------|
| `name` | `callcenter` |
| `main` | `worker.ts` |
| `compatibility_date` | `2025-05-26` |
| `assets.directory` | `./public` (binding: `ASSETS`) |
| `d1_databases[0].binding` | `DB` |
| `d1_databases[0].database_name` | `callcenter` |
| `d1_databases[0].database_id` | `a0f23fef-208e-446f-82a3-f126958b5ce3` |
| `dev.port` | `3000` |

---

### `types/types.ts` — Shared Types

```typescript
type Env = {
    DB: D1Database;   // Cloudflare D1 binding
    ASSETS: Fetcher;  // Static asset binding
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

Wraps D1 SQL queries. Receives a `D1Database` instance at construction time (passed in from `env.DB` per request).

| Method | SQL / behaviour |
|--------|-----------------|
| `getAll()` | `SELECT * FROM phone_records ORDER BY id` |
| `getByType(type)` | `WHERE type = ?` |
| `fuzzySearch(query, { threshold?, limit? })` | Fetches all rows, builds `"service code"` strings, runs `FuzzySearch`, injects `matchesIdx` onto results |
| `getUniqueTypes()` | `SELECT DISTINCT type … ORDER BY type` |
| `getCount()` | `SELECT COUNT(*) …` |
| `getStatsByType()` | `GROUP BY type ORDER BY count DESC` |

---

### `src/fuzzy_search.ts` — Fuzzy Search Engine

Pure TypeScript, no dependencies.

- Accepts an array of strings at construction time.
- `search(query, threshold = 0.3)` — custom character-distance algorithm:
  - Scans query chars left-to-right through each subject string.
  - Penalty `+1` per skipped subject char; `+subject.length` per unmatched query char.
  - Score: `exp(-distance / (maxLen × 2))` — ranges 0–1 (higher = better match).
  - Filters by `score >= threshold`, sorts descending.
  - Returns `{ item, matchesIdx[] }` so the UI can highlight matched positions.
- Threshold guide: `0.6` very strict → `0.3` fuzzy (default) → `0.2` very fuzzy.

---

### `src/routes/index.ts` — Route Registry

Aggregates all `ApiRouteParent` groups, prefixes each route with `/api` + parent prefix, and builds:

```
Map<"METHOD:/api/path", (req, env) => Promise<Response>>
```

Current keys: `GET:/api/records`, `GET:/api/stats`, `GET:/api/search`, `GET:/api/records/type`.

---

### `src/routes/phonerecords.ts` — Route Handlers

All routes are `GET`. Each handler instantiates `PhoneRepository(env.DB)` and returns JSON.

| Route | Path | Query params | Action |
|-------|------|--------------|--------|
| `phonerecordsRoute` | `/api/records` | — | All records |
| `statsRoute` | `/api/stats` | — | `{ count, types[], byType[] }` |
| `fuzzySearchRoute` | `/api/search` | `q`, `threshold` | Fuzzy-matched records with `matchesIdx` |
| `byTypeRoute` | `/api/records/type` | `type` | Records filtered by type |

---

### `src/routes/utils.ts` — Utilities

| Export | Purpose |
|--------|---------|
| `trycatch(fn, errorMsg)` | Wraps a handler; catches errors → `500` JSON response |
| `headers` | Standard CORS headers (`Access-Control-Allow-*`) |
| `handleCors(request)` | Returns `200` preflight `Response` for `OPTIONS`, else `null` |
| `requestUrlToString(request)` | Normalises to `"METHOD:/pathname"` key format |

---

### `migrations/` — Database Schema

**`0001_schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS phone_records (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    type    TEXT NOT NULL,    -- category (e.g. "ΟΤΕ", "WIND", …)
    service TEXT NOT NULL,    -- service / department name
    code    TEXT NOT NULL     -- phone number / short code
);

CREATE INDEX IF NOT EXISTS idx_type    ON phone_records(type);
CREATE INDEX IF NOT EXISTS idx_service ON phone_records(service);
CREATE INDEX IF NOT EXISTS idx_code    ON phone_records(code);
```

**`0002_seed.sql`** — 1 054 `INSERT` statements across 8 record types.

---

### `public/index.html` — Frontend SPA

Single self-contained HTML file; no build step.

**Layout** — two-column (desktop) / stacked (mobile):
- **Left panel** — brand card + search section + Latest island
- **Right panel** — results table with sticky thead, pagination

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
