use super::*;
use crate::history::{DirectoryTeam, HistoryDatabase, schema::MIGRATIONS};
use crate::sessions::Account;
use std::{path::Path, time::Instant};
use tempfile::tempdir;

const URL: &str = "https://sidebar.example.test/mm";
const USER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEAM: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const OTHER: &str = "cccccccccccccccccccccccccc";

fn account() -> Account {
    Account::new(URL, USER).unwrap()
}
fn open(root: &Path) -> AccountHistory {
    AccountHistory::open(root, &account()).unwrap()
}
fn teams(db: &mut AccountHistory, ids: &[&str]) {
    let load = db.begin_team_directory_load().unwrap();
    let rows = ids
        .iter()
        .map(|id| DirectoryTeam {
            id: (*id).into(),
            name: (*id).into(),
            display_name: (*id).into(),
            preference_rank: None,
        })
        .collect::<Vec<_>>();
    assert!(db.store_team_directory(load, &rows).unwrap());
}
fn sidebar(count: usize) -> SidebarData {
    let channels: Vec<_> = (0..count)
        .map(|n| SidebarChannel {
            id: format!("{n:026}"),
            kind: if n % 2 == 0 { "D" } else { "O" }.into(),
            name: format!("room-{n}"),
            display_name: format!("Room {n}"),
            header: "A header".into(),
            purpose: "Discussion".into(),
            delete_at: 0,
            last_post_at: Some(379),
            last_root_post_at: Some(371),
            total_msg_count: Some(61),
            total_msg_count_root: Some(58),
            last_viewed_at: Some(295),
            msg_count: Some(55),
            msg_count_root: Some(54),
            mention_count: Some(2),
            mention_count_root: Some(1),
            urgent_mention_count: None,
            muted: n % 3 == 0,
        })
        .collect();
    let categories = if channels.is_empty() {
        Vec::new()
    } else {
        vec![SidebarCategory {
            id: "custom_category".into(),
            kind: "custom".into(),
            display_name: "Primary".into(),
            sorting: "manual".into(),
            collapsed: false,
            muted: true,
            channel_ids: channels.iter().rev().map(|row| row.id.clone()).collect(),
        }]
    };
    SidebarData {
        channels,
        categories,
    }
}
fn save(db: &mut AccountHistory, team: &str, data: &SidebarData) {
    let load = db.begin_sidebar_load(team).unwrap().unwrap();
    assert!(db.store_sidebar(load, data).unwrap());
}

#[test]
fn distinguishes_cold_and_empty_and_preserves_the_latest_committed_choice_per_team() {
    let root = tempdir().unwrap();
    let mut a = open(root.path());
    let mut b = open(root.path());
    let rows = sidebar(3);
    assert!(a.begin_sidebar_load(TEAM).unwrap().is_none());
    teams(&mut a, &[TEAM, OTHER]);
    assert_eq!(a.read_sidebar(TEAM).unwrap(), None);
    save(&mut a, TEAM, &sidebar(0));
    assert_eq!(b.read_sidebar(TEAM).unwrap().unwrap().data, sidebar(0));
    save(&mut a, TEAM, &rows);
    save(&mut b, OTHER, &rows);
    let earlier = a.begin_sidebar_load(TEAM).unwrap().unwrap();
    let latest = b.begin_sidebar_load(TEAM).unwrap().unwrap();
    assert!(
        a.select_sidebar_channel(TEAM, &rows.channels[2].id)
            .unwrap()
    );
    assert!(
        b.select_sidebar_channel(OTHER, &rows.channels[1].id)
            .unwrap()
    );
    assert!(!a.select_sidebar_channel(TEAM, USER).unwrap());
    assert!(!a.store_sidebar(earlier, &sidebar(0)).unwrap());
    assert!(b.store_sidebar(latest, &rows).unwrap());
    teams(&mut a, &[OTHER, TEAM]);
    let saved = open(root.path()).read_sidebar(TEAM).unwrap().unwrap();
    assert_eq!(
        saved.selected_channel.as_deref(),
        Some(rows.channels[2].id.as_str())
    );
    assert_eq!(saved.data, rows);
    save(&mut a, TEAM, &sidebar(1));
    assert_eq!(
        b.read_sidebar(TEAM).unwrap().unwrap().selected_channel,
        None
    );
    assert_eq!(
        b.read_sidebar(OTHER).unwrap().unwrap().selected_channel,
        Some(rows.channels[1].id.clone())
    );
}

#[test]
fn membership_loss_and_new_logins_invalidate_outstanding_loads() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    let rows = sidebar(2);
    teams(&mut db, &[TEAM, OTHER]);
    save(&mut db, TEAM, &rows);
    save(&mut db, OTHER, &rows);
    let excluded = db.begin_sidebar_load(TEAM).unwrap().unwrap();
    teams(&mut db, &[OTHER]);
    assert_eq!(db.read_sidebar(TEAM).unwrap(), None);
    teams(&mut db, &[TEAM, OTHER]);
    assert!(!db.store_sidebar(excluded, &rows).unwrap());
    let old = db.begin_sidebar_load(OTHER).unwrap().unwrap();
    db.database.new_login(&account()).unwrap();
    let mut fresh = open(root.path());
    assert_eq!(db.read_sidebar(OTHER), Err(HistoryError::StaleOwner));
    assert_eq!(
        fresh.store_sidebar(old, &rows),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(fresh.read_sidebar(OTHER).unwrap().unwrap().data, rows);
    HistoryDatabase::purge_account(root.path(), &account()).unwrap();
    assert_eq!(fresh.read_sidebar(OTHER), Err(HistoryError::StaleOwner));
    let mut new = open(root.path());
    for table in [
        "sidebar_team",
        "sidebar_channel",
        "sidebar_category",
        "sidebar_item",
    ] {
        assert_eq!(
            new.read(
                |tx| tx.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
            )
            .unwrap(),
            0
        );
    }
}

#[test]
fn invalid_or_partial_replacements_never_publish() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    teams(&mut db, &[TEAM]);
    let saved = sidebar(3);
    save(&mut db, TEAM, &saved);
    db.select_sidebar_channel(TEAM, &saved.channels[1].id)
        .unwrap();
    let before = db.read_sidebar(TEAM).unwrap();
    for change in [0, 1, 2, 3] {
        let mut bad = sidebar(2);
        match change {
            0 => bad.channels[1].id = bad.channels[0].id.clone(),
            1 => bad.channels[0].kind = "invalid".into(),
            2 => bad.categories[0].channel_ids[0] = USER.into(),
            _ => bad.channels[1].msg_count = Some(-1),
        }
        let load = db.begin_sidebar_load(TEAM).unwrap().unwrap();
        assert_eq!(
            db.store_sidebar(load, &bad),
            Err(HistoryError::InvalidDirectory)
        );
    }
    db.write(|tx|tx.execute_batch("CREATE TEMP TRIGGER fail_category BEFORE INSERT ON sidebar_category BEGIN SELECT RAISE(ABORT,'fixture'); END;")).unwrap();
    let load = db.begin_sidebar_load(TEAM).unwrap().unwrap();
    assert_eq!(
        db.store_sidebar(load, &sidebar(1)),
        Err(HistoryError::Storage)
    );
    drop(db);
    assert_eq!(open(root.path()).read_sidebar(TEAM).unwrap(), before);
}

#[test]
fn version_five_opens_populated_prior_formats_and_older_readers_preserve_the_new_data() {
    let rows = sidebar(1);
    for version in 1..=4 {
        let root = tempdir().unwrap();
        let mut previous =
            HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]).unwrap();
        let owner = previous.restore(&account()).unwrap();
        if version >= 2 {
            previous.write(&owner,|tx|tx.execute("INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
                    VALUES(?1,?2,?3,1,1,0,'','kept','',0)",params![USER,OTHER,USER])).unwrap();
        }
        if version == 4 {
            previous.write(&owner,|tx|tx.execute_batch("INSERT INTO team_directory(owner,published) VALUES(1,1);
                INSERT INTO joined_team(position,team_id,name,display_name,selected) VALUES(0,'bbbbbbbbbbbbbbbbbbbbbbbbbb','kept','Kept',1);")).unwrap();
        }
        drop(previous);
        let mut next = open(root.path());
        assert_eq!(next.read_sidebar(TEAM).unwrap(), None);
        if version == 4 {
            assert_eq!(
                next.read_team_directory()
                    .unwrap()
                    .unwrap()
                    .selected_team
                    .as_deref(),
                Some(TEAM)
            );
        } else {
            teams(&mut next, &[TEAM]);
        }
        save(&mut next, TEAM, &rows);
        drop(next);
        assert!(matches!(
            HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]),
            Err(HistoryError::UnsupportedSchema)
        ));
        let mut reopened = open(root.path());
        assert_eq!(reopened.read_sidebar(TEAM).unwrap().unwrap().data, rows);
        if version >= 2 {
            assert_eq!(reopened.read_post(USER).unwrap().unwrap().message, "kept");
        }
    }
}

#[test]
fn scoped_order_and_id_lookups_use_indexes_at_workspace_sizes() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    teams(&mut db, &[TEAM, OTHER]);
    for count in [107, 5000] {
        let data = sidebar(count);
        let began = Instant::now();
        save(&mut db, TEAM, &data);
        let written = began.elapsed();
        let began = Instant::now();
        let saved = db.read_sidebar(TEAM).unwrap().unwrap();
        let read = began.elapsed();
        let began = Instant::now();
        assert!(
            db.select_sidebar_channel(TEAM, &data.channels[count / 2].id)
                .unwrap()
        );
        let chosen = began.elapsed();
        assert_eq!(saved.data, data);
        eprintln!("sidebar {count} rows: write {written:?}, read {read:?}, select {chosen:?}");
    }
    db.read(|tx| {
        for (sql, table) in [
            (READ_CHANNELS, "sidebar_channel"),
            (READ_CATEGORIES, "sidebar_category"),
            (READ_ITEMS, "sidebar_item"),
            (KNOWN_CHANNEL, "sidebar_channel"),
        ] {
            let mut stmt = tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
            let args: Vec<&str> = if sql == KNOWN_CHANNEL {
                vec![TEAM, USER]
            } else {
                vec![TEAM]
            };
            let steps = stmt
                .query_map(rusqlite::params_from_iter(args), |r| r.get::<_, String>(3))?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .join(" ");
            assert!(steps.contains(&format!("SEARCH {table} USING")), "{steps}");
            assert!(!steps.contains("TEMP B-TREE"), "{steps}");
            if sql == KNOWN_CHANNEL {
                assert!(steps.contains("channel_id=?"), "{steps}");
            }
        }
        Ok(())
    })
    .unwrap();
}
