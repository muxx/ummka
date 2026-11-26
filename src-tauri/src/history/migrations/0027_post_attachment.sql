CREATE TABLE history_post_attachment (
    observation INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL UNIQUE REFERENCES history_post(id) ON DELETE CASCADE,
    payload TEXT
) STRICT;
