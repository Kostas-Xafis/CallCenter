#!/usr/bin/env bun
/**
 * Cloudflare D1 Database Setup Helper
 *
 * For Cloudflare Workers + D1, the database is managed through Wrangler CLI,
 * not through local SQLite files. Use the following commands:
 *
 *   # Create the D1 database (first time only)
 *   bun run d1:create
 *
 *   # Apply migrations (local dev)
 *   bun run d1:migrate:local
 *
 *   # Apply migrations (production)
 *   bun run d1:migrate
 *
 *   # Seed the database (local dev)
 *   bun run d1:seed:local
 *
 *   # Seed the database (production)
 *   bun run d1:seed
 *
 * This script is kept as a convenience reference.
 * For local Node.js development with SQLite, switch to the 'node' branch.
 */

console.log(`
📦 CallCenter — Cloudflare D1 Database Setup
─────────────────────────────────────────────

The database is managed via Wrangler CLI (not local SQLite files).

Quick start (local dev):
  1. bun run d1:migrate:local    ← apply all migrations
  2. bun run d1:seed:local        ← seed initial data
  3. bun run user:create:local -- <username> <password> [--admin]

Production:
  1. bun run d1:migrate           ← apply all migrations
  2. bun run user:create -- <username> <password> [--admin]

For local Node.js + SQLite development, switch to the 'node' branch.
`);
