import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_DB_PATH = 'sqlite/callcenter.db';
const MIGRATIONS_DIR = 'migrations';

let _db: Database | null = null;
let _dbPath: string | null = null;

/** Get the singleton database instance, running migrations if needed. */
export function getDb(dbPath?: string): Database {
    const resolvedPath = dbPath ?? DEFAULT_DB_PATH;

    // Return cached instance only if the path matches
    if (_db && _dbPath === resolvedPath) return _db;

    // Close existing connection if switching paths (testing)
    if (_db) {
        _db.close();
        _db = null;
    }

    _db = new Database(resolvedPath, { create: true });
    _dbPath = resolvedPath;
    _db.exec('PRAGMA journal_mode = WAL');
    _db.exec('PRAGMA foreign_keys = ON');

    runMigrations(_db);
    return _db;
}

/** Apply all SQL migration files in order. Skips already-applied migrations. */
function runMigrations(db: Database): void {
    // Ensure the migrations tracking table exists
    db.exec(
        `CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
    );

    // Collect migration files sorted by name
    let files: string[];
    try {
        files = readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.sql'))
            .sort();
    } catch {
        console.warn(`Migrations directory "${MIGRATIONS_DIR}" not found — skipping migrations.`);
        return;
    }

    const applied = new Set(
        (db.query('SELECT name FROM _migrations').all() as { name: string; }[]).map(r => r.name)
    );

    for (const file of files) {
        if (applied.has(file)) continue;

        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
        console.log(`Applying migration: ${file}`);

        db.transaction(() => {
            db.exec(sql);
            db.query('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(file);
        })();
    }
}

/** Close the database connection (for graceful shutdown). */
export function closeDb(): void {
    if (_db) {
        _db.close();
        _db = null;
    }
}
