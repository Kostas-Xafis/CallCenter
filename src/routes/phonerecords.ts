import type { ApiRoute, ApiRouteParent, Env } from "@_types/types";
import { PhoneRepository } from "@src/phone_repository";
import { trycatch } from "./utils";

const phonerecordsRoute: ApiRoute = {
    url: '/records',
    method: 'GET',
    handler: (_: Request, env: Env) => {
        return trycatch(async () => {
            const repo = new PhoneRepository(env.DB);
            const records = await repo.getAll();
            return new Response(JSON.stringify(records), {
                headers: { 'Content-Type': 'application/json' }
            });
        }, 'Error fetching phone records');
    }
};

const statsRoute: ApiRoute = {
    url: '/stats',
    method: 'GET',
    handler: (_: Request, env: Env) => {
        return trycatch(async () => {
            const repo = new PhoneRepository(env.DB);
            const total = await repo.getCount();
            const types = await repo.getUniqueTypes();
            const statsByType = await repo.getStatsByType();

            return new Response(JSON.stringify({
                total,
                uniqueTypes: types.length,
                types,
                statsByType
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }, 'Error fetching statistics');
    }
};

const fuzzySearchRoute: ApiRoute = {
    url: '/search',
    method: 'GET',
    handler: (request: Request, env: Env) => {
        return trycatch(async () => {
            const url = new URL(request.url);
            const query = url.searchParams.get('q') || '';
            const threshold = parseFloat(url.searchParams.get('threshold') ?? '0.4');
            const repo = new PhoneRepository(env.DB);
            const results = await repo.fuzzySearch(query, { threshold });

            return new Response(JSON.stringify(results), {
                headers: { 'Content-Type': 'application/json' }
            });
        }, 'Error performing fuzzy search');
    }
};

const byTypeRoute: ApiRoute = {
    url: '/records/type',
    method: 'GET',
    handler: (request: Request, env: Env) => {
        return trycatch(async () => {
            const url = new URL(request.url);
            const type = url.searchParams.get('type') || '';
            const repo = new PhoneRepository(env.DB);
            const results = await repo.getByType(type);

            return new Response(JSON.stringify(results), {
                headers: { 'Content-Type': 'application/json' }
            });
        }, 'Error fetching records by type');
    }
};

const getLatestRoute: ApiRoute = {
    url: '/latest',
    method: 'GET',
    handler: (_: Request, env: Env) => {
        return trycatch(async () => {
            const repo = new PhoneRepository(env.DB);
            const latest = await repo.getLatest();
            return new Response(JSON.stringify(latest), {
                headers: { 'Content-Type': 'application/json' }
            });
        }, 'Error fetching latest records');
    }
};

const trackLatestRoute: ApiRoute = {
    url: '/latest',
    method: 'POST',
    handler: (request: Request, env: Env) => {
        return trycatch(async () => {
            const { type, service, code } = await request.json<{ type: string; service: string; code: string }>();
            const repo = new PhoneRepository(env.DB);
            await repo.trackLatest(type, service, code);
            return new Response(null, { status: 204 });
        }, 'Error tracking latest record');
    }
};

const deleteLatestRoute: ApiRoute = {
    url: '/latest',
    method: 'DELETE',
    handler: (request: Request, env: Env) => {
        return trycatch(async () => {
            const { type, service, code } = await request.json<{ type: string; service: string; code: string }>();
            const repo = new PhoneRepository(env.DB);
            await repo.deleteLatest(type, service, code);
            return new Response(null, { status: 204 });
        }, 'Error deleting latest record');
    }
};

export const PhoneRecordRoutes: ApiRouteParent = {
    url: '',
    routes: [phonerecordsRoute, statsRoute, fuzzySearchRoute, byTypeRoute, getLatestRoute, trackLatestRoute, deleteLatestRoute]
};
