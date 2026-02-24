import { createClient } from "@libsql/client";
import path from "path";

type DBType = "sqlite-prod" | "sqlite-dev" | null;

export function createDbConnection(type?: DBType) {
    const {
        // Turso env variables for production
        TURSO_DB_URL, TURSO_DB_TOKEN,
        // Connector type
        CONNECTOR } = process.env;
    if (type === "sqlite-prod" || CONNECTOR === "sqlite-prod") {
        console.log("Connecting to production database");
        return createClient({
            url: TURSO_DB_URL as string,
            authToken: TURSO_DB_TOKEN,
            intMode: "number",
        });
    } else {
        const db_url = path.join(process.cwd(), 'sqlite/callcenter.db');
        console.log("Connecting to development database");
        return createClient({
            url: `file://${db_url}`,
            intMode: "number",
        });
    }
}
