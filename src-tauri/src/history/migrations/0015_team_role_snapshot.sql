CREATE TABLE team_role_snapshot (
    team_id TEXT PRIMARY KEY REFERENCES sidebar_team(team_id) ON DELETE CASCADE,
    pending BLOB CHECK (pending IS NULL OR length(pending) = 16),
    generation BLOB CHECK (generation IS NULL OR length(generation) = 16),
    payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
    CHECK ((generation IS NULL) = (payload IS NULL))
) STRICT, WITHOUT ROWID;
