CREATE TABLE channel_membership_change (
    channel_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    owner INTEGER NOT NULL DEFAULT 1 CHECK (owner = 1) REFERENCES history_owner(slot) ON DELETE CASCADE,
    pending BLOB CHECK (pending IS NULL OR length(pending) = 16),
    departed INTEGER NOT NULL DEFAULT 0 CHECK (departed IN (0,1)),
    empty_revision TEXT CHECK (empty_revision IS NULL OR length(empty_revision) = 32),
    CHECK (departed = 0 OR empty_revision IS NOT NULL)
) STRICT, WITHOUT ROWID;
