CREATE TABLE history_thread_summary (
    observation INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL UNIQUE REFERENCES history_post(id) ON DELETE CASCADE,
    root_version INTEGER NOT NULL CHECK (root_version > 0),
    reply_count INTEGER NOT NULL CHECK (reply_count >= 0),
    last_reply_at INTEGER NOT NULL CHECK (last_reply_at >= 0),
    participant_ids TEXT
) STRICT;
