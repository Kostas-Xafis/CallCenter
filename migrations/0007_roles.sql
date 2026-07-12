-- Add role column to users for role-based access control
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Add role column to sessions so role is available without a users join on every request
ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
