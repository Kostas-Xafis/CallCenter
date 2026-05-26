import { PhoneRecordRoutes } from "./phonerecords";
import { requestUrlToString } from "./utils";
import type { Env } from "@_types/types";

const allRoutes = [PhoneRecordRoutes].map(pRoute => {
    const baseUrl = '/api' + pRoute.url;
    return pRoute.routes.map(route => ({
        url: baseUrl + route.url,
        method: route.method,
        handler: route.handler
    }));
}).flat();

export const routes = new Map(
    allRoutes.map(route => [requestUrlToString(route), route.handler])
) as Map<string, (req: Request, env: Env) => Promise<Response>>;
