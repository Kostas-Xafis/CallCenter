-- Key-value store for table metadata
CREATE TABLE IF NOT EXISTS table_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Initialize version counter at 1 (existing records were seeded by prior migrations)
INSERT OR IGNORE INTO table_meta (key, value) VALUES ('records_version', '1');

-- Increment version on any INSERT into phone_records
CREATE TRIGGER IF NOT EXISTS trg_records_insert
AFTER INSERT ON phone_records
BEGIN
    UPDATE table_meta
    SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    WHERE key = 'records_version';
END;

-- Increment version on any UPDATE to phone_records
CREATE TRIGGER IF NOT EXISTS trg_records_update
AFTER UPDATE ON phone_records
BEGIN
    UPDATE table_meta
    SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    WHERE key = 'records_version';
END;

-- Increment version on any DELETE from phone_records
CREATE TRIGGER IF NOT EXISTS trg_records_delete
AFTER DELETE ON phone_records
BEGIN
    UPDATE table_meta
    SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
    WHERE key = 'records_version';
END;
