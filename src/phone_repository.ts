
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
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    async getAll(): Promise<PhoneRecord[]> {
        const result = await this.db
            .prepare('SELECT * FROM phone_records ORDER BY id')
            .all<PhoneRecord>();
        return result.results;
    }

    async getTableHash(): Promise<string> {
        const result = await this.db
            .prepare("SELECT value FROM table_meta WHERE key = 'records_version'")
            .first<{ value: string; }>();
        return result?.value ?? '0';
    }

    async getUniqueTypes(): Promise<string[]> {
        const result = await this.db
            .prepare('SELECT DISTINCT type FROM phone_records ORDER BY type')
            .all<{ type: string; }>();
        return result.results.map(row => row.type);
    }

    async getCount(): Promise<number> {
        const result = await this.db
            .prepare('SELECT COUNT(*) as count FROM phone_records')
            .first<{ count: number; }>();
        return result?.count ?? 0;
    }

    async getStatsByType(): Promise<{ type: string; count: number; }[]> {
        const result = await this.db
            .prepare(
                'SELECT type, COUNT(*) as count FROM phone_records GROUP BY type ORDER BY count DESC'
            )
            .all<{ type: string; count: number; }>();
        return result.results;
    }

    async getLatest(): Promise<LatestRecord[]> {
        const result = await this.db
            .prepare(
                `SELECT type, service, code, count
                 FROM latest_requests
                 WHERE date = date('now')
                 ORDER BY count DESC
                 LIMIT 5`
            )
            .all<LatestRecord>();
        return result.results;
    }

    async trackLatest(type: string, service: string, code: string): Promise<void> {
        await this.db
            .prepare(
                `INSERT INTO latest_requests (date, type, service, code, count)
                 VALUES (date('now'), ?, ?, ?, 1)
                 ON CONFLICT(date, type, service, code) DO UPDATE SET count = count + 1`
            )
            .bind(type, service, code)
            .run();
    }

    async deleteLatest(type: string, service: string, code: string): Promise<void> {
        await this.db
            .prepare(
                `DELETE FROM latest_requests
                 WHERE date = date('now') AND type = ? AND service = ? AND code = ?`
            )
            .bind(type, service, code)
            .run();
    }
}
