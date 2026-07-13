import { closeDb, getDb } from './db';
import { getSessionUser, handleLogin, handleLogout, handleSignup } from './src/auth';
import { routes } from './src/routes/index';
import { handleCors, jsonError } from './src/routes/utils';
import type { Env, SessionUser } from './types/types';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = './public';
const DEV_LOG = process.env.LOG_REQUESTS === 'true';

// Paths that are accessible without a valid session
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/auth/login', '/signup', '/signup.html', '/auth/signup', '/api/signup/validate']);

// HTTP methods that require admin role for /api/* paths
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// MIME types for common static file extensions
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

function getMimeType(path: string): string {
    const ext = path.slice(path.lastIndexOf('.'));
    return MIME_TYPES[ext] || 'application/octet-stream';
}

/** Try to serve an HTML file at the given path. Returns null if not found. */
async function serveHtml(filePath: string): Promise<Response | null> {
    const file = Bun.file(filePath);
    if (await file.exists()) {
        return new Response(file, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }
    return null;
}

/** Serve a static file from the public directory. Returns null if not found. */
async function serveStatic(path: string): Promise<Response | null> {
    // Prevent directory traversal
    const safePath = path.replace(/\.\./g, '').replace(/\/\//g, '/');
    const filePath = safePath === '/' || safePath === ''
        ? `${PUBLIC_DIR}/index.html`
        : `${PUBLIC_DIR}${safePath}`;

    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) return null;

    return new Response(file, {
        headers: {
            'Content-Type': getMimeType(filePath),
            // In dev mode, disable caching so changes appear immediately on reload.
            // In production, cache static assets for 1 hour.
            'Cache-Control': DEV_LOG ? 'no-cache' : 'public, max-age=3600',
        },
    });
}

/** Return a 302 redirect Response to the given location. */
function redirect(location: string): Response {
    return new Response(null, { status: 302, headers: { Location: location } });
}

/** Log a request and its outcome when dev logging is enabled. */
function logRequest(method: string, path: string, status: number, durationMs: number): void {
    if (!DEV_LOG) return;
    const ts = new Date().toISOString();
    const ms = durationMs.toFixed(1).padStart(7);
    const emoji = status < 400 ? '✅' : status < 500 ? '⚠️' : '❌';
    console.log(`[${ts}] ${emoji} ${method.padEnd(6)} ${status} ${ms}ms  ${path}`);
}

/** Create the Env object. Accepts optional DB path for testing. */
export function createEnv(dbPath?: string): Env {
    return { DB: getDb(dbPath) };
}

/** The application fetch handler — exported so tests can call it directly. */
export async function appFetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    const preflightRes = handleCors(request);
    if (preflightRes) return preflightRes;

    // Auth endpoints (no session required)
    const AUTH_HANDLERS: Record<string, (req: Request, env: Env) => Promise<Response>> = {
        '/auth/login': handleLogin,
        '/auth/logout': handleLogout,
        '/auth/signup': handleSignup,
    };
    const authHandler = AUTH_HANDLERS[path];
    if (authHandler && request.method === 'POST') {
        return authHandler(request, env);
    }

    // Session guard — skip only for the login page itself
    if (!PUBLIC_PATHS.has(path)) {
        // Static non-HTML assets (icons, manifest, JS, CSS, etc.) are
        // always served — the login page needs them to render properly.
        const isStaticAsset = await Bun.file(`${PUBLIC_DIR}${path}`).exists();
        if (isStaticAsset && !path.endsWith('.html')) {
            const staticResponse = await serveStatic(path);
            if (staticResponse) return staticResponse;
        }

        let sessionUser: SessionUser | null = null;
        try {
            sessionUser = await getSessionUser(env.DB, request);
        } catch (e) {
            console.error('Session validation error:', e);
        }

        if (!sessionUser) {
            // API callers get a clean 401; everything else gets redirected to /login
            if (path.startsWith('/api/')) {
                return jsonError('Unauthorized', 401);
            }
            return redirect('/login');
        }

        // Role-based access control for write operations
        if (path.startsWith('/api/') && sessionUser.role !== 'admin') {
            if (WRITE_METHODS.has(request.method)) {
                return jsonError('Forbidden: admin access required', 403);
            }
        }

        // Admin-only pages — non-admin users are redirected to /
        if ((path === '/admin' || path.startsWith('/admin/')) && sessionUser.role !== 'admin') {
            return redirect('/');
        }
    }

    try {
        // API routes
        if (path.startsWith('/api/')) {
            const routeKey = `${request.method}:${path}`;
            const handler = routes.get(routeKey);
            if (handler) {
                return await handler(request, env);
            }
            return jsonError('API route not found', 404);
        }

        // Serve static assets
        const staticResponse = await serveStatic(path);
        if (staticResponse) return staticResponse;

        // Map clean URLs to .html files
        const cleanUrlMap: Record<string, string> = {
            '/login': `${PUBLIC_DIR}/login.html`,
            '/signup': `${PUBLIC_DIR}/signup.html`,
            '/admin': `${PUBLIC_DIR}/admin/index.html`,
        };
        const htmlFile = cleanUrlMap[path];
        if (htmlFile) {
            const response = await serveHtml(htmlFile);
            if (response) return response;
        }

        // Fallback to index.html for SPA-style routing
        const indexResponse = await serveHtml(`${PUBLIC_DIR}/index.html`);
        if (indexResponse) return indexResponse;

        return new Response('Not Found', { status: 404 });

    } catch (error) {
        console.error('Server error:', error);
        return jsonError('Internal Server Error', 500);
    }
}

// Build the env object once at startup
const env = createEnv();

const server = Bun.serve({
    port: PORT,
    fetch: (request: Request) => {
        const start = performance.now();
        const url = new URL(request.url);
        return appFetch(request, env)
            .then(response => {
                logRequest(request.method, url.pathname, response.status, performance.now() - start);
                return response;
            })
            .catch(error => {
                logRequest(request.method, url.pathname, 500, performance.now() - start);
                throw error;
            });
    },
});

console.log(`🚀 CallCenter server running at http://localhost:${server.port}`);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    closeDb();
    server.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeDb();
    server.stop();
    process.exit(0);
});
