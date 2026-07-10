import type { Database } from 'bun:sqlite';

export type UserRole = 'admin' | 'user';

export type Env = {
    DB: Database;
};

export type SessionUser = {
    sessionId: string;
    username: string;
    role: UserRole;
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
