CREATE TABLE joined_team (
    position INTEGER PRIMARY KEY,
    owner INTEGER NOT NULL DEFAULT 1 REFERENCES team_directory(owner) ON DELETE CASCADE,
    team_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    preference_rank INTEGER CHECK (preference_rank >= 0),
    selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1))
) STRICT;
