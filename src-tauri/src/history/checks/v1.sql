-- A populated RFC 0040 database, kept independent of subsequent migrations.
PRAGMA auto_vacuum = INCREMENTAL;
PRAGMA journal_mode = WAL;
BEGIN IMMEDIATE;
CREATE TABLE history_owner (
    slot INTEGER PRIMARY KEY CHECK (slot = 1),
    installation TEXT NOT NULL,
    user_id TEXT NOT NULL,
    generation BLOB NOT NULL CHECK (length(generation) = 16)
) STRICT;
INSERT INTO history_owner VALUES (
    1, 'https://chat.example.test/migrations', 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
    X'000102030405060708090a0b0c0d0e0f'
);
PRAGMA application_id = 0x554d4849;
PRAGMA user_version = 1;
COMMIT;
