CREATE TABLE channel_profile (
    id TEXT PRIMARY KEY,
    owner INTEGER NOT NULL DEFAULT 1 CHECK (owner = 1) REFERENCES history_owner(slot) ON DELETE CASCADE,
    username TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    nickname TEXT NOT NULL,
    position TEXT NOT NULL,
    update_at INTEGER,
    delete_at INTEGER,
    last_picture_update INTEGER,
    is_bot INTEGER NOT NULL CHECK (is_bot IN (0,1)),
    is_guest INTEGER NOT NULL CHECK (is_guest IN (0,1)),
    remote_username TEXT NOT NULL
) STRICT, WITHOUT ROWID;
