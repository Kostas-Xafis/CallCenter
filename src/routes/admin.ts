import type { ApiRoute, ApiRouteParent, Env, UserRole } from "@_types/types";
import { headers, trycatch } from "./utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a cryptographically random 24-character lowercase hex string. */
function generateHexCode(): string {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

/** Calculate a Unix timestamp 14 days from now. */
function expiryTwoWeeks(): number {
    return Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
}

const VALID_ROLES: ReadonlySet<UserRole> = new Set(["admin", "user"]);

// ---------------------------------------------------------------------------
// POST /api/admin/create-user
// ---------------------------------------------------------------------------

const createUserRoute: ApiRoute = {
    url: "/admin/create-user",
    method: "POST",
    handler: (request: Request, env: Env) => {
        return trycatch(async () => {
            const body = await request.json() as {
                username?: string;
                role?: string;
            };
            const username = (body.username ?? "").trim();
            const role = (body.role ?? "").trim().toLowerCase();

            // --- Validation ---

            if (!username || username.length < 2) {
                return new Response(
                    JSON.stringify({ error: "Το όνομα χρήστη πρέπει να έχει τουλάχιστον 2 χαρακτήρες." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            if (username.length > 64) {
                return new Response(
                    JSON.stringify({ error: "Το όνομα χρήστη δεν μπορεί να υπερβαίνει τους 64 χαρακτήρες." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // Allow only alphanumeric, underscore, dash, and Greek letters
            if (!/^[\w\u0370-\u03ff\u1f00-\u1fff-]+$/.test(username)) {
                return new Response(
                    JSON.stringify({ error: "Το όνομα χρήστη περιέχει μη επιτρεπτούς χαρακτήρες." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            if (!VALID_ROLES.has(role as UserRole)) {
                return new Response(
                    JSON.stringify({ error: "Μη έγκυρος ρόλος. Επιτρέπονται: admin, user." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // --- Business rules ---

            // Check if the username already exists as a registered user
            const existingUser = env.DB.query(
                "SELECT username FROM users WHERE username = ?"
            ).get(username) as { username: string; } | null;

            if (existingUser) {
                return new Response(
                    JSON.stringify({ error: "Υπάρχει ήδη καταχωρημένος χρήστης με αυτό το όνομα." }),
                    { status: 409, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // Clean up expired invitations for this username (so they don't block re-creation)
            const now = Math.floor(Date.now() / 1000);
            env.DB.query(
                "DELETE FROM signup_invitations WHERE username = ? AND expires_at < ?"
            ).run(username, now);

            // Check if a *valid* (non-expired) invitation already exists for this username
            const existingInvite = env.DB.query(
                "SELECT id FROM signup_invitations WHERE username = ? AND expires_at > ?"
            ).get(username, now) as { id: string; } | null;

            if (existingInvite) {
                return new Response(
                    JSON.stringify({
                        error: "Υπάρχει ήδη ενεργή πρόσκληση για αυτό το όνομα χρήστη. " +
                            "Περιμένετε να λήξει ή ακυρώστε την πρώτα.",
                    }),
                    { status: 409, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // --- Create invitation ---

            const hexCode = generateHexCode();
            const expiresAt = expiryTwoWeeks();

            env.DB.query(
                "INSERT INTO signup_invitations (id, username, role, expires_at) VALUES (?, ?, ?, ?)"
            ).run(hexCode, username, role, expiresAt);

            const signupUrl = `/signup?id=${hexCode}`;

            return new Response(
                JSON.stringify({ signupUrl, hexCode, expiresAt }),
                { status: 201, headers: { ...headers, "Content-Type": "application/json" } }
            );
        }, "Error creating user invitation");
    },
};

// ---------------------------------------------------------------------------
// POST /api/admin/upload-data  (stub — not implemented yet)
// ---------------------------------------------------------------------------

const uploadDataRoute: ApiRoute = {
    url: "/admin/upload-data",
    method: "POST",
    handler: (_request: Request, _env: Env) => {
        return trycatch(async () => {
            return new Response(
                JSON.stringify({ error: "Not implemented yet." }),
                { status: 501, headers: { ...headers, "Content-Type": "application/json" } }
            );
        }, "Error handling file upload");
    },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const AdminRoutes: ApiRouteParent = {
    url: "",
    routes: [createUserRoute, uploadDataRoute],
};
