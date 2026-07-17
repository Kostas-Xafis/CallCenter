import type { ApiRoute, ApiRouteParent, Env } from "@_types/types";
import { jsonError, jsonSuccess, trycatch } from "./utils";

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
            const invite = await env.DB.prepare(
                "SELECT id, username, role, expires_at FROM signup_invitations WHERE id = ?"
            ).bind(inviteId).first<{
                id: string;
                username: string;
                role: string;
                expires_at: number;
            }>();

            if (!invite) {
                return jsonError("Η πρόσκληση δεν βρέθηκε.", 404);
            }

            if (invite.expires_at < now) {
                // Clean up expired invitation
                await env.DB.prepare("DELETE FROM signup_invitations WHERE id = ?").bind(inviteId).run();
                return jsonError("Η πρόσκληση έχει λήξει.", 410);
            }

            return jsonSuccess({ username: invite.username });
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
