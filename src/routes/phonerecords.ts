import type { ApiRoute, ApiRouteParent } from "@_types/types";
import { PhoneRepository } from "@src/phone_repository";
import { trycatch } from "./utils";

const phonerecordsRoute: ApiRoute = {
    url: '/records',
    method: 'GET',
    handler: (_: Request) => {
        return trycatch(async () => {
            const headers = { 'Access-Control-Allow-Origin': '*' };
            const repo = new PhoneRepository();
            const records = await repo.getAll();

            return new Response(JSON.stringify(records), {
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }, 'Error fetching phone records');
    }
};

const statsRoute: ApiRoute = {
    url: '/stats',
    method: 'GET',
    handler: (_: Request) => {
        return trycatch(async () => {
            const headers = { 'Access-Control-Allow-Origin': '*' };
            const repo = new PhoneRepository();
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
        }, 'Error fetching statistics');
    }
};

const fuzzySearchRoute: ApiRoute = {
    url: '/search',
    method: 'GET',
    handler: (request: Request) => {
        return trycatch(async () => {
            const headers = { 'Access-Control-Allow-Origin': '*' };
            const url = new URL(request.url);
            const query = url.searchParams.get('q') || '';
            const repo = new PhoneRepository();
            const results = await repo.fuzzySearch(query);

            return new Response(JSON.stringify(results), {
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }, 'Error performing fuzzy search');
    }
};

const byTypeRoute: ApiRoute = {
    url: '/records/type',
    method: 'GET',
    handler: (request: Request) => {
        return trycatch(async () => {
            const headers = { 'Access-Control-Allow-Origin': '*' };
            const url = new URL(request.url);
            const type = url.searchParams.get('type') || '';
            const repo = new PhoneRepository();
            const results = await repo.getByType(type);

            return new Response(JSON.stringify(results), {
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }, 'Error fetching records by type');
    }
};

const byServiceRoute: ApiRoute = {
    url: '/records/service',
    method: 'GET',
    handler: (request: Request) => {
        return trycatch(async () => {
            const headers = { 'Access-Control-Allow-Origin': '*' };
            const url = new URL(request.url);
            const service = url.searchParams.get('service') || '';
            const repo = new PhoneRepository();
            const results = await repo.getByService(service);

            return new Response(JSON.stringify(results), {
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }, 'Error fetching records by service');
    }
};

export const PhoneRecordRoutes: ApiRouteParent = {
    url: '',
    routes: [phonerecordsRoute, statsRoute, fuzzySearchRoute, byTypeRoute, byServiceRoute]
};
