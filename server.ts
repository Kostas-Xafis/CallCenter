/**
 * NOTE: This file is for the **Node.js** branch (Hono + better-sqlite3).
 * On the Cloudflare Workers ('cf') branch, the server entry point is
 * `worker.ts` which uses the standard `export default { fetch }` pattern.
 *
 * See: worker.ts (CF entry point), wrangler.toml (CF config)
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { closeDb, getDb } from './db';
import { getSessionUser, handleLogin, handleLogout, handleSignup } from './src/auth';
import { routes } from './src/routes/index';
import type { Env, SessionUser } from './types/types';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = './public';
const DEV_LOG = process.env.LOG_REQUESTS === 'true';

// Paths that are accessible without a valid session
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/auth/login', '/signup', '/signup.html', '/auth/signup', '/api/signup/validate']);

// HTTP methods that require admin role for /api/* paths
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** MIME types for common static file extensions */
const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Static file helpers
// ---------------------------------------------------------------------------

function getMimeType(path: string): string {
    return MIME_TYPES[extname(path)] || 'application/octet-stream';
}

function fileExists(filePath: string): boolean {
    try { return statSync(filePath).isFile(); } catch { return false; }
}

function streamFile(filePath: string, mime: string, cacheControl = 'public, max-age=3600'): Promise<Response> {
    return new Promise((resolve) => {
        const stream = createReadStream(filePath);
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => { if (Buffer.isBuffer(chunk)) chunks.push(chunk); });
        stream.on('end', () => resolve(new Response(Buffer.concat(chunks), {
            headers: { 'Content-Type': mime, 'Cache-Control': cacheControl },
        })));
        stream.on('error', () => resolve(new Response('Not Found', { status: 404 })));
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logRequest(method: string, path: string, status: number, durationMs: number): void {
    if (!DEV_LOG) return;
    const ts = new Date().toISOString();
    const ms = durationMs.toFixed(1).padStart(7);
    const emoji = status < 400 ? '✅' : status < 500 ? '⚠️' : '❌';
    console.log(`[${ts}] ${emoji} ${method.padEnd(6)} ${status} ${ms}ms  ${path}`);
}

export function createEnv(dbPath?: string): Env {
    // @ts-ignore
    return { DB: getDb(dbPath) };
}

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono<{ Variables: { start: number; }; }>();

// CORS
app.use('*', cors());

// Per-request timing
app.use('*', async (c, next) => {
    c.set('start', performance.now());
    await next();
});

// Auth endpoints
app.post('/auth/login', async (c) => {
    const env = c.env as Env;
    return handleLogin(c.req.raw, env);
});

app.post('/auth/logout', async (c) => {
    const env = c.env as Env;
    return handleLogout(c.req.raw, env);
});

app.post('/auth/signup', async (c) => {
    const env = c.env as Env;
    return handleSignup(c.req.raw, env);
});

// Session guard for /api/* (skipping public paths)
app.use('/api/*', async (c, next) => {
    const path = c.req.path;
    if (PUBLIC_PATHS.has(path)) return next();

    const env = c.env as Env;
    let sessionUser: SessionUser | null = null;
    try {
        sessionUser = await getSessionUser(env.DB, c.req.raw);
    } catch (e) {
        console.error('Session validation error:', e);
    }

    if (!sessionUser) {
        return c.json({ error: 'Unauthorized' }, 401 as any);
    }

    // Role-based access control for write operations
    if (sessionUser.role !== 'admin' && WRITE_METHODS.has(c.req.method)) {
        return c.json({ error: 'Forbidden: admin access required' }, 403 as any);
    }

    return next();
});

// Register API routes from src/routes/index
for (const [key, handler] of routes) {
    const [method, path] = key.split(':') as [string, string];
    app.on(method as any, path!, async (c) => {
        const env = c.env as Env;
        return handler(c.req.raw, env);
    });
}

// Session guard for admin pages and non-public HTML
app.use('*', async (c, next) => {
    const path = c.req.path;
    if (PUBLIC_PATHS.has(path)) return next();
    if (path.startsWith('/api/')) return next();

    // Static non-HTML assets always served
    if (path.includes('.') && !path.endsWith('.html')) return next();

    const env = c.env as Env;
    let sessionUser: SessionUser | null = null;
    try {
        sessionUser = await getSessionUser(env.DB, c.req.raw);
    } catch (e) {
        console.error('Session validation error:', e);
    }

    if (!sessionUser) return c.redirect('/login');

    // Admin-only pages
    if ((path === '/admin' || path.startsWith('/admin/')) && sessionUser.role !== 'admin') {
        return c.redirect('/');
    }

    return next();
});

// Static file serving — catch-all
app.get('*', async (c) => {
    const path = c.req.path;
    const cacheControl = DEV_LOG ? 'no-cache' : 'public, max-age=3600';
    const safePath = path.replace(/\.\./g, '').replace(/\/\//g, '/');

    const filePath = safePath === '/' || safePath === ''
        ? `${PUBLIC_DIR}/index.html`
        : `${PUBLIC_DIR}${safePath}`;

    if (fileExists(filePath)) {
        return streamFile(filePath, getMimeType(filePath), cacheControl);
    }

    // Clean URL → .html mapping
    const cleanUrlMap: Record<string, string> = {
        '/login': `${PUBLIC_DIR}/login.html`,
        '/signup': `${PUBLIC_DIR}/signup.html`,
        '/admin': `${PUBLIC_DIR}/admin/index.html`,
    };
    const htmlFile = cleanUrlMap[path];
    if (htmlFile && fileExists(htmlFile)) {
        return streamFile(htmlFile, 'text/html; charset=utf-8');
    }

    // SPA fallback
    const indexPath = `${PUBLIC_DIR}/index.html`;
    if (fileExists(indexPath)) {
        return streamFile(indexPath, 'text/html; charset=utf-8');
    }

    return c.notFound();
});

// Export the fetch handler for tests
export const appFetch = app.fetch;

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const env = createEnv();

serve({
    fetch: async (request) => {
        const start = performance.now();
        const response = await app.fetch(request, env);
        const url = new URL(request.url);
        logRequest(request.method, url.pathname, response.status, performance.now() - start);
        return response;
    },
    port: PORT,
});

console.log(`🚀 CallCenter server running at http://localhost:${PORT}`);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    closeDb();
    process.exit(0);
});
process.on('SIGTERM', () => {
    closeDb();
    process.exit(0);
});
