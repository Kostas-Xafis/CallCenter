# Call Center

A phone records management app with fuzzy search. Built with Bun, TypeScript, and SQLite.

## Stack

- **Runtime:** [Bun](https://bun.com)
- **Database:** SQLite via `@libsql/client`
- **Search:** Fuzzy search via `fuse.js`
- **CSV parsing:** `papaparse`

## Setup

```bash
bun install
```

Seed the database from `phones.csv`:

```bash
bun run db:reset
```

## Running

```bash
bun run dev     # Development (watch mode)
bun server.ts   # Production
```

Server starts on `http://localhost:3000`.

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/records` | All phone records |
| GET | `/api/stats` | Counts, unique types & services |
| GET | `/api/search?q=<query>` | Fuzzy search records |

