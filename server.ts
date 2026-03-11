import { routes } from '@src/routes/index.js';
import { handleCors, headers } from '@src/routes/utils.js';

const PORT = 3000;
const Routes = routes;

// Simple HTTP server using Bun
Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;

        // Handle CORS preflight requests
        const preflightRes = handleCors(req);
        if (preflightRes) {
            return preflightRes;
        }

        try {
            // Serve the frontend HTML
            if (path === '/' || path === '/index.html') {
                const html = await Bun.file('./public/index.html').text();
                return new Response(html, {
                    headers: { ...headers, 'Content-Type': 'text/html' }
                });
            }

            // Match API routes
            const routeKey = `${req.method}:${path}`;
            const handler = Routes.get(routeKey);
            if (handler) {
                return await handler(req);
            }

            // 404 Not Found
            return new Response('Not Found', {
                status: 404,
                headers
            });

        } catch (error) {
            console.error('Error:', error);
            return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
                status: 500,
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }
    }
});

console.log(`🚀 Server running at http://localhost:${PORT}`);
console.log(`📱 Phone Records API ready!`);
console.log(`\nAvailable endpoints:`);
console.log(`  GET  /                        - Frontend interface`);
console.log(`  GET  /api/records             - Get all records`);
console.log(`  GET  /api/stats               - Get statistics`);
console.log(`  GET  /api/search?q=<query>    - Fuzzy search`);
console.log(`  GET  /api/records/type?type=  - Filter by type`);
console.log(`  GET  /api/records/service?service= - Filter by service`);
