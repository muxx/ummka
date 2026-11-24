use crate::registry::{
    ACTIVE, InstallationRegistry as Registry, InstallationSelection, ORDERED, RegistryError,
    SELECT_NEIGHBOR, schema,
};
use rusqlite::{Connection, params_from_iter};
use std::{fs, path::Path, sync::Barrier, thread};
use tempfile::tempdir;

const A: &str = "https://chat.example.test/A";
const B: &str = "https://chat.example.test/B";
const C: &str = "https://chat.example.test/C";

fn legacy(path: &Path) {
    let db = Connection::open(path).unwrap();
    db.execute(schema::V1, []).unwrap();
    for url in [C, A, B] {
        db.execute("INSERT INTO installations VALUES (?1)", [url])
            .unwrap();
    }
    db.pragma_update(None, "user_version", 1).unwrap();
}

#[test]
fn reads_legacy_without_writing_then_upgrades_once_on_first_change() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("registry");
    let missing = dir.path().join("missing/registry");
    assert_eq!(
        Registry::read_selection(&missing).unwrap(),
        InstallationSelection::default()
    );
    assert!(!missing.parent().unwrap().exists());
    legacy(&path);
    let before = fs::read(&path).unwrap();
    let expected = InstallationSelection {
        installations: vec![A.into(), B.into(), C.into()],
        selected: Some(A.into()),
    };
    assert_eq!(Registry::read_selection(&path).unwrap(), expected);
    assert_eq!(fs::read(&path).unwrap(), before);
    drop(Registry::open(&path).unwrap());
    assert_eq!(Registry::read_selection(&path).unwrap(), expected);
    let db = Registry::open(&path).unwrap();
    assert_eq!(
        db.select("relative"),
        Err(RegistryError::InvalidInstallation)
    );
    assert_eq!(
        db.select("https://unknown.example.test"),
        Err(RegistryError::UnknownInstallation)
    );
    assert_eq!(Registry::read_selection(&path).unwrap(), expected);
    db.select(B).unwrap();
    db.remember(A).unwrap();
    db.forget(C).unwrap();
    assert_eq!(
        Registry::read_selection(&path).unwrap().selected.as_deref(),
        Some(B)
    );
    db.remember(C).unwrap();
    db.forget(B).unwrap();
    assert_eq!(
        Registry::read_selection(&path).unwrap().selected.as_deref(),
        Some(A)
    );
    db.forget(A).unwrap();
    assert_eq!(
        Registry::read_selection(&path).unwrap().selected.as_deref(),
        Some(C)
    );
    db.remember(A).unwrap();
    db.forget(C).unwrap();
    assert_eq!(
        Registry::read_selection(&path).unwrap().selected.as_deref(),
        Some(A)
    );
    db.forget(A).unwrap();
    assert_eq!(
        Registry::read_selection(&path).unwrap(),
        InstallationSelection::default()
    );
}

#[test]
fn failed_schema_upgrade_rolls_back_with_the_bundled_sqlite() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("registry");
    legacy(&path);
    let mut db = Connection::open(&path).unwrap();
    let pages: u32 = db
        .pragma_query_value(None, "page_count", |r| r.get(0))
        .unwrap();
    let limit: u32 = db
        .query_row(&format!("PRAGMA max_page_count = {pages}"), [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(limit, pages);
    let tx = db.transaction().unwrap();
    assert!(matches!(schema::upgrade(&tx), Err(RegistryError::Storage)));
    drop(tx);
    drop(db);
    let db = Connection::open(&path).unwrap();
    assert!(matches!(schema::identify(&db).unwrap(), schema::Schema::V1));
    assert_eq!(
        Registry::read_selection(&path).unwrap().installations,
        [A, B, C]
    );
    drop(db);
    Registry::open(&path).unwrap().select(C).unwrap();
    assert_eq!(
        Registry::read_selection(&path).unwrap().selected.as_deref(),
        Some(C)
    );
}

#[test]
fn damaged_or_future_files_never_look_like_a_first_launch() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("file");
    fs::write(&path, b"broken storage").unwrap();
    assert_eq!(Registry::read_selection(&path), Err(RegistryError::Storage));
    assert_eq!(
        Registry::read_selection(&path.join("child")),
        Err(RegistryError::Storage)
    );
    fs::remove_file(&path).unwrap();
    legacy(&path);
    let db = Connection::open(&path).unwrap();
    db.pragma_update(None, "user_version", 3).unwrap();
    drop(db);
    let before = fs::read(&path).unwrap();
    assert_eq!(
        Registry::read_selection(&path),
        Err(RegistryError::UnsupportedSchema)
    );
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn concurrent_selection_and_removal_keep_exactly_one_remembered_server_active() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("registry");
    let db = Registry::open(&path).unwrap();
    for url in [A, B, C] {
        db.remember(url).unwrap();
    }
    let start = Barrier::new(2);
    thread::scope(|s| {
        s.spawn(|| {
            let db = Registry::open(&path).unwrap();
            start.wait();
            db.forget(A).unwrap();
        });
        s.spawn(|| {
            let db = Registry::open(&path).unwrap();
            start.wait();
            db.select(C).unwrap();
        });
    });
    let saved = Registry::read_selection(&path).unwrap();
    assert_eq!(saved.installations, [B, C]);
    assert_eq!(saved.selected.as_deref(), Some(C));
}

#[test]
fn looks_up_selection_and_both_neighbors_through_indexes() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("registry");
    let db = Registry::open(&path).unwrap().connection;
    db.execute_batch("WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<800)
        INSERT INTO installations SELECT printf('https://s%04d.example.test', n), n=400 FROM ids; ANALYZE;").unwrap();
    let plan = |sql: &str, args: &[&str]| {
        db.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap()
            .query_map(params_from_iter(args), |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n")
    };
    let listing = plan(ORDERED, &[]);
    assert!(
        listing.contains("COVERING INDEX") && !listing.contains("TEMP B-TREE"),
        "{listing}"
    );
    let active = plan(ACTIVE, &[]);
    assert!(
        active.contains("USING INDEX active_installation"),
        "{active}"
    );
    let neighbors = plan(SELECT_NEIGHBOR, &[B]);
    for predicate in ["url=?", "url<?", "url>?"] {
        assert!(neighbors.contains(predicate), "{neighbors}");
    }
    assert!(!neighbors.contains("TEMP B-TREE"), "{neighbors}");
}
