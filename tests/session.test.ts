/**
 * Session & Role-Based Access Control Tests
 *
 * Covers the full user lifecycle:
 *   login → read (GET endpoints) → write (POST/DELETE endpoints) → logout
 *
 * Validates that:
 *   - Unauthenticated users are blocked (401)
 *   - Authenticated regular users can read but NOT write (403 on write ops)
 *   - Authenticated admin users can read AND write
 *   - Logout invalidates the session
 *   - Invalid credentials are rejected
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "fs";
import { appFetch, createEnv } from "../server";
import { hashPassword } from "../src/auth";
import type { LatestRecord, PhoneRecord } from "../src/phone_repository";
import type { Env, UserRole } from "../types/types";

// ---------------------------------------------------------------------------
// Response type helpers — narrow the `unknown` returned by Response.json()
// ---------------------------------------------------------------------------

type ErrorBody = { error: string; };
type LoginBody = { ok: true; role: UserRole; };
type LogoutBody = { ok: true; };
type StatsBody = { total: number; uniqueTypes: number; types: string[]; statsByType: { type: string; count: number; }[]; };
type HashBody = { hash: string; };

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const TEST_DB_PATH = "sqlite/test-callcenter.db";
const TEST_PORT = 0; // not used — we call appFetch directly

/** Clean up any leftover test database from a previous run. */
function removeTestDb() {
    try { unlinkSync(TEST_DB_PATH); } catch { /* doesn't exist */ }
    try { unlinkSync(TEST_DB_PATH + "-wal"); } catch { /* */ }
    try { unlinkSync(TEST_DB_PATH + "-shm"); } catch { /* */ }
}

let env: Env;
let db: Database;

/** Extract the session cookie from a Response (Set-Cookie header). */
function getSessionCookie(response: Response): string | null {
    const setCookie = response.headers.get("Set-Cookie");
    if (!setCookie) return null;
    const match = setCookie.match(/^session=([^;]+)/);
    return match ? match[1]! : null;
}

/** Build a Request with an optional session cookie. */
function req(
    method: string,
    path: string,
    opts?: { body?: unknown; cookie?: string | null; }
): Request {
    const headers: Record<string, string> = {};
    if (opts?.cookie) {
        headers["Cookie"] = `session=${opts.cookie}`;
    }
    if (opts?.body !== undefined) {
        headers["Content-Type"] = "application/json";
    }
    return new Request(`http://localhost${path}`, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
    removeTestDb();

    // Create test database with migrations applied
    env = createEnv(TEST_DB_PATH);
    db = env.DB;

    // Seed two users: one admin, one regular
    const adminCreds = await hashPassword("adminpass");
    const userCreds = await hashPassword("userpass");

    db.query(
        `INSERT OR REPLACE INTO users (username, password_hash, salt, role)
         VALUES (?, ?, ?, ?)`
    ).run("admin", adminCreds.hash, adminCreds.salt, "admin");

    db.query(
        `INSERT OR REPLACE INTO users (username, password_hash, salt, role)
         VALUES (?, ?, ?, ?)`
    ).run("user", userCreds.hash, userCreds.salt, "user");
});

afterAll(() => {
    removeTestDb();
});

// ---------------------------------------------------------------------------
// 1. Unauthenticated access
// ---------------------------------------------------------------------------

describe("Unauthenticated access", () => {
    const readEndpoints = [
        ["GET", "/api/records"],
        ["GET", "/api/stats"],
        ["GET", "/api/records/hash"],
        ["GET", "/api/latest"],
    ] as const;

    const writeEndpoints = [
        ["POST", "/api/latest"],
        ["DELETE", "/api/latest"],
    ] as const;

    for (const [method, path] of readEndpoints) {
        it(`${method} ${path} returns 401 without session`, async () => {
            const res = await appFetch(req(method, path), env);
            expect(res.status).toBe(401);
            const body = await res.json() as ErrorBody;
            expect(body.error).toBe("Unauthorized");
        });
    }

    for (const [method, path] of writeEndpoints) {
        it(`${method} ${path} returns 401 without session`, async () => {
            const res = await appFetch(
                req(method, path, { body: { type: "test", service: "test", code: "123" } }),
                env
            );
            expect(res.status).toBe(401);
        });
    }
});

// ---------------------------------------------------------------------------
// 2. Login
// ---------------------------------------------------------------------------

describe("Login", () => {
    it("succeeds with valid admin credentials", async () => {
        const res = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "admin", password: "adminpass" },
            }),
            env
        );
        expect(res.status).toBe(200);
        const body = await res.json() as LoginBody;
        expect(body.ok).toBe(true);
        expect(body.role).toBe("admin");
        expect(getSessionCookie(res)).toBeTruthy();
    });

    it("succeeds with valid regular user credentials", async () => {
        const res = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "user", password: "userpass" },
            }),
            env
        );
        expect(res.status).toBe(200);
        const body = await res.json() as LoginBody;
        expect(body.ok).toBe(true);
        expect(body.role).toBe("user");
        expect(getSessionCookie(res)).toBeTruthy();
    });

    it("fails with wrong password", async () => {
        const res = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "admin", password: "wrongpass" },
            }),
            env
        );
        expect(res.status).toBe(401);
        const body = await res.json() as ErrorBody;
        expect(body.error).toBe("Invalid credentials");
    });

    it("fails with non-existent user", async () => {
        const res = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "nobody", password: "whatever" },
            }),
            env
        );
        expect(res.status).toBe(401);
    });

    it("fails with missing username", async () => {
        const res = await appFetch(
            req("POST", "/auth/login", { body: { password: "adminpass" } }),
            env
        );
        expect(res.status).toBe(400);
    });

    it("fails with missing password", async () => {
        const res = await appFetch(
            req("POST", "/auth/login", { body: { username: "admin" } }),
            env
        );
        expect(res.status).toBe(400);
    });

    it("fails with empty body", async () => {
        const res = await appFetch(req("POST", "/auth/login"), env);
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// 3. Regular user (role="user") — read allowed, write forbidden
// ---------------------------------------------------------------------------

describe("Regular user session", () => {
    let cookie: string;

    beforeAll(async () => {
        const res = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "user", password: "userpass" },
            }),
            env
        );
        cookie = getSessionCookie(res)!;
    });

    it("can GET /api/records", async () => {
        const res = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(res.status).toBe(200);
        const body = await res.json() as PhoneRecord[];
        expect(Array.isArray(body)).toBe(true);
    });

    it("can GET /api/stats", async () => {
        const res = await appFetch(req("GET", "/api/stats", { cookie }), env);
        expect(res.status).toBe(200);
        const body = await res.json() as StatsBody;
        expect(typeof body.total).toBe("number");
    });

    it("can GET /api/records/hash", async () => {
        const res = await appFetch(req("GET", "/api/records/hash", { cookie }), env);
        expect(res.status).toBe(200);
        const body = await res.json() as HashBody;
        expect(typeof body.hash).toBe("string");
    });

    it("can GET /api/latest", async () => {
        const res = await appFetch(req("GET", "/api/latest", { cookie }), env);
        expect(res.status).toBe(200);
    });

    it("is blocked from POST /api/latest (403 Forbidden)", async () => {
        const res = await appFetch(
            req("POST", "/api/latest", {
                cookie,
                body: { type: "test", service: "svc", code: "001" },
            }),
            env
        );
        expect(res.status).toBe(403);
        const body = await res.json() as ErrorBody;
        expect(body.error).toContain("admin access required");
    });

    it("is blocked from DELETE /api/latest (403 Forbidden)", async () => {
        const res = await appFetch(
            req("DELETE", "/api/latest", {
                cookie,
                body: { type: "test", service: "svc", code: "001" },
            }),
            env
        );
        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// 4. Admin user (role="admin") — read AND write allowed
// ---------------------------------------------------------------------------

describe("Admin user session", () => {
    let cookie: string;

    beforeAll(async () => {
        const res = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "admin", password: "adminpass" },
            }),
            env
        );
        cookie = getSessionCookie(res)!;
    });

    // --- Read endpoints ---
    it("can GET /api/records", async () => {
        const res = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(res.status).toBe(200);
    });

    it("can GET /api/stats", async () => {
        const res = await appFetch(req("GET", "/api/stats", { cookie }), env);
        expect(res.status).toBe(200);
    });

    it("can GET /api/records/hash", async () => {
        const res = await appFetch(req("GET", "/api/records/hash", { cookie }), env);
        expect(res.status).toBe(200);
    });

    it("can GET /api/latest", async () => {
        const res = await appFetch(req("GET", "/api/latest", { cookie }), env);
        expect(res.status).toBe(200);
    });

    // --- Write endpoints ---
    it("can POST /api/latest (track)", async () => {
        const res = await appFetch(
            req("POST", "/api/latest", {
                cookie,
                body: { type: "Ραντεβού Άμεσα", service: "ΑΞΟΝΙΚΗ", code: "4932" },
            }),
            env
        );
        expect(res.status).toBe(204);
    });

    it("can DELETE /api/latest", async () => {
        const res = await appFetch(
            req("DELETE", "/api/latest", {
                cookie,
                body: { type: "Ραντεβού Άμεσα", service: "ΑΞΟΝΙΚΗ", code: "4932" },
            }),
            env
        );
        expect(res.status).toBe(204);
    });

    it("can read back tracked data via GET /api/latest", async () => {
        // Track something first
        await appFetch(
            req("POST", "/api/latest", {
                cookie,
                body: { type: "TestType", service: "TestSvc", code: "999" },
            }),
            env
        );

        const res = await appFetch(req("GET", "/api/latest", { cookie }), env);
        expect(res.status).toBe(200);
        const body = await res.json() as LatestRecord[];
        const tracked = body.find(
            (r) => r.type === "TestType" && r.service === "TestSvc" && r.code === "999"
        );
        expect(tracked).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// 5. Logout
// ---------------------------------------------------------------------------

describe("Logout", () => {
    it("clears the session cookie", async () => {
        // Login first
        const loginRes = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "user", password: "userpass" },
            }),
            env
        );
        const cookie = getSessionCookie(loginRes)!;

        // Logout
        const logoutRes = await appFetch(
            req("POST", "/auth/logout", { cookie }),
            env
        );
        expect(logoutRes.status).toBe(200);
        const body = await logoutRes.json() as LogoutBody;
        expect(body.ok).toBe(true);

        // The Set-Cookie should clear the session (Max-Age=0 or empty value)
        const setCookie = logoutRes.headers.get("Set-Cookie") || "";
        expect(setCookie).toContain("session=");
    });

    it("blocks access after logout", async () => {
        // Login
        const loginRes = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "user", password: "userpass" },
            }),
            env
        );
        const cookie = getSessionCookie(loginRes)!;

        // Verify we can access a protected endpoint
        const before = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(before.status).toBe(200);

        // Logout
        await appFetch(req("POST", "/auth/logout", { cookie }), env);

        // Now the same cookie should be rejected
        const after = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(after.status).toBe(401);
    });

    it("logout without a session still succeeds", async () => {
        const res = await appFetch(req("POST", "/auth/logout"), env);
        expect(res.status).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// 6. Full lifecycle: login → read → write → logout → blocked
// ---------------------------------------------------------------------------

describe("Full session lifecycle", () => {
    it("admin: login → read → write → logout → blocked", async () => {
        // 1. Login as admin
        const loginRes = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "admin", password: "adminpass" },
            }),
            env
        );
        expect(loginRes.status).toBe(200);
        const cookie = getSessionCookie(loginRes)!;

        // 2. Read records
        const readRes = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(readRes.status).toBe(200);

        // 3. Write (POST latest)
        const writeRes = await appFetch(
            req("POST", "/api/latest", {
                cookie,
                body: { type: "Lifecycle", service: "Test", code: "000" },
            }),
            env
        );
        expect(writeRes.status).toBe(204);

        // 4. Logout
        const logoutRes = await appFetch(req("POST", "/auth/logout", { cookie }), env);
        expect(logoutRes.status).toBe(200);

        // 5. Blocked after logout
        const blockedRes = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(blockedRes.status).toBe(401);
    });

    it("regular user: login → read → write blocked → logout → blocked", async () => {
        // 1. Login as regular user
        const loginRes = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "user", password: "userpass" },
            }),
            env
        );
        expect(loginRes.status).toBe(200);
        const cookie = getSessionCookie(loginRes)!;

        // 2. Read records (allowed)
        const readRes = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(readRes.status).toBe(200);

        // 3. Write attempt (blocked)
        const writeRes = await appFetch(
            req("POST", "/api/latest", {
                cookie,
                body: { type: "Lifecycle", service: "Test", code: "000" },
            }),
            env
        );
        expect(writeRes.status).toBe(403);

        // 4. Logout
        const logoutRes = await appFetch(req("POST", "/auth/logout", { cookie }), env);
        expect(logoutRes.status).toBe(200);

        // 5. Blocked after logout
        const blockedRes = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(blockedRes.status).toBe(401);
    });
});
