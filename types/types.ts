export type ApiRoute = {
    url: string;
    method: string;
    handler: (request: Request) => Promise<Response>;
};

export type ApiRouteParent = {
    url: string;
    routes: ApiRoute[];
};