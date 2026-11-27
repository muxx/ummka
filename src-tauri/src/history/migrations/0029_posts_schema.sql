CREATE TABLE history_post (
    id TEXT PRIMARY KEY,
    owner INTEGER NOT NULL DEFAULT 1 REFERENCES history_owner(slot) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    root_id TEXT,
    create_at INTEGER NOT NULL,
    update_at INTEGER NOT NULL,
    edit_at INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    message_source TEXT,
    hashtags TEXT NOT NULL,
    is_pinned INTEGER NOT NULL CHECK (is_pinned IN (0, 1))
, from_webhook INTEGER CHECK (from_webhook IN (0, 1))) STRICT, WITHOUT ROWID;
