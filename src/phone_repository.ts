import type { Database } from 'bun:sqlite';

export type PhoneRecord = {
    id: number;
    type: string;
    service: string;
    code: string;
    merged: number;
};

export type LatestRecord = {
    type: string;
    service: string;
    code: string;
    count: number;
};

export class PhoneRepository {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    async getAll(): Promise<PhoneRecord[]> {
        return this.db.query('SELECT * FROM phone_records ORDER BY id').all() as PhoneRecord[];
    }

    async getTableHash(): Promise<string> {
        const row = this.db.query(
            "SELECT value FROM table_meta WHERE key = 'records_version'"
        ).get() as { value: string; } | null;
        return row?.value ?? '0';
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

    async getLatest(): Promise<LatestRecord[]> {
        return this.db.query(
            `SELECT type, service, code, count
             FROM latest_requests
             WHERE date = date('now')
             ORDER BY count DESC
             LIMIT 5`
        ).all() as LatestRecord[];
    }

    async trackLatest(type: string, service: string, code: string): Promise<void> {
        this.db.query(
            `INSERT INTO latest_requests (date, type, service, code, count)
             VALUES (date('now'), ?, ?, ?, 1)
             ON CONFLICT(date, type, service, code) DO UPDATE SET count = count + 1`
        ).run(type, service, code);
    }

    async deleteLatest(type: string, service: string, code: string): Promise<void> {
        this.db.query(
            `DELETE FROM latest_requests
             WHERE date = date('now') AND type = ? AND service = ? AND code = ?`
        ).run(type, service, code);
    }
}
