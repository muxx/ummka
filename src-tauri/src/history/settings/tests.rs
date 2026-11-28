use super::*;
use crate::history::{
    DirectoryTeam, HistoryDatabase,
    schema::{MIGRATIONS, Migration},
};
use crate::sessions::Account;
use serde_json::json;
use std::path::Path;
use tempfile::tempdir;

const URL: &str = "https://settings.example.test/mm";
const ME: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";

fn account() -> Account {
    Account::new(URL, ME).unwrap()
}
fn open(path: &Path) -> AccountHistory {
    AccountHistory::open(path, &account()).unwrap()
}
fn policy() -> ServerPolicy {
    ServerPolicy {
        user_statuses_enabled: true,
        hide_guest_tags: None,
        dm_recipient_scope: Some(RecipientScope::Team),
        collapsed_threads: ThreadMode::DefaultOn,
        separate_unreads: false,
        name_format: NameFormat::FullName,
        lock_name_format: true,
        shared_channel_dms: Some(true),
        search: Some(SearchSettings {
            all_teams: true,
            files: true,
            archived_channels: false,
        }),
        unique_reaction_limit: Some("-2".into()),
        post_edit_limit_seconds: Some("30".into()),
        mentions: Some(MentionSettings {
            confirm_notifications: true,
            max_notifications_per_channel: i64::MAX.to_string(),
            custom_groups: false,
            ldap_groups: true,
        }),
    }
}
fn preferences() -> SidebarPreferences {
    SidebarPreferences {
        limit: Some(25),
        name_format: Some(NameFormat::Username),
        direct_shown: BTreeMap::from([(OTHER.into(), true)]),
        view_times: BTreeMap::from([(ME.into(), 78)]),
        ..Default::default()
    }
}
fn team() -> DirectoryTeam {
    DirectoryTeam {
        id: ME.into(),
        name: "north".into(),
        display_name: "North".into(),
        preference_rank: None,
        roles: Some("team_user".into()),
        group_constrained: None,
    }
}

#[test]
fn legacy_presence_policy_is_enabled_and_a_saved_disable_survives_reopening() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    let initial = policy();
    let load = db.begin_server_policy_load().unwrap();
    assert!(db.store_server_policy(load, &initial).unwrap());
    let mut legacy = serde_json::to_value(&initial).unwrap();
    legacy
        .as_object_mut()
        .unwrap()
        .remove("userStatusesEnabled")
        .unwrap();
    db.write(|tx| {
        tx.execute(
            "UPDATE workspace_settings SET server=?1 WHERE owner=1",
            [legacy.to_string()],
        )
    })
    .unwrap();
    drop(db);
    let mut db = open(root.path());
    assert_eq!(
        db.read_workspace_settings().unwrap().server.unwrap(),
        initial
    );
    let mut disabled = policy();
    disabled.user_statuses_enabled = false;
    let load = db.begin_server_policy_load().unwrap();
    assert!(db.store_server_policy(load, &disabled).unwrap());
    drop(db);
    let mut db = open(root.path());
    assert_eq!(
        db.read_workspace_settings().unwrap().server.unwrap(),
        disabled
    );
    let load = db.begin_server_policy_load().unwrap();
    assert!(db.store_server_policy(load, &initial).unwrap());
    assert_eq!(
        db.read_workspace_settings().unwrap().server.unwrap(),
        initial
    );
}

#[test]
fn publishes_two_independent_sources_and_rejects_stale_or_partial_updates() {
    let root = tempdir().unwrap();
    let mut a = open(root.path());
    let mut b = open(root.path());
    assert_eq!(
        a.read_workspace_settings().unwrap(),
        WorkspaceSettings::default()
    );
    let late = a.begin_server_policy_load().unwrap();
    let newest = b.begin_server_policy_load().unwrap();
    let late_teams = a.begin_team_directory_load().unwrap();
    let new_teams = b.begin_team_directory_load().unwrap();
    assert!(
        b.store_team_directory(new_teams, &[team()], Some(&preferences()))
            .unwrap()
    );
    assert!(
        !a.store_team_directory(late_teams, &[], Some(&SidebarPreferences::default()))
            .unwrap()
    );
    assert_eq!(a.read_workspace_settings().unwrap().server, None);
    assert!(b.store_server_policy(newest, &policy()).unwrap());
    assert!(!a.store_server_policy(late, &policy()).unwrap());
    drop(b);
    let mut restarted = open(root.path());
    assert_eq!(
        restarted.read_workspace_settings().unwrap(),
        WorkspaceSettings {
            preferences: Some(preferences()),
            server: Some(policy())
        }
    );
    a.write(|tx| tx.execute_batch("CREATE TEMP TRIGGER refuse_new_team BEFORE INSERT ON joined_team BEGIN SELECT RAISE(ABORT,'fixture rejection'); END")).unwrap();
    let load = a.begin_team_directory_load().unwrap();
    assert_eq!(
        a.store_team_directory(load, &[team()], Some(&SidebarPreferences::default())),
        Err(HistoryError::Storage)
    );
    assert_eq!(
        restarted.read_workspace_settings().unwrap().preferences,
        Some(preferences())
    );
    let zero = restarted.begin_team_directory_load().unwrap();
    assert!(
        restarted
            .store_team_directory(zero, &[], Some(&SidebarPreferences::default()))
            .unwrap()
    );
    assert_eq!(
        restarted.read_workspace_settings().unwrap().preferences,
        Some(SidebarPreferences::default())
    );
    let abandoned = a.begin_server_policy_load().unwrap();
    let newer = a.begin_server_policy_load().unwrap();
    drop(newer);
    assert!(!a.store_server_policy(abandoned, &policy()).unwrap());
    let old_login = a.begin_server_policy_load().unwrap();
    HistoryDatabase::retire_existing(root.path(), &account(), true).unwrap();
    assert_eq!(a.read_workspace_settings(), Err(HistoryError::StaleOwner));
    let mut fresh = open(root.path());
    assert_eq!(
        fresh.store_server_policy(old_login, &policy()),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        fresh.read_workspace_settings().unwrap().server,
        Some(policy())
    );
    HistoryDatabase::purge_account(root.path(), &account()).unwrap();
    let mut next = AccountHistory::open(root.path(), &Account::new(URL, OTHER).unwrap()).unwrap();
    assert_eq!(
        next.read_workspace_settings().unwrap(),
        WorkspaceSettings::default()
    );
}

#[test]
fn accepts_only_known_settings_and_indexes_an_owner_lookup() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    let mut prefs = preferences();
    for (map, value) in [
        ("directShown", json!({"bad":true})),
        ("groupShown", json!({(ME):false})),
        ("viewTimes", json!({(ME):9007199254740992_u64})),
        ("limit", json!(9007199254740992_u64)),
    ] {
        let mut raw = serde_json::to_value(&prefs).unwrap();
        raw[map] = value;
        let bad = serde_json::from_value(raw).unwrap();
        let load = db.begin_team_directory_load().unwrap();
        assert_eq!(
            db.store_team_directory(load, &[], Some(&bad)),
            Err(HistoryError::InvalidDirectory)
        );
    }
    let mut raw = serde_json::to_value(&prefs).unwrap();
    raw["email"] = json!("private");
    assert!(serde_json::from_value::<SidebarPreferences>(raw).is_err());
    for malformed in [
        json!({"sendOnCtrlEnter":true}),
        json!({"sendOnCtrlEnter":"true","codeBlockOnCtrlEnter":false}),
        json!({"sendOnCtrlEnter":true,"codeBlockOnCtrlEnter":false,"other":true}),
    ] {
        let mut raw = serde_json::to_value(&prefs).unwrap();
        raw["composerKeys"] = malformed;
        assert!(serde_json::from_value::<SidebarPreferences>(raw).is_err());
    }
    let mut raw = serde_json::to_value(policy()).unwrap();
    raw["dmRecipientScope"] = json!("unrecognised-value");
    assert!(serde_json::from_value::<ServerPolicy>(raw).is_err());
    let mut raw = serde_json::to_value(policy()).unwrap();
    raw["nameFormat"] = json!("unrecognised-value");
    assert!(serde_json::from_value::<ServerPolicy>(raw).is_err());
    for n in 0..5000 {
        prefs.view_times.insert(format!("{n:026}"), n);
    }
    let load = db.begin_team_directory_load().unwrap();
    assert!(
        db.store_team_directory(load, &[team()], Some(&prefs))
            .unwrap()
    );
    assert_eq!(
        db.read_workspace_settings().unwrap().preferences,
        Some(prefs)
    );
    db.read(|tx| {
        let plan: String =
            tx.query_row(&format!("EXPLAIN QUERY PLAN {READ}"), [], |row| row.get(3))?;
        assert!(
            plan.contains("INTEGER PRIMARY KEY") && !plan.contains("SCAN"),
            "{plan}"
        );
        Ok(())
    })
    .unwrap();
}

#[test]
fn upgrades_settings_and_drafts_and_protects_the_new_policy() {
    for version in [17, 19, 21, 22, 24, 25] {
        let root = tempdir().unwrap();
        let previous = &MIGRATIONS[..version];
        let mut old = HistoryDatabase::open_with(root.path(), URL, previous).unwrap();
        let owner = old.restore(&account()).unwrap();
        let mut legacy = policy();
        legacy.dm_recipient_scope = None;
        if version < 25 {
            legacy.post_edit_limit_seconds = None;
        }
        if version < 23 {
            legacy.search = None;
        }
        if version < 20 {
            legacy.unique_reaction_limit = None;
        }
        if version == 17 {
            legacy.mentions = None;
        }
        let saved = serde_json::to_string(&legacy).unwrap();
        old.write(&owner, |tx| {
            tx.execute("INSERT INTO workspace_settings(owner,server) VALUES(1,?1)", [&saved])?;
            tx.execute("INSERT INTO composer_draft(channel_id,root_id,message,revision) VALUES(?1,'','preserved',lower(hex(randomblob(16))))", [OTHER])?;
            Ok(())
        }).unwrap();
        let mut db = open(root.path());
        assert_eq!(db.read_workspace_settings().unwrap().server, Some(legacy));
        let load = db.begin_server_policy_load().unwrap();
        assert!(db.store_server_policy(load, &policy()).unwrap());
        assert_eq!(
            old.write(&owner, |tx| tx
                .execute("DELETE FROM workspace_settings", [])),
            Err(HistoryError::UnsupportedSchema)
        );
        drop(db);
        assert!(matches!(
            HistoryDatabase::open_with(root.path(), URL, previous),
            Err(HistoryError::UnsupportedSchema)
        ));
        let mut reopened = open(root.path());
        assert_eq!(
            reopened.read_workspace_settings().unwrap().server,
            Some(policy())
        );
        assert_eq!(
            reopened.read_draft(OTHER, None).unwrap().message,
            "preserved"
        );
    }
}

#[test]
fn guest_tag_policy_upgrades_v31_and_survives_downgrade_refusals() {
    let root = tempdir().unwrap();
    let prior = &MIGRATIONS[..31];
    let open_v32 = || {
        let mut database = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..32]).unwrap();
        let owner = database.restore(&account()).unwrap();
        AccountHistory { database, owner }
    };
    let mut old = HistoryDatabase::open_with(root.path(), URL, prior).unwrap();
    let owner = old.restore(&account()).unwrap();
    let legacy = policy();
    let saved = serde_json::to_string_pretty(&legacy).unwrap();
    let prefs = preferences();
    old.write(&owner, |tx| {
        prefs.publish(tx)?;
        tx.execute("UPDATE workspace_settings SET server=?1 WHERE owner=1", [&saved])?;
        tx.execute(
            "INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
             VALUES(?1,?2,?1,5,5,0,'','prior post','',0)",
            [ME, OTHER],
        )?;
        Ok(())
    })
    .unwrap();

    let mut db = open_v32();
    assert_eq!(db.read_workspace_settings().unwrap().server, Some(legacy));
    let migrated: (i64, String) = db
        .read(|tx| {
            Ok((
                crate::history::schema::version(tx)?,
                tx.query_row("SELECT server FROM workspace_settings", [], |row| {
                    row.get(0)
                })?,
            ))
        })
        .unwrap();
    assert_eq!(migrated, (32, saved));
    assert_eq!(
        old.write(&owner, |_| -> rusqlite::Result<()> { panic!("old writer") }),
        Err(HistoryError::UnsupportedSchema)
    );
    drop(old);

    let file = root
        .path()
        .join("history")
        .join(crate::history::filename(URL));
    for hidden in [false, true, false] {
        let mut confirmed = policy();
        confirmed.hide_guest_tags = Some(hidden);
        let load = db.begin_server_policy_load().unwrap();
        assert!(db.store_server_policy(load, &confirmed).unwrap());
        drop(db);
        let before = std::fs::read(&file).unwrap();
        assert_eq!(
            HistoryDatabase::open_with(root.path(), URL, prior).err(),
            Some(HistoryError::UnsupportedSchema)
        );
        assert_eq!(std::fs::read(&file).unwrap(), before);
        db = open_v32();
        assert_eq!(
            db.read_workspace_settings().unwrap(),
            WorkspaceSettings {
                preferences: Some(preferences()),
                server: Some(confirmed),
            }
        );
        assert_eq!(db.read_post(ME).unwrap().unwrap().message, "prior post");
    }
}

#[test]
fn strict_guest_tag_policy_only_accepts_absence_or_a_boolean() {
    let mut raw = serde_json::to_value(policy()).unwrap();
    assert!(raw.get("hideGuestTags").is_none());
    assert_eq!(
        serde_json::from_value::<ServerPolicy>(raw.clone())
            .unwrap()
            .hide_guest_tags,
        None
    );
    for hidden in [false, true] {
        raw["hideGuestTags"] = json!(hidden);
        let decoded: ServerPolicy = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(decoded.hide_guest_tags, Some(hidden));
        assert_eq!(serde_json::to_value(decoded).unwrap(), raw);
    }
    for invalid in [json!(null), json!("false"), json!(0), json!([])] {
        raw["hideGuestTags"] = invalid;
        assert!(serde_json::from_value::<ServerPolicy>(raw.clone()).is_err());
    }
}

#[test]
fn invalid_edit_limit_preserves_the_last_policy_after_restart() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    let mut value = policy();
    value.post_edit_limit_seconds = Some(i64::MAX.to_string());
    let load = db.begin_server_policy_load().unwrap();
    assert!(db.store_server_policy(load, &value).unwrap());
    for raw in [
        "-0",
        "+7",
        "12.5",
        "9223372036854775808",
        "-9223372036854775809",
    ] {
        let mut bad = policy();
        bad.post_edit_limit_seconds = Some(raw.into());
        let load = db.begin_server_policy_load().unwrap();
        assert_eq!(
            db.store_server_policy(load, &bad),
            Err(HistoryError::InvalidDirectory)
        );
    }
    drop(db);
    assert_eq!(
        open(root.path()).read_workspace_settings().unwrap().server,
        Some(value)
    );
}

#[test]
fn invalid_mention_limits_never_replace_the_last_policy() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    let load = db.begin_server_policy_load().unwrap();
    assert!(db.store_server_policy(load, &policy()).unwrap());
    for invalid in ["0", "-1", "+20", "01", "2x", "9223372036854775808"] {
        let mut bad = policy();
        bad.mentions.as_mut().unwrap().max_notifications_per_channel = invalid.into();
        let next = db.begin_server_policy_load().unwrap();
        assert_eq!(
            db.store_server_policy(next, &bad),
            Err(HistoryError::InvalidDirectory)
        );
        assert_eq!(db.read_workspace_settings().unwrap().server, Some(policy()));
    }
}

#[test]
fn v16_keeps_the_draft_and_unknown_shortcuts_until_this_account_refreshes() {
    let root = tempdir().unwrap();
    let v16 = &MIGRATIONS[..16];
    let mut old = HistoryDatabase::open_with(root.path(), URL, v16).unwrap();
    let owner = old.restore(&account()).unwrap();
    let legacy = serde_json::to_string(&preferences()).unwrap();
    assert!(!legacy.contains("composerKeys"));
    old.write(&owner, |tx| {
        tx.execute("INSERT INTO workspace_settings(owner,preferences) VALUES(1,?1)", [&legacy])?;
        tx.execute("INSERT INTO composer_draft(channel_id,root_id,message,revision) VALUES(?1,'','my draft',lower(hex(randomblob(16))))", [OTHER])?;
        Ok(())
    }).unwrap();
    let mut db = open(root.path());
    assert_eq!(
        db.read_workspace_settings().unwrap().preferences,
        Some(preferences())
    );
    let mut choice = preferences();
    choice.composer_keys = Some(ComposerKeys {
        send_on_ctrl_enter: true,
        code_block_on_ctrl_enter: false,
    });
    let load = db.begin_team_directory_load().unwrap();
    assert!(
        db.store_team_directory(load, &[team()], Some(&choice))
            .unwrap()
    );
    assert_eq!(
        old.write(&owner, |tx| tx
            .execute("DELETE FROM workspace_settings", [])),
        Err(HistoryError::UnsupportedSchema)
    );
    drop(db);
    assert!(matches!(
        HistoryDatabase::open_with(root.path(), URL, v16),
        Err(HistoryError::UnsupportedSchema)
    ));
    let mut reopened = open(root.path());
    assert_eq!(
        reopened.read_workspace_settings().unwrap().preferences,
        Some(choice)
    );
    assert_eq!(
        reopened.read_draft(OTHER, None).unwrap().message,
        "my draft"
    );
}

#[test]
fn upgrades_populated_v1_through_v6_preserving_content_and_unknown_creation_time() {
    for version in 1..=6 {
        let root = tempdir().unwrap();
        let mut old = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]).unwrap();
        let owner = old.restore(&account()).unwrap();
        old.write(&owner,|tx|{
            if version>=2 {
                tx.execute("INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
                    VALUES(?1,?1,?1,5,5,0,'','prior post','',0)",[ME])?;
            }
            if version>=4 {
                tx.execute("INSERT INTO team_directory(owner,published) VALUES(1,1)",[])?;
                tx.execute("INSERT INTO joined_team(position,team_id,name,display_name,selected) VALUES(0,?1,'north','North',1)",[ME])?;
            }
            if version>=5 {
                tx.execute("INSERT INTO sidebar_team(team_id,published,selected_channel) VALUES(?1,1,?2)",[ME,OTHER])?;
                tx.execute("INSERT INTO sidebar_channel(team_id,position,channel_id,kind,name,display_name,header,purpose,delete_at,muted)
                    VALUES(?1,0,?2,'O','general','General','','',0,0)",[ME,OTHER])?;
            }
            if version==6 {
                tx.execute("INSERT INTO channel_profile(id,username,first_name,last_name,nickname,position,is_bot,is_guest,remote_username)
                            VALUES(?1,'alex','','','','',0,0,'')",[ME])?;
            }
            Ok(())
        }).unwrap();
        drop(old);
        if version == 6 {
            let mut broken: Vec<_> = MIGRATIONS[..6]
                .iter()
                .map(|m| Migration {
                    statements: m.statements,
                    objects: m.objects,
                })
                .collect();
            broken.push(Migration {
                statements: &[
                    "ALTER TABLE sidebar_channel ADD COLUMN create_at INTEGER",
                    "CREATE INDEX broken ON missing_table(col)",
                ],
                objects: MIGRATIONS[6].objects,
            });
            assert!(matches!(
                HistoryDatabase::open_with(root.path(), URL, &broken),
                Err(HistoryError::Storage)
            ));
            let mut rolled_back =
                HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..6]).unwrap();
            assert_eq!(
                rolled_back.restore(&account()).unwrap().generation,
                owner.generation
            );
        }
        let mut db = open(root.path());
        assert_eq!(db.owner.generation, owner.generation);
        assert_eq!(
            db.read_workspace_settings().unwrap(),
            WorkspaceSettings::default()
        );
        if version >= 2 {
            assert_eq!(db.read_post(ME).unwrap().unwrap().message, "prior post");
        }
        if version >= 4 {
            assert_eq!(
                db.read_team_directory()
                    .unwrap()
                    .unwrap()
                    .selected_team
                    .as_deref(),
                Some(ME)
            );
        }
        if version >= 5 {
            let snap = db.read_sidebar(ME).unwrap().unwrap();
            assert_eq!(snap.selected_channel.as_deref(), Some(OTHER));
            assert_eq!(snap.data.channels[0].create_at, None);
            let mut data = snap.data;
            data.channels[0].create_at = Some(1000);
            let load = db.begin_sidebar_load(ME).unwrap().unwrap();
            assert!(db.store_sidebar(load, &data).unwrap());
            assert_eq!(
                open(root.path()).read_sidebar(ME).unwrap().unwrap().data,
                data
            );
        }
        if version == 6 {
            db.read(|tx| {
                tx.query_row(
                    "SELECT username FROM channel_profile WHERE id=?1",
                    [ME],
                    |r| {
                        assert_eq!(r.get::<_, String>(0)?, "alex");
                        Ok(())
                    },
                )
            })
            .unwrap();
        }
        let load = db.begin_server_policy_load().unwrap();
        assert!(db.store_server_policy(load, &policy()).unwrap());
        drop(db);
        assert!(matches!(
            HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]),
            Err(HistoryError::UnsupportedSchema)
        ));
        assert_eq!(
            open(root.path()).read_workspace_settings().unwrap().server,
            Some(policy())
        );
    }
}

#[test]
fn reaction_limits_preserve_signed_values_and_reject_invalid_refreshes() {
    let root = tempdir().unwrap();
    let mut db = open(root.path());
    let mut value = policy();
    for raw in ["0", "-9223372036854775808", "500", "9223372036854775807"] {
        value.unique_reaction_limit = Some(raw.into());
        let load = db.begin_server_policy_load().unwrap();
        assert!(db.store_server_policy(load, &value).unwrap());
        assert_eq!(
            db.read_workspace_settings().unwrap().server,
            Some(policy_with_limit(raw))
        );
    }
    for raw in [
        "",
        "1.0",
        "-0",
        "+1",
        "-9223372036854775809",
        "9223372036854775808",
    ] {
        let load = db.begin_server_policy_load().unwrap();
        assert_eq!(
            db.store_server_policy(load, &policy_with_limit(raw)),
            Err(HistoryError::InvalidDirectory)
        );
    }
    assert_eq!(db.read_workspace_settings().unwrap().server, Some(value));
}

fn policy_with_limit(raw: &str) -> ServerPolicy {
    let mut value = policy();
    value.unique_reaction_limit = Some(raw.into());
    value
}
