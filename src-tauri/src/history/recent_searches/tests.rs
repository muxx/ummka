use super::*;
use crate::{
    history::{DirectoryTeam, HistoryDatabase, schema::MIGRATIONS},
    sessions::Account,
};
use std::{path::Path, sync::Barrier, thread};
use tempfile::tempdir;

const BASE: &str = "https://search.example.test/chat";
const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const U: &str = "uuuuuuuuuuuuuuuuuuuuuuuuuu";

fn account() -> Account {
    Account::new(BASE, U).unwrap()
}
fn open(path: &Path) -> AccountHistory {
    AccountHistory::open(path, &account()).unwrap()
}

fn directory(db: &mut AccountHistory, ids: &[&str]) {
    let teams: Vec<_> = ids
        .iter()
        .map(|id| DirectoryTeam {
            id: (*id).into(),
            name: (*id).into(),
            display_name: (*id).into(),
            preference_rank: None,
            roles: None,
            group_constrained: None,
        })
        .collect();
    let load = db.begin_team_directory_load().unwrap();
    assert!(db.store_team_directory(load, &teams, None).unwrap());
}

#[test]
fn submitted_terms_are_exact_recent_and_independent_of_the_directory_refresh() {
    let dir = tempdir().unwrap();
    let mut db = open(dir.path());
    assert!(db.recent_team_searches(A).unwrap().is_empty());
    assert!(!db.remember_team_search(A, "unknown team").unwrap());
    directory(&mut db, &[A, B]);
    let first = "from:Аня \"две строки\"";
    for team in [A, B] {
        assert!(db.remember_team_search(team, first).unwrap());
    }
    assert!(db.remember_team_search(A, "case").unwrap());
    assert!(db.remember_team_search(A, "Case").unwrap());
    assert!(db.remember_team_search(A, first).unwrap());
    directory(&mut db, &[B, A]);
    drop(db);
    let mut db = open(dir.path());
    assert_eq!(db.recent_team_searches(A).unwrap(), [first, "Case", "case"]);
    db.forget_team_search(A, first).unwrap();
    db.forget_team_search(A, first).unwrap();
    assert_eq!(db.recent_team_searches(A).unwrap(), ["Case", "case"]);
    assert_eq!(db.recent_team_searches(B).unwrap(), [first]);
    assert_eq!(
        db.remember_team_search(A, " \n "),
        Err(HistoryError::InvalidDirectory)
    );
    assert_eq!(
        db.recent_team_searches(""),
        Err(HistoryError::InvalidDirectory)
    );
    directory(&mut db, &[A]);
    assert!(!db.remember_team_search(B, first).unwrap());
    directory(&mut db, &[A, B]);
    assert!(db.recent_team_searches(B).unwrap().is_empty());
}

#[test]
fn two_windows_share_the_cap_and_logout_retires_both() {
    let dir = tempdir().unwrap();
    let path = dir.path();
    let mut first = open(path);
    directory(&mut first, &[A]);
    let mut second = open(path);
    let start = Barrier::new(2);
    thread::scope(|scope| {
        for (prefix, db) in [("left", &mut first), ("right", &mut second)] {
            let start = &start;
            scope.spawn(move || {
                start.wait();
                for i in 0..7 {
                    assert!(db.remember_team_search(A, &format!("{prefix}{i}")).unwrap());
                }
            });
        }
    });
    let terms = first.recent_team_searches(A).unwrap();
    assert_eq!(terms.len(), 14);
    for prefix in ["left", "right"] {
        let subset: Vec<_> = terms
            .iter()
            .filter(|term| term.starts_with(prefix))
            .cloned()
            .collect();
        assert_eq!(
            subset,
            (0..7)
                .rev()
                .map(|i| format!("{prefix}{i}"))
                .collect::<Vec<_>>()
        );
    }
    for i in 0..23 {
        assert!(
            second
                .remember_team_search(A, &format!("query {i}"))
                .unwrap()
        );
    }
    assert_eq!(
        first.recent_team_searches(A).unwrap(),
        (8..23)
            .rev()
            .map(|i| format!("query {i}"))
            .collect::<Vec<_>>()
    );
    assert!(first.remember_team_search(A, "query 8").unwrap());
    let terms = second.recent_team_searches(A).unwrap();
    assert_eq!(terms.len(), 15);
    assert_eq!(terms[0], "query 8");
    HistoryDatabase::purge_account(path, &account()).unwrap();
    assert_eq!(
        second.recent_team_searches(A),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        first.remember_team_search(A, "late"),
        Err(HistoryError::StaleOwner)
    );
    let replacement = Account::new(BASE, B).unwrap();
    let mut replacement = AccountHistory::open(path, &replacement).unwrap();
    directory(&mut replacement, &[A]);
    assert!(replacement.recent_team_searches(A).unwrap().is_empty());
}

#[test]
fn upgrading_preserves_existing_data_and_queries_seek_within_one_team() {
    let dir = tempdir().unwrap();
    let mut prior = HistoryDatabase::open_with(dir.path(), BASE, &MIGRATIONS[..21]).unwrap();
    let owner = prior.restore(&account()).unwrap();
    prior.write(&owner,|tx|{
        tx.execute("INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
            VALUES (?1,?2,?3,1,1,0,'','before upgrade','',0)",params![B,A,U])?;
        Ok(())
    }).unwrap();
    drop(prior);
    let mut broken: Vec<_> = MIGRATIONS[..21]
        .iter()
        .map(|m| crate::history::schema::Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    broken.push(crate::history::schema::Migration {
        statements: &[
            include_str!("../migrations/0022_team_search.sql"),
            "CREATE INDEX broken_search_index ON missing(position)",
        ],
        objects: MIGRATIONS[21].objects,
    });
    assert_eq!(
        HistoryDatabase::open_with(dir.path(), BASE, &broken).err(),
        Some(HistoryError::Storage)
    );
    let old = HistoryDatabase::open_with(dir.path(), BASE, &MIGRATIONS[..21]).unwrap();
    let untouched: (i64, String) = old.connection.query_row(
        "SELECT (SELECT count(*) FROM sqlite_schema WHERE name='team_search'), message FROM history_post WHERE id=?1",
        [B], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(untouched, (0, "before upgrade".to_owned()));
    drop(old);
    let mut db = open(dir.path());
    assert_eq!(db.read_post(B).unwrap().unwrap().message, "before upgrade");
    assert!(db.recent_team_searches(A).unwrap().is_empty());
    let teams: Vec<_> = (0..40).map(|i| format!("{i:026}")).collect();
    directory(
        &mut db,
        &teams.iter().map(String::as_str).collect::<Vec<_>>(),
    );
    for team in &teams {
        for i in 0..15 {
            db.remember_team_search(team, &format!("term {i}")).unwrap();
        }
    }
    db.read(|tx| {
        for (sql, needle) in [
            (LIST, "team_search_order"),
            (TRIM, "team_search_order"),
            (REMOVE, "sqlite_autoindex_team_search"),
        ] {
            let mut plan = tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
            let details = plan
                .query_map(params![teams[0], 15], |row| row.get::<_, String>(3))?
                .collect::<Result<Vec<_>, _>>()?;
            assert!(
                details
                    .iter()
                    .any(|step| step.contains("SEARCH") && step.contains(needle)),
                "{details:?}"
            );
            assert!(
                !details
                    .iter()
                    .any(|step| step.contains("USE TEMP B-TREE")
                        || step.contains("SCAN team_search")),
                "{details:?}"
            );
        }
        Ok(())
    })
    .unwrap();
    drop(db);
    assert_eq!(
        HistoryDatabase::open_with(dir.path(), BASE, &MIGRATIONS[..21]).err(),
        Some(HistoryError::UnsupportedSchema)
    );
    let mut reopened = open(dir.path());
    assert_eq!(reopened.recent_team_searches(&teams[0]).unwrap().len(), 15);
    assert_eq!(
        reopened.read_post(B).unwrap().unwrap().message,
        "before upgrade"
    );
}
