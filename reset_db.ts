import { createDbConnection } from "./db.js";
import fs from "fs";
import path from "path";
import readline from "readline";

async function executeSqlFile(db: any, sqlFilePath: string) {
    const sql = fs.readFileSync(sqlFilePath, 'utf-8');
    const statements = sql.split(';').filter(stmt => stmt.trim());

    for (const statement of statements) {
        if (statement.trim()) {
            await db.execute(statement);
        }
    }
    console.log(`Executed: ${sqlFilePath}`);
}

async function loadPhoneRecords(db: any) {
    const file = path.join(process.cwd(), 'phones.csv');
    const rl = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity
    });

    let count = 0;
    for await (const line of rl) {
        const [Type, Service, Code] = line.split(',');
        if (Type === "Type") {
            // Skip header line
            continue;
        }
        if (Type && Service && Code) {
            try {
                await db.execute(
                    'INSERT INTO phone_records (type, service, code) VALUES (?, ?, ?)',
                    [Type.trim(), Service.trim(), Code.trim()]
                );
                count++;
            } catch (error) {
                console.error(`Error inserting record: ${line} - ${error}`);
            }
        } else {
            console.warn(`Invalid line format: ${line}`);
        }
    }
    console.log(`Loaded ${count} phone records successfully.`);
}

async function resetDatabase() {
    console.log('Starting database reset...');
    const db = createDbConnection();

    try {
        // Step 1: Drop existing tables
        console.log('Dropping existing tables...');
        await executeSqlFile(db, path.join(process.cwd(), 'sqlite', 'drop.sql'));

        // Step 2: Create tables and indexes
        console.log('Creating tables and indexes...');
        await executeSqlFile(db, path.join(process.cwd(), 'sqlite', 'callcenter.sql'));

        // Step 3: Load data from CSV
        console.log('Loading phone records from CSV...');
        await loadPhoneRecords(db);

        console.log('Database reset completed successfully! ✓');
    } catch (error) {
        console.error('Error during database reset:', error);
        process.exit(1);
    }
}

resetDatabase();
