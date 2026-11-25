use super::*;
use crate::history::{
    DirectoryTeam, HistoryDatabase, SidebarData,
    schema::{MIGRATIONS, Migration},
};
use crate::sessions::Account;
use std::path::Path;
use tempfile::tempdir;

const URL: &str = "https://roles.example.test/chat";
const USER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEAM: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const OTHER: &str = "cccccccccccccccccccccccccc";

fn account() -> Account {
    Account::new(URL, USER).unwrap()
}
fn open(dir: &Path) -> AccountHistory {
    AccountHistory::open(dir, &account()).unwrap()
}
fn join(db: &mut AccountHistory, ids: &[&str]) {
    let teams: Vec<_> = ids
        .iter()
        .map(|id| DirectoryTeam {
            id: (*id).into(),
            name: (*id).into(),
            display_name: (*id).into(),
            preference_rank: None,
            roles: Some("team_user".into()),
        })
        .collect();
    let load = db.begin_team_directory_load().unwrap();
    assert!(db.store_team_directory(load, &teams, None).unwrap());
    for team in ids {
        let load = db.begin_sidebar_load(team).unwrap().unwrap();
        let sidebar: SidebarData = serde_json::from_value(serde_json::json!({
            "channels":[{"id": USER, "kind":"O", "name":"channel", "displayName":"Channel",
                "header":"", "purpose":"", "deleteAt":0, "muted":false, "roles":"channel_user"}],
            "categories":[]
        }))
        .unwrap();
        assert!(db.store_sidebar(load, &sidebar).unwrap());
    }
}
fn grants(permission: &str) -> TeamRoleSnapshot {
    TeamRoleSnapshot {
        system_roles: "system_user".into(),
        definitions: vec![
            RoleDefinition {
                name: "system_user".into(),
                permissions: vec![],
            },
            RoleDefinition {
                name: "custom_writer".into(),
                permissions: vec![permission.into()],
            },
        ],
    }
}
fn publish(db: &mut AccountHistory, team: &str, data: &TeamRoleSnapshot) {
    let load = db.begin_team_roles(team).unwrap().unwrap().0;
    assert!(db.store_team_roles(load, data).unwrap());
}

#[test]
fn publishes_one_complete_role_snapshot_per_team_and_rejects_a_stale_writer() {
    let dir = tempdir().unwrap();
    let mut first = open(dir.path());
    let mut second = open(dir.path());
    assert_eq!(first.read_team_roles(TEAM).unwrap(), None);
    assert!(first.begin_team_roles(TEAM).unwrap().is_none());
    assert_eq!(
        first.read_team_roles("invalid"),
        Err(HistoryError::InvalidDirectory)
    );
    join(&mut first, &[TEAM, OTHER]);
    let kept = grants("create_post");
    publish(&mut first, TEAM, &kept);
    let old = first.begin_team_roles(TEAM).unwrap().unwrap().0;
    let new = second.begin_team_roles(TEAM).unwrap().unwrap().0;
    let separate = first.begin_team_roles(OTHER).unwrap().unwrap().0;
    let missing = TeamRoleSnapshot {
        system_roles: String::new(),
        definitions: vec![],
    };
    assert!(first.store_team_roles(separate, &missing).unwrap());
    assert!(!first.store_team_roles(old, &missing).unwrap());
    assert_eq!(second.read_team_roles(TEAM).unwrap(), Some(kept));
    let changed = grants("read_channel");
    assert!(second.store_team_roles(new, &changed).unwrap());
    drop(first);
    drop(second);
    let mut restored = open(dir.path());
    assert_eq!(restored.read_team_roles(TEAM).unwrap(), Some(changed));
    assert_eq!(restored.read_team_roles(OTHER).unwrap(), Some(missing));
}

#[test]
fn rejects_incomplete_and_ambiguous_definitions_without_erasing_the_previous_snapshot() {
    let dir = tempdir().unwrap();
    let mut db = open(dir.path());
    join(&mut db, &[TEAM]);
    publish(&mut db, TEAM, &grants("post"));
    for name in [
        "",
        "contains space",
        "system_user",
        "missing_system_definition",
    ] {
        let mut bad = grants("post");
        if name == "missing_system_definition" {
            bad.system_roles = name.into();
        } else {
            bad.definitions[1].name = name.into();
        }
        let load = db.begin_team_roles(TEAM).unwrap().unwrap().0;
        assert_eq!(
            db.store_team_roles(load, &bad),
            Err(HistoryError::InvalidDirectory)
        );
    }
    let mut bad = grants("");
    let load = db.begin_team_roles(TEAM).unwrap().unwrap().0;
    assert_eq!(
        db.store_team_roles(load, &bad),
        Err(HistoryError::InvalidDirectory)
    );
    // A queried role with no grants is a valid definition, including a deleted role.
    bad.definitions[1].permissions.clear();
    assert_eq!(db.read_team_roles(TEAM).unwrap(), Some(grants("post")));
    publish(&mut db, TEAM, &bad);
    assert_eq!(db.read_team_roles(TEAM).unwrap(), Some(bad));
}

#[test]
fn leaving_a_team_rotating_a_login_and_signing_out_invalidate_their_rights() {
    let dir = tempdir().unwrap();
    let mut first = open(dir.path());
    join(&mut first, &[TEAM, OTHER]);
    publish(&mut first, TEAM, &grants("old"));
    publish(&mut first, OTHER, &grants("other"));
    let departed = first.begin_team_roles(TEAM).unwrap().unwrap().0;
    join(&mut first, &[OTHER]);
    assert_eq!(first.read_team_roles(TEAM).unwrap(), None);
    assert_eq!(first.read_team_roles(OTHER).unwrap(), Some(grants("other")));
    join(&mut first, &[TEAM, OTHER]);
    let current = first.begin_team_roles(TEAM).unwrap().unwrap().0;
    assert!(!first.store_team_roles(departed, &grants("stale")).unwrap());
    assert!(
        first
            .store_team_roles(current, &grants("rejoined"))
            .unwrap()
    );
    let delayed = first.begin_team_roles(OTHER).unwrap().unwrap().0;
    let mut database = HistoryDatabase::open(dir.path(), URL).unwrap();
    let owner = database.new_login(&account()).unwrap();
    let mut next = open(dir.path());
    assert_eq!(next.read_team_roles(OTHER).unwrap(), None);
    assert!(matches!(
        first.store_team_roles(delayed, &grants("stale")),
        Err(HistoryError::StaleOwner)
    ));
    publish(&mut next, OTHER, &grants("new"));
    database.purge(&owner).unwrap();
    drop(next);
    let mut restored = open(dir.path());
    let count: i64 = restored
        .read(|tx| tx.query_row("SELECT count(*) FROM team_role_snapshot", [], |r| r.get(0)))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn migration_preserves_a_populated_v13_or_v14_file_and_rolls_back_its_schema_on_failure() {
    for version in [13, 14] {
        let dir = tempdir().unwrap();
        let mut old = HistoryDatabase::open_with(dir.path(), URL, &MIGRATIONS[..version]).unwrap();
        let owner = old.new_login(&account()).unwrap();
        old.write(&owner, |tx| {
            tx.execute(
                "INSERT INTO pending_post(pending_id,login_generation,channel_id,root_id,message)
            VALUES ('p',?1,?2,'','keep me')",
                params![owner.generation, TEAM],
            )
        })
        .unwrap();
        drop(old);
        let mut broken: Vec<_> = MIGRATIONS[..14]
            .iter()
            .map(|m| Migration {
                statements: m.statements,
                objects: m.objects,
            })
            .collect();
        const FAIL: &[&str] = &[
            MIGRATIONS[14].statements[0],
            "DROP TABLE nonexistent_role_fixture",
        ];
        broken.push(Migration {
            statements: FAIL,
            objects: MIGRATIONS[14].objects,
        });
        assert!(matches!(
            HistoryDatabase::open_with(dir.path(), URL, &broken),
            Err(HistoryError::Storage)
        ));
        drop(HistoryDatabase::open_with(dir.path(), URL, &MIGRATIONS[..version]).unwrap());
        let mut next = open(dir.path());
        assert_eq!(
            next.pending_posts(TEAM, None, 0, 1).unwrap()[0].message,
            "keep me"
        );
        assert_eq!(next.read_team_roles(TEAM).unwrap(), None);
        join(&mut next, &[TEAM]);
        publish(&mut next, TEAM, &grants("create_post"));
        drop(next);
        assert!(matches!(
            HistoryDatabase::open_with(dir.path(), URL, &MIGRATIONS[..version]),
            Err(HistoryError::UnsupportedSchema)
        ));
        assert_eq!(
            open(dir.path()).read_team_roles(TEAM).unwrap(),
            Some(grants("create_post"))
        );
    }
}

#[test]
fn lookup_and_updates_use_the_team_key_with_five_thousand_snapshots() {
    let dir = tempdir().unwrap();
    let mut db = open(dir.path());
    let generation = db.owner.generation;
    db.write(|tx| {
        tx.execute_batch("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5000)
            INSERT INTO sidebar_team(team_id,published) SELECT printf('%026d',i),1 FROM n")?;
        tx.execute("INSERT INTO team_role_snapshot(team_id,generation,payload) SELECT team_id,?1,'{\"systemRoles\":\"\",\"definitions\":[]}' FROM sidebar_team",[generation])?;
        tx.execute_batch("ANALYZE")?;
        let team=format!("{:026}",3456);
        for (sql,args) in [(READ,vec![&team as &dyn rusqlite::ToSql,&generation]),
            (BEGIN,vec![&team]),(STORE,vec![&team,&generation,&generation,&"{}"])] {
            let plan=tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?.query_map(args.as_slice(),|row|row.get::<_,String>(3))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            assert!(!plan.iter().any(|line|line.starts_with("SCAN ")), "{plan:?}");
            assert!(plan.iter().any(|line|line.contains("USING PRIMARY KEY")),"{plan:?}");
        }
        Ok(())
    }).unwrap();
}

#[test]
fn reserves_the_distinct_roles_of_the_current_team_and_omits_team_roles_in_direct_messages() {
    let dir = tempdir().unwrap();
    let mut db = open(dir.path());
    join(&mut db, &[TEAM, OTHER]);
    let mut sidebar = db.read_sidebar(TEAM).unwrap().unwrap().data;
    let mut direct = sidebar.channels[0].clone();
    direct.kind = "D".into();
    direct.roles = Some("direct_writer shared shared".into());
    let mut group = direct.clone();
    group.id = OTHER.into();
    group.kind = "G".into();
    group.roles = Some("group_reader shared".into());
    sidebar.channels = vec![direct, group];
    let ticket = db.begin_sidebar_load(TEAM).unwrap().unwrap();
    assert!(db.store_sidebar(ticket, &sidebar).unwrap());
    let (_, names) = db.begin_team_roles(TEAM).unwrap().unwrap();
    assert_eq!(names, ["direct_writer", "group_reader", "shared"]);
    assert_eq!(
        db.begin_team_roles(OTHER).unwrap().unwrap().1,
        ["channel_user", "team_user"]
    );

    sidebar.channels[0].kind = "P".into();
    sidebar.channels[0].roles = Some("team_user shared".into());
    let ticket = db.begin_sidebar_load(TEAM).unwrap().unwrap();
    assert!(db.store_sidebar(ticket, &sidebar).unwrap());
    assert_eq!(
        db.begin_team_roles(TEAM).unwrap().unwrap().1,
        ["group_reader", "shared", "team_user"]
    );

    sidebar.channels.truncate(1);
    sidebar.channels[0].kind = "D".into();
    sidebar.channels[0].roles = None;
    let ticket = db.begin_sidebar_load(TEAM).unwrap().unwrap();
    assert!(db.store_sidebar(ticket, &sidebar).unwrap());
    assert!(db.begin_team_roles(TEAM).unwrap().unwrap().1.is_empty());
    sidebar.channels.clear();
    let ticket = db.begin_sidebar_load(TEAM).unwrap().unwrap();
    assert!(db.store_sidebar(ticket, &sidebar).unwrap());
    assert!(db.begin_team_roles(TEAM).unwrap().is_none());
    assert!(db.begin_team_roles(USER).unwrap().is_none());
}

#[test]
fn role_assignment_query_reads_only_the_requested_team_on_a_large_sidebar() {
    let dir = tempdir().unwrap();
    let mut db = open(dir.path());
    db.write(|tx| {
        tx.execute_batch("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<100)
            INSERT INTO sidebar_team(team_id,published) SELECT printf('%026d',i),1 FROM n;
            WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<50)
            INSERT INTO sidebar_channel(team_id,position,channel_id,kind,name,display_name,header,purpose,delete_at,muted,roles)
            SELECT team_id,i,printf('%026d',i),'O','room','Room','','',0,0,'channel_user' FROM sidebar_team,n;
            ANALYZE")?;
        let plan=tx.prepare(&format!("EXPLAIN QUERY PLAN {ASSIGNMENTS}"))?
            .query_map([format!("{:026}",75)],|row|row.get::<_,String>(3))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        assert_eq!(plan.iter().filter(|line|line.starts_with("SEARCH sidebar_channel") && line.contains("team_id=?")).count(),2,"{plan:?}");
        assert!(plan.iter().any(|line|line.starts_with("SEARCH joined_team") && line.contains("team_id=?")),"{plan:?}");
        Ok(())
    }).unwrap();
}
