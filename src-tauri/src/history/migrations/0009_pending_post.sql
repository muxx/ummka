CREATE TABLE pending_post (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    pending_id TEXT NOT NULL UNIQUE,
    owner INTEGER NOT NULL DEFAULT 1 CHECK (owner = 1) REFERENCES history_owner(slot) ON DELETE CASCADE,
    login_generation BLOB NOT NULL CHECK (length(login_generation) = 16),
    channel_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
