import type { Env, SessionUser, UserRole } from '@_types/types';
import { jsonError, jsonSuccess, toHex } from './routes/utils';

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days in seconds

// ---------------------------------------------------------------------------
// Password hashing — PBKDF2 / SHA-256 via the Web Crypto API
// ---------------------------------------------------------------------------

function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<string> {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: 100_000 },
        keyMaterial,
        256
    );
    return toHex(new Uint8Array(hashBuffer));
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string; }> {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const hash = await deriveKey(password, saltBytes);
    return { hash, salt: toHex(saltBytes) };
}

export async function verifyPassword(
    password: string,
    salt: string,
    expectedHash: string
): Promise<boolean> {
    const hash = await deriveKey(password, fromHex(salt));
    return hash === expectedHash;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export function getSessionCookie(request: Request): string | null {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name?.trim() === SESSION_COOKIE) return rest.join('=').trim();
    }
    return null;
}

export async function validateSession(db: D1Database, sessionId: string): Promise<SessionUser | null> {
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare(
        'SELECT id, username, role FROM sessions WHERE id = ? AND expires_at > ?'
    ).bind(sessionId, now).first<{ id: string; username: string; role: UserRole; }>();
    if (!row) return null;
    return { sessionId: row.id, username: row.username, role: row.role };
}

/** Convenience: extract session user from a Request. */
export async function getSessionUser(db: D1Database, request: Request): Promise<SessionUser | null> {
    const sessionId = getSessionCookie(request);
    if (!sessionId) return null;
    return validateSession(db, sessionId);
}

async function createSession(db: D1Database, username: string): Promise<string> {
    // Fetch the user's role
    const user = await db.prepare('SELECT role FROM users WHERE username = ?')
        .bind(username)
        .first<{ role: UserRole; }>();
    const role = user?.role ?? 'user';

    const id = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
    // Prune stale sessions opportunistically
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?')
        .bind(Math.floor(Date.now() / 1000))
        .run();
    await db.prepare(
        'INSERT INTO sessions (id, username, role, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(id, username, role, expiresAt).run();
    return id;
}

async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

function sessionCookieHeader(value: string, maxAge: number): string {
    return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

export async function handleLogin(request: Request, env: Env): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError('Invalid request body');
    }

    const { username, password } = body as { username?: string; password?: string; };
    if (!username || !password) {
        return jsonError('Username and password are required');
    }

    const user = await env.DB.prepare(
        'SELECT password_hash, salt, role FROM users WHERE username = ?'
    ).bind(username).first<{ password_hash: string; salt: string; role: UserRole; }>();

    if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
        return jsonError('Invalid credentials', 401);
    }

    const sessionId = await createSession(env.DB, username);
    return new Response(JSON.stringify({ ok: true, role: user.role }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': sessionCookieHeader(sessionId, SESSION_MAX_AGE),
        },
    });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
    const sessionId = getSessionCookie(request);
    if (sessionId) await deleteSession(env.DB, sessionId);
    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': sessionCookieHeader('', 0),
        },
    });
}

// ---------------------------------------------------------------------------
// Signup — complete registration from an invitation
// ---------------------------------------------------------------------------

export async function handleSignup(request: Request, env: Env): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError('Invalid request body');
    }

    const { inviteId, password } = body as { inviteId?: string; password?: string; };

    if (!inviteId || !password) {
        return jsonError('Κωδικός πρόσκλησης και κωδικός χρήστη είναι υποχρεωτικά.');
    }

    if (password.length < 6) {
        return jsonError('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες.');
    }

    // Look up the invitation
    const now = Math.floor(Date.now() / 1000);
    const invite = await env.DB.prepare(
        'SELECT id, username, role, expires_at FROM signup_invitations WHERE id = ?'
    ).bind(inviteId).first<{ id: string; username: string; role: UserRole; expires_at: number; }>();

    if (!invite) {
        return jsonError('Η πρόσκληση δεν βρέθηκε.', 404);
    }

    if (invite.expires_at < now) {
        // Clean up expired invitation
        await env.DB.prepare('DELETE FROM signup_invitations WHERE id = ?').bind(inviteId).run();
        return jsonError('Η πρόσκληση έχει λήξει.', 410);
    }

    // Check if the username is already taken (shouldn't happen, but safety first)
    const existingUser = await env.DB.prepare(
        'SELECT username FROM users WHERE username = ?'
    ).bind(invite.username).first<{ username: string; }>();

    if (existingUser) {
        await env.DB.prepare('DELETE FROM signup_invitations WHERE id = ?').bind(inviteId).run();
        return jsonError('Υπάρχει ήδη καταχωρημένος χρήστης με αυτό το όνομα.', 409);
    }

    // Hash the password and create the user
    const { hash, salt } = await hashPassword(password);

    await env.DB.prepare(
        'INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)'
    ).bind(invite.username, hash, salt, invite.role).run();

    // Delete the used invitation
    await env.DB.prepare('DELETE FROM signup_invitations WHERE id = ?').bind(inviteId).run();

    return jsonSuccess({ ok: true, username: invite.username }, 201);
}
