CREATE TABLE workspace_settings (
    owner INTEGER PRIMARY KEY CHECK (owner = 1) REFERENCES history_owner(slot) ON DELETE CASCADE,
    preferences TEXT CHECK (preferences IS NULL OR json_valid(preferences)),
    server TEXT CHECK (server IS NULL OR json_valid(server)),
    pending BLOB CHECK (pending IS NULL OR length(pending) = 16)
) STRICT;
