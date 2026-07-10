#!/usr/bin/env bun
/**
 * Create or update a user in the local callcenter SQLite database.
 *
 * Usage:
 *   bun run scripts/create-user.ts <username> <password> [--admin]
 *
 *   --admin   Give the user administrator privileges (default: regular user)
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const isAdmin = args.includes('--admin');
const positional = args.filter(a => a !== '--admin');
const [username, password] = positional;

if (!username || !password) {
    console.error('Usage: bun run scripts/create-user.ts <username> <password> [--admin]');
    process.exit(1);
}

const role = isAdmin ? 'admin' : 'user';

// ---------------------------------------------------------------------------
// Hash password — same algorithm used by the server (PBKDF2 / SHA-256)
// ---------------------------------------------------------------------------
function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function hashPassword(pw: string): Promise<{ hash: string; salt: string; }> {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(pw) as BufferSource,
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes as BufferSource, iterations: 100_000 },
        keyMaterial,
        256
    );
    return { hash: toHex(new Uint8Array(hashBuffer)), salt: toHex(saltBytes) };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const { hash, salt } = await hashPassword(password);

const dbPath = join(import.meta.dir, '..', 'sqlite', 'callcenter.db');
const db = new Database(dbPath, { create: true });

// Ensure the users table exists (in case migrations haven't been run yet)
// Note: the role column is added by migration 0007; we handle both cases below.
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        salt          TEXT NOT NULL
    );
`);

// Add role column if it doesn't exist yet (migration 0007 may not have run)
const hasRole = db.query(
    "SELECT 1 FROM pragma_table_info('users') WHERE name = 'role'"
).get();
if (!hasRole) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
}

// Upsert: create or overwrite existing user
db.query(
    `INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt, role = excluded.role`
).run(username, hash, salt, role);

db.close();

console.log(`Done. User "${username}" created with role "${role}".`);

