CREATE TABLE IF NOT EXISTS phone_records (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    type    TEXT    NOT NULL,
    service TEXT    NOT NULL,
    code    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_type    ON phone_records(type);
CREATE INDEX IF NOT EXISTS idx_service ON phone_records(service);
CREATE INDEX IF NOT EXISTS idx_code    ON phone_records(code);
