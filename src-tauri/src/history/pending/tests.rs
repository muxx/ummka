use super::*;
use crate::history::{
    DraftSave, HistoryDatabase,
    schema::{MIGRATIONS, Migration},
};
use crate::sessions::Account;
use std::{path::Path, sync::Barrier, thread};
use tempfile::tempdir;

const INSTALLATION: &str = "https://messages.example.test/mm";
const ME: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROOM: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const THREAD: &str = "cccccccccccccccccccccccccc";
const TEXT: &str = "  **Север**\n\n🐻‍❄️\t";

fn account() -> Account {
    Account::new(INSTALLATION, ME).unwrap()
}

fn open(path: &Path) -> AccountHistory {
    AccountHistory::open(path, &account()).unwrap()
}

fn edit(view: &mut AccountHistory, root: Option<&str>, text: &str) -> ComposerDraft {
    let previous = view.read_draft(ROOM, root).unwrap();
    let DraftSave::Saved(draft) = view
        .save_draft(ROOM, root, previous.revision.as_deref(), text)
        .unwrap()
    else {
        panic!("could not save fixture draft")
    };
    draft
}

fn send(view: &mut AccountHistory, root: Option<&str>, text: &str) -> (PendingPost, ComposerDraft) {
    let edit = edit(view, root, text);
    let StagePost::Created { post, draft } = view
        .stage_post(ROOM, root, edit.revision.as_deref().unwrap())
        .unwrap()
    else {
        panic!("expected a fresh attempt")
    };
    (post, draft)
}

#[test]
fn preserves_exact_text_order_and_separate_destinations_across_reopen() {
    let path = tempdir().unwrap();
    let mut a = open(path.path());
    let (first, cleared) = send(&mut a, None, TEXT);
    assert_eq!(cleared.message, "");
    assert!(cleared.revision.is_some());
    assert_eq!(first.message, TEXT);
    assert!(!first.previous_login);
    assert!(first.created_at > 0);
    let id = Uuid::parse_str(first.pending_id.strip_prefix(&format!("{ME}:")).unwrap()).unwrap();
    assert_eq!(id.get_version_num(), 4);
    let (reply, _) = send(&mut a, Some(THREAD), TEXT);
    let (next, _) = send(&mut a, None, TEXT);
    assert!(first.sequence < reply.sequence && reply.sequence < next.sequence);
    assert_ne!(first.pending_id, next.pending_id);
    drop(a);
    let mut b = open(path.path());
    for _ in 0..2 {
        assert_eq!(
            b.pending_posts(ROOM, None, 0, 1).unwrap().as_slice(),
            std::slice::from_ref(&first)
        );
        assert_eq!(
            b.pending_posts(ROOM, None, first.sequence, 4)
                .unwrap()
                .as_slice(),
            std::slice::from_ref(&next)
        );
        assert_eq!(
            b.pending_posts(ROOM, Some(THREAD), 0, 10)
                .unwrap()
                .as_slice(),
            std::slice::from_ref(&reply)
        );
        assert!(b.pending_posts(THREAD, None, 0, 10).unwrap().is_empty());
        assert!(
            b.pending_posts(ROOM, None, next.sequence, 10)
                .unwrap()
                .is_empty()
        );
    }
    assert!(b.read_draft(ROOM, None).unwrap().message.is_empty());
}

#[test]
fn concurrent_windows_and_a_late_retry_can_create_only_one_attempt() {
    let path = tempdir().unwrap();
    let mut editor = open(path.path());
    let original = edit(&mut editor, None, TEXT).revision.unwrap();
    let barrier = Barrier::new(2);
    let outcomes = thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|_| {
                scope.spawn(|| {
                    let mut view = open(path.path());
                    barrier.wait();
                    view.stage_post(ROOM, None, &original).unwrap()
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(
        outcomes
            .iter()
            .filter(|r| matches!(r, StagePost::Created { .. }))
            .count(),
        1
    );
    let current = editor.read_draft(ROOM, None).unwrap();
    assert!(current.message.is_empty());
    assert_ne!(current.revision.as_ref(), Some(&original));
    assert!(
        outcomes
            .iter()
            .any(|r| matches!(r,StagePost::NotStaged{draft} if *draft == current))
    );
    let replacement = edit(&mut editor, None, "another");
    assert_eq!(
        editor.stage_post(ROOM, None, &original).unwrap(),
        StagePost::NotStaged { draft: replacement }
    );
    assert_eq!(editor.pending_posts(ROOM, None, 0, 5).unwrap().len(), 1);
}

#[test]
fn failed_clear_rolls_back_the_pending_insert_and_preserves_the_edited_draft() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    let original = edit(&mut view, Some(THREAD), TEXT);
    view.write(|tx| {
        tx.execute_batch(
            "CREATE TEMP TRIGGER abort_clear BEFORE UPDATE ON composer_draft
        WHEN NEW.message='' BEGIN SELECT RAISE(ABORT,'injected storage failure'); END",
        )
    })
    .unwrap();
    assert_eq!(
        view.stage_post(ROOM, Some(THREAD), original.revision.as_deref().unwrap()),
        Err(HistoryError::Storage)
    );
    drop(view);
    let mut reopened = open(path.path());
    assert_eq!(reopened.read_draft(ROOM, Some(THREAD)).unwrap(), original);
    assert!(
        reopened
            .pending_posts(ROOM, Some(THREAD), 0, 5)
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        reopened.stage_post(ROOM, Some(THREAD), original.revision.as_deref().unwrap()),
        Ok(StagePost::Created { .. })
    ));
}

#[test]
fn validates_keys_and_keeps_blank_text_in_the_editor() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    let blank = edit(&mut view, None, "\t\n\u{feff}\u{a0}");
    let version = blank.revision.clone().unwrap();
    assert_eq!(
        view.stage_post(ROOM, None, &version).unwrap(),
        StagePost::NotStaged { draft: blank }
    );
    assert_eq!(
        view.stage_post(ROOM, None, "bad"),
        Err(HistoryError::InvalidDraft)
    );
    assert_eq!(
        view.stage_post(ROOM, Some(""), &version),
        Err(HistoryError::InvalidDraft)
    );
    assert_eq!(
        view.pending_posts("bad", None, 0, 2),
        Err(HistoryError::InvalidDraft)
    );
    assert_eq!(
        view.pending_posts(ROOM, None, -1, 2),
        Err(HistoryError::InvalidDraft)
    );
    assert_eq!(
        view.pending_posts(ROOM, None, 0, 0),
        Err(HistoryError::InvalidDraft)
    );
    assert!(view.pending_posts(ROOM, None, 0, 5).unwrap().is_empty());
    assert_eq!(send(&mut view, None, "\u{85}").0.message, "\u{85}");
}

#[test]
fn same_user_reopens_pending_text_and_sign_out_removes_it() {
    let path = tempdir().unwrap();
    let mut old = open(path.path());
    let (post, _) = send(&mut old, None, TEXT);
    let draft = edit(&mut old, None, "later").revision.unwrap();
    old.database.new_login(&account()).unwrap();
    assert_eq!(
        old.stage_post(ROOM, None, &draft),
        Err(HistoryError::StaleOwner)
    );
    let mut current = open(path.path());
    assert_eq!(
        current.pending_posts(ROOM, None, 0, 3).unwrap(),
        [PendingPost {
            previous_login: true,
            ..post
        }]
    );
    let separate = Account::new("https://messages.example.test/other", ME).unwrap();
    assert!(
        AccountHistory::open(path.path(), &separate)
            .unwrap()
            .pending_posts(ROOM, None, 0, 3)
            .unwrap()
            .is_empty()
    );
    HistoryDatabase::purge_account(path.path(), &account()).unwrap();
    assert_eq!(
        current.pending_posts(ROOM, None, 0, 3),
        Err(HistoryError::StaleOwner)
    );
    let replacement = Account::new(INSTALLATION, THREAD).unwrap();
    let mut next = AccountHistory::open(path.path(), &replacement).unwrap();
    assert!(next.pending_posts(ROOM, None, 0, 3).unwrap().is_empty());
    assert_eq!(
        next.read_draft(ROOM, None).unwrap(),
        ComposerDraft::default()
    );
}

#[test]
fn v8_upgrade_rollback_and_older_client_preserve_fixture_data() {
    let path = tempdir().unwrap();
    let mut old = HistoryDatabase::open_with(path.path(), INSTALLATION, &MIGRATIONS[..8]).unwrap();
    let owner = old.restore(&account()).unwrap();
    // Populate through the published v8 schema, independently of the current draft writer.
    let revision: String = old
        .write(&owner, |tx| tx.query_row(
            "INSERT INTO composer_draft(channel_id,root_id,message,revision) VALUES (?1,'',?2,lower(hex(randomblob(16)))) RETURNING revision",
            [ROOM, TEXT], |row| row.get(0)))
        .unwrap();
    drop(old);
    let mut broken: Vec<_> = MIGRATIONS[..8]
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    broken.push(Migration {
        statements: &[
            include_str!("../migrations/0009_pending_post.sql"),
            "CREATE INDEX broken ON no_such_table(x)",
        ],
        objects: MIGRATIONS[8].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(path.path(), INSTALLATION, &broken),
        Err(HistoryError::Storage)
    ));
    let mut v8 = HistoryDatabase::open_with(path.path(), INSTALLATION, &MIGRATIONS[..8]).unwrap();
    assert_eq!(
        v8.read(&owner, |tx| tx.query_row(
            "SELECT message,revision FROM composer_draft WHERE channel_id=?1 AND root_id=''",
            [ROOM],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        ))
        .unwrap(),
        (TEXT.to_owned(), revision.clone())
    );
    drop(v8);
    let mut upgraded = open(path.path());
    let draft = upgraded.read_draft(ROOM, None).unwrap();
    assert_eq!(draft.message, TEXT);
    assert_eq!(draft.revision.as_ref(), Some(&revision));
    assert_eq!(draft.cleared_by_submission, None);
    assert!(matches!(
        upgraded.stage_post(ROOM, None, &revision),
        Ok(StagePost::Created { .. })
    ));
    drop(upgraded);
    assert!(matches!(
        HistoryDatabase::open_with(path.path(), INSTALLATION, &MIGRATIONS[..8]),
        Err(HistoryError::UnsupportedSchema)
    ));
    assert_eq!(
        open(path.path()).pending_posts(ROOM, None, 0, 2).unwrap()[0].message,
        TEXT
    );
}

#[test]
fn paginates_by_an_index_across_five_thousand_pending_posts() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    view.write(|tx| {
        tx.execute(
            "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5000)
             INSERT INTO pending_post(channel_id,root_id,pending_id,message,created_at,login_generation)
             SELECT ?1,CASE WHEN i%2=0 THEN '' ELSE ?2 END,CAST(i AS TEXT),'same text',5,zeroblob(16) FROM n",
            [ROOM, THREAD],
        )?;
        let details = tx
            .prepare(&format!("EXPLAIN QUERY PLAN {LIST}"))?
            .query_map(params![ROOM, "", 4980, 3, [0u8; 16]], |r| r.get::<_, String>(3))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        assert!(details.iter().any(|s| s.contains(
            "SEARCH pending_post USING INDEX pending_post_by_conversation (channel_id=? AND root_id=? AND rowid>?)"
        )), "{details:?}");
        assert!(
            !details.iter().any(|s| s.contains("TEMP B-TREE")),
            "{details:?}"
        );
        Ok(())
    })
    .unwrap();
    let page = view.pending_posts(ROOM, None, 4980, 3).unwrap();
    assert_eq!(
        page.iter().map(|p| p.sequence).collect::<Vec<_>>(),
        [4982, 4984, 4986]
    );
}
