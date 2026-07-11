import type { ApiRoute } from "@_types/types";

/**
 * Return a JSON error response with the given message and HTTP status.
 * Defaults to 400 (Bad Request). CORS headers are included automatically.
 */
export function jsonError(message: string, status: number = 400): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
    });
}

/**
 * Return a JSON success response with the given body and HTTP status.
 * Defaults to 200 (OK). CORS headers are included automatically.
 * The body can be any JSON-serializable value (object, array, etc.).
 */
export function jsonSuccess(body: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
    });
}

/** Convert a Uint8Array to a lowercase hex string. */
export function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

export const trycatch = async (fn: () => Promise<Response>, errorMsg: string) => {
    try {
        return await fn();
    } catch (error) {
        console.error(errorMsg, error);
        return jsonError("Internal Server Error", 500);
    }
};

export const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

export const handleCors = (request: Request) => {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers });
    }

    return null;
};

export const requestUrlToString = (request: Request | ApiRoute) => {
    try {
        if (request.url.startsWith('/')) {
            return `${request.method}:${request.url}`;
        }

        const url = new URL(request.url);
        return `${request.method}:${url.pathname}`;
    } catch (error) {
        console.error('Error parsing request URL:', error);
        return null;
    }
};
