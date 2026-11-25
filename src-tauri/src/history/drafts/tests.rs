use super::*;
use crate::history::{
    HistoryDatabase,
    schema::{MIGRATIONS, Migration},
};
use crate::sessions::Account;
use std::{
    path::Path,
    sync::{Arc, Barrier},
    thread,
};
use tempfile::tempdir;

const URL: &str = "https://drafts.example.test/mm";
const ME: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROOM: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const THREAD: &str = "cccccccccccccccccccccccccc";

fn account() -> Account {
    Account::new(URL, ME).unwrap()
}
fn open(path: &Path) -> AccountHistory {
    AccountHistory::open(path, &account()).unwrap()
}
fn saved(outcome: DraftSave) -> ComposerDraft {
    let DraftSave::Saved(draft) = outcome else {
        panic!("expected a saved draft")
    };
    draft
}

#[test]
fn preserves_exact_text_across_reopen_and_isolates_channels_threads_and_accounts() {
    let root = tempdir().unwrap();
    let mut first = open(root.path());
    let message = "  Привет\n🐻‍❄️\t ";
    let edit = saved(first.save_draft(ROOM, None, None, message).unwrap());
    assert_eq!(edit.message, message);
    assert_eq!(edit.revision.as_deref().unwrap().len(), 32);
    let reply = saved(first.save_draft(ROOM, Some(THREAD), None, "  ").unwrap());
    drop(first);
    let mut second = open(root.path());
    assert_eq!(second.read_draft(ROOM, None).unwrap(), edit);
    assert_eq!(second.read_draft(ROOM, Some(THREAD)).unwrap(), reply);
    assert_eq!(
        second.read_draft(THREAD, None).unwrap(),
        ComposerDraft::default()
    );
    let another = Account::new("https://another.example.test/mm", ME).unwrap();
    assert_eq!(
        AccountHistory::open(root.path(), &another)
            .unwrap()
            .read_draft(ROOM, None)
            .unwrap(),
        ComposerDraft::default()
    );

    // The next login by the same user keeps drafts and retires the previous connection.
    second.database.new_login(&account()).unwrap();
    assert_eq!(
        second.save_draft(ROOM, None, edit.revision.as_deref(), "old"),
        Err(HistoryError::StaleOwner)
    );
    let mut current = open(root.path());
    assert_eq!(current.read_draft(ROOM, None).unwrap(), edit);
    HistoryDatabase::purge_account(root.path(), &account()).unwrap();
    assert_eq!(
        current.read_draft(ROOM, Some(THREAD)),
        Err(HistoryError::StaleOwner)
    );
    let other = Account::new(URL, THREAD).unwrap();
    let mut other_view = AccountHistory::open(root.path(), &other).unwrap();
    assert_eq!(
        other_view.read_draft(ROOM, None).unwrap(),
        ComposerDraft::default()
    );
    assert_eq!(
        other_view.read_draft(ROOM, Some(THREAD)).unwrap(),
        ComposerDraft::default()
    );
}

#[test]
fn confirms_retries_and_keeps_a_revision_after_clearing() {
    let root = tempdir().unwrap();
    let mut a = open(root.path());
    let mut b = open(root.path());
    let initial = saved(a.save_draft(ROOM, None, None, "one").unwrap());
    assert_eq!(
        saved(b.save_draft(ROOM, None, None, "one").unwrap()),
        initial
    );
    let updated = saved(
        b.save_draft(ROOM, None, initial.revision.as_deref(), "two")
            .unwrap(),
    );
    assert_ne!(updated.revision, initial.revision);
    assert_eq!(
        a.save_draft(ROOM, None, initial.revision.as_deref(), "")
            .unwrap(),
        DraftSave::Conflict(updated)
    );
    let latest = a.read_draft(ROOM, None).unwrap();
    let cleared = saved(
        a.save_draft(ROOM, None, latest.revision.as_deref(), "")
            .unwrap(),
    );
    assert_eq!(cleared.message, "");
    assert_ne!(cleared.revision, latest.revision);
    assert_eq!(
        saved(
            b.save_draft(ROOM, None, latest.revision.as_deref(), "")
                .unwrap()
        ),
        cleared
    );
    assert_eq!(
        b.save_draft(ROOM, None, None, "stale").unwrap(),
        DraftSave::Conflict(cleared)
    );
    let empty = saved(a.save_draft(ROOM, Some(THREAD), None, "").unwrap());
    assert!(empty.revision.is_some());
    assert_eq!(
        b.save_draft(ROOM, Some(THREAD), None, "delayed").unwrap(),
        DraftSave::Conflict(empty)
    );
    assert_eq!(a.read_draft("bad", None), Err(HistoryError::InvalidDraft));
    assert_eq!(
        a.read_draft(ROOM, Some("")),
        Err(HistoryError::InvalidDraft)
    );
    assert_eq!(
        a.save_draft(ROOM, None, Some("bad"), "x"),
        Err(HistoryError::InvalidDraft)
    );
}

#[test]
fn simultaneous_writers_get_one_saved_value_and_one_conflict() {
    let root = tempdir().unwrap();
    let gate = Arc::new(Barrier::new(2));
    let outcomes = thread::scope(|scope| {
        let threads: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|value| {
                let gate = Arc::clone(&gate);
                let path = root.path();
                scope.spawn(move || {
                    let mut view = open(path);
                    gate.wait();
                    view.save_draft(ROOM, None, None, value).unwrap()
                })
            })
            .collect();
        threads
            .into_iter()
            .map(|task| task.join().unwrap())
            .collect::<Vec<_>>()
    });
    let current = open(root.path()).read_draft(ROOM, None).unwrap();
    assert_eq!(
        outcomes
            .iter()
            .filter(|r| matches!(r, DraftSave::Saved(d) if d == &current))
            .count(),
        1
    );
    assert_eq!(
        outcomes
            .iter()
            .filter(|r| matches!(r, DraftSave::Conflict(d) if d == &current))
            .count(),
        1
    );
}

#[test]
fn preserves_v7_data_on_upgrade_failure_and_refuses_downgrade() {
    let root = tempdir().unwrap();
    let mut old = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..7]).unwrap();
    let owner = old.restore(&account()).unwrap();
    let preferences = crate::history::SidebarPreferences::default();
    let encoded = serde_json::to_string(&preferences).unwrap();
    old.write(&owner, |tx| {
        tx.execute("INSERT INTO workspace_settings(owner, preferences) VALUES(1,?1)", [&encoded])?;
        tx.execute("INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
            VALUES(?1,?1,?1,1,1,0,'','before v8','',0)", [ROOM])?;
        Ok(())
    }).unwrap();
    drop(old);
    let mut broken: Vec<_> = MIGRATIONS[..7]
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    broken.push(Migration {
        statements: &[
            include_str!("../migrations/0008_composer_draft.sql"),
            "CREATE INDEX broken ON missing_table(col)",
        ],
        objects: MIGRATIONS[7].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(root.path(), URL, &broken),
        Err(HistoryError::Storage)
    ));
    let mut restored = HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..7]).unwrap();
    assert_eq!(
        restored.restore(&account()).unwrap().generation,
        owner.generation
    );
    drop(restored);
    let edit = saved(
        open(root.path())
            .save_draft(ROOM, None, None, "after v8")
            .unwrap(),
    );
    assert!(matches!(
        HistoryDatabase::open_with(root.path(), URL, &MIGRATIONS[..7]),
        Err(HistoryError::UnsupportedSchema)
    ));
    let mut updated = open(root.path());
    assert_eq!(updated.read_draft(ROOM, None).unwrap(), edit);
    assert_eq!(
        updated.read_post(ROOM).unwrap().unwrap().message,
        "before v8"
    );
    assert_eq!(
        updated.read_workspace_settings().unwrap().preferences,
        Some(preferences)
    );
}

#[test]
fn reads_one_draft_by_composite_primary_key_among_five_thousand() {
    let root = tempdir().unwrap();
    let mut view = open(root.path());
    view.write(|tx| {
        let mut insert = tx.prepare(
            "INSERT INTO composer_draft(channel_id, root_id, message, revision)
            VALUES (?1, ?2, 'draft', lower(hex(randomblob(16))))",
        )?;
        for n in 0..5000 {
            insert.execute(params![ROOM, format!("{n:026}")])?;
        }
        let plan = tx.query_row(&format!("EXPLAIN QUERY PLAN {READ}"), [ROOM, THREAD], |r| {
            r.get::<_, String>(3)
        })?;
        assert!(
            plan.contains("SEARCH composer_draft USING PRIMARY KEY (channel_id=? AND root_id=?)"),
            "{plan}"
        );
        Ok(())
    })
    .unwrap();
    assert_eq!(
        view.read_draft(ROOM, Some(&format!("{:026}", 4999)))
            .unwrap()
            .message,
        "draft"
    );
}
