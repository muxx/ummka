CREATE TABLE history_window_neighbor (
    window_id INTEGER NOT NULL REFERENCES history_window(id) ON DELETE CASCADE,
    anchor_id TEXT NOT NULL,
    older INTEGER NOT NULL CHECK (older IN (0, 1)),
    post_id TEXT NOT NULL,
    PRIMARY KEY (window_id, anchor_id, older)
) STRICT, WITHOUT ROWID;
