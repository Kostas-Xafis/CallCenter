import type { ApiRoute } from "@_types/types";

export const trycatch = async (fn: () => Promise<Response>, errorMsg: any) => {
    try {
        return await fn();
    } catch (error) {
        console.error(errorMsg, error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, UPDATE, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

export const handleCors = (request: Request) => {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers });
    }

    return null;
};

export const parseJsonBody = async (request: Request) => {
    try {
        const bodyText = await request.text();
        return JSON.parse(bodyText);
    } catch (error) {
        console.error('Error parsing JSON body:', error);
        return null;
    }
};

export const requestUrlToString = (request: Request | ApiRoute) => {
    try {
        const url = new URL(request.url);
        return `${request.method}:${url.pathname}`;
    } catch (error) {
        console.error('Error parsing request URL:', error);
        return null;
    }
};