CREATE TABLE sidebar_item (
    team_id TEXT NOT NULL,
    category_position INTEGER NOT NULL,
    position INTEGER NOT NULL,
    channel_id TEXT NOT NULL,
    PRIMARY KEY (team_id, category_position, position),
    FOREIGN KEY (team_id, category_position) REFERENCES sidebar_category(team_id, position) ON DELETE CASCADE,
    FOREIGN KEY (team_id, channel_id) REFERENCES sidebar_channel(team_id, channel_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
