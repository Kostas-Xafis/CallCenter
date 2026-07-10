import type { ApiRoute, ApiRouteParent, Env } from "@_types/types";
import { headers, trycatch } from "./utils";

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
                return new Response(
                    JSON.stringify({ error: "Λείπει ο κωδικός πρόσκλησης." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
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
                return new Response(
                    JSON.stringify({ error: "Η πρόσκληση δεν βρέθηκε." }),
                    { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            if (invite.expires_at < now) {
                // Clean up expired invitation
                env.DB.query("DELETE FROM signup_invitations WHERE id = ?").run(inviteId);
                return new Response(
                    JSON.stringify({ error: "Η πρόσκληση έχει λήξει." }),
                    { status: 410, headers: { ...headers, "Content-Type": "application/json" } }
                );
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
