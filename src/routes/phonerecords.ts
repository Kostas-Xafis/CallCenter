import type { ApiRoute, ApiRouteParent, Env } from "@_types/types";
import { PhoneRepository } from "@src/phone_repository";
import { jsonSuccess, trycatch } from "./utils";

const phonerecordsRoute: ApiRoute = {
    url: '/records',
    method: 'GET',
    handler: (_: Request, env: Env) => {
        return trycatch(async () => {
            const repo = new PhoneRepository(env.DB);
            const records = await repo.getAll();
            return jsonSuccess(records);
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

            return jsonSuccess({
                total,
                uniqueTypes: types.length,
                types,
                statsByType
            });
        }, 'Error fetching statistics');
    }
};

const tableHashRoute: ApiRoute = {
    url: '/records/hash',
    method: 'GET',
    handler: (_: Request, env: Env) => {
        return trycatch(async () => {
            const repo = new PhoneRepository(env.DB);
            const hash = await repo.getTableHash();
            return jsonSuccess({ hash });
        }, 'Error fetching table hash');
    }
};

export const PhoneRecordRoutes: ApiRouteParent = {
    url: '',
    routes: [phonerecordsRoute, statsRoute, tableHashRoute]
};
