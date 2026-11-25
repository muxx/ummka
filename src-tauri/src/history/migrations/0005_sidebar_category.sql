CREATE TABLE sidebar_category (
    team_id TEXT NOT NULL REFERENCES sidebar_team(team_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    category_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    display_name TEXT NOT NULL,
    sorting TEXT NOT NULL,
    collapsed INTEGER NOT NULL CHECK (collapsed IN (0,1)),
    muted INTEGER NOT NULL CHECK (muted IN (0,1)),
    PRIMARY KEY (team_id, position),
    UNIQUE (team_id, category_id)
) STRICT, WITHOUT ROWID;
