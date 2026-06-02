#!/usr/bin/env bun
/**
 * Create or update a user in the callcenter D1 database.
 *
 * Usage:
 *   bun run user:create       -- <username> <password>   # production
 *   bun run user:create:local -- <username> <password>   # local dev
 *
 * Or directly:
 *   bun run scripts/create-user.ts <username> <password> [--local]
 */

import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const positional = args.filter(a => a !== '--local');
const [username, password] = positional;

if (!username || !password) {
    console.error('Usage: bun run scripts/create-user.ts <username> <password> [--local]');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Hash password — same algorithm used by the Worker (PBKDF2 / SHA-256)
// ---------------------------------------------------------------------------
function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function hashPassword(pw: string): Promise<{ hash: string; salt: string }> {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(pw),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 100_000 },
        keyMaterial,
        256
    );
    return { hash: toHex(new Uint8Array(hashBuffer)), salt: toHex(saltBytes) };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const { hash, salt } = await hashPassword(password);

// Upsert: create or overwrite existing user
const sql =
    `INSERT INTO users (username, password_hash, salt) VALUES ('${username}', '${hash}', '${salt}') ` +
    `ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt;`;

const wranglerArgs = [
    'wrangler', 'd1', 'execute', 'callcenter',
    isLocal ? '--local' : '--remote',
    '--command', sql,
];

console.log(`Creating user "${username}" ${isLocal ? '(local)' : '(production)'}...`);

const result = spawnSync('bunx', wranglerArgs, { stdio: 'inherit' });

if (result.status !== 0) {
    console.error('Failed to create user.');
    process.exit(result.status ?? 1);
}

console.log(`Done. User "${username}" is ready.`);
