import type { Env } from "@_types/types";
import { AdminRoutes } from "./admin";
import { PhoneRecordRoutes } from "./phonerecords";
import { SignupRoutes } from "./signup";
import { requestUrlToString } from "./utils";

const allRoutes = [PhoneRecordRoutes, AdminRoutes, SignupRoutes].map(pRoute => {
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
