use super::*;
use crate::history::{
    DeliveryPost, DeliverySource, DraftSave, HistoryDatabase, PendingPost, StagePost,
    schema::{MIGRATIONS, Migration},
};
use crate::sessions::Account;
use std::path::Path;
use tempfile::tempdir;

const SERVER: &str = "https://attempts.example.test/base";
const USER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROOM: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const POST: &str = "cccccccccccccccccccccccccc";
const TEXT: &str = "  exact draft\n🐻‍❄️ ";

fn account() -> Account {
    Account::new(SERVER, USER).unwrap()
}
fn open(path: &Path) -> AccountHistory {
    AccountHistory::open(path, &account()).unwrap()
}
fn stage(view: &mut AccountHistory) -> PendingPost {
    let existing = view.read_draft(ROOM, None).unwrap();
    let DraftSave::Saved(draft) = view
        .save_draft(ROOM, None, existing.revision.as_deref(), TEXT)
        .unwrap()
    else {
        panic!("fixture draft must be saved");
    };
    let StagePost::Created { post, .. } = view
        .stage_post(ROOM, None, draft.revision.as_deref().unwrap())
        .unwrap()
    else {
        panic!("fixture must stage its saved draft");
    };
    post
}
fn refusal() -> PostRefusal {
    PostRefusal {
        status: 403,
        code: "api.context.permissions.app_error".into(),
        message: Some("You cannot post in this channel.".into()),
    }
}
fn confirm(view: &mut AccountHistory, id: &str) -> bool {
    view.confirm_delivery(
        DeliverySource::Posted,
        Some(id),
        &DeliveryPost {
            id: POST.into(),
            channel_id: ROOM.into(),
            user_id: USER.into(),
            root_id: None,
        },
    )
    .unwrap()
}

fn edit_refused(message: &str) -> RetryPost {
    RetryPost::AfterRefusal {
        message: message.into(),
    }
}

#[test]
fn an_ambiguous_attempt_stays_uncertain_after_a_later_refusal() {
    let dir = tempdir().unwrap();
    let mut view = open(dir.path());
    let original = stage(&mut view);
    let id = &original.pending_id;
    assert!(
        view.retry_post(id, 1, edit_refused("different"))
            .unwrap()
            .is_none()
    );
    let next = view
        .retry_post(id, 1, RetryPost::DespiteUnknownDelivery)
        .unwrap()
        .unwrap();
    assert_eq!(next.attempt, 2);
    assert_eq!(
        (
            &next.pending_id,
            next.message.as_str(),
            next.sequence,
            next.created_at
        ),
        (id, TEXT, original.sequence, original.created_at)
    );
    assert_eq!(view.record_post_refusal(id, 1, &refusal()).unwrap(), None);
    assert_eq!(
        view.record_post_refusal(id, 2, &refusal()).unwrap(),
        Some(RefusalScope::Retry)
    );
    assert!(!view.dismiss_pending_post(id, 1).unwrap());
    drop(view);
    let mut view = open(dir.path());
    assert_eq!(
        view.pending_posts(ROOM, None, 0, 10).unwrap(),
        [PendingPost {
            retry_refusal: Some(Box::new(refusal())),
            ..next
        }]
    );
    assert!(
        view.retry_post(id, 2, edit_refused("cannot replace the first text"))
            .unwrap()
            .is_none()
    );
    let again = view
        .retry_post(id, 2, RetryPost::DespiteUnknownDelivery)
        .unwrap()
        .unwrap();
    assert_eq!(
        (again.attempt, again.message.as_str(), again.retry_refusal),
        (3, TEXT, None)
    );
    assert_eq!(view.record_post_refusal(id, 2, &refusal()).unwrap(), None);
    assert_eq!(
        view.record_post_refusal(id, 3, &refusal()).unwrap(),
        Some(RefusalScope::Retry)
    );
    assert_eq!(
        view.record_post_refusal(id, 3, &refusal()).unwrap(),
        Some(RefusalScope::Retry)
    );
    let mut different = refusal();
    different.code = "another".into();
    assert_eq!(view.record_post_refusal(id, 3, &different).unwrap(), None);
    assert!(confirm(&mut view, id));
    assert!(
        view.retry_post(id, 3, RetryPost::DespiteUnknownDelivery)
            .unwrap()
            .is_none()
    );
    assert!(!view.dismiss_pending_post(id, 3).unwrap());
    let confirmed = view.pending_posts(ROOM, None, 0, 10).unwrap().remove(0);
    assert_eq!(confirmed.confirmed_post_id.as_deref(), Some(POST));
    assert_eq!((confirmed.refusal, confirmed.retry_refusal), (None, None));
}

#[test]
fn correcting_a_definitive_refusal_preserves_the_independent_editor_and_allows_a_second_refusal() {
    let dir = tempdir().unwrap();
    let mut view = open(dir.path());
    let original = stage(&mut view);
    let id = &original.pending_id;
    let revision = view.read_draft(ROOM, None).unwrap().revision;
    let DraftSave::Saved(editor) = view
        .save_draft(ROOM, None, revision.as_deref(), "different unsent draft")
        .unwrap()
    else {
        panic!("expected saved editor")
    };
    assert_eq!(
        view.record_post_refusal(id, 1, &refusal()).unwrap(),
        Some(RefusalScope::Delivery)
    );
    assert!(
        view.retry_post(id, 1, RetryPost::DespiteUnknownDelivery)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        view.retry_post(id, 1, edit_refused(" \t\u{feff} ")),
        Err(HistoryError::InvalidDraft)
    );
    view.write(|tx| tx.execute_batch("CREATE TEMP TRIGGER refuse_update BEFORE UPDATE OF message ON pending_post BEGIN SELECT RAISE(ABORT,'storage failure'); END")).unwrap();
    assert_eq!(
        view.retry_post(id, 1, edit_refused("changed")),
        Err(HistoryError::Storage)
    );
    view.write(|tx| tx.execute_batch("DROP TRIGGER refuse_update"))
        .unwrap();
    let kept = view.pending_posts(ROOM, None, 0, 1).unwrap().remove(0);
    assert_eq!(
        (kept.message.as_str(), kept.attempt, kept.refusal),
        (TEXT, 1, Some(Box::new(refusal())))
    );
    let fixed = "  new **text**\n";
    let next = view
        .retry_post(id, 1, edit_refused(fixed))
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            next.attempt,
            next.message.as_str(),
            next.pending_id.as_str(),
            next.refusal
        ),
        (2, fixed, id.as_str(), None)
    );
    assert_eq!(view.record_post_refusal(id, 1, &refusal()).unwrap(), None);
    assert_eq!(
        view.record_post_refusal(id, 2, &refusal()).unwrap(),
        Some(RefusalScope::Delivery)
    );
    assert!(
        view.retry_post(id, 2, edit_refused("third"))
            .unwrap()
            .is_some()
    );
    assert_eq!(view.read_draft(ROOM, None).unwrap(), editor);
}

#[test]
fn competing_windows_get_one_retry_and_deletion_cannot_remove_a_newer_attempt() {
    use std::{sync::Barrier, thread};
    let dir = tempdir().unwrap();
    let mut view = open(dir.path());
    let pending = stage(&mut view).pending_id;
    let barrier = Barrier::new(2);
    let results = thread::scope(|scope| {
        let mut jobs = Vec::new();
        for _ in 0..2 {
            jobs.push(scope.spawn(|| {
                let mut other = open(dir.path());
                barrier.wait();
                other
                    .retry_post(&pending, 1, RetryPost::DespiteUnknownDelivery)
                    .unwrap()
            }));
        }
        jobs.into_iter()
            .map(|job| job.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(results.iter().flatten().count(), 1);
    assert!(!view.dismiss_pending_post(&pending, 1).unwrap());
    assert!(view.dismiss_pending_post(&pending, 2).unwrap());
    assert!(!view.dismiss_pending_post(&pending, 2).unwrap());
    assert!(
        view.retry_post(&pending, 2, RetryPost::DespiteUnknownDelivery)
            .unwrap()
            .is_none()
    );
    assert!(!confirm(&mut view, &pending));
    assert!(view.pending_posts(ROOM, None, 0, 10).unwrap().is_empty());
    assert_eq!(
        view.read(
            |tx| tx.query_row("SELECT count(*) FROM post_attempt", [], |r| r
                .get::<_, i64>(0))
        )
        .unwrap(),
        0
    );
}

#[test]
fn a_new_login_can_only_read_or_dismiss_the_previous_logins_text() {
    let dir = tempdir().unwrap();
    let mut old = open(dir.path());
    let pending = stage(&mut old).pending_id;
    old.database.new_login(&account()).unwrap();
    assert_eq!(
        old.dismiss_pending_post(&pending, 1),
        Err(HistoryError::StaleOwner)
    );
    let mut current = open(dir.path());
    assert!(
        current
            .retry_post(&pending, 1, RetryPost::DespiteUnknownDelivery)
            .unwrap()
            .is_none()
    );
    assert!(
        current
            .retry_post(&pending, 1, edit_refused("edit"))
            .unwrap()
            .is_none()
    );
    let row = current.pending_posts(ROOM, None, 0, 1).unwrap().remove(0);
    assert!(row.previous_login);
    assert_eq!(row.message, TEXT);
    assert!(current.dismiss_pending_post(&pending, 1).unwrap());
}

#[test]
fn a_refusal_survives_restart_but_cannot_hide_a_confirmed_post() {
    let dir = tempdir().unwrap();
    let mut view = open(dir.path());
    let first = stage(&mut view);
    assert_eq!((first.attempt, first.refusal.as_ref()), (1, None));
    let id = &first.pending_id;
    assert_eq!(view.record_post_refusal(id, 2, &refusal()).unwrap(), None);
    assert_eq!(
        view.record_post_refusal(id, 1, &refusal()).unwrap(),
        Some(RefusalScope::Delivery)
    );
    drop(view);
    let mut view = open(dir.path());
    let kept = view.pending_posts(ROOM, None, 0, 1).unwrap().remove(0);
    assert_eq!(
        (kept.refusal, kept.message.as_str(), kept.attempt),
        (Some(Box::new(refusal())), TEXT, 1)
    );
    assert_eq!(
        view.record_post_refusal(id, 1, &refusal()).unwrap(),
        Some(RefusalScope::Delivery)
    );
    let mut different = refusal();
    different.code = "another.error".into();
    assert_eq!(view.record_post_refusal(id, 1, &different).unwrap(), None);
    assert!(confirm(&mut view, id));
    assert_eq!(view.record_post_refusal(id, 1, &refusal()).unwrap(), None);
    let kept = view.pending_posts(ROOM, None, 0, 1).unwrap().remove(0);
    assert_eq!(
        (kept.confirmed_post_id.as_deref(), kept.refusal),
        (Some(POST), None)
    );
}

#[test]
fn invalid_diagnostics_expired_handles_and_replaced_logins_cannot_record_a_refusal() {
    let dir = tempdir().unwrap();
    let mut previous = open(dir.path());
    let id = stage(&mut previous).pending_id;
    for (status, code, number) in [
        (200, "error", 1),
        (401, "error", 1),
        (403, " ", 1),
        (503, "error", 1),
        (403, "error", 0),
    ] {
        assert_eq!(
            previous.record_post_refusal(
                &id,
                number,
                &PostRefusal {
                    status,
                    code: code.into(),
                    message: None
                }
            ),
            Err(HistoryError::InvalidPost)
        );
    }
    assert!(
        previous.pending_posts(ROOM, None, 0, 1).unwrap()[0]
            .refusal
            .is_none()
    );
    previous.database.new_login(&account()).unwrap();
    assert_eq!(
        previous.record_post_refusal(&id, 1, &refusal()),
        Err(HistoryError::StaleOwner)
    );
    let mut current = open(dir.path());
    assert_eq!(
        current.record_post_refusal(&id, 1, &refusal()).unwrap(),
        None
    );
    let kept = current.pending_posts(ROOM, None, 0, 1).unwrap().remove(0);
    assert!(kept.previous_login && kept.refusal.is_none());
}

#[test]
fn populated_v10_upgrades_and_a_failed_migration_preserves_both_kinds_of_posts() {
    let dir = tempdir().unwrap();
    let mut older = HistoryDatabase::open_with(dir.path(), SERVER, &MIGRATIONS[..10]).unwrap();
    let owner = older.restore(&account()).unwrap();
    older.write(&owner, |tx| {
        for id in ["unconfirmed", "confirmed"] {
            tx.execute("INSERT INTO pending_post(pending_id,login_generation,channel_id,root_id,message) VALUES(?1,?2,?3,'',?4)",
                params![id, owner.generation, ROOM, TEXT])?;
        }
        tx.execute("INSERT INTO post_confirmation VALUES('confirmed',?1)", [POST])
    }).unwrap();
    drop(older);
    let mut broken: Vec<_> = MIGRATIONS[..10]
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    broken.push(Migration {
        statements: &[
            include_str!("../migrations/0011_post_attempt.sql"),
            "CREATE INDEX bad ON missing(col)",
        ],
        objects: MIGRATIONS[10].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(dir.path(), SERVER, &broken),
        Err(HistoryError::Storage)
    ));
    let mut older = HistoryDatabase::open_with(dir.path(), SERVER, &MIGRATIONS[..10]).unwrap();
    assert_eq!(
        older
            .read(&owner, |tx| tx.query_row(
                "SELECT count(*) FROM pending_post WHERE message=?1",
                [TEXT],
                |r| r.get::<_, u32>(0)
            ))
            .unwrap(),
        2
    );
    drop(older);
    let mut current = open(dir.path());
    let posts = current.pending_posts(ROOM, None, 0, 10).unwrap();
    assert_eq!(posts.len(), 2);
    assert!(
        posts
            .iter()
            .all(|p| p.message == TEXT && p.attempt == 1 && p.refusal.is_none())
    );
    assert_eq!(posts[1].confirmed_post_id.as_deref(), Some(POST));
    assert_eq!(
        current
            .record_post_refusal("unconfirmed", 1, &refusal())
            .unwrap(),
        Some(RefusalScope::Delivery)
    );
    drop(current);
    assert!(matches!(
        HistoryDatabase::open_with(dir.path(), SERVER, &MIGRATIONS[..10]),
        Err(HistoryError::UnsupportedSchema)
    ));
    assert_eq!(
        open(dir.path()).pending_posts(ROOM, None, 0, 2).unwrap()[0].refusal,
        Some(Box::new(refusal()))
    );
}

#[test]
fn rebuilding_attempts_retains_uncertain_and_refused_rows_and_rolls_back_on_failure() {
    for version in [11, 13] {
        let dir = tempdir().unwrap();
        let mut old =
            HistoryDatabase::open_with(dir.path(), SERVER, &MIGRATIONS[..version]).unwrap();
        let owner = old.restore(&account()).unwrap();
        old.write(&owner, |tx| {
            tx.execute("INSERT INTO pending_post(pending_id,channel_id,root_id,message,login_generation)
                        VALUES('known',?1,'',?2,?3),('uncertain',?1,'',?2,?3)", params![ROOM, TEXT, owner.generation])?;
            tx.execute("INSERT INTO post_attempt(pending_id,attempt,refusal_status,refusal_code,refusal_message)
                        VALUES('known',2,403,'denied','Old reason')", [])?;
            tx.execute("INSERT INTO post_attempt(pending_id,attempt,prior_uncertain) VALUES('uncertain',3,1)", [])?;
            Ok(())
        }).unwrap();
        drop(old);
        if version == 13 {
            let mut interrupted: Vec<_> = MIGRATIONS[..13]
                .iter()
                .map(|m| Migration {
                    statements: m.statements,
                    objects: m.objects,
                })
                .collect();
            const FAIL_AFTER_COPY: &[&str] = &[
                MIGRATIONS[13].statements[0],
                MIGRATIONS[13].statements[1],
                MIGRATIONS[13].statements[2],
                "DROP TABLE missing_fixture_table",
            ];
            interrupted.push(Migration {
                statements: FAIL_AFTER_COPY,
                objects: MIGRATIONS[13].objects,
            });
            assert!(matches!(
                HistoryDatabase::open_with(dir.path(), SERVER, &interrupted),
                Err(HistoryError::Storage)
            ));
            let mut previous =
                HistoryDatabase::open_with(dir.path(), SERVER, &MIGRATIONS[..13]).unwrap();
            assert_eq!(
                previous
                    .read(&owner, |tx| tx.query_row(
                        "SELECT count(*) FROM post_attempt",
                        [],
                        |r| r.get::<_, u32>(0)
                    ))
                    .unwrap(),
                2
            );
        }
        let mut next = open(dir.path());
        let rows = next.pending_posts(ROOM, None, 0, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].attempt, 2);
        assert_eq!(
            rows[0].refusal.as_ref().unwrap().message.as_deref(),
            Some("Old reason")
        );
        assert_eq!(rows[0].retry_refusal, None);
        assert_eq!(rows[1].attempt, 3);
        assert_eq!((&rows[1].refusal, &rows[1].retry_refusal), (&None, &None));
        assert_eq!(
            next.record_post_refusal("uncertain", 3, &refusal())
                .unwrap(),
            Some(RefusalScope::Retry)
        );
        drop(next);
        assert!(matches!(
            HistoryDatabase::open_with(dir.path(), SERVER, &MIGRATIONS[..version]),
            Err(HistoryError::UnsupportedSchema)
        ));
        let read = open(dir.path()).pending_posts(ROOM, None, 0, 10).unwrap();
        assert_eq!(read[0], rows[0]);
        assert_eq!(
            (
                read[1].message.as_str(),
                read[1].refusal.as_deref(),
                read[1].retry_refusal.as_deref()
            ),
            (TEXT, None, Some(&refusal()))
        );
    }
}

#[test]
fn refusal_retry_and_dismissal_use_id_indexes_with_five_thousand_pending_posts() {
    let dir = tempdir().unwrap();
    let mut view = open(dir.path());
    let generation = view.owner.generation;
    view.write(|tx| {
        tx.execute("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5000)
            INSERT INTO pending_post(pending_id,login_generation,channel_id,root_id,message) SELECT printf('id-%d',i),?1,?2,'','text' FROM n", params![generation,ROOM])?;
        tx.execute("INSERT INTO post_attempt(pending_id,attempt) SELECT pending_id,2 FROM pending_post WHERE sequence%2=0", [])?;
        tx.execute_batch("ANALYZE")?;
        let plan = |sql: &str, bindings: &[&dyn rusqlite::ToSql]| -> rusqlite::Result<Vec<String>> {
            let details = tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?
                .query_map(bindings,|r|r.get::<_,String>(3))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            assert!(!details.iter().any(|s| s.starts_with("SCAN ")), "{sql}: {details:?}");
            assert!(details.iter().any(|s|s.contains("USING INDEX") || s.contains("USING PRIMARY KEY")), "{sql}: {details:?}");
            Ok(details)
        };
        for details in [
            plan(REFUSE, &[&"id-43",&1,&generation,&403,&"code",&"message"])?,
            plan(RESERVE_RETRY, &[&"id-43",&1,&2,&generation,&true])?,
        ] {
            assert!(details.iter().any(|s|s.contains("SEARCH p USING INDEX")), "{details:?}");
            assert!(details.iter().any(|s|s.contains("SEARCH a USING PRIMARY KEY")), "{details:?}");
        }
        plan(RETRY_POST, &[&"id-43",&"edited",&2])?;
        plan(DISMISS, &[&"id-43",&1])?;
        Ok(())
    }).unwrap();
    assert_eq!(
        view.record_post_refusal("id-43", 1, &refusal()).unwrap(),
        Some(RefusalScope::Delivery)
    );
}
