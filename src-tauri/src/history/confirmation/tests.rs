use super::*;
use crate::history::{
    DraftSave, HistoryDatabase, PageWrite, PostChange, StagePost, StoredPost,
    schema::{MIGRATIONS, Migration},
};
use crate::realtime::{EventConnectionError, ServerEvent, StreamError};
use crate::sessions::Account;
use serde_json::{Value, json};
use std::{path::Path, sync::Barrier, thread};
use tempfile::tempdir;

const URL: &str = "https://delivery.example.test/team";
const ME: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROOM: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const ROOT: &str = "cccccccccccccccccccccccccc";
const REPLY: &str = "dddddddddddddddddddddddddd";
const OTHER: &str = "eeeeeeeeeeeeeeeeeeeeeeeeee";

fn account() -> Account {
    Account::new(URL, ME).unwrap()
}
fn open(path: &Path) -> AccountHistory {
    AccountHistory::open(path, &account()).unwrap()
}
fn stage(view: &mut AccountHistory, root: Option<&str>) -> String {
    let revision = view.read_draft(ROOM, root).unwrap().revision;
    let DraftSave::Saved(draft) = view
        .save_draft(ROOM, root, revision.as_deref(), "same text")
        .unwrap()
    else {
        panic!("expected fixture draft")
    };
    let StagePost::Created { post, .. } = view
        .stage_post(ROOM, root, draft.revision.as_deref().unwrap())
        .unwrap()
    else {
        panic!("expected fixture attempt")
    };
    post.pending_id
}
fn canonical(id: &str, root: Option<&str>) -> DeliveryPost {
    DeliveryPost {
        id: id.into(),
        channel_id: ROOM.into(),
        user_id: ME.into(),
        root_id: root.map(str::to_owned),
    }
}
fn saved(post: DeliveryPost) -> PostChange {
    PostChange::Save(StoredPost {
        id: post.id,
        channel_id: post.channel_id,
        user_id: post.user_id,
        root_id: post.root_id,
        create_at: 10,
        update_at: 10,
        edit_at: 0,
        post_type: String::new(),
        message: "same text".into(),
        message_source: None,
        hashtags: String::new(),
        is_pinned: false,
        thread_summary: None,
    })
}
fn apply(view: &mut AccountHistory, change: PostChange) {
    let load = view.begin_channel_load(ROOM).unwrap();
    assert_eq!(
        view.apply_channel_page(load, &[change]).unwrap(),
        PageWrite::Applied
    );
}
fn http(id: &str) -> DeliverySource {
    DeliverySource::Response {
        request_pending_id: id.to_owned(),
    }
}

fn wire_post(post: &DeliveryPost, pending_id: &str) -> Value {
    json!({
        "id": post.id, "user_id": post.user_id, "channel_id": post.channel_id,
        "root_id": post.root_id.as_deref().unwrap_or(""), "pending_post_id": pending_id
    })
}

fn posted(payload: Value, broadcast: Value) -> ServerEvent {
    ServerEvent {
        name: "posted".into(),
        data: [("post".into(), payload)].into_iter().collect(),
        broadcast: broadcast.as_object().unwrap().clone(),
    }
}

#[test]
fn posted_and_http_can_arrive_in_either_order_and_survive_restart() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    for (event_first, post_id, root) in [(true, ROOT, None), (false, REPLY, Some(ROOT))] {
        let pending = stage(&mut view, root);
        let post = canonical(post_id, root);
        let receipt = posted(
            wire_post(&post, &pending).to_string().into(),
            json!({"channel_id": ROOM}),
        );
        if event_first {
            assert!(receipt.confirm_delivery(&mut view).unwrap());
        } else {
            // The server reads the deduplicated post from SQL and can omit pending_post_id.
            assert!(view.confirm_delivery(http(&pending), None, &post).unwrap());
        }
        drop(view);
        view = open(path.path());
        let kept = view.pending_posts(ROOM, root, 0, 4).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].confirmed_post_id.as_deref(), Some(post_id));
        assert_eq!(kept[0].message, "same text");
        assert_eq!(view.retire_delivered_posts(&[post_id]).unwrap(), 0);
        assert!(
            view.confirm_delivery(http(&pending), Some(&pending), &post)
                .unwrap()
        );
        assert!(receipt.confirm_delivery(&mut view).unwrap());
        apply(&mut view, saved(post));
        assert_eq!(view.retire_delivered_posts(&[post_id, post_id]).unwrap(), 1);
        assert_eq!(view.retire_delivered_posts(&[post_id]).unwrap(), 0);
        assert!(view.pending_posts(ROOM, root, 0, 4).unwrap().is_empty());
        assert!(view.read_post(post_id).unwrap().is_some());
    }
}

#[test]
fn omitted_root_id_confirms_channel_posts_only() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    for root in [None, Some(ROOT)] {
        let pending = stage(&mut view, root);
        let mut post = wire_post(
            &canonical(if root.is_some() { REPLY } else { ROOT }, root),
            &pending,
        );
        post.as_object_mut().unwrap().remove("root_id");
        let event = posted(post.to_string().into(), json!({"channel_id": ROOM}));
        assert_eq!(event.confirm_delivery(&mut view).unwrap(), root.is_none());
        assert_eq!(
            view.pending_posts(ROOM, root, 0, 4).unwrap()[0]
                .confirmed_post_id
                .as_deref(),
            root.is_none().then_some(ROOT)
        );
    }
}

#[test]
fn posted_checks_the_recipient_and_exact_pending_conversation() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    let pending = stage(&mut view, Some(ROOT));
    let open_channel = view.begin_channel_load(OTHER).unwrap();
    let original = wire_post(&canonical(REPLY, Some(ROOT)), &pending);
    for (field, value) in [
        ("user_id", OTHER),
        ("channel_id", OTHER),
        ("root_id", ""),
        ("pending_post_id", "unknown"),
        ("pending_post_id", ""),
    ] {
        let mut body = original.clone();
        body[field] = value.into();
        let event = posted(
            body.to_string().into(),
            json!({"channel_id": body["channel_id"]}),
        );
        assert!(!event.confirm_delivery(&mut view).unwrap(), "{field}");
    }
    let mut absent = original.clone();
    absent.as_object_mut().unwrap().remove("pending_post_id");
    assert!(
        !posted(absent.to_string().into(), json!({"channel_id": ROOM}))
            .confirm_delivery(&mut view)
            .unwrap()
    );
    for broadcast in [
        json!({"channel_id": OTHER}),
        json!({"user_id": OTHER}),
        json!({"channel_id": ROOM, "user_id": OTHER}),
        json!({}),
    ] {
        assert!(
            !posted(original.to_string().into(), broadcast)
                .confirm_delivery(&mut view)
                .unwrap()
        );
    }
    let mut deleted = original.clone();
    deleted["delete_at"] = 1.into();
    assert!(
        !posted(deleted.to_string().into(), json!({"channel_id": ROOM}))
            .confirm_delivery(&mut view)
            .unwrap()
    );
    let mut unrelated = posted(Value::Null, json!({}));
    unrelated.name = "post_edited".into();
    assert!(!unrelated.confirm_delivery(&mut view).unwrap());
    assert_eq!(
        view.pending_posts(ROOM, Some(ROOT), 0, 4).unwrap()[0].confirmed_post_id,
        None
    );
    let direct = posted(
        original.to_string().into(),
        json!({"channel_id":"", "user_id":ME}),
    );
    assert!(direct.confirm_delivery(&mut view).unwrap());
    assert!(direct.confirm_delivery(&mut view).unwrap());
    let rows = view.pending_posts(ROOM, Some(ROOT), 0, 4).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].confirmed_post_id.as_deref(), Some(REPLY));
    assert!(view.read_post(REPLY).unwrap().is_none());
    assert_eq!(
        view.apply_channel_page(open_channel, &[]).unwrap(),
        PageWrite::Applied
    );
}

#[test]
fn malformed_post_storage_failure_and_a_retired_history_have_distinct_errors() {
    let path = tempdir().unwrap();
    let mut old = open(path.path());
    let mut missing = posted(Value::Null, json!({"channel_id": ROOM}));
    missing.data.clear();
    let malformed = Err(EventConnectionError::Protocol(StreamError::InvalidFrame));
    assert_eq!(missing.confirm_delivery(&mut old), malformed);
    for value in [json!({}), "[]".into(), "{}".into(), "invalid".into()] {
        assert_eq!(
            posted(value, json!({"channel_id": ROOM})).confirm_delivery(&mut old),
            malformed
        );
    }
    HistoryDatabase::purge_account(path.path(), &account()).unwrap();
    let mut new = open(path.path());
    let pending = stage(&mut new, None);
    let body = wire_post(&canonical(ROOT, None), &pending).to_string();
    assert_eq!(
        posted(body.clone().into(), json!({"channel_id": 5})).confirm_delivery(&mut new),
        malformed
    );
    let event = posted(body.into(), json!({"channel_id": ROOM}));
    assert_eq!(
        event.confirm_delivery(&mut old),
        Err(EventConnectionError::History(HistoryError::StaleOwner))
    );
    new.write(|tx| tx.execute_batch("CREATE TEMP TRIGGER reject_receipt BEFORE INSERT ON post_confirmation BEGIN SELECT RAISE(ABORT, 'fixture'); END"))
        .unwrap();
    assert_eq!(
        event.confirm_delivery(&mut new),
        Err(EventConnectionError::History(HistoryError::Storage))
    );
    assert_eq!(
        new.pending_posts(ROOM, None, 0, 1).unwrap()[0].confirmed_post_id,
        None
    );
    new.write(|tx| tx.execute_batch("DROP TRIGGER reject_receipt"))
        .unwrap();
    assert!(event.confirm_delivery(&mut new).unwrap());
}

#[test]
fn ordinary_history_identical_text_or_incorrect_scope_cannot_confirm_a_send() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    let pending = stage(&mut view, Some(ROOT));
    let other = stage(&mut view, Some(ROOT));
    apply(&mut view, saved(canonical(REPLY, Some(ROOT))));
    assert_eq!(view.retire_delivered_posts(&[REPLY]).unwrap(), 0);
    let mut reply = canonical(REPLY, Some(ROOT));
    assert!(
        !view
            .confirm_delivery(DeliverySource::Posted, None, &reply)
            .unwrap()
    );
    assert!(
        !view
            .confirm_delivery(http(&pending), Some(&other), &reply)
            .unwrap()
    );
    reply.channel_id = OTHER.into();
    assert!(
        !view
            .confirm_delivery(DeliverySource::Posted, Some(&pending), &reply)
            .unwrap()
    );
    reply.channel_id = ROOM.into();
    reply.user_id = OTHER.into();
    assert!(!view.confirm_delivery(http(&pending), None, &reply).unwrap());
    reply.user_id = ME.into();
    reply.root_id = None;
    assert!(
        !view
            .confirm_delivery(DeliverySource::Posted, Some(&pending), &reply)
            .unwrap()
    );
    assert!(
        view.pending_posts(ROOM, Some(ROOT), 0, 3)
            .unwrap()
            .iter()
            .all(|p| p.confirmed_post_id.is_none())
    );
    let reply = canonical(REPLY, Some(ROOT));
    assert!(view.confirm_delivery(http(&pending), None, &reply).unwrap());
    assert!(!view.confirm_delivery(http(&other), None, &reply).unwrap());
    assert_eq!(view.retire_delivered_posts(&[REPLY]).unwrap(), 1);
    assert_eq!(
        view.pending_posts(ROOM, Some(ROOT), 0, 3).unwrap()[0].pending_id,
        other
    );
}

#[test]
fn two_authoritative_post_ids_for_one_pending_id_remain_two_posts() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    let pending = stage(&mut view, None);
    let barrier = Barrier::new(2);
    let winners = thread::scope(|scope| {
        let tasks: Vec<_> = [ROOT, OTHER]
            .into_iter()
            .map(|id| {
                let pending = &pending;
                let barrier = &barrier;
                let dir = path.path();
                scope.spawn(move || {
                    let mut other = open(dir);
                    barrier.wait();
                    (
                        id,
                        other
                            .confirm_delivery(http(pending), Some(pending), &canonical(id, None))
                            .unwrap(),
                    )
                })
            })
            .collect();
        tasks
            .into_iter()
            .map(|task| task.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(winners.iter().filter(|(_, matched)| *matched).count(), 1);
    let winner = winners.iter().find(|(_, w)| *w).unwrap().0;
    assert_eq!(
        view.pending_posts(ROOM, None, 0, 3).unwrap()[0]
            .confirmed_post_id
            .as_deref(),
        Some(winner)
    );
    for id in [ROOT, OTHER] {
        apply(&mut view, saved(canonical(id, None)));
    }
    assert_eq!(view.retire_delivered_posts(&[ROOT, OTHER]).unwrap(), 1);
    assert!(view.read_post(ROOT).unwrap().is_some());
    assert!(view.read_post(OTHER).unwrap().is_some());
}

#[test]
fn removal_retires_only_confirmed_posts_and_replies_in_that_conversation() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    let root = stage(&mut view, None);
    let reply = stage(&mut view, Some(ROOT));
    let unknown = stage(&mut view, Some(ROOT));
    let in_other_thread = stage(&mut view, Some(OTHER));
    assert!(
        view.confirm_delivery(http(&root), None, &canonical(ROOT, None))
            .unwrap()
    );
    assert!(
        view.confirm_delivery(http(&reply), None, &canonical(REPLY, Some(ROOT)))
            .unwrap()
    );
    apply(
        &mut view,
        PostChange::Remove {
            id: ROOT.into(),
            channel_id: ROOM.into(),
        },
    );
    assert!(view.pending_posts(ROOM, None, 0, 3).unwrap().is_empty());
    assert_eq!(
        view.pending_posts(ROOM, Some(ROOT), 0, 3).unwrap()[0].pending_id,
        unknown
    );
    assert_eq!(
        view.pending_posts(ROOM, Some(OTHER), 0, 3).unwrap()[0].pending_id,
        in_other_thread
    );
    assert!(
        !view
            .confirm_delivery(http(&root), None, &canonical(ROOT, None))
            .unwrap()
    );
}

#[test]
fn logout_cascades_confirmations_and_invalidates_the_original_handle() {
    let path = tempdir().unwrap();
    let mut old = open(path.path());
    let pending = stage(&mut old, None);
    assert!(
        old.confirm_delivery(http(&pending), None, &canonical(ROOT, None))
            .unwrap()
    );
    HistoryDatabase::purge_account(path.path(), &account()).unwrap();
    assert_eq!(
        old.confirm_delivery(http(&pending), None, &canonical(ROOT, None)),
        Err(HistoryError::StaleOwner)
    );
    let another = Account::new(URL, OTHER).unwrap();
    let mut next = AccountHistory::open(path.path(), &another).unwrap();
    assert!(next.pending_posts(ROOM, None, 0, 4).unwrap().is_empty());
    assert_eq!(
        next.read(
            |tx| tx.query_row("SELECT count(*) FROM post_confirmation", [], |r| r
                .get::<_, u32>(0))
        )
        .unwrap(),
        0
    );
}

#[test]
fn v9_pending_rows_survive_failed_upgrade_and_remain_uncertain_in_v10() {
    let path = tempdir().unwrap();
    let mut v9 = HistoryDatabase::open_with(path.path(), URL, &MIGRATIONS[..9]).unwrap();
    let owner = v9.restore(&account()).unwrap();
    v9.write(&owner, |tx| {
        tx.execute(
            "INSERT INTO pending_post(pending_id,channel_id,root_id,message,login_generation)
        VALUES('old-id',?1,'','preserved',?2)",
            params![ROOM, owner.generation],
        )
    })
    .unwrap();
    drop(v9);
    let mut broken: Vec<_> = MIGRATIONS[..9]
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    broken.push(Migration {
        statements: &[
            include_str!("../migrations/0010_post_confirmation.sql"),
            "CREATE INDEX broken ON missing(col)",
        ],
        objects: MIGRATIONS[9].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(path.path(), URL, &broken),
        Err(HistoryError::Storage)
    ));
    let mut recovered = HistoryDatabase::open_with(path.path(), URL, &MIGRATIONS[..9]).unwrap();
    assert_eq!(
        recovered
            .read(&owner, |tx| tx.query_row(
                "SELECT message FROM pending_post WHERE pending_id='old-id'",
                [],
                |r| r.get::<_, String>(0)
            ))
            .unwrap(),
        "preserved"
    );
    drop(recovered);
    let mut upgraded = open(path.path());
    let pending = upgraded.pending_posts(ROOM, None, 0, 2).unwrap();
    assert_eq!(pending[0].message, "preserved");
    assert_eq!(pending[0].confirmed_post_id, None);
    assert!(
        upgraded
            .confirm_delivery(http("old-id"), None, &canonical(ROOT, None))
            .unwrap()
    );
    drop(upgraded);
    assert!(matches!(
        HistoryDatabase::open_with(path.path(), URL, &MIGRATIONS[..9]),
        Err(HistoryError::UnsupportedSchema)
    ));
    assert_eq!(
        open(path.path()).pending_posts(ROOM, None, 0, 2).unwrap()[0]
            .confirmed_post_id
            .as_deref(),
        Some(ROOT)
    );
}

#[test]
fn confirmation_and_removal_use_indexed_lookups_with_five_thousand_attempts() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    view.write(|tx| {
        tx.execute("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5000)
            INSERT INTO pending_post(pending_id,channel_id,root_id,login_generation,message)
            SELECT printf('pending-%d',i),?1,CASE WHEN i%2=0 THEN '' ELSE printf('%026d',i/2) END,zeroblob(16),'fixture' FROM n", [ROOM])?;
        tx.execute("INSERT INTO post_confirmation SELECT pending_id,printf('%026d',sequence) FROM pending_post", [])?;
        tx.execute_batch("ANALYZE")?;
        let check = |sql: &str, bindings: &[&dyn rusqlite::ToSql]| -> rusqlite::Result<()> {
            let details = tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?
                .query_map(bindings, |r| r.get::<_,String>(3))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let scans_tables = details.iter().any(|line| line.starts_with("SCAN ") &&
                ["pending_post", "post_confirmation", "history_post", "p ", "c ", "h "]
                    .iter().any(|table|line[5..].starts_with(table)));
            assert!(!scans_tables,"{sql}: {details:?}");
            assert!(details.iter().any(|line|line.contains("SEARCH") && line.contains("INDEX") || line.contains("USING PRIMARY KEY")),"{sql}: {details:?}");
            Ok(())
        };
        check(ATTACH, &[&"pending-42",&ROOT,&ROOM,&""])?;
        check(MATCHED, &[&"pending-42",&ROOT,&ROOM,&""])?;
        check(RETIRE, &[&ROOT,&ME])?;
        check(REMOVED, &[&ROOM,&ROOT])
    }).unwrap();
}
