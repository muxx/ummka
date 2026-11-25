CREATE TABLE post_confirmation (
    pending_id TEXT PRIMARY KEY REFERENCES pending_post(pending_id) ON DELETE CASCADE,
    post_id TEXT NOT NULL UNIQUE
) STRICT, WITHOUT ROWID;
