use super::*;
use crate::history::{
    HistoryDatabase,
    schema::{MIGRATIONS, Migration},
};
use crate::sessions::Account;
use std::path::Path;
use std::time::Instant;
use tempfile::tempdir;

const URL: &str = "https://profiles.example.test/chat";
const ME: &str = "mmmmmmmmmmmmmmmmmmmmmmmmmm";

fn account() -> Account {
    Account::new(URL, ME).unwrap()
}
fn open(root: &Path) -> AccountHistory {
    AccountHistory::open(root, &account()).unwrap()
}

fn person(index: usize, time: Option<i64>) -> ChannelProfile {
    ChannelProfile {
        id: format!("{index:026}"),
        username: format!("user-{index}"),
        first_name: "Имя".into(),
        last_name: "Last".into(),
        nickname: String::new(),
        position: "Engineer".into(),
        update_at: time,
        delete_at: Some(0),
        last_picture_update: Some(73),
        is_bot: false,
        is_guest: true,
        remote_username: String::new(),
    }
}
fn lookup(ids: &[&str], names: &[&str]) -> ProfileQuery {
    ProfileQuery {
        ids: ids.iter().map(|s| (*s).into()).collect(),
        usernames: names.iter().map(|s| (*s).into()).collect(),
    }
}

#[test]
fn updates_are_atomic_and_versions_survive_reopening() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    let mut current = person(10, None);
    let query = lookup(&[&current.id], &[]);
    assert_eq!(db.read_profiles(&query).unwrap(), ProfileLookup::default());
    db.store_profiles(&[current.clone()]).unwrap();
    let mut partial = current.clone();
    partial.first_name.clear();
    partial.position.clear();
    open(root.path()).store_profiles(&[partial]).unwrap();
    assert_eq!(
        db.read_profiles(&query).unwrap().profiles[&current.id],
        current
    );
    current.update_at = Some(0);
    current.username = "new-name".into();
    current.is_bot = true;
    db.store_profiles(&[current.clone()]).unwrap();
    let mut other = open(root.path());
    other.store_profiles(&[person(10, None)]).unwrap();
    assert_eq!(
        other.read_profiles(&query).unwrap().profiles[&current.id],
        current
    );
    current.update_at = Some(85);
    current.delete_at = Some(86);
    current.remote_username = "remote-user".into();
    other.store_profiles(&[current.clone()]).unwrap();
    db.store_profiles(&[person(10, Some(84))]).unwrap();
    assert_eq!(
        db.read_profiles(&query).unwrap().profiles[&current.id],
        current
    );
    let mut same_millisecond = current.clone();
    same_millisecond.position = "Earlier response arriving late".into();
    db.store_profiles(&[same_millisecond]).unwrap();
    assert_eq!(
        other.read_profiles(&query).unwrap().profiles[&current.id],
        current
    );
    current.update_at = Some(87);
    current.position = "New title".into();
    db.store_profiles(&[current.clone()]).unwrap();
    db.store_profiles(&[]).unwrap();
    db.write(|tx|tx.execute_batch("CREATE TEMP TRIGGER reject_profile BEFORE INSERT ON channel_profile WHEN NEW.username='user-20' BEGIN SELECT RAISE(ABORT,'fixture'); END")).unwrap();
    assert_eq!(
        db.store_profiles(&[person(10, Some(99)), person(20, Some(1))]),
        Err(HistoryError::Storage)
    );
    drop(db);
    let total = open(root.path())
        .read_profiles(&lookup(&[&current.id], &["new-name", "user-20"]))
        .unwrap();
    assert_eq!(
        total.profiles,
        BTreeMap::from([(current.id.clone(), current.clone())])
    );
    assert_eq!(
        total.usernames,
        BTreeMap::from([("new-name".into(), current.id)])
    );
}

#[test]
fn names_resolve_only_when_unambiguous_even_for_a_mixed_query() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    let mut a = person(1, Some(10));
    let mut b = person(2, Some(300));
    b.username.clone_from(&a.username);
    db.store_profiles(&[a.clone(), b.clone()]).unwrap();
    let mixed = db
        .read_profiles(&lookup(
            &[&a.id, &a.id],
            &[&a.username, "missing", &a.username],
        ))
        .unwrap();
    assert_eq!(mixed.profiles.len(), 1);
    assert_eq!(mixed.profiles[&a.id], a);
    assert!(mixed.usernames.is_empty());
    assert!(
        db.read_profiles(&lookup(&[], &[&b.username]))
            .unwrap()
            .profiles
            .is_empty()
    );
    a.username = "renamed".into();
    a.update_at = Some(301);
    db.store_profiles(&[a.clone()]).unwrap();
    let next = db
        .read_profiles(&lookup(&[&a.id], &[&b.username, &a.username]))
        .unwrap();
    assert_eq!(next.profiles.len(), 2);
    assert_eq!(next.usernames[&a.username], a.id);
    assert_eq!(next.usernames[&b.username], b.id);
}

#[test]
fn validates_batches_and_expires_old_accounts_and_views() {
    let root = tempdir().unwrap();
    let mut old = open(root.path());
    let a = person(1, Some(3));
    old.store_profiles(std::slice::from_ref(&a)).unwrap();
    for bad in [
        ChannelProfile {
            id: "bad".into(),
            ..person(2, Some(4))
        },
        ChannelProfile {
            username: " ".into(),
            ..person(2, Some(4))
        },
        ChannelProfile {
            last_picture_update: Some(1_i64 << 53),
            ..person(2, Some(4))
        },
        ChannelProfile {
            delete_at: Some(-1),
            ..person(2, Some(4))
        },
        person(2, Some(-2)),
        a.clone(),
    ] {
        assert_eq!(
            old.store_profiles(&[a.clone(), bad]),
            Err(HistoryError::InvalidDirectory)
        );
    }
    for bad in [lookup(&["short"], &[]), lookup(&[], &[" "])] {
        assert_eq!(old.read_profiles(&bad), Err(HistoryError::InvalidDirectory));
    }
    let query = lookup(&[&a.id], &[&a.username]);
    HistoryDatabase::retire_existing(root.path(), &account(), true).unwrap();
    assert_eq!(old.read_profiles(&query), Err(HistoryError::StaleOwner));
    assert_eq!(
        old.store_profiles(&[person(1, Some(9))]),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        open(root.path()).read_profiles(&query).unwrap().profiles[&a.id],
        a
    );
    HistoryDatabase::purge_account(root.path(), &account()).unwrap();
    let next = Account::new(URL, "nnnnnnnnnnnnnnnnnnnnnnnnnn").unwrap();
    assert_eq!(
        AccountHistory::open(root.path(), &next)
            .unwrap()
            .read_profiles(&query)
            .unwrap(),
        ProfileLookup::default()
    );
}

#[test]
fn upgrades_populated_versions_and_rolls_back_a_failed_index() {
    for version in 1..=5 {
        let root = tempdir().unwrap();
        let mut old = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]).unwrap();
        let owner = old.restore(&account()).unwrap();
        if version >= 2 {
            old.write(&owner,|tx|tx.execute("INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
                VALUES(?1,?1,?1,1,2,0,'','preserved','',0)",[ME])).unwrap();
        }
        if version >= 4 {
            old.write(&owner,|tx|tx.execute_batch("INSERT INTO team_directory(owner,published) VALUES(1,1);
                INSERT INTO joined_team(position,team_id,name,display_name,selected) VALUES(0,'mmmmmmmmmmmmmmmmmmmmmmmmmm','prior','Prior',1)")).unwrap();
        }
        if version == 5 {
            old.write(&owner, |tx| {
                tx.execute(
                    "INSERT INTO sidebar_team(team_id,published) VALUES(?1,1)",
                    [ME],
                )
            })
            .unwrap();
        }
        drop(old);
        if version == 5 {
            let mut faulty: Vec<_> = MIGRATIONS[..5]
                .iter()
                .map(|m| Migration {
                    statements: m.statements,
                    objects: m.objects,
                })
                .collect();
            faulty.push(Migration {
                statements: &[
                    include_str!("../migrations/0006_channel_profile.sql"),
                    "CREATE INDEX broken ON missing_table(id)",
                ],
                objects: MIGRATIONS[5].objects,
            });
            assert!(matches!(
                HistoryDatabase::open_with(root.path(), URL, &faulty),
                Err(HistoryError::Storage)
            ));
            let mut previous =
                HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..5]).unwrap();
            assert_eq!(
                previous.restore(&account()).unwrap().generation,
                owner.generation
            );
        }
        let mut current = open(root.path());
        assert_eq!(current.owner.generation, owner.generation);
        if version >= 2 {
            assert_eq!(current.read_post(ME).unwrap().unwrap().message, "preserved");
        }
        if version >= 4 {
            assert_eq!(
                current
                    .read_team_directory()
                    .unwrap()
                    .unwrap()
                    .selected_team
                    .as_deref(),
                Some(ME)
            );
        }
        if version == 5 {
            assert!(current.read_sidebar(ME).unwrap().is_some());
        }
        let new = person(6, Some(10));
        current.store_profiles(std::slice::from_ref(&new)).unwrap();
        drop(current);
        assert!(matches!(
            HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]),
            Err(HistoryError::UnsupportedSchema)
        ));
        assert_eq!(
            open(root.path())
                .read_profiles(&lookup(&[], &[&new.username]))
                .unwrap()
                .profiles[&new.id],
            new
        );
    }
}

#[test]
fn indexed_reads_cover_the_visible_subset_at_workspace_sizes() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    for count in [100, 5000] {
        let rows: Vec<_> = (0..count).map(|n| person(n, Some(2))).collect();
        let started = Instant::now();
        db.store_profiles(&rows).unwrap();
        let write = started.elapsed();
        let query = ProfileQuery {
            ids: rows.iter().rev().take(50).map(|p| p.id.clone()).collect(),
            usernames: rows.iter().take(50).map(|p| p.username.clone()).collect(),
        };
        let started = Instant::now();
        let result = db.read_profiles(&query).unwrap();
        let read = started.elapsed();
        assert_eq!(result.profiles.len(), 100);
        assert_eq!(result.usernames.len(), 50);
        eprintln!("profiles {count} rows: write {write:?}, read 100 {read:?}");
    }
    db.read(|tx| {
        for (sql, index) in [
            (BY_ID, "PRIMARY KEY"),
            (BY_NAME, "channel_profile_by_username"),
        ] {
            let mut query = tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
            let plan = query
                .query_map([ME], |row| row.get::<_, String>(3))?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .join(" ");
            assert!(
                plan.contains("SEARCH channel_profile USING") && plan.contains(index),
                "{plan}"
            );
            assert!(!plan.contains("TEMP B-TREE"), "{plan}");
        }
        Ok(())
    })
    .unwrap();
}
