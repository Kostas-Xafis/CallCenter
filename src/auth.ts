import type { Env, SessionUser, UserRole } from '@_types/types';
import type { Database } from 'bun:sqlite';

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days in seconds

// ---------------------------------------------------------------------------
// Password hashing — PBKDF2 / SHA-256 via the Web Crypto API
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

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
        new TextEncoder().encode(password) as BufferSource,
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 100_000 },
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

export async function validateSession(db: Database, sessionId: string): Promise<SessionUser | null> {
    const now = Math.floor(Date.now() / 1000);
    const row = db.query(
        'SELECT id, username, role FROM sessions WHERE id = ? AND expires_at > ?'
    ).get(sessionId, now) as { id: string; username: string; role: UserRole; } | null;
    if (!row) return null;
    return { sessionId: row.id, username: row.username, role: row.role };
}

/** Convenience: extract session user from a Request. */
export function getSessionUser(db: Database, request: Request): Promise<SessionUser | null> {
    const sessionId = getSessionCookie(request);
    if (!sessionId) return Promise.resolve(null);
    return validateSession(db, sessionId);
}

async function createSession(db: Database, username: string): Promise<string> {
    // Fetch the user's role
    const user = db.query('SELECT role FROM users WHERE username = ?').get(username) as { role: UserRole; } | null;
    const role = user?.role ?? 'user';

    const id = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
    // Prune stale sessions opportunistically
    db.query('DELETE FROM sessions WHERE expires_at < ?').run(
        Math.floor(Date.now() / 1000)
    );
    db.query(
        'INSERT INTO sessions (id, username, role, expires_at) VALUES (?, ?, ?, ?)'
    ).run(id, username, role, expiresAt);
    return id;
}

async function deleteSession(db: Database, sessionId: string): Promise<void> {
    db.query('DELETE FROM sessions WHERE id = ?').run(sessionId);
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
        return jsonResponse({ error: 'Invalid request body' }, 400);
    }

    const { username, password } = body as { username?: string; password?: string; };
    if (!username || !password) {
        return jsonResponse({ error: 'Username and password are required' }, 400);
    }

    const user = env.DB.query(
        'SELECT password_hash, salt, role FROM users WHERE username = ?'
    ).get(username) as { password_hash: string; salt: string; role: UserRole; } | null;

    if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
        return jsonResponse({ error: 'Invalid credentials' }, 401);
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

function jsonResponse(body: object, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
