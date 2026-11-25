CREATE TABLE composer_draft (
    channel_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    owner INTEGER NOT NULL DEFAULT 1 CHECK (owner = 1) REFERENCES history_owner(slot) ON DELETE CASCADE,
    message TEXT NOT NULL,
    revision TEXT NOT NULL CHECK (length(revision) = 32), cleared_by_submission INTEGER CHECK (cleared_by_submission IS NULL OR (cleared_by_submission IN (0,1) AND message = '')),
    PRIMARY KEY (channel_id, root_id)
) STRICT, WITHOUT ROWID;
