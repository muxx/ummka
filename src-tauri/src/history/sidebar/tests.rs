use super::*;
use crate::history::{
    DirectoryTeam, HistoryDatabase,
    schema::{MIGRATIONS, Migration},
};
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
            roles: Some("team_user".into()),
            group_constrained: None,
        })
        .collect::<Vec<_>>();
    assert!(db.store_team_directory(load, &rows, None).unwrap());
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
            create_at: Some(120),
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
            roles: Some("channel_user custom_writer".into()),
            shared: Some(n % 3 == 1),
            group_constrained: None,
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
fn upgrades_populated_directories_with_unknown_roles_and_restores_the_next_assignments() {
    for version in [5, 7, 12] {
        let root = tempdir().unwrap();
        let mut old = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]).unwrap();
        let owner = old.restore(&account()).unwrap();
        old.write(&owner, |tx| {
            tx.execute("INSERT INTO team_directory(owner,published) VALUES(1,1)", [])?;
            tx.execute("INSERT INTO joined_team(position,team_id,name,display_name,selected)
                        VALUES(0,?1,'old-team','Old team',1)", [TEAM])?;
            tx.execute("INSERT INTO sidebar_team(team_id,published,selected_channel) VALUES(?1,1,?2)", [TEAM, OTHER])?;
            tx.execute("INSERT INTO sidebar_channel(team_id,position,channel_id,kind,name,display_name,header,purpose,delete_at,muted)
                        VALUES(?1,0,?2,'O','old-room','Old room','','',0,0)", [TEAM, OTHER])?;
            Ok(())
        }).unwrap();
        drop(old);
        if version == 12 {
            let mut broken: Vec<_> = MIGRATIONS[..12]
                .iter()
                .map(|m| Migration {
                    statements: m.statements,
                    objects: m.objects,
                })
                .collect();
            const INTERRUPTED: &[&str] = &[
                MIGRATIONS[12].statements[0],
                "ALTER TABLE missing ADD COLUMN roles TEXT",
            ];
            broken.push(Migration {
                statements: INTERRUPTED,
                objects: MIGRATIONS[12].objects,
            });
            assert!(matches!(
                HistoryDatabase::open_with(root.path(), URL, &broken),
                Err(HistoryError::Storage)
            ));
            // Validating the old fingerprint checks that the first ALTER rolled back.
            let prior = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..12]).unwrap();
            assert_eq!(prior.version, 12);
        }
        let mut next = open(root.path());
        let mut team = next.read_team_directory().unwrap().unwrap();
        let mut channels = next.read_sidebar(TEAM).unwrap().unwrap();
        assert_eq!(team.selected_team.as_deref(), Some(TEAM));
        assert_eq!(channels.selected_channel.as_deref(), Some(OTHER));
        assert_eq!(team.teams[0].name, "old-team");
        assert_eq!(channels.data.channels[0].name, "old-room");
        assert_eq!(team.teams[0].roles, None);
        assert_eq!(channels.data.channels[0].roles, None);
        let load = next.begin_team_directory_load().unwrap();
        team.teams[0].roles = Some(String::new());
        assert!(next.store_team_directory(load, &team.teams, None).unwrap());
        channels.data.channels[0].roles = Some("custom_writer channel_user".into());
        save(&mut next, TEAM, &channels.data);
        drop(next);
        assert!(matches!(
            HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]),
            Err(HistoryError::UnsupportedSchema)
        ));
        let mut reopened = open(root.path());
        assert_eq!(reopened.read_team_directory().unwrap().unwrap(), team);
        assert_eq!(reopened.read_sidebar(TEAM).unwrap().unwrap(), channels);
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

#[test]
fn upgrades_v15_preserving_unknown_sharing_old_policy_and_drafts() {
    let root = tempdir().unwrap();
    let mut old = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..15]).unwrap();
    let owner = old.restore(&account()).unwrap();
    old.write(&owner, |tx| {
        tx.execute("INSERT INTO team_directory(owner,published) VALUES(1,1)", [])?;
        tx.execute("INSERT INTO joined_team(position,team_id,name,display_name,roles) VALUES(0,?1,'old','Old','team_user')",[TEAM])?;
        tx.execute("INSERT INTO sidebar_team(team_id,published,selected_channel) VALUES(?1,1,?2)",[TEAM,OTHER])?;
        tx.execute("INSERT INTO sidebar_channel(team_id,position,channel_id,kind,name,display_name,header,purpose,delete_at,muted,roles) VALUES(?1,0,?2,'D','dm','DM','','',0,0,'channel_user')",[TEAM,OTHER])?;
        tx.execute("INSERT INTO workspace_settings(owner,server) VALUES(1,?1)",[r#"{"collapsedThreads":"always_on","separateUnreads":false,"nameFormat":"username","lockNameFormat":true}"#])?;
        tx.execute("INSERT INTO composer_draft(channel_id,root_id,message,revision) VALUES(?1,'','keep draft',lower(hex(randomblob(16))))",[OTHER])?;
        Ok(())
    }).unwrap();
    drop(old);
    let mut broken: Vec<_> = MIGRATIONS[..15]
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    const FAIL: &[&str] = &[
        MIGRATIONS[15].statements[0],
        "ALTER TABLE missing ADD COLUMN shared INTEGER",
    ];
    broken.push(Migration {
        statements: FAIL,
        objects: MIGRATIONS[15].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(root.path(), URL, &broken),
        Err(HistoryError::Storage)
    ));
    drop(HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..15]).unwrap());
    let mut db = open(root.path());
    let mut catalog = db.read_sidebar(TEAM).unwrap().unwrap().data;
    assert_eq!(catalog.channels[0].shared, None);
    assert_eq!(catalog.channels[0].roles.as_deref(), Some("channel_user"));
    assert_eq!(db.read_draft(OTHER, None).unwrap().message, "keep draft");
    let policy =
        serde_json::to_value(db.read_workspace_settings().unwrap().server.unwrap()).unwrap();
    assert_eq!(policy["lockNameFormat"], true);
    assert!(policy.get("sharedChannelDMs").is_none());
    for shared in [true, false] {
        catalog.channels[0].shared = Some(shared);
        save(&mut db, TEAM, &catalog);
        assert_eq!(
            open(root.path())
                .read_sidebar(TEAM)
                .unwrap()
                .unwrap()
                .data
                .channels[0]
                .shared,
            Some(shared)
        );
    }
    drop(db);
    let mut current = HistoryDatabase::open(root.path(), URL).unwrap();
    current.purge(&owner).unwrap();
    drop(current);
    assert!(matches!(
        HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..15]),
        Err(HistoryError::UnsupportedSchema)
    ));
    let mut empty = open(root.path());
    assert!(empty.read_sidebar(TEAM).unwrap().is_none());
    assert!(empty.read_workspace_settings().unwrap().server.is_none());
    assert!(empty.read_draft(OTHER, None).unwrap().message.is_empty());
}

#[test]
fn upgrades_v18_group_constraints_without_replacing_the_team_channel_or_draft() {
    let root = tempdir().unwrap();
    let mut old = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..18]).unwrap();
    let owner = old.restore(&account()).unwrap();
    old.write(&owner, |tx| {
        tx.execute("INSERT INTO team_directory(owner,published) VALUES(1,1)", [])?;
        tx.execute("INSERT INTO joined_team(position,team_id,name,display_name,selected) VALUES(0,?1,'north','North',1)", [TEAM])?;
        tx.execute("INSERT INTO sidebar_team(team_id,published,selected_channel) VALUES(?1,1,?2)", [TEAM,OTHER])?;
        tx.execute("INSERT INTO sidebar_channel(team_id,position,channel_id,kind,name,display_name,header,purpose,delete_at,muted) VALUES(?1,0,?2,'P','private','Private','','',0,0)", [TEAM,OTHER])?;
        tx.execute("INSERT INTO composer_draft(channel_id,root_id,message,revision) VALUES(?1,'','keep draft',lower(hex(randomblob(16))))", [OTHER])?;
        tx.execute("INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned) VALUES(?1,?2,?3,10,10,0,'','keep post','',0)", [USER,OTHER,USER])?;
        Ok(())
    }).unwrap();
    drop(old);

    const BROKEN: &[&str] = &[
        MIGRATIONS[18].statements[0],
        "ALTER TABLE missing ADD COLUMN group_constrained INTEGER",
    ];
    let mut broken: Vec<_> = MIGRATIONS[..18]
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    broken.push(Migration {
        statements: BROKEN,
        objects: MIGRATIONS[18].objects,
    });
    assert!(HistoryDatabase::open_with(root.path(), URL, &broken).is_err());
    drop(HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..18]).unwrap());

    let mut current = open(root.path());
    let team = current.read_team_directory().unwrap().unwrap();
    let channel = current.read_sidebar(TEAM).unwrap().unwrap();
    assert_eq!(team.selected_team.as_deref(), Some(TEAM));
    assert_eq!(channel.selected_channel.as_deref(), Some(OTHER));
    assert_eq!(team.teams[0].group_constrained, None);
    assert_eq!(channel.data.channels[0].group_constrained, None);
    let mut rows = team.teams;
    let mut data = channel.data;
    for (team_flag, channel_flag) in [(true, false), (false, true)] {
        rows[0].group_constrained = Some(team_flag);
        data.channels[0].group_constrained = Some(channel_flag);
        let ticket = current.begin_team_directory_load().unwrap();
        assert!(current.store_team_directory(ticket, &rows, None).unwrap());
        save(&mut current, TEAM, &data);
        drop(current);
        current = open(root.path());
        assert_eq!(current.read_team_directory().unwrap().unwrap().teams, rows);
        assert_eq!(current.read_sidebar(TEAM).unwrap().unwrap().data, data);
    }
    assert_eq!(
        current.read_draft(OTHER, None).unwrap().message,
        "keep draft"
    );
    assert_eq!(
        current.read_post(USER).unwrap().unwrap().message,
        "keep post"
    );
}
