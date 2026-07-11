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
// POST /api/admin/upload-data
// ---------------------------------------------------------------------------

/** Expected columns in the first sheet of the uploaded xlsx file. */
const EXPECTED_COLUMNS = ["type", "service", "code"] as const;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const uploadDataRoute: ApiRoute = {
    url: "/admin/upload-data",
    method: "POST",
    handler: (request: Request, env: Env) => {
        return trycatch(async () => {
            const contentType = request.headers.get("Content-Type") ?? "";
            if (!contentType.includes("multipart/form-data")) {
                return new Response(
                    JSON.stringify({ error: "Απαιτείται multipart/form-data." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // Read the raw body and check size
            const contentLength = parseInt(request.headers.get("Content-Length") ?? "0", 10);
            if (contentLength > MAX_FILE_SIZE) {
                return new Response(
                    JSON.stringify({ error: `Το αρχείο υπερβαίνει το μέγιστο επιτρεπόμενο μέγεθος (50 MB).` }),
                    { status: 413, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            const formData = await request.formData();
            const file = formData.get("file");

            if (!file || !(file instanceof File)) {
                return new Response(
                    JSON.stringify({ error: "Δεν βρέθηκε αρχείο στο αίτημα." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // Validate file extension
            const fileName = file.name.toLowerCase();
            if (!fileName.endsWith(".xlsx")) {
                return new Response(
                    JSON.stringify({ error: "Επιτρέπονται μόνο αρχεία .xlsx." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // Parse the xlsx file with SheetJS
            const arrayBuffer = await file.arrayBuffer();
            const XLSX = await import("xlsx");
            const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });

            const sheetNames = workbook.SheetNames;
            if (sheetNames.length === 0) {
                return new Response(
                    JSON.stringify({ error: "Το αρχείο Excel δεν περιέχει φύλλα εργασίας." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            const firstSheetName = sheetNames[0];
            const sheet = workbook.Sheets[firstSheetName];
            const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

            if (rawRows.length === 0) {
                return new Response(
                    JSON.stringify({ error: "Το φύλλο εργασίας είναι κενό." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // Validate that the expected columns exist (case-insensitive header matching)
            const headerRow = rawRows[0];
            const headerKeys = Object.keys(headerRow).map(k => k.trim().toLowerCase());

            const missingColumns = EXPECTED_COLUMNS.filter(
                col => !headerKeys.includes(col)
            );
            if (missingColumns.length > 0) {
                return new Response(
                    JSON.stringify({
                        error: `Λείπουν οι απαιτούμενες στήλες: ${missingColumns.join(", ")}. ` +
                            `Βρέθηκαν: ${headerKeys.join(", ") || "(καμία)"}.`,
                    }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // Map the actual (possibly differently-cased) column names to our expected keys
            const columnMap = new Map<string, string>();
            for (const key of Object.keys(headerRow)) {
                const lower = key.trim().toLowerCase();
                if ((EXPECTED_COLUMNS as readonly string[]).includes(lower)) {
                    columnMap.set(lower, key);
                }
            }

            // Extract and validate data rows (skip header row)
            const records: { type: string; service: string; code: string; }[] = [];
            for (let i = 1; i < rawRows.length; i++) {
                const row = rawRows[i];
                const type = String(row[columnMap.get("type")!] ?? "").trim();
                const service = String(row[columnMap.get("service")!] ?? "").trim();
                const code = String(row[columnMap.get("code")!] ?? "").trim();

                // Skip completely empty rows
                if (!type && !service && !code) continue;

                // Every row must have all three fields
                if (!type || !service || !code) {
                    return new Response(
                        JSON.stringify({
                            error: `Η γραμμή ${i + 1} έχει κενά πεδία. ` +
                                `Απαιτούνται: type, service, code.`,
                        }),
                        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                    );
                }

                records.push({ type, service, code });
            }

            if (records.length === 0) {
                return new Response(
                    JSON.stringify({ error: "Δεν βρέθηκαν έγκυρες εγγραφές δεδομένων." }),
                    { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
                );
            }

            // --- Replace all phone_records in a transaction ---
            const replaceAll = env.DB.transaction((rows: typeof records) => {
                env.DB.query("DELETE FROM phone_records").run();

                const stmt = env.DB.prepare(
                    "INSERT INTO phone_records (type, service, code, merged) VALUES (?, ?, ?, 0)"
                );
                for (const row of rows) {
                    stmt.run(row.type, row.service, row.code);
                }

                // Bump the version token so clients invalidate their cache
                env.DB.query(
                    "UPDATE table_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'records_version'"
                ).run();
            });

            replaceAll(records);

            return new Response(
                JSON.stringify({
                    success: true,
                    message: "Η βάση δεδομένων ενημερώθηκε επιτυχώς.",
                    recordsProcessed: records.length,
                }),
                { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
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
