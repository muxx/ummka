use super::*;
use crate::history::{HistoryDatabase, schema::MIGRATIONS};
use crate::sessions::Account;
use std::path::Path;
use tempfile::tempdir;

const URL: &str = "https://teams.example.test/mm";
const USER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const FIRST: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const SECOND: &str = "cccccccccccccccccccccccccc";

fn account() -> Account {
    Account::new(URL, USER).unwrap()
}

fn team(id: &str, rank: Option<u32>) -> DirectoryTeam {
    DirectoryTeam {
        id: id.to_owned(),
        name: format!("team-{id}"),
        display_name: format!("Команда {id}"),
        preference_rank: rank,
        roles: Some("team_user".into()),
    }
}

fn open(root: &Path) -> AccountHistory {
    AccountHistory::open(root, &account()).unwrap()
}

fn publish(view: &mut AccountHistory, teams: &[DirectoryTeam]) {
    let load = view.begin_team_directory_load().unwrap();
    assert!(view.store_team_directory(load, teams, None).unwrap());
}

#[test]
fn a_newer_refresh_and_an_explicit_choice_survive_other_writers() {
    let root = tempdir().unwrap();
    let mut a = open(root.path());
    let mut b = open(root.path());
    assert_eq!(a.read_team_directory().unwrap(), None);
    let old = a.begin_team_directory_load().unwrap();
    let new = b.begin_team_directory_load().unwrap();
    assert!(b.store_team_directory(new, &[], None).unwrap());
    assert!(
        !a.store_team_directory(old, &[team(SECOND, None)], None)
            .unwrap()
    );
    assert_eq!(a.read_team_directory().unwrap().unwrap().teams, []);
    publish(&mut a, &[team(FIRST, None)]);
    assert_eq!(
        b.read_team_directory()
            .unwrap()
            .unwrap()
            .selected_team
            .as_deref(),
        Some(FIRST)
    );
    publish(&mut a, &[team(FIRST, Some(2)), team(SECOND, None)]);
    assert_eq!(
        b.read_team_directory()
            .unwrap()
            .unwrap()
            .selected_team
            .as_deref(),
        Some(FIRST)
    );
    assert!(a.select_team(FIRST).unwrap());
    let refresh = a.begin_team_directory_load().unwrap();
    assert!(b.select_team(SECOND).unwrap());
    assert!(!b.select_team(USER).unwrap());
    assert!(
        a.store_team_directory(refresh, &[team(SECOND, None), team(FIRST, Some(4))], None)
            .unwrap()
    );
    let restored = open(root.path()).read_team_directory().unwrap().unwrap();
    assert_eq!(restored.selected_team.as_deref(), Some(SECOND));
    assert_eq!(restored.teams, [team(SECOND, None), team(FIRST, Some(4))]);
    publish(&mut b, &[team(FIRST, Some(1))]);
    assert_eq!(
        a.read_team_directory()
            .unwrap()
            .unwrap()
            .selected_team
            .as_deref(),
        Some(FIRST)
    );
}

#[test]
fn failed_replacement_preserves_the_whole_snapshot_and_its_selection() {
    let root = tempdir().unwrap();
    let mut a = open(root.path());
    publish(&mut a, &[team(FIRST, None)]);
    assert!(a.select_team(FIRST).unwrap());
    let previous = a.read_team_directory().unwrap();
    for invalid in [
        vec![team(FIRST, None), team(FIRST, None)],
        vec![team("short", None)],
        vec![team(FIRST, Some(7)), team(SECOND, Some(7))],
    ] {
        let load = a.begin_team_directory_load().unwrap();
        assert_eq!(
            a.store_team_directory(load, &invalid, None),
            Err(HistoryError::InvalidDirectory)
        );
    }
    a.write(|tx| {
        tx.execute_batch(
            "CREATE TEMP TRIGGER refuse_second BEFORE INSERT ON joined_team WHEN new.position = 1
         BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END;",
        )
    })
    .unwrap();
    let load = a.begin_team_directory_load().unwrap();
    assert_eq!(
        a.store_team_directory(load, &[team(SECOND, Some(0)), team(FIRST, None)], None),
        Err(HistoryError::Storage)
    );
    drop(a);
    assert_eq!(open(root.path()).read_team_directory().unwrap(), previous);
}

#[test]
fn a_new_login_keeps_teams_but_revokes_old_loads_and_sign_out_purges_them() {
    let root = tempdir().unwrap();
    let mut old = open(root.path());
    publish(&mut old, &[team(FIRST, None)]);
    let load = old.begin_team_directory_load().unwrap();
    old.database.new_login(&account()).unwrap();
    let mut fresh = open(root.path());
    assert_eq!(old.read_team_directory(), Err(HistoryError::StaleOwner));
    assert_eq!(
        fresh.store_team_directory(load, &[], None),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        fresh.read_team_directory().unwrap().unwrap().teams,
        [team(FIRST, None)]
    );
    HistoryDatabase::purge_account(root.path(), &account()).unwrap();
    assert_eq!(fresh.read_team_directory(), Err(HistoryError::StaleOwner));
    let mut replacement = open(root.path());
    assert!(replacement.read_team_directory().unwrap().is_none());
    replacement
        .read(|tx| {
            for table in ["team_directory", "joined_team"] {
                assert_eq!(
                    tx.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                        .get::<_, u32>(0))?,
                    0
                );
            }
            Ok(())
        })
        .unwrap();
}

#[test]
fn upgrades_prior_releases_and_keeps_the_newer_database_on_downgrade() {
    for version in 1..=3 {
        let root = tempdir().unwrap();
        let mut previous =
            HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]).unwrap();
        let owner = previous.restore(&account()).unwrap();
        if version >= 2 {
            previous.write(&owner, |tx|tx.execute(
                "INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
                 VALUES(?1,?2,?3,1,1,0,'','kept','',0)", params![FIRST,SECOND,USER],
            )).unwrap();
        }
        let mut next = open(root.path());
        assert!(next.owner == owner);
        assert!(next.read_team_directory().unwrap().is_none());
        publish(&mut next, &[team(SECOND, Some(0))]);
        assert_eq!(
            previous.read(&owner, |_| Ok(())),
            Err(HistoryError::UnsupportedSchema)
        );
        assert_eq!(
            HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..version]).err(),
            Some(HistoryError::UnsupportedSchema)
        );
        let mut reopened = open(root.path());
        assert_eq!(
            reopened.read_team_directory().unwrap().unwrap().teams,
            [team(SECOND, Some(0))]
        );
        if version >= 2 {
            assert_eq!(reopened.read_post(FIRST).unwrap().unwrap().message, "kept");
        }
    }
}

#[test]
fn listing_uses_row_order_and_point_lookups_use_their_indexes() {
    let root = tempdir().unwrap();
    let mut account = open(root.path());
    let teams: Vec<_> = (0..160)
        .map(|id| team(&format!("{id:026}"), None))
        .collect();
    publish(&mut account, &teams);
    account.select_team(&teams[70].id).unwrap();
    account
        .read(|tx| {
            for (sql, arg, expected) in [
                (ORDERED, None, "SCAN joined_team"),
                (SELECTED, None, "joined_team_selected"),
                (HAS_TEAM, Some(teams[70].id.as_str()), "team_id=?"),
            ] {
                let mut plan = tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
                let steps = plan
                    .query_map(rusqlite::params_from_iter(arg), |row| {
                        row.get::<_, String>(3)
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?
                    .join(" ");
                assert!(steps.contains(expected), "{steps}");
                assert!(!steps.contains("TEMP B-TREE"), "{steps}");
            }
            Ok(())
        })
        .unwrap();
}
