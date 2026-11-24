use super::RegistryError;
use rusqlite::{Connection, Transaction};

// sqlite_schema preserves the spelling of our DDL, including the result of ALTER TABLE.
pub(super) const V1: &str = "CREATE TABLE installations (url TEXT PRIMARY KEY NOT NULL) STRICT";
const V2: &str = "CREATE TABLE installations (url TEXT PRIMARY KEY NOT NULL, active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))) STRICT";
const ACTIVE_INDEX: &str =
    "CREATE UNIQUE INDEX active_installation ON installations(active) WHERE active = 1";

pub(super) enum Schema {
    Empty,
    V1,
    V2,
}

pub(super) fn identify(db: &Connection) -> Result<Schema, RegistryError> {
    let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 0 {
        let empty: bool =
            db.query_row("SELECT NOT EXISTS(SELECT 1 FROM sqlite_schema)", [], |r| {
                r.get(0)
            })?;
        return if empty {
            Ok(Schema::Empty)
        } else {
            Err(RegistryError::UnsupportedSchema)
        };
    }
    let definitions: &[&str] = match version {
        1 => &[V1],
        2 => &[V2, ACTIVE_INDEX],
        _ => return Err(RegistryError::UnsupportedSchema),
    };
    let mut stmt = db.prepare(
        "SELECT sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type DESC, name",
    )?;
    let actual = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if actual != definitions {
        return Err(RegistryError::UnsupportedSchema);
    }
    Ok(if version == 1 { Schema::V1 } else { Schema::V2 })
}

pub(super) fn upgrade(tx: &Transaction<'_>) -> Result<(), RegistryError> {
    match identify(tx)? {
        Schema::V2 => return Ok(()),
        Schema::Empty => {
            tx.execute(V2, [])?;
            tx.execute(ACTIVE_INDEX, [])?;
        }
        Schema::V1 => {
            tx.execute("ALTER TABLE installations ADD COLUMN active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))", [])?;
            tx.execute(ACTIVE_INDEX, [])?;
            tx.execute("UPDATE installations SET active = 1 WHERE url = (SELECT url FROM installations ORDER BY url LIMIT 1)", [])?;
        }
    }
    tx.pragma_update(None, "user_version", 2)?;
    Ok(())
}
