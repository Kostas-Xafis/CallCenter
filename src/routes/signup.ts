import type { ApiRoute, ApiRouteParent, Env } from "@_types/types";
import { headers, jsonError, trycatch } from "./utils";

// ---------------------------------------------------------------------------
// GET /api/signup/validate?id=<hexCode>
// ---------------------------------------------------------------------------

const validateInvitationRoute: ApiRoute = {
    url: "/signup/validate",
    method: "GET",
    handler: (request: Request, env: Env) => {
        return trycatch(async () => {
            const url = new URL(request.url);
            const inviteId = url.searchParams.get("id");

            if (!inviteId) {
                return jsonError("Λείπει ο κωδικός πρόσκλησης.");
            }

            const now = Math.floor(Date.now() / 1000);
            const invite = env.DB.query(
                "SELECT id, username, role, expires_at FROM signup_invitations WHERE id = ?"
            ).get(inviteId) as {
                id: string;
                username: string;
                role: string;
                expires_at: number;
            } | null;

            if (!invite) {
                return jsonError("Η πρόσκληση δεν βρέθηκε.", 404);
            }

            if (invite.expires_at < now) {
                // Clean up expired invitation
                env.DB.query("DELETE FROM signup_invitations WHERE id = ?").run(inviteId);
                return jsonError("Η πρόσκληση έχει λήξει.", 410);
            }

            return new Response(
                JSON.stringify({ username: invite.username }),
                { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
            );
        }, "Error validating signup invitation");
    },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const SignupRoutes: ApiRouteParent = {
    url: "",
    routes: [validateInvitationRoute],
};
