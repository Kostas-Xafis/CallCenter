/**
 * Session, Signup & Role-Based Access Control Tests
 *
 * Uses Miniflare's in-memory D1 to run the full Worker fetch handler.
 *
 * Covers the full user lifecycle:
 *   signup (validate → register) → login → read (GET) → write (POST/DELETE) → logout
 *
 * Validates that:
 *   - Unauthenticated users are blocked (401)
 *   - Signup invitations can be validated and used to create accounts
 *   - Authenticated regular users can read but NOT write (403 on write ops)
 *   - Authenticated admin users can read AND write
 *   - Logout invalidates the session
 *   - Invalid credentials are rejected
 */

import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth';
import type { PhoneRecord } from '../src/phone_repository';
import type { Env, UserRole } from '../types/types';

// ---------------------------------------------------------------------------
// Response type helpers
// ---------------------------------------------------------------------------

type ErrorBody = { error: string; };
type LoginBody = { ok: true; role: UserRole; };
type LogoutBody = { ok: true; };
type SignupBody = { ok: true; username: string; };
type ValidateInviteBody = { username: string; };
type StatsBody = { total: number; uniqueTypes: number; types: string[]; statsByType: { type: string; count: number; }[]; };
type HashBody = { hash: string; };
type CreateUserBody = { signupUrl: string; hexCode: string; expiresAt: number; };

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let env: Env;
let db: D1Database;
let workerFetch: (request: Request, env: Env) => Promise<Response>;

/** Extract the session cookie from a Response (Set-Cookie header). */
function getSessionCookie(response: Response): string | null {
    const setCookie = response.headers.get('Set-Cookie');
    if (!setCookie) return null;
    const match = setCookie.match(/^session=([^;]+)/);
    return match ? match[1]! : null;
}

/** Build a Request with an optional session cookie. */
function req(
    method: string,
    path: string,
    opts?: { body?: unknown; cookie?: string | null; }
): Request {
    const headers: Record<string, string> = {};
    if (opts?.cookie) {
        headers['Cookie'] = `session=${opts.cookie}`;
    }
    if (opts?.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    return new Request(`http://localhost${path}`, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
    // Create Miniflare instance with a D1 database
    const mf = new Miniflare({
        d1Databases: ['DB'],
        modules: true,
        script: 'export default { fetch() { return new Response(null, { status: 404 }); } }',
    });

    db = await mf.getD1Database('DB');

    // Run all migrations — collapse to single-line, exec entire file at once
    const migrationsDir = join(import.meta.dirname!, '..', 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    for (const file of migrationFiles) {
        let sql = readFileSync(join(migrationsDir, file), 'utf-8');
        // Strip SQL comments, collapse newlines, normalize whitespace
        sql = sql.replace(/--.*$/gm, '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (sql.length === 0) continue;
        await db.exec(sql);
    }

    // Seed two users: one admin, one regular
    const adminCreds = await hashPassword('adminpass');
    const userCreds = await hashPassword('userpass');

    await db.prepare(
        `INSERT OR REPLACE INTO users (username, password_hash, salt, role)
         VALUES (?, ?, ?, ?)`
    ).bind('admin', adminCreds.hash, adminCreds.salt, 'admin').run();

    await db.prepare(
        `INSERT OR REPLACE INTO users (username, password_hash, salt, role)
         VALUES (?, ?, ?, ?)`
    ).bind('user', userCreds.hash, userCreds.salt, 'user').run();

    // Import the Worker dynamically
    const workerModule = await import('../worker');
    workerFetch = workerModule.default.fetch;

    // Build mock env with real D1 and a stub ASSETS fetcher
    env = {
        DB: db,
        ASSETS: {
            fetch: () => Promise.resolve(new Response('Not Found', { status: 404 })),
        } as unknown as Fetcher,
    };
});

afterAll(async () => {
    // Miniflare cleans up automatically when the process exits
});

// ---------------------------------------------------------------------------
// 1. Unauthenticated access
// ---------------------------------------------------------------------------

describe('Unauthenticated access', () => {
    const readEndpoints = [
        ['GET', '/api/records'],
        ['GET', '/api/stats'],
        ['GET', '/api/records/hash'],
    ] as const;

    for (const [method, path] of readEndpoints) {
        it(`${method} ${path} returns 401 without session`, async () => {
            const res = await workerFetch(req(method, path), env);
            expect(res.status).toBe(401);
            const body = await res.json() as ErrorBody;
            expect(body.error).toBe('Unauthorized');
        });
    }

    it('public paths bypass auth guard (non-existent invite → 404, not 401)', async () => {
        const res = await workerFetch(req('GET', '/api/signup/validate?id=test'), env);
        // 404 means the auth guard let us through — the endpoint handled the request
        expect(res.status).toBe(404);
    });

    it('login page redirect works for unauthenticated users', async () => {
        const res = await workerFetch(req('GET', '/admin'), env);
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/login');
    });
});

// ---------------------------------------------------------------------------
// 2. Login
// ---------------------------------------------------------------------------

describe('Login', () => {
    it('succeeds with valid admin credentials', async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'admin', password: 'adminpass' },
            }),
            env
        );
        expect(res.status).toBe(200);
        const body = await res.json() as LoginBody;
        expect(body.ok).toBe(true);
        expect(body.role).toBe('admin');
        expect(getSessionCookie(res)).toBeTruthy();
    });

    it('succeeds with valid regular user credentials', async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'user', password: 'userpass' },
            }),
            env
        );
        expect(res.status).toBe(200);
        const body = await res.json() as LoginBody;
        expect(body.ok).toBe(true);
        expect(body.role).toBe('user');
        expect(getSessionCookie(res)).toBeTruthy();
    });

    it('fails with wrong password', async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'admin', password: 'wrongpass' },
            }),
            env
        );
        expect(res.status).toBe(401);
        const body = await res.json() as ErrorBody;
        expect(body.error).toBe('Invalid credentials');
    });

    it('fails with non-existent user', async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'nobody', password: 'whatever' },
            }),
            env
        );
        expect(res.status).toBe(401);
    });

    it('fails with missing username', async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', { body: { password: 'adminpass' } }),
            env
        );
        expect(res.status).toBe(400);
    });

    it('fails with missing password', async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', { body: { username: 'admin' } }),
            env
        );
        expect(res.status).toBe(400);
    });

    it('fails with empty body', async () => {
        const res = await workerFetch(req('POST', '/auth/login'), env);
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// 3. Signup — complete registration from an invitation
// ---------------------------------------------------------------------------

describe('Signup', () => {
    const VALID_INVITE_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6';
    const EXPIRED_INVITE_ID = 'deadbeef1111deadbeef2222';
    const EXPIRED_INVITE_ID2 = 'deadbeef3333deadbeef4444';

    beforeAll(async () => {
        const now = Math.floor(Date.now() / 1000);

        // Create a valid signup invitation (expires in 14 days)
        await db.prepare(
            `INSERT INTO signup_invitations (id, username, role, expires_at, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(VALID_INVITE_ID, 'newuser', 'user', now + 60 * 60 * 24 * 14).run();

        // Create an expired invitation (for validate test)
        await db.prepare(
            `INSERT INTO signup_invitations (id, username, role, expires_at, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(EXPIRED_INVITE_ID, 'expireduser', 'user', now - 60).run();

        // Create another expired invitation (for POST signup test)
        await db.prepare(
            `INSERT INTO signup_invitations (id, username, role, expires_at, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
        ).bind(EXPIRED_INVITE_ID2, 'expireduser2', 'user', now - 60).run();
    });

    // -------------------------------------------------------
    // Validate invitation endpoint
    // -------------------------------------------------------

    describe('GET /api/signup/validate', () => {
        it('returns username for a valid invitation', async () => {
            const res = await workerFetch(
                req('GET', `/api/signup/validate?id=${VALID_INVITE_ID}`),
                env
            );
            expect(res.status).toBe(200);
            const body = await res.json() as ValidateInviteBody;
            expect(body.username).toBe('newuser');
        });

        it('returns 410 for an expired invitation', async () => {
            const res = await workerFetch(
                req('GET', `/api/signup/validate?id=${EXPIRED_INVITE_ID}`),
                env
            );
            expect(res.status).toBe(410);
            const body = await res.json() as ErrorBody;
            expect(body.error).toContain('έχει λήξει');
        });

        it('returns 404 for a non-existent invitation', async () => {
            const res = await workerFetch(
                req('GET', '/api/signup/validate?id=nonexistent000000000000'),
                env
            );
            expect(res.status).toBe(404);
        });

        it('returns 400 when id is missing', async () => {
            const res = await workerFetch(
                req('GET', '/api/signup/validate'),
                env
            );
            expect(res.status).toBe(400);
        });
    });

    // -------------------------------------------------------
    // Signup endpoint
    // -------------------------------------------------------

    describe('POST /auth/signup', () => {
        it('completes signup with valid invitation and password', async () => {
            const res = await workerFetch(
                req('POST', '/auth/signup', {
                    body: { inviteId: VALID_INVITE_ID, password: 'newuserpass' },
                }),
                env
            );
            expect(res.status).toBe(201);
            const body = await res.json() as SignupBody;
            expect(body.ok).toBe(true);
            expect(body.username).toBe('newuser');
        });

        it('allows the new user to log in after signup', async () => {
            const res = await workerFetch(
                req('POST', '/auth/login', {
                    body: { username: 'newuser', password: 'newuserpass' },
                }),
                env
            );
            expect(res.status).toBe(200);
            const body = await res.json() as LoginBody;
            expect(body.ok).toBe(true);
            expect(body.role).toBe('user');
            expect(getSessionCookie(res)).toBeTruthy();
        });

        it('fails when invitation is already used', async () => {
            const res = await workerFetch(
                req('POST', '/auth/signup', {
                    body: { inviteId: VALID_INVITE_ID, password: 'anotherpass' },
                }),
                env
            );
            expect(res.status).toBe(404);
            const body = await res.json() as ErrorBody;
            expect(body.error).toContain('δεν βρέθηκε');
        });

        it('fails with expired invitation', async () => {
            const res = await workerFetch(
                req('POST', '/auth/signup', {
                    body: { inviteId: EXPIRED_INVITE_ID2, password: 'expiredpass' },
                }),
                env
            );
            expect(res.status).toBe(410);
            const body = await res.json() as ErrorBody;
            expect(body.error).toContain('έχει λήξει');
        });

        it('fails with non-existent invitation', async () => {
            const res = await workerFetch(
                req('POST', '/auth/signup', {
                    body: { inviteId: 'nonexistent000000000000', password: 'whatever' },
                }),
                env
            );
            expect(res.status).toBe(404);
        });

        it('fails with short password', async () => {
            const newInviteId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
            const now = Math.floor(Date.now() / 1000);
            await db.prepare(
                `INSERT INTO signup_invitations (id, username, role, expires_at, created_at)
                 VALUES (?, ?, ?, ?, datetime('now'))`
            ).bind(newInviteId, 'shortpwuser', 'user', now + 60 * 60 * 24 * 14).run();

            const res = await workerFetch(
                req('POST', '/auth/signup', {
                    body: { inviteId: newInviteId, password: '12345' },
                }),
                env
            );
            expect(res.status).toBe(400);
            const body = await res.json() as ErrorBody;
            expect(body.error).toContain('6 χαρακτήρες');
        });

        it('fails with missing inviteId', async () => {
            const res = await workerFetch(
                req('POST', '/auth/signup', { body: { password: 'whatever' } }),
                env
            );
            expect(res.status).toBe(400);
        });

        it('fails with missing password', async () => {
            const res = await workerFetch(
                req('POST', '/auth/signup', { body: { inviteId: VALID_INVITE_ID } }),
                env
            );
            expect(res.status).toBe(400);
        });

        it('fails with empty body', async () => {
            const res = await workerFetch(req('POST', '/auth/signup'), env);
            expect(res.status).toBe(400);
        });
    });
});

// ---------------------------------------------------------------------------
// 4. Logout
// ---------------------------------------------------------------------------

describe('Logout', () => {
    it('invalidates session after logout', async () => {
        const loginRes = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'admin', password: 'adminpass' },
            }),
            env
        );
        const cookie = getSessionCookie(loginRes)!;
        expect(cookie).toBeTruthy();

        // Verify session works
        const beforeRes = await workerFetch(req('GET', '/api/stats', { cookie }), env);
        expect(beforeRes.status).toBe(200);

        // Logout
        const logoutRes = await workerFetch(req('POST', '/auth/logout', { cookie }), env);
        expect(logoutRes.status).toBe(200);
        const logoutBody = await logoutRes.json() as LogoutBody;
        expect(logoutBody.ok).toBe(true);

        // Verify session no longer works
        const afterRes = await workerFetch(req('GET', '/api/stats', { cookie }), env);
        expect(afterRes.status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// 5. Regular user (role="user") — read allowed, write forbidden
// ---------------------------------------------------------------------------

describe('Regular user session', () => {
    let cookie: string;

    beforeAll(async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'user', password: 'userpass' },
            }),
            env
        );
        cookie = getSessionCookie(res)!;
    });

    it('can GET /api/records', async () => {
        const res = await workerFetch(req('GET', '/api/records', { cookie }), env);
        expect(res.status).toBe(200);
        const body = await res.json() as PhoneRecord[];
        expect(Array.isArray(body)).toBe(true);
    });

    it('can GET /api/stats', async () => {
        const res = await workerFetch(req('GET', '/api/stats', { cookie }), env);
        expect(res.status).toBe(200);
        const body = await res.json() as StatsBody;
        expect(typeof body.total).toBe('number');
    });

    it('can GET /api/records/hash', async () => {
        const res = await workerFetch(req('GET', '/api/records/hash', { cookie }), env);
        expect(res.status).toBe(200);
        const body = await res.json() as HashBody;
        expect(typeof body.hash).toBe('string');
    });

    it('is forbidden from POST /api/admin/create-user (403)', async () => {
        const res = await workerFetch(
            req('POST', '/api/admin/create-user', {
                cookie,
                body: { username: 'shouldfail', role: 'user' },
            }),
            env
        );
        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// 6. Admin user (role="admin") — read AND write allowed
// ---------------------------------------------------------------------------

describe('Admin user session', () => {
    let cookie: string;

    beforeAll(async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'admin', password: 'adminpass' },
            }),
            env
        );
        cookie = getSessionCookie(res)!;
    });

    it('can GET /api/records', async () => {
        const res = await workerFetch(req('GET', '/api/records', { cookie }), env);
        expect(res.status).toBe(200);
    });

    it('can GET /api/stats', async () => {
        const res = await workerFetch(req('GET', '/api/stats', { cookie }), env);
        expect(res.status).toBe(200);
    });

    it('can GET /api/records/hash', async () => {
        const res = await workerFetch(req('GET', '/api/records/hash', { cookie }), env);
        expect(res.status).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// 7. Admin write operations
// ---------------------------------------------------------------------------

describe('Admin write operations', () => {
    let adminCookie: string;

    beforeAll(async () => {
        const res = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'admin', password: 'adminpass' },
            }),
            env
        );
        adminCookie = getSessionCookie(res)!;
    });

    it('creates invitation for a new username', async () => {
        const res = await workerFetch(
            req('POST', '/api/admin/create-user', {
                cookie: adminCookie,
                body: { username: 'invited_user', role: 'user' },
            }),
            env
        );
        expect(res.status).toBe(201);
        const body = await res.json() as CreateUserBody;
        expect(typeof body.signupUrl).toBe('string');
        expect(body.signupUrl).toContain('/signup?id=');
        expect(typeof body.hexCode).toBe('string');
        expect(body.hexCode.length).toBe(24);
        expect(typeof body.expiresAt).toBe('number');

        // Verify the invitation exists in the database
        const row = await db.prepare(
            'SELECT username, role FROM signup_invitations WHERE id = ?'
        ).bind(body.hexCode).first<{ username: string; role: string; }>();
        expect(row).not.toBeNull();
        expect(row!.username).toBe('invited_user');
        expect(row!.role).toBe('user');
    });

    it('rejects creating invitation for an already registered username', async () => {
        const res = await workerFetch(
            req('POST', '/api/admin/create-user', {
                cookie: adminCookie,
                body: { username: 'admin', role: 'user' },
            }),
            env
        );
        expect(res.status).toBe(409);
        const body = await res.json() as ErrorBody;
        expect(body.error).toContain('ήδη');
    });

    it('rejects creating invitation with missing username', async () => {
        const res = await workerFetch(
            req('POST', '/api/admin/create-user', {
                cookie: adminCookie,
                body: { role: 'user' },
            }),
            env
        );
        expect(res.status).toBe(400);
    });

    it('rejects invitation with invalid role', async () => {
        const res = await workerFetch(
            req('POST', '/api/admin/create-user', {
                cookie: adminCookie,
                body: { username: 'someone', role: 'superadmin' },
            }),
            env
        );
        expect(res.status).toBe(400);
    });

    it('rejects invitation creation from a regular user (403)', async () => {
        const userLogin = await workerFetch(
            req('POST', '/auth/login', {
                body: { username: 'user', password: 'userpass' },
            }),
            env
        );
        const userCookie = getSessionCookie(userLogin)!;

        const res = await workerFetch(
            req('POST', '/api/admin/create-user', {
                cookie: userCookie,
                body: { username: 'hacker', role: 'user' },
            }),
            env
        );
        expect(res.status).toBe(403);
    });
});
