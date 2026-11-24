use super::{InstallationRegistry, RegistryError};
use std::path::Path;

/// Run the same file-backed round trip on the host and in Android instrumentation.
pub(crate) fn round_trip(path: &Path) -> Result<(), RegistryError> {
    let first = "https://chat.example.test";
    let second = "https://chat.example.test:8443/Team%20One//A%2FB";
    {
        let registry = InstallationRegistry::open(path)?;
        assert!(registry.list()?.is_empty());
        registry.remember(second)?;
        registry.remember(first)?;
        registry.remember(second)?;
        assert_eq!(
            InstallationRegistry::read_selection(path)?
                .selected
                .as_deref(),
            Some(second)
        );
        registry.select(first)?;
    }
    {
        let registry = InstallationRegistry::open(path)?;
        assert_eq!(registry.list()?, [first, second]);
        assert_eq!(
            InstallationRegistry::read_selection(path)?
                .selected
                .as_deref(),
            Some(first)
        );
        registry.forget(first)?;
        registry.forget(first)?;
    }
    let selected = InstallationRegistry::read_selection(path)?;
    assert_eq!(selected.installations, [second]);
    assert_eq!(selected.selected.as_deref(), Some(second));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::{fs, sync::Barrier, thread};
    use tempfile::tempdir;

    #[test]
    fn remembers_and_forgets_across_reopens() {
        let dir = tempdir().unwrap();
        round_trip(&dir.path().join("installations.sqlite")).unwrap();
    }

    #[test]
    fn keeps_addresses_distinct_and_rejects_invalid_changes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("installations.sqlite");
        let registry = InstallationRegistry::open(&path).unwrap();
        let urls = [
            "http://[::1]:8065",
            "https://chat.example.test/A%2FB",
            "https://chat.example.test/O'Connor",
            "https://chat.example.test/a%2Fb",
            "https://chat.example.test/a/b",
        ];
        for url in urls.iter().rev() {
            registry.remember(url).unwrap();
        }
        for invalid in [
            "relative",
            "https://CHAT.example.test",
            "https://chat.example.test:443",
            "https://chat.example.test/",
            "https://private-marker@chat.example.test",
            "https://chat.example.test/team?t=private-marker",
            "https://chat.example.test/#private-marker",
        ] {
            for outcome in [registry.remember(invalid), registry.forget(invalid)] {
                let error = outcome.unwrap_err();
                assert_eq!(error, RegistryError::InvalidInstallation);
                assert!(!format!("{error} {error:?}").contains("private-marker"));
            }
        }
        assert_eq!(registry.list().unwrap(), urls);
    }

    #[test]
    fn serializes_first_open_and_duplicate_inserts() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("installations.sqlite");
        let start = Barrier::new(2);
        let url = "https://chat.example.test/team";
        thread::scope(|scope| {
            for _ in 0..2 {
                scope.spawn(|| {
                    start.wait();
                    InstallationRegistry::open(&path)
                        .unwrap()
                        .remember(url)
                        .unwrap();
                });
            }
        });
        assert_eq!(
            InstallationRegistry::open(&path).unwrap().list().unwrap(),
            [url]
        );
        let sqlite = Connection::open(path).unwrap();
        let version: i64 = sqlite
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn checks_table_constraints_before_exposing_a_version_one_file() {
        let dir = tempdir().unwrap();
        for (name, definition) in [
            (
                "equivalent-external-ddl",
                "create table INSTALLATIONS ( URL text not null, primary key(URL) ) strict",
            ),
            (
                "extra-unique",
                "CREATE TABLE installations(url TEXT PRIMARY KEY NOT NULL, UNIQUE(url COLLATE NOCASE)) STRICT",
            ),
            (
                "extra-check",
                "CREATE TABLE installations(url TEXT PRIMARY KEY NOT NULL CHECK(length(url) < 100)) STRICT",
            ),
            ("no-key", "CREATE TABLE installations(url TEXT) STRICT"),
            (
                "nocase",
                "CREATE TABLE installations(url TEXT PRIMARY KEY COLLATE NOCASE) STRICT",
            ),
            (
                "non-strict",
                "CREATE TABLE installations(url TEXT NOT NULL PRIMARY KEY)",
            ),
            (
                "extra-column",
                "CREATE TABLE installations(url TEXT PRIMARY KEY, other TEXT) STRICT",
            ),
            (
                "extra-object",
                "CREATE TABLE installations (url TEXT PRIMARY KEY NOT NULL) STRICT; CREATE TABLE other(value TEXT)",
            ),
        ] {
            let path = dir.path().join(name);
            {
                let db = Connection::open(&path).unwrap();
                db.execute_batch(definition).unwrap();
                db.execute(
                    "INSERT INTO installations(url) VALUES (?1)",
                    ["https://chat.example.test"],
                )
                .unwrap();
                db.pragma_update(None, "user_version", 1).unwrap();
            }
            let bytes = fs::read(&path).unwrap();
            assert_eq!(
                InstallationRegistry::open(&path).err(),
                Some(RegistryError::UnsupportedSchema),
                "{name}"
            );
            assert_eq!(fs::read(path).unwrap(), bytes);
        }
    }

    #[test]
    fn reopens_its_own_schema_after_sqlite_maintenance() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("maintained.sqlite");
        let url = "https://chat.example.test/Team";
        InstallationRegistry::open(&path)
            .unwrap()
            .remember(url)
            .unwrap();
        {
            let db = Connection::open(&path).unwrap();
            db.execute_batch("ANALYZE; VACUUM;").unwrap();
        }
        assert_eq!(
            InstallationRegistry::open(&path).unwrap().list().unwrap(),
            [url]
        );
    }

    #[test]
    fn leaves_existing_data_intact_on_schema_or_storage_errors() {
        let dir = tempdir().unwrap();
        for (version, error) in [
            (0, RegistryError::UnsupportedSchema),
            (1, RegistryError::UnsupportedSchema),
            (2, RegistryError::UnsupportedSchema),
            (3, RegistryError::UnsupportedSchema),
        ] {
            let path = dir.path().join(format!("version-{version}.sqlite"));
            {
                let db = Connection::open(&path).unwrap();
                db.execute_batch(
                    "CREATE TABLE previous(value TEXT); INSERT INTO previous VALUES ('keep');",
                )
                .unwrap();
                db.pragma_update(None, "user_version", version).unwrap();
            }
            let bytes = fs::read(&path).unwrap();
            assert_eq!(InstallationRegistry::open(&path).err(), Some(error));
            assert_eq!(fs::read(path).unwrap(), bytes);
        }
        let broken = dir.path().join("broken.sqlite");
        let contents = b"an existing file with unrelated data";
        fs::write(&broken, contents).unwrap();
        assert_eq!(
            InstallationRegistry::open(&broken).err(),
            Some(RegistryError::Storage)
        );
        assert_eq!(fs::read(broken).unwrap(), contents);

        let missing = dir.path().join("private-marker").join("registry.sqlite");
        let error = InstallationRegistry::open(&missing).err().unwrap();
        assert_eq!(error, RegistryError::Storage);
        assert!(!format!("{error} {error:?}").contains("private-marker"));
        assert!(InstallationRegistry::open(Path::new("")).is_err());
    }
}

#[cfg(test)]
mod selection;
