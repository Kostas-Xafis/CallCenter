-- Users table for password-based authentication
CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL
);

-- Sessions table for cookie-based session management
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username)
);
