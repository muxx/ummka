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

#[test]
fn a_refusal_survives_restart_but_cannot_hide_a_confirmed_post() {
    let dir = tempdir().unwrap();
    let mut view = open(dir.path());
    let first = stage(&mut view);
    assert_eq!((first.attempt, first.refusal.as_ref()), (1, None));
    let id = &first.pending_id;
    assert!(!view.record_post_refusal(id, 2, &refusal()).unwrap());
    assert!(view.record_post_refusal(id, 1, &refusal()).unwrap());
    drop(view);
    let mut view = open(dir.path());
    let kept = view.pending_posts(ROOM, None, 0, 1).unwrap().remove(0);
    assert_eq!(
        (kept.refusal, kept.message.as_str(), kept.attempt),
        (Some(refusal()), TEXT, 1)
    );
    assert!(view.record_post_refusal(id, 1, &refusal()).unwrap());
    let mut different = refusal();
    different.code = "another.error".into();
    assert!(!view.record_post_refusal(id, 1, &different).unwrap());
    assert!(confirm(&mut view, id));
    assert!(!view.record_post_refusal(id, 1, &refusal()).unwrap());
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
    assert!(!current.record_post_refusal(&id, 1, &refusal()).unwrap());
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
    assert!(
        current
            .record_post_refusal("unconfirmed", 1, &refusal())
            .unwrap()
    );
    drop(current);
    assert!(matches!(
        HistoryDatabase::open_with(dir.path(), SERVER, &MIGRATIONS[..10]),
        Err(HistoryError::UnsupportedSchema)
    ));
    assert_eq!(
        open(dir.path()).pending_posts(ROOM, None, 0, 2).unwrap()[0].refusal,
        Some(refusal())
    );
}

#[test]
fn refusal_uses_the_id_index_with_five_thousand_pending_posts() {
    let dir = tempdir().unwrap();
    let mut view = open(dir.path());
    let generation = view.owner.generation;
    view.write(|tx| {
        tx.execute("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5000)
            INSERT INTO pending_post(pending_id,login_generation,channel_id,root_id,message) SELECT printf('id-%d',i),?1,?2,'','text' FROM n", params![generation,ROOM])?;
        tx.execute("INSERT INTO post_attempt(pending_id,attempt) SELECT pending_id,2 FROM pending_post WHERE sequence%2=0", [])?;
        tx.execute_batch("ANALYZE")?;
        let details = tx.prepare(&format!("EXPLAIN QUERY PLAN {REFUSE}"))?
            .query_map(params!["id-43",1,generation,403,"code","message"],|r|r.get::<_,String>(3))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        assert!(!details.iter().any(|s| s.starts_with("SCAN ")), "{details:?}");
        assert!(details.iter().any(|s|s.contains("SEARCH p USING INDEX")), "{details:?}");
        assert!(details.iter().any(|s|s.contains("SEARCH a USING PRIMARY KEY")), "{details:?}");
        Ok(())
    }).unwrap();
    assert!(view.record_post_refusal("id-43", 1, &refusal()).unwrap());
}
