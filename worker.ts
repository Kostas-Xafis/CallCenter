import { getSessionUser, handleLogin, handleLogout, handleSignup } from './src/auth';
import { routes } from './src/routes/index';
import { handleCors, headers } from './src/routes/utils';
import type { Env } from './types/types';

// Paths that are accessible without a valid session
const PUBLIC_PATHS = new Set([
    '/login', '/login.html', '/auth/login',
    '/signup', '/signup.html', '/auth/signup',
    '/api/signup/validate',
]);

// HTTP methods that require admin role for /api/* paths
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // Handle CORS preflight
        const preflightRes = handleCors(request);
        if (preflightRes) return preflightRes;

        // ------------------------------------------------------------------
        // Auth endpoints (no session required)
        // ------------------------------------------------------------------

        if (path === '/auth/login' && request.method === 'POST') {
            return handleLogin(request, env);
        }
        if (path === '/auth/logout' && request.method === 'POST') {
            return handleLogout(request, env);
        }
        if (path === '/auth/signup' && request.method === 'POST') {
            return handleSignup(request, env);
        }

        // ------------------------------------------------------------------
        // API routes — session guard with role-based access control
        // ------------------------------------------------------------------

        if (path.startsWith('/api/')) {
            if (!PUBLIC_PATHS.has(path)) {
                let sessionUser = null;
                try {
                    sessionUser = await getSessionUser(env.DB, request);
                } catch (e) {
                    console.error('Session validation error:', e);
                }

                if (!sessionUser) {
                    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                        status: 401,
                        headers: { ...headers, 'Content-Type': 'application/json' },
                    });
                }

                // Role-based access control for write operations
                if (sessionUser.role !== 'admin' && WRITE_METHODS.has(request.method)) {
                    return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
                        status: 403,
                        headers: { ...headers, 'Content-Type': 'application/json' },
                    });
                }
            }

            // Dispatch to the appropriate route handler
            const routeKey = `${request.method}:${path}`;
            const handler = routes.get(routeKey);
            if (handler) {
                try {
                    return await handler(request, env);
                } catch (error) {
                    console.error('Worker error:', error);
                    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
                        status: 500,
                        headers: { ...headers, 'Content-Type': 'application/json' },
                    });
                }
            }

            return new Response(JSON.stringify({ error: 'API route not found' }), {
                status: 404,
                headers: { ...headers, 'Content-Type': 'application/json' },
            });
        }

        // ------------------------------------------------------------------
        // Session guard for HTML pages (skip public paths and static assets)
        // ------------------------------------------------------------------

        if (!PUBLIC_PATHS.has(path)) {
            // Static non-HTML assets (CSS, JS, images, etc.) are always served
            const isStaticAsset = path.includes('.') && !path.endsWith('.html');

            if (!isStaticAsset) {
                let sessionUser = null;
                try {
                    sessionUser = await getSessionUser(env.DB, request);
                } catch (e) {
                    console.error('Session validation error:', e);
                }

                if (!sessionUser) {
                    return new Response(null, {
                        status: 302,
                        headers: { Location: '/login' },
                    });
                }

                // Admin-only pages
                if ((path === '/admin' || path.startsWith('/admin/')) && sessionUser.role !== 'admin') {
                    return new Response(null, {
                        status: 302,
                        headers: { Location: '/' },
                    });
                }
            }
        }

        // ------------------------------------------------------------------
        // Serve static assets via Cloudflare Pages Assets
        // ------------------------------------------------------------------

        return env.ASSETS.fetch(request);
    },
};
