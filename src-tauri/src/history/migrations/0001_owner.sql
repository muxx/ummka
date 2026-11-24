CREATE TABLE history_owner (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    installation TEXT NOT NULL,
    user_id TEXT NOT NULL,
    generation BLOB NOT NULL CHECK (length(generation) = 16)
) STRICT;
