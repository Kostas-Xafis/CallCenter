import FuzzySearch from "@src/fuzzy_search";

export type PhoneRecord = {
    id: number;
    type: string;
    service: string;
    code: string;
};

export class PhoneRepository {
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    /**
     * Get all phone records
     */
    async getAll(): Promise<PhoneRecord[]> {
        const result = await this.db
            .prepare('SELECT * FROM phone_records ORDER BY id')
            .all<PhoneRecord>();
        return result.results;
    }

    /**
     * Get phone records by type
     */
    async getByType(type: string): Promise<PhoneRecord[]> {
        const result = await this.db
            .prepare('SELECT * FROM phone_records WHERE type = ? ORDER BY id')
            .bind(type)
            .all<PhoneRecord>();
        return result.results;
    }

    /**
     * Get phone records by service
     */
    async getByService(service: string): Promise<PhoneRecord[]> {
        const result = await this.db
            .prepare('SELECT * FROM phone_records WHERE service = ? ORDER BY id')
            .bind(service)
            .all<PhoneRecord>();
        return result.results;
    }

    /**
     * Get phone record by code
     */
    async getByCode(code: string): Promise<PhoneRecord | null> {
        return await this.db
            .prepare('SELECT * FROM phone_records WHERE code = ? LIMIT 1')
            .bind(code)
            .first<PhoneRecord>();
    }

    /**
     * Search phone records with flexible matching
     */
    async search(query: string): Promise<PhoneRecord[]> {
        const result = await this.db
            .prepare(
                'SELECT * FROM phone_records WHERE type LIKE ? OR service LIKE ? OR code LIKE ? ORDER BY id'
            )
            .bind(`%${query}%`, `%${query}%`, `%${query}%`)
            .all<PhoneRecord>();
        return result.results;
    }

    /**
     * Fuzzy search phone records by service and code using custom fuzzy search
     * Returns ranked results based on relevance
     */
    async fuzzySearch(query: string, options?: {
        threshold?: number;  // 0.0 = perfect match, 1.0 = match anything (default: 0.4)
        limit?: number;      // Max results to return
    }): Promise<PhoneRecord[]> {
        const allRecords = await this.getAll();
        const threshold = options?.threshold ?? 0.4;
        const searchableItems = allRecords.map(record => `${record.service} ${record.code}`);

        const recordsBySearchItem = new Map<string, PhoneRecord[]>();
        allRecords.forEach(record => {
            const key = `${record.service} ${record.code}`;
            const bucket = recordsBySearchItem.get(key) ?? [];
            bucket.push(record);
            recordsBySearchItem.set(key, bucket);
        });

        const fuzzySearch = new FuzzySearch(searchableItems);
        const results = fuzzySearch.search(query, threshold);

        return results
            .flatMap(result => {
                const bucket = recordsBySearchItem.get(result.item);
                const matchedRecord = bucket?.shift();
                if (!matchedRecord) return [];
                return [{ ...matchedRecord, matchesIdx: result.matchesIdx } as PhoneRecord];
            })
            .slice(0, options?.limit);
    }

    /**
     * Get unique types
     */
    async getUniqueTypes(): Promise<string[]> {
        const result = await this.db
            .prepare('SELECT DISTINCT type FROM phone_records ORDER BY type')
            .all<{ type: string }>();
        return result.results.map(row => row.type);
    }

    /**
     * Get unique services
     */
    async getUniqueServices(): Promise<string[]> {
        const result = await this.db
            .prepare('SELECT DISTINCT service FROM phone_records ORDER BY service')
            .all<{ service: string }>();
        return result.results.map(row => row.service);
    }

    /**
     * Get total count of records
     */
    async getCount(): Promise<number> {
        const result = await this.db
            .prepare('SELECT COUNT(*) as count FROM phone_records')
            .first<{ count: number }>();
        return result?.count ?? 0;
    }

    /**
     * Get statistics by type
     */
    async getStatsByType(): Promise<{ type: string; count: number }[]> {
        const result = await this.db
            .prepare(
                'SELECT type, COUNT(*) as count FROM phone_records GROUP BY type ORDER BY count DESC'
            )
            .all<{ type: string; count: number }>();
        return result.results;
    }
}
