CREATE TABLE history_window (
    id INTEGER PRIMARY KEY,
    owner INTEGER NOT NULL DEFAULT 1 REFERENCES history_owner(slot) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    collapsed INTEGER NOT NULL CHECK (collapsed IN (0, 1)),
    recent INTEGER NOT NULL DEFAULT 0 CHECK (recent IN (0, 1)),
    newer TEXT,
    older TEXT,
    inaccessible INTEGER NOT NULL DEFAULT 0 CHECK (inaccessible >= 0)
) STRICT;
