CREATE TABLE team_directory (
    owner INTEGER PRIMARY KEY CHECK (owner = 1) REFERENCES history_owner(slot) ON DELETE CASCADE,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
    pending BLOB CHECK (pending IS NULL OR length(pending) = 16)
) STRICT;
