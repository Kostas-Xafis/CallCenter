/**
 * Session, Signup & Role-Based Access Control Tests
 *
 * Covers the full user lifecycle:
 *   signup (validate → register) → login → read (GET) → write (POST/DELETE) → logout
 *
 * Validates that:
 *   - Unauthenticated users are blocked (401)
 *   - Signup invitations can be validated and used to create accounts
 *   - Authenticated regular users can read but NOT write (403 on write ops)
 *   - Authenticated admin users can read AND write
 *   - Logout invalidates the session
 *   - Invalid credentials are rejected
 */

import { unlinkSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appFetch, createEnv } from "../server";
import { hashPassword } from "../src/auth";
import type { PhoneRecord } from "../src/phone_repository";
import type { Database, Env, UserRole } from "../types/types";

// ---------------------------------------------------------------------------
// Response type helpers — narrow the `unknown` returned by Response.json()
// ---------------------------------------------------------------------------

type ErrorBody = { error: string; };
type LoginBody = { ok: true; role: UserRole; };
type LogoutBody = { ok: true; };
type SignupBody = { ok: true; username: string; };
type ValidateInviteBody = { username: string; };
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

    db.prepare(
        `INSERT OR REPLACE INTO users (username, password_hash, salt, role)
         VALUES (?, ?, ?, ?)`
    ).run("admin", adminCreds.hash, adminCreds.salt, "admin");

    db.prepare(
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
    ] as const;

    const writeEndpoints = [
    ] as const;

    for (const [method, path] of readEndpoints) {
        it(`${method} ${path} returns 401 without session`, async () => {
            const res = await appFetch(req(method, path), env);
            expect(res.status).toBe(401);
            const body = await res.json() as ErrorBody;
            expect(body.error).toBe("Unauthorized");
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
// 3. Signup — complete registration from an invitation
// ---------------------------------------------------------------------------

describe("Signup", () => {
    const VALID_INVITE_ID = "a1b2c3d4e5f6a1b2c3d4e5f6";
    const EXPIRED_INVITE_ID = "deadbeef1111deadbeef2222";
    const EXPIRED_INVITE_ID2 = "deadbeef3333deadbeef4444"; // separate for POST test

    beforeAll(() => {
        const now = Math.floor(Date.now() / 1000);

        // Create a valid signup invitation (expires in 14 days)
        db.prepare(
            `INSERT INTO signup_invitations (id, username, role, expires_at, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
        ).run(VALID_INVITE_ID, "newuser", "user", now + 60 * 60 * 24 * 14);

        // Create an expired invitation (for validate test)
        db.prepare(
            `INSERT INTO signup_invitations (id, username, role, expires_at, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
        ).run(EXPIRED_INVITE_ID, "expireduser", "user", now - 60); // 1 min ago

        // Create another expired invitation (for POST signup test — validate will delete the first)
        db.prepare(
            `INSERT INTO signup_invitations (id, username, role, expires_at, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
        ).run(EXPIRED_INVITE_ID2, "expireduser2", "user", now - 60);
    });

    // -------------------------------------------------------
    // Validate invitation endpoint
    // -------------------------------------------------------

    describe("GET /api/signup/validate", () => {
        it("returns username for a valid invitation", async () => {
            const res = await appFetch(
                req("GET", `/api/signup/validate?id=${VALID_INVITE_ID}`),
                env
            );
            expect(res.status).toBe(200);
            const body = await res.json() as ValidateInviteBody;
            expect(body.username).toBe("newuser");
        });

        it("returns 410 for an expired invitation", async () => {
            const res = await appFetch(
                req("GET", `/api/signup/validate?id=${EXPIRED_INVITE_ID}`),
                env
            );
            expect(res.status).toBe(410);
            const body = await res.json() as ErrorBody;
            expect(body.error).toContain("έχει λήξει");
        });

        it("returns 404 for a non-existent invitation", async () => {
            const res = await appFetch(
                req("GET", "/api/signup/validate?id=nonexistent000000000000"),
                env
            );
            expect(res.status).toBe(404);
        });

        it("returns 400 when id is missing", async () => {
            const res = await appFetch(
                req("GET", "/api/signup/validate"),
                env
            );
            expect(res.status).toBe(400);
        });
    });

    // -------------------------------------------------------
    // Signup endpoint
    // -------------------------------------------------------

    describe("POST /auth/signup", () => {
        it("completes signup with valid invitation and password", async () => {
            const res = await appFetch(
                req("POST", "/auth/signup", {
                    body: { inviteId: VALID_INVITE_ID, password: "newuserpass" },
                }),
                env
            );
            expect(res.status).toBe(201);
            const body = await res.json() as SignupBody;
            expect(body.ok).toBe(true);
            expect(body.username).toBe("newuser");
        });

        it("allows the new user to log in after signup", async () => {
            const res = await appFetch(
                req("POST", "/auth/login", {
                    body: { username: "newuser", password: "newuserpass" },
                }),
                env
            );
            expect(res.status).toBe(200);
            const body = await res.json() as LoginBody;
            expect(body.ok).toBe(true);
            expect(body.role).toBe("user");
            expect(getSessionCookie(res)).toBeTruthy();
        });

        it("fails when invitation is already used", async () => {
            // The invitation was consumed by the successful signup above
            const res = await appFetch(
                req("POST", "/auth/signup", {
                    body: { inviteId: VALID_INVITE_ID, password: "anotherpass" },
                }),
                env
            );
            expect(res.status).toBe(404);
            const body = await res.json() as ErrorBody;
            expect(body.error).toContain("δεν βρέθηκε");
        });

        it("fails with expired invitation", async () => {
            const res = await appFetch(
                req("POST", "/auth/signup", {
                    body: { inviteId: EXPIRED_INVITE_ID2, password: "expiredpass" },
                }),
                env
            );
            expect(res.status).toBe(410);
            const body = await res.json() as ErrorBody;
            expect(body.error).toContain("έχει λήξει");
        });

        it("fails with non-existent invitation", async () => {
            const res = await appFetch(
                req("POST", "/auth/signup", {
                    body: { inviteId: "nonexistent000000000000", password: "whatever" },
                }),
                env
            );
            expect(res.status).toBe(404);
        });

        it("fails with short password", async () => {
            const res = await appFetch(
                req("POST", "/auth/signup", {
                    body: { inviteId: VALID_INVITE_ID, password: "12345" },
                }),
                env
            );
            expect(res.status).toBe(400);
            const body = await res.json() as ErrorBody;
            expect(body.error).toContain("6 χαρακτήρες");
        });

        it("fails with missing inviteId", async () => {
            const res = await appFetch(
                req("POST", "/auth/signup", {
                    body: { password: "whatever" },
                }),
                env
            );
            expect(res.status).toBe(400);
        });

        it("fails with missing password", async () => {
            const res = await appFetch(
                req("POST", "/auth/signup", {
                    body: { inviteId: VALID_INVITE_ID },
                }),
                env
            );
            expect(res.status).toBe(400);
        });

        it("fails with empty body", async () => {
            const res = await appFetch(req("POST", "/auth/signup"), env);
            expect(res.status).toBe(400);
        });
    });
});

// ---------------------------------------------------------------------------
// 5. Regular user (role="user") — read allowed, write forbidden
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

});

// ---------------------------------------------------------------------------
// 6. Admin user (role="admin") — read AND write allowed
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

});

// ---------------------------------------------------------------------------
// 7. Admin write operations (POST /api/admin/create-user)
// ---------------------------------------------------------------------------

type CreateUserBody = { signupUrl: string; hexCode: string; expiresAt: number; };

describe("Admin write operations", () => {
    let adminCookie: string;

    beforeAll(async () => {
        const res = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "admin", password: "adminpass" },
            }),
            env
        );
        adminCookie = getSessionCookie(res)!;
    });

    // --- POST /api/admin/create-user ---

    it("creates invitation for a new username (no FK constraint)", async () => {
        const res = await appFetch(
            req("POST", "/api/admin/create-user", {
                cookie: adminCookie,
                body: { username: "invited_user", role: "user" },
            }),
            env
        );
        expect(res.status).toBe(201);
        const body = await res.json() as CreateUserBody;
        expect(typeof body.signupUrl).toBe("string");
        expect(body.signupUrl).toContain("/signup?id=");
        expect(typeof body.hexCode).toBe("string");
        expect(body.hexCode.length).toBe(24);
        expect(typeof body.expiresAt).toBe("number");

        // Verify the invitation exists in the database
        const row = db.prepare(
            "SELECT username, role FROM signup_invitations WHERE id = ?"
        ).get(body.hexCode) as { username: string; role: string; } | null;
        expect(row).not.toBeNull();
        expect(row!.username).toBe("invited_user");
        expect(row!.role).toBe("user");
    });

    it("rejects creating invitation for an already registered username", async () => {
        const res = await appFetch(
            req("POST", "/api/admin/create-user", {
                cookie: adminCookie,
                body: { username: "admin", role: "user" },
            }),
            env
        );
        expect(res.status).toBe(409);
        const body = await res.json() as ErrorBody;
        expect(body.error).toContain("ήδη");
    });

    it("rejects creating invitation with missing username", async () => {
        const res = await appFetch(
            req("POST", "/api/admin/create-user", {
                cookie: adminCookie,
                body: { role: "user" },
            }),
            env
        );
        expect(res.status).toBe(400);
    });

    it("rejects invitation with invalid role", async () => {
        const res = await appFetch(
            req("POST", "/api/admin/create-user", {
                cookie: adminCookie,
                body: { username: "someone", role: "superadmin" },
            }),
            env
        );
        expect(res.status).toBe(400);
    });

    it("rejects invitation creation from a regular user (403)", async () => {
        // Login as regular user
        const userLogin = await appFetch(
            req("POST", "/auth/login", {
                body: { username: "user", password: "userpass" },
            }),
            env
        );
        const userCookie = getSessionCookie(userLogin)!;

        const res = await appFetch(
            req("POST", "/api/admin/create-user", {
                cookie: userCookie,
                body: { username: "hacker", role: "admin" },
            }),
            env
        );
        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// 8. Logout
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
// 9. Full lifecycle: login → read → write → logout → blocked
// ---------------------------------------------------------------------------

describe("Full session lifecycle", () => {
    it("admin: login → read → logout → blocked", async () => {
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

        // 3. Logout
        const logoutRes = await appFetch(req("POST", "/auth/logout", { cookie }), env);
        expect(logoutRes.status).toBe(200);

        // 4. Blocked after logout
        const blockedRes = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(blockedRes.status).toBe(401);
    });

    it("regular user: login → read → logout → blocked", async () => {
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

        // 3. Logout
        const logoutRes = await appFetch(req("POST", "/auth/logout", { cookie }), env);
        expect(logoutRes.status).toBe(200);

        // 4. Blocked after logout
        const blockedRes = await appFetch(req("GET", "/api/records", { cookie }), env);
        expect(blockedRes.status).toBe(401);
    });
});
