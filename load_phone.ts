import { createDbConnection } from "./db.js";
import fs from "fs";
import path from "path";
import readline from "readline";

export async function loadPhoneRecords() {
    const db = createDbConnection();
    const file = path.join(process.cwd(), 'phones.csv');
    const rl = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        const [Type, Service, Code] = line.split(',');
        if (Type === "Type" && Service === "Service" && Code === "Code") {
            // Skip header line
            continue;
        }
        if (Type && Service && Code) {
            try {
                await db.execute(
                    'INSERT INTO phone_records (type, service, code) VALUES (?, ?, ?)',
                    [Type.trim(), Service.trim(), Code.trim()]
                );
            } catch (error) {
                console.error(`Error inserting record: ${line} - ${error}`);
            }
        } else {
            console.warn(`Invalid line format: ${line}`);
        }
    }
    console.log('Phone records loaded successfully.');
}

loadPhoneRecords().catch(err => {
    console.error('Error loading phone records:', err);
});