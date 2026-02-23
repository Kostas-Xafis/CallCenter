import { PhoneRepository } from './phone_repository.js';

const repo = new PhoneRepository();
const PORT = 3000;

// Simple HTTP server using Bun
const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;

        // CORS headers
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle OPTIONS preflight
        if (req.method === 'OPTIONS') {
            return new Response(null, { headers });
        }

        try {
            // Serve the frontend HTML
            if (path === '/' || path === '/index.html') {
                const html = await Bun.file('./public/index.html').text();
                return new Response(html, {
                    headers: { ...headers, 'Content-Type': 'text/html' }
                });
            }

            // API: Get all phone records
            if (path === '/api/records') {
                const records = await repo.getAll();
                return new Response(JSON.stringify(records), {
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }

            // API: Get statistics
            if (path === '/api/stats') {
                const total = await repo.getCount();
                const types = await repo.getUniqueTypes();
                const services = await repo.getUniqueServices();
                const statsByType = await repo.getStatsByType();

                return new Response(JSON.stringify({
                    total,
                    uniqueTypes: types.length,
                    uniqueServices: services.length,
                    types,
                    services,
                    statsByType
                }), {
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }

            // API: Fuzzy search
            if (path === '/api/search') {
                const query = url.searchParams.get('q');
                const threshold = url.searchParams.get('threshold');
                const limit = url.searchParams.get('limit');

                if (!query) {
                    return new Response(JSON.stringify({ error: 'Query parameter "q" is required' }), {
                        status: 400,
                        headers: { ...headers, 'Content-Type': 'application/json' }
                    });
                }

                const results = await repo.fuzzySearch(query, {
                    threshold: threshold ? parseFloat(threshold) : undefined,
                    limit: limit ? parseInt(limit) : undefined
                });
                console.log(`Fuzzy search for "${query}" returned ${results.length} results`);
                console.log('Results:', results);
                return new Response(JSON.stringify(results), {
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }

            // API: Get by type
            if (path === '/api/records/type') {
                const type = url.searchParams.get('type');
                if (!type) {
                    return new Response(JSON.stringify({ error: 'Type parameter is required' }), {
                        status: 400,
                        headers: { ...headers, 'Content-Type': 'application/json' }
                    });
                }

                const records = await repo.getByType(type);
                return new Response(JSON.stringify(records), {
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }

            // API: Get by service
            if (path === '/api/records/service') {
                const service = url.searchParams.get('service');
                if (!service) {
                    return new Response(JSON.stringify({ error: 'Service parameter is required' }), {
                        status: 400,
                        headers: { ...headers, 'Content-Type': 'application/json' }
                    });
                }

                const records = await repo.getByService(service);
                return new Response(JSON.stringify(records), {
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
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
