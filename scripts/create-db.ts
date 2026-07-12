#!/usr/bin/env bun
/**
 * Create a fresh SQLite database with all migrations applied.
 *
 * Usage:
 *   bun run db:create
 */

import { unlinkSync } from "fs";
import { closeDb, getDb } from "../db";

const DB_PATH = "sqlite/callcenter.db";

// Remove existing database files
for (const suffix of ["", "-wal", "-shm"]) {
    try {
        unlinkSync(DB_PATH + suffix);
        console.log(`Removed ${DB_PATH}${suffix}`);
    } catch {
        // File doesn't exist — that's fine
    }
}

// Initialize the database (runs all migrations and seeds)
const db = getDb(DB_PATH);
console.log("All migrations and seeds applied successfully.");

closeDb();
