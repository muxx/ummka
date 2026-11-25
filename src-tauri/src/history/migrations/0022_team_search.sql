CREATE TABLE team_search (
    position INTEGER PRIMARY KEY,
    owner INTEGER NOT NULL DEFAULT 1 REFERENCES history_owner(slot) ON DELETE CASCADE,
    team_id TEXT NOT NULL,
    term TEXT NOT NULL CHECK (term <> ''),
    UNIQUE (team_id, term)
) STRICT;
