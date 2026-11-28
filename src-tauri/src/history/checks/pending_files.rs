use super::{
    ALICE, BOB, account,
    departure::{NEIGHBOR, TEAM, seed_sidebar},
    posts::{CHANNEL, ROOT},
};
use crate::{
    history::{
        AccountHistory, ComposerDraft, DraftSave, HistoryDatabase, HistoryError, PendingPost,
        PostRefusal, RefusalScope, RetryPost, StagePost, filename,
        pending::FILES_FOR_PAGE,
        schema::{MIGRATIONS, Migration},
    },
    rest::file_upload::UploadedFile,
};
use rusqlite::params;
use std::{fs, path::Path, sync::Barrier, thread};

const URL: &str = "https://pending-files.example.test/team";
const PEER: &str = "https://pending-files.example.test/peer";

fn uploaded(id: char, size: u64) -> UploadedFile {
    UploadedFile {
        id: id.to_string().repeat(26),
        name: "same name.txt".into(),
        size,
    }
}

fn selected() -> [UploadedFile; 2] {
    [uploaded('z', 12), uploaded('a', 7)]
}

fn check_files(post: &PendingPost, expected: &[UploadedFile]) {
    let fields: Vec<_> = post
        .files
        .iter()
        .map(|file| (file.id.as_str(), file.name.as_str(), file.size))
        .collect();
    assert_eq!(
        fields,
        expected
            .iter()
            .map(|file| (
                file.id.as_str(),
                file.name.as_str(),
                i64::try_from(file.size).unwrap()
            ))
            .collect::<Vec<_>>()
    );
}

fn store(
    view: &mut AccountHistory,
    channel: &str,
    root: Option<&str>,
    revision: Option<&str>,
    files: &[UploadedFile],
) -> Result<(PendingPost, ComposerDraft), HistoryError> {
    let StagePost::Created { post, draft } =
        view.stage_post_with_files(channel, root, revision, files)?
    else {
        panic!("fixture must be queued");
    };
    check_files(&post, files);
    assert!(draft.message.is_empty());
    assert_eq!(draft.cleared_by_submission, Some(true));
    assert_ne!(draft.revision.as_deref(), revision);
    Ok((post, draft))
}

fn file_count(view: &mut AccountHistory) -> Result<u32, HistoryError> {
    view.read(|tx| tx.query_row("SELECT count(*) FROM pending_post_file", [], |r| r.get(0)))
}

fn saves_and_retries(root: &Path) -> Result<(), HistoryError> {
    let identity = account(URL, ALICE);
    let files = selected();
    let mut writer = AccountHistory::open(root, &identity)?;
    seed_sidebar(&mut writer)?;
    let (first, sent) = store(&mut writer, CHANNEL, None, None, &files)?;
    assert_eq!(first.root_id, None);
    assert!(first.message.is_empty());
    assert_eq!(
        writer.stage_post_with_files(CHANNEL, None, None, &[uploaded('b', 1)])?,
        StagePost::NotStaged { draft: sent }
    );
    let (reply, _) = store(&mut writer, CHANNEL, Some(ROOT), None, &files)?;
    assert_eq!(reply.root_id.as_deref(), Some(ROOT));
    assert!(reply.message.is_empty());
    let (neighbor, _) = store(&mut writer, NEIGHBOR, None, None, &files[1..])?;
    assert_eq!(file_count(&mut writer)?, 5);
    drop(writer);

    let mut view = AccountHistory::open(root, &identity)?;
    assert_eq!(
        view.recent_pending_posts(CHANNEL, None, None, 1)?,
        std::slice::from_ref(&first)
    );
    assert_eq!(
        view.pending_posts(CHANNEL, Some(ROOT), 0, 1)?,
        std::slice::from_ref(&reply)
    );
    let retried = view
        .retry_post(&first.pending_id, 1, RetryPost::DespiteUnknownDelivery)?
        .unwrap();
    assert_eq!(retried.pending_id, first.pending_id);
    assert_eq!(retried.sequence, first.sequence);
    assert_eq!(retried.attempt, 2);
    check_files(&retried, &files);
    assert!(
        view.retry_post(&first.pending_id, 1, RetryPost::DespiteUnknownDelivery)?
            .is_none()
    );
    assert_eq!(
        view.record_post_refusal(
            &reply.pending_id,
            1,
            &PostRefusal {
                status: 400,
                code: "fixture refusal".into(),
                message: None,
            },
        )?,
        Some(RefusalScope::Delivery)
    );
    let retried_reply = view
        .retry_post(
            &reply.pending_id,
            1,
            RetryPost::AfterRefusal {
                message: String::new(),
            },
        )?
        .unwrap();
    assert!(retried_reply.message.is_empty());
    check_files(&retried_reply, &files);
    assert!(view.dismiss_pending_post(&reply.pending_id, 2)?);
    assert_eq!(file_count(&mut view)?, 3);

    let peer_account = account(PEER, BOB);
    let mut peer = AccountHistory::open(root, &peer_account)?;
    let (peer_post, _) = store(&mut peer, CHANNEL, None, None, &files)?;
    assert!(matches!(
        AccountHistory::open(root, &account(URL, BOB)),
        Err(HistoryError::OwnerConflict)
    ));
    let leave = view
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    assert!(view.finish_channel_membership_update(&leave, false)?);
    assert!(view.pending_posts(CHANNEL, None, 0, 10)?.is_empty());
    assert_eq!(file_count(&mut view)?, 1);
    let absent_revision = view.read_draft(CHANNEL, None)?.revision;
    assert!(matches!(
        view.stage_post_with_files(CHANNEL, None, absent_revision.as_deref(), &files)?,
        StagePost::NotStaged { .. }
    ));
    let join = view
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    assert!(view.finish_channel_membership_update(&join, true)?);
    let revision = view.read_draft(CHANNEL, None)?.revision;
    assert!(revision.is_some() && revision != absent_revision);
    assert!(matches!(
        view.stage_post_with_files(CHANNEL, None, absent_revision.as_deref(), &files)?,
        StagePost::NotStaged { .. }
    ));
    let (after_rejoin, _) = store(&mut view, CHANNEL, None, revision.as_deref(), &files)?;
    assert_eq!(
        view.pending_posts(NEIGHBOR, None, 0, 1)?,
        std::slice::from_ref(&neighbor)
    );
    view.database.new_login(&identity)?;
    assert_eq!(file_count(&mut view), Err(HistoryError::StaleOwner));
    let mut new_login = AccountHistory::open(root, &identity)?;
    assert!(
        new_login
            .retry_post(
                &after_rejoin.pending_id,
                1,
                RetryPost::DespiteUnknownDelivery
            )?
            .is_none()
    );
    assert_eq!(
        new_login.pending_posts(CHANNEL, None, 0, 1)?,
        [PendingPost {
            previous_login: true,
            ..after_rejoin
        }]
    );
    HistoryDatabase::purge_account(root, &identity)?;
    assert_eq!(file_count(&mut new_login), Err(HistoryError::StaleOwner));
    let mut next = AccountHistory::open(root, &account(URL, BOB))?;
    assert_eq!(file_count(&mut next)?, 0);
    assert_eq!(peer.pending_posts(CHANNEL, None, 0, 1)?, [peer_post]);
    Ok(())
}

fn competes_for_one_revision(root: &Path, with_text: bool) -> Result<(), HistoryError> {
    let identity = account(URL, ALICE);
    let mut view = AccountHistory::open(root, &identity)?;
    let revision = if with_text {
        let DraftSave::Saved(draft) = view.save_draft(CHANNEL, Some(ROOT), None, "reply")? else {
            panic!("fixture revision must be saved");
        };
        draft.revision
    } else {
        None
    };
    let first = AccountHistory::open(root, &identity)?;
    let second = AccountHistory::open(root, &identity)?;
    let ready = Barrier::new(2);
    let outcomes = thread::scope(|scope| {
        [(first, uploaded('p', 3)), (second, uploaded('q', 5))]
            .map(|(mut window, file)| {
                let ready = &ready;
                let revision = revision.as_deref();
                scope.spawn(move || {
                    ready.wait();
                    window.stage_post_with_files(CHANNEL, Some(ROOT), revision, &[file])
                })
            })
            .map(|task| task.join().unwrap())
    });
    let [first, second] = outcomes;
    let outcomes = [first?, second?];
    let queued = view.pending_posts(CHANNEL, Some(ROOT), 0, 10)?;
    let [winner] = queued.as_slice() else {
        panic!("one editor owns the submitted revision");
    };
    assert_eq!(winner.message, if with_text { "reply" } else { "" });
    let draft = view.read_draft(CHANNEL, Some(ROOT))?;
    assert_eq!(file_count(&mut view)?, 1);
    assert!(
        outcomes
            .iter()
            .any(|outcome| matches!(outcome, StagePost::Created { post, .. } if post == winner))
    );
    assert!(outcomes.iter().any(
        |outcome| matches!(outcome, StagePost::NotStaged { draft: current } if current == &draft)
    ));
    Ok(())
}

fn rolls_back_and_checks_uploads(root: &Path) -> Result<(), HistoryError> {
    let mut view = AccountHistory::open(root, &account(URL, ALICE))?;
    let DraftSave::Saved(draft) = view.save_draft(CHANNEL, None, None, "preserved")? else {
        panic!("fixture draft must be saved");
    };
    let revision = draft.revision.as_deref();
    let mut bad_id = uploaded('a', 12);
    bad_id.id.pop();
    let too_many: Vec<_> = ('a'..='k').map(|id| uploaded(id, 1)).collect();
    for invalid in [
        &[bad_id][..],
        &[uploaded('a', 1), uploaded('a', 2)],
        &[uploaded('p', u64::MAX)],
        &too_many,
    ] {
        assert_eq!(
            view.stage_post_with_files(CHANNEL, None, revision, invalid),
            Err(HistoryError::InvalidPost)
        );
    }
    view.write(|tx| {
        tx.execute_batch(
            "CREATE TEMP TRIGGER fail_pending_files BEFORE INSERT ON pending_post_file
             WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END",
        )
    })?;
    assert_eq!(
        view.stage_post_with_files(CHANNEL, None, revision, &selected()),
        Err(HistoryError::Storage)
    );
    assert_eq!(view.read_draft(CHANNEL, None)?, draft);
    assert!(view.pending_posts(CHANNEL, None, 0, 10)?.is_empty());
    assert_eq!(file_count(&mut view)?, 0);
    view.write(|tx| tx.execute_batch("DROP TRIGGER fail_pending_files"))?;
    let (queued, _) = store(&mut view, CHANNEL, None, revision, &too_many[..10])?;
    assert_eq!(queued.message, "preserved");
    assert_eq!(file_count(&mut view)?, 10);
    Ok(())
}

fn upgrades_populated_queue_and_pages_files(
    root: &Path,
    prior_version: usize,
) -> Result<(), HistoryError> {
    const COUNT: u32 = 5000;
    const V32: usize = 32;
    const INTERRUPTED: &[&str] = &[
        MIGRATIONS[V32].statements[0],
        "CREATE INDEX interrupted ON missing(pending_id)",
    ];
    let prior = &MIGRATIONS[..prior_version];
    let identity = account(URL, ALICE);
    let mut old = HistoryDatabase::open_with(root, URL, prior)?;
    let owner = old.restore(&identity)?;
    old.write(&owner, |tx| {
        tx.execute(
            "WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?1)
             INSERT INTO pending_post(pending_id,login_generation,channel_id,root_id,message,created_at)
             SELECT printf('fixture-%d',i),?2,CASE WHEN i%2=0 THEN ?3 ELSE ?4 END,'','previous text',25 FROM n",
            params![COUNT, owner.generation, CHANNEL, NEIGHBOR],
        )?;
        tx.execute(
            "INSERT INTO post_attempt(pending_id,attempt,refusal_status,refusal_code)
             VALUES ('fixture-5000',2,400,'fixture refusal')",
            [],
        )
    })?;
    let mut interrupted: Vec<_> = MIGRATIONS[..V32]
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    interrupted.push(Migration {
        statements: INTERRUPTED,
        objects: MIGRATIONS[V32].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(root, URL, &interrupted),
        Err(HistoryError::Storage)
    ));
    let mut previous = HistoryDatabase::open_with(root, URL, prior)?;
    assert!(previous.restore(&identity)? == owner);
    let verify = |tx: &rusqlite::Transaction<'_>| {
        let counts: (u32, u32) = tx.query_row(
            "SELECT (SELECT count(*) FROM pending_post WHERE message='previous text'),
                    (SELECT count(*) FROM post_attempt WHERE pending_id='fixture-5000' AND attempt=2 AND refusal_status=400)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(counts, (COUNT, 1));
        Ok(())
    };
    previous.read(&owner, verify)?;
    drop(previous);
    let mut view = AccountHistory::open(root, &identity)?;
    view.read(verify)?;
    let latest = view.recent_pending_posts(CHANNEL, None, None, 1)?;
    let post = &latest[0];
    assert_eq!(post.pending_id, "fixture-5000");
    assert_eq!(post.message, "previous text");
    assert_eq!(post.attempt, 2);
    assert_eq!(post.refusal.as_ref().unwrap().code, "fixture refusal");
    assert!(post.files.is_empty());
    let (new, _) = store(&mut view, CHANNEL, None, None, &selected())?;
    assert_eq!(
        old.read(&owner, |_| -> rusqlite::Result<()> {
            panic!("old reader entered v33")
        }),
        Err(HistoryError::UnsupportedSchema)
    );
    assert_eq!(
        old.write(&owner, |_| -> rusqlite::Result<()> {
            panic!("old writer entered v33")
        }),
        Err(HistoryError::UnsupportedSchema)
    );
    drop(old);
    drop(view);
    let path = root.join("history").join(filename(URL));
    let bytes = fs::read(&path).map_err(|_| HistoryError::Storage)?;
    assert!(matches!(
        HistoryDatabase::open_with(root, URL, prior),
        Err(HistoryError::UnsupportedSchema)
    ));
    assert_eq!(fs::read(path).map_err(|_| HistoryError::Storage)?, bytes);
    let mut view = AccountHistory::open(root, &identity)?;
    view.read(verify)?;
    let [newest, legacy] = view
        .recent_pending_posts(CHANNEL, None, None, 2)?
        .try_into()
        .unwrap();
    assert_eq!(newest, new);
    assert_eq!(&legacy, post);

    view.write(|tx| {
        tx.execute(
            "INSERT INTO pending_post_file
             SELECT pending_id,0,?1,'first',25 FROM pending_post WHERE sequence<=?2",
            params!["f".repeat(26), COUNT],
        )?;
        tx.execute_batch("ANALYZE")
    })?;
    let page = view.recent_pending_posts(CHANNEL, None, Some(new.sequence), 3)?;
    assert_eq!(
        page.iter().map(|post| post.sequence).collect::<Vec<_>>(),
        [5000, 4998, 4996]
    );
    assert!(
        page.iter()
            .all(|post| post.files.len() == 1 && post.files[0].name == "first")
    );
    view.read(|tx| {
        let ids = serde_json::json!(page.iter().map(|post| &post.pending_id).collect::<Vec<_>>()).to_string();
        let plans = tx
            .prepare(&format!("EXPLAIN QUERY PLAN {FILES_FOR_PAGE}"))?
            .query_map([ids], |row| row.get::<_, String>(3))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        assert!(plans.iter().any(|step| {
            step.contains("SEARCH pending_post_file USING PRIMARY KEY (pending_id=?)")
        }), "{plans:?}");
        assert!(plans.iter().all(|step| !step.contains("SCAN pending_post_file")), "{plans:?}");
        #[cfg(test)]
        {
            let library: String = tx.query_row("SELECT sqlite_version()", [], |row| row.get(0))?;
            println!("SQLite {library}: v33 rollback and reopen kept {COUNT} v{prior_version} rows and attempt; v{prior_version} refused v33");
            println!("File lookup for one page against {COUNT} rows: {plans:?}");
        }
        Ok(())
    })
}

pub(super) fn round_trip(root: &Path) -> Result<(), HistoryError> {
    saves_and_retries(&root.join("retry"))?;
    competes_for_one_revision(&root.join("race-empty"), false)?;
    competes_for_one_revision(&root.join("race-saved"), true)?;
    rolls_back_and_checks_uploads(&root.join("rollback"))?;
    upgrades_populated_queue_and_pages_files(&root.join("schema"), 32)?;
    upgrades_populated_queue_and_pages_files(&root.join("schema-skipped"), 28)
}
