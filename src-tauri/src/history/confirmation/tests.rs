use super::*;
use crate::history::{
    DraftSave, HistoryDatabase, PageWrite, PostChange, StagePost,
    schema::{MIGRATIONS, Migration},
};
use crate::sessions::Account;
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
fn canonical(id: &str, root: Option<&str>) -> StoredPost {
    StoredPost {
        id: id.into(),
        channel_id: ROOM.into(),
        user_id: ME.into(),
        root_id: root.map(str::to_owned),
        create_at: 10,
        update_at: 10,
        edit_at: 0,
        post_type: String::new(),
        message: "same text".into(),
        message_source: None,
        hashtags: String::new(),
        is_pinned: false,
    }
}
fn apply(view: &mut AccountHistory, change: PostChange) {
    let load = view.begin_channel_load(ROOM).unwrap();
    assert_eq!(
        view.apply_channel_page(load, &[change]).unwrap(),
        PageWrite::Applied
    );
}
fn http(id: &str) -> DeliverySource<'_> {
    DeliverySource::Response {
        request_pending_id: id,
    }
}

#[test]
fn posted_and_http_can_arrive_in_either_order_and_survive_restart() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    for (event_first, post_id, root) in [(true, ROOT, None), (false, REPLY, Some(ROOT))] {
        let pending = stage(&mut view, root);
        let post = canonical(post_id, root);
        if event_first {
            assert!(
                view.confirm_delivery(DeliverySource::Posted, Some(&pending), &post)
                    .unwrap()
            );
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
        assert!(
            view.confirm_delivery(DeliverySource::Posted, Some(&pending), &post)
                .unwrap()
        );
        apply(&mut view, PostChange::Save(post));
        assert_eq!(view.retire_delivered_posts(&[post_id, post_id]).unwrap(), 1);
        assert_eq!(view.retire_delivered_posts(&[post_id]).unwrap(), 0);
        assert!(view.pending_posts(ROOM, root, 0, 4).unwrap().is_empty());
        assert!(view.read_post(post_id).unwrap().is_some());
    }
}

#[test]
fn ordinary_history_identical_text_or_incorrect_scope_cannot_confirm_a_send() {
    let path = tempdir().unwrap();
    let mut view = open(path.path());
    let pending = stage(&mut view, Some(ROOT));
    let other = stage(&mut view, Some(ROOT));
    apply(&mut view, PostChange::Save(canonical(REPLY, Some(ROOT))));
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
        apply(&mut view, PostChange::Save(canonical(id, None)));
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
