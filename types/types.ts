export type Env = {
    DB: D1Database;
    ASSETS: Fetcher;
};

export type ApiRoute = {
    url: string;
    method: string;
    handler: (request: Request, env: Env) => Promise<Response>;
};

export type ApiRouteParent = {
    url: string;
    routes: ApiRoute[];
};
