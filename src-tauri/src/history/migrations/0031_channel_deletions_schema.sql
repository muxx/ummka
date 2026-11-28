CREATE TABLE history_channel_deletion (
    channel_id TEXT PRIMARY KEY,
    owner INTEGER NOT NULL DEFAULT 1 REFERENCES history_owner(slot) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0)
, observation INTEGER CHECK (observation > 0)) STRICT, WITHOUT ROWID;
