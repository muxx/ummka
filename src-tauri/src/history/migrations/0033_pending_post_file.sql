CREATE TABLE pending_post_file (
    pending_id TEXT NOT NULL REFERENCES pending_post(pending_id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9),
    file_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0),
    PRIMARY KEY (pending_id, position),
    UNIQUE (pending_id, file_id)
) STRICT, WITHOUT ROWID;
