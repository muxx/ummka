CREATE TABLE sidebar_team (
    team_id TEXT PRIMARY KEY,
    owner INTEGER NOT NULL DEFAULT 1 REFERENCES history_owner(slot) ON DELETE CASCADE,
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
    pending BLOB CHECK (pending IS NULL OR length(pending) = 16),
    selected_channel TEXT
) STRICT, WITHOUT ROWID;
