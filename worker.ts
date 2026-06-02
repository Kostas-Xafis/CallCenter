import { routes } from './src/routes/index';
import { handleCors, headers } from './src/routes/utils';
import { handleLogin, handleLogout, getSessionCookie, validateSession } from './src/auth';
import type { Env } from './types/types';

// Paths that are accessible without a valid session
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/auth/login']);

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // Handle CORS preflight
        const preflightRes = handleCors(request);
        if (preflightRes) return preflightRes;

        // Auth endpoints (no session required)
        if (path === '/auth/login' && request.method === 'POST') {
            return handleLogin(request, env);
        }
        if (path === '/auth/logout' && request.method === 'POST') {
            return handleLogout(request, env);
        }

        // Session guard — skip only for the login page itself
        if (!PUBLIC_PATHS.has(path)) {
            let authenticated = false;
            try {
                const sessionId = getSessionCookie(request);
                authenticated = sessionId ? await validateSession(env.DB, sessionId) : false;
            } catch (e) {
                // DB not ready (e.g. migration not yet applied) — treat as unauthenticated
                console.error('Session validation error:', e);
            }

            if (!authenticated) {
                // API callers get a clean 401; everything else gets redirected to /login
                if (path.startsWith('/api/')) {
                    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                        status: 401,
                        headers: { ...headers, 'Content-Type': 'application/json' },
                    });
                }
                return new Response(null, {
                    status: 302,
                    headers: { Location: '/login' },
                });
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
                return new Response(JSON.stringify({ error: 'API route not found' }), {
                    status: 404,
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }

            // Serve static assets (index.html, login.html, etc.)
            return env.ASSETS.fetch(request);

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
                status: 500,
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }
    }
};
