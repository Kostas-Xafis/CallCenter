-- Signup invitations table for invitation-based registration flow.
-- No FK to users because invitations are created *before* the user account exists.
CREATE TABLE IF NOT EXISTS signup_invitations (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
