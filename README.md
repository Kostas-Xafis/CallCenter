# Call Center

A phone records management app with client-side fuzzy search and IndexedDB caching. Built with Bun, TypeScript, and SQLite.

## Stack

- **Runtime:** [Bun](https://bun.com)
- **Database:** SQLite via `bun:sqlite`
- **Search:** Client-side fuzzy search (custom implementation, no external libraries)
- **Caching:** IndexedDB with server-side hash-based cache invalidation

## Setup

```bash
bun install
```

The database is auto-created on first startup from the migrations in `migrations/`.

## Running

```bash
bun run dev              # Development (watch mode + request logging)
bun run start            # Production
bun run user:create      # Create a user (CLI)
bun run cache:invalidate # Bump service worker cache version
```

Server starts on `http://localhost:3000`.

## Authentication & Authorization

The app uses session-based authentication with HttpOnly cookies. Passwords are hashed via PBKDF2/SHA-256 (100 000 iterations).

- **Roles:** `admin` and `user`
- Write operations (`POST`/`PUT`/`PATCH`/`DELETE`) on `/api/*` require the `admin` role
- The `/admin` panel is restricted to admin users
- Signup is invitation-only: admins create invitations and share the signup link

## API

### Phone Records

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/records` | All phone records |
| GET | `/api/records/hash` | Content fingerprint for cache invalidation |
| GET | `/api/stats` | Total count, unique types & per-type breakdown |

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Authenticate with username/password → session cookie |
| POST | `/auth/logout` | Clear session |
| POST | `/auth/signup` | Complete registration from invitation (body: `{ inviteId, password }`) |

### Signup (invitation-based)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/signup/validate?id=<hex>` | Validate an invitation code, returns the username |

### Admin (admin role required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/create-user` | Create a signup invitation (body: `{ username, role }`) |
| POST | `/api/admin/upload-data` | Replace all records from an `.xlsx` file (multipart/form-data) |

## Frontend Pages

| Path | Description |
|------|-------------|
| `/` | Main SPA — search, type filter, pagination, dark mode |
| `/login` | Login page |
| `/signup` | Signup page (requires `?id=<invitation>`) |
| `/admin` | Admin panel — create user invitations, upload Excel data (admin only) |

