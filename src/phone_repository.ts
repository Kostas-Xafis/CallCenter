import { createDbConnection } from "@src/db";
import type { Client, ResultSet } from "@libsql/client";
import FuzzySearch from "@src/fuzzy_search";

export type PhoneRecord = {
    id: number;
    type: string;
    service: string;
    code: string;
};

export class PhoneRepository {
    private db: Client;

    constructor() {
        this.db = createDbConnection();
    }

    /**
     * Get all phone records
     */
    async getAll(): Promise<PhoneRecord[]> {
        const result = await this.db.execute('SELECT * FROM phone_records ORDER BY id');
        return result.rows as unknown as PhoneRecord[];
    }

    /**
     * Get phone records by type
     */
    async getByType(type: string): Promise<PhoneRecord[]> {
        const result = await this.db.execute({
            sql: 'SELECT * FROM phone_records WHERE type = ? ORDER BY id',
            args: [type]
        });
        return result.rows as unknown as PhoneRecord[];
    }

    /**
     * Get phone records by service
     */
    async getByService(service: string): Promise<PhoneRecord[]> {
        const result = await this.db.execute({
            sql: 'SELECT * FROM phone_records WHERE service = ? ORDER BY id',
            args: [service]
        });
        return result.rows as unknown as PhoneRecord[];
    }

    /**
     * Get phone record by code
     */
    async getByCode(code: string): Promise<PhoneRecord | null> {
        const result = await this.db.execute({
            sql: 'SELECT * FROM phone_records WHERE code = ? LIMIT 1',
            args: [code]
        });
        return result.rows.length > 0 ? result.rows[0] as unknown as PhoneRecord : null;
    }

    /**
     * Search phone records with flexible matching
     */
    async search(query: string): Promise<PhoneRecord[]> {
        const result = await this.db.execute({
            sql: `SELECT * FROM phone_records 
                  WHERE type LIKE ? OR service LIKE ? OR code LIKE ? 
                  ORDER BY id`,
            args: [`%${query}%`, `%${query}%`, `%${query}%`]
        });
        return result.rows as unknown as PhoneRecord[];
    }

    /**
     * Fuzzy search phone records by service and code using Fuse.js
     * Returns ranked results based on relevance
     */
    async fuzzySearch(query: string, options?: {
        threshold?: number;  // 0.0 = perfect match, 1.0 = match anything (default: 0.4)
        limit?: number;      // Max results to return
    }): Promise<PhoneRecord[]> {
        // Get all records
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

        // Perform fuzzy search in-memory
        const fuzzySearch = new FuzzySearch(searchableItems);
        const results = fuzzySearch.search(query, threshold);

        // Map back to phone records
        return results
            .flatMap(result => {
                const bucket = recordsBySearchItem.get(result.item);
                const matchedRecord = bucket?.shift();

                if (!matchedRecord) {
                    return [];
                }

                return [{
                    ...matchedRecord,
                    matchesIdx: result.matchesIdx
                } as PhoneRecord];
            })
            .slice(0, options?.limit); // Apply limit if specified

    }

    /**
     * Get unique types
     */
    async getUniqueTypes(): Promise<string[]> {
        const result = await this.db.execute('SELECT DISTINCT type FROM phone_records ORDER BY type');
        return result.rows.map(row => row.type as string);
    }

    /**
     * Get unique services
     */
    async getUniqueServices(): Promise<string[]> {
        const result = await this.db.execute('SELECT DISTINCT service FROM phone_records ORDER BY service');
        return result.rows.map(row => row.service as string);
    }

    /**
     * Get total count of records
     */
    async getCount(): Promise<number> {
        const result = await this.db.execute('SELECT COUNT(*) as count FROM phone_records');
        return (result.rows[0] as any).count as number;
    }

    /**
     * Get statistics by type
     */
    async getStatsByType(): Promise<{ type: string; count: number; }[]> {
        const result = await this.db.execute(
            'SELECT type, COUNT(*) as count FROM phone_records GROUP BY type ORDER BY count DESC'
        );
        return result.rows as unknown as { type: string; count: number; }[];
    }

    /**
     * Print a single record nicely
     */
    printRecord(record: PhoneRecord): void {
        console.log('━'.repeat(60));
        console.log(`📱 Phone Record #${record.id}`);
        console.log('━'.repeat(60));
        console.log(`  Type:       ${record.type}`);
        console.log(`  Service:    ${record.service}`);
        console.log(`  Code:       ${record.code}`);
        console.log('━'.repeat(60));
    }

    /**
     * Print multiple records in a table format
     */
    printRecords(records: PhoneRecord[]): void {
        if (records.length === 0) {
            console.log('No records found.');
            return;
        }

        console.log('\n' + '═'.repeat(80));
        console.log(`📊 Phone Records (${records.length} total)`);
        console.log('═'.repeat(80));

        // Header
        const header = `${'ID'.padEnd(6)} | ${'Type'.padEnd(15)} | ${'Service'.padEnd(20)} | ${'Code'.padEnd(15)}`;
        console.log(header);
        console.log('─'.repeat(80));

        // Rows
        records.forEach(record => {
            const row = `${String(record.id).padEnd(6)} | ${record.type.padEnd(15)} | ${record.service.padEnd(20)} | ${record.code.padEnd(15)}`;
            console.log(row);
        });

        console.log('═'.repeat(80) + '\n');
    }

    /**
     * Print statistics summary
     */
    async printStats(): Promise<void> {
        const total = await this.getCount();
        const types = await this.getUniqueTypes();
        const services = await this.getUniqueServices();
        const statsByType = await this.getStatsByType();

        console.log('\n' + '╔' + '═'.repeat(58) + '╗');
        console.log('║' + ' 📈 Database Statistics'.padEnd(58) + '║');
        console.log('╠' + '═'.repeat(58) + '╣');
        console.log('║' + `  Total Records:      ${total}`.padEnd(58) + '║');
        console.log('║' + `  Unique Types:       ${types.length}`.padEnd(58) + '║');
        console.log('║' + `  Unique Services:    ${services.length}`.padEnd(58) + '║');
        console.log('╠' + '═'.repeat(58) + '╣');
        console.log('║' + ' Records by Type:'.padEnd(58) + '║');

        statsByType.forEach(stat => {
            const bar = '█'.repeat(Math.min(30, Math.floor(stat.count / 10)));
            const line = `  ${stat.type.padEnd(15)} ${String(stat.count).padStart(5)} ${bar}`;
            console.log('║' + line.padEnd(58) + '║');
        });

        console.log('╚' + '═'.repeat(58) + '╝\n');
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}

if (import.meta.main) {
    (async () => {
        const repo = new PhoneRepository();
        const input = process.argv[2]?.normalize("NFD").replace(/\p{Diacritic}/gu, "") || "";

        try {
            await repo.printStats();
            const all = await repo.getAll();
            console.log(`\nFound ${all.length} total records`);

            console.log('\n🔍 Fuzzy Search Example:');
            const fuzzyResults = await repo.fuzzySearch(input);
            if (fuzzyResults.length > 0) {
                repo.printRecords(fuzzyResults);
            }
        } catch (error) {
            console.error('Error:', error);
        } finally {
            repo.close();
        }
    })();
}