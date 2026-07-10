import type { Database } from 'bun:sqlite';

export type PhoneRecord = {
    id: number;
    type: string;
    service: string;
    code: string;
    merged: number;
};

export class PhoneRepository {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    async getAll(): Promise<PhoneRecord[]> {
        return this.db.query('SELECT * FROM phone_records ORDER BY id').all() as PhoneRecord[];
    }

    /**
     * Compute a lightweight content fingerprint of the phone_records table.
     * Any insert, delete, or content change produces a different hash,
     * so the client's IndexedDB cache is automatically invalidated.
     */
    async getTableHash(): Promise<string> {
        const row = this.db.query(`
            SELECT
                CAST(COUNT(*) AS TEXT) || ':'
                || CAST(COALESCE(MAX(id), 0) AS TEXT) || ':'
                || CAST(COALESCE(SUM(
                    LENGTH(type) + LENGTH(service) + LENGTH(code) + merged
                ), 0) AS TEXT) AS hash
            FROM phone_records
        `).get() as { hash: string; } | null;
        return row?.hash ?? '0';
    }

    async getUniqueTypes(): Promise<string[]> {
        const rows = this.db.query(
            'SELECT DISTINCT type FROM phone_records ORDER BY type'
        ).all() as { type: string; }[];
        return rows.map(row => row.type);
    }

    async getCount(): Promise<number> {
        const row = this.db.query(
            'SELECT COUNT(*) as count FROM phone_records'
        ).get() as { count: number; } | null;
        return row?.count ?? 0;
    }

    async getStatsByType(): Promise<{ type: string; count: number; }[]> {
        return this.db.query(
            'SELECT type, COUNT(*) as count FROM phone_records GROUP BY type ORDER BY count DESC'
        ).all() as { type: string; count: number; }[];
    }

}
