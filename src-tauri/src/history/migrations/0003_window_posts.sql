CREATE TABLE history_window_post (
    post_id TEXT NOT NULL REFERENCES history_post(id) ON DELETE CASCADE,
    collapsed INTEGER NOT NULL CHECK (collapsed IN (0, 1)),
    window_id INTEGER NOT NULL REFERENCES history_window(id) ON DELETE CASCADE,
    created INTEGER NOT NULL,
    tie INTEGER NOT NULL,
    PRIMARY KEY (post_id, collapsed)
) STRICT, WITHOUT ROWID;
