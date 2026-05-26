import { routes } from './src/routes/index';
import { handleCors, headers } from './src/routes/utils';
import type { Env } from './types/types';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // Handle CORS preflight
        const preflightRes = handleCors(request);
        if (preflightRes) return preflightRes;

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
