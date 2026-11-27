CREATE TABLE history_post_observation (
    owner INTEGER PRIMARY KEY CHECK (owner = 1) REFERENCES history_owner(slot) ON DELETE CASCADE,
    priority INTEGER NOT NULL CHECK (priority > 0)
) STRICT;
