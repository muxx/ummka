use super::{
    ALICE, account,
    posts::{CHANNEL, ROOT},
};
use crate::history::{
    AccountHistory, CachedPostRead, ChannelHistoryPage, HistoryDatabase, HistoryError, PageWrite,
    PostChange, PostObservation,
    posts::READ,
    schema::{MIGRATIONS, Migration},
    windows::read::LATEST,
};
use rusqlite::params;
use serde_json::{Value, json};

const BASE: &str = "https://history.example.test/cards";
const REPLY: &str = "pppppppppppppppppppppppppp";
const TEAM: &str = "tttttttttttttttttttttttttt";

fn card(title: &str) -> Value {
    json!([{
        "title": title,
        "text": "**Build passed**",
        "fields": [{"title":"Target", "value":"Android", "short":true}],
        "image":{"url":"https://images.example.test/build.png", "metadata":{"width":4,"height":3,"frameCount":0}}
    }])
}

fn post(id: &str, parent: Option<&str>, version: i64, cards: Value) -> Value {
    json!({
        "kind":"save", "id":id,"channelId":CHANNEL,"userId":ALICE,"rootId":parent,
        "createAt":version,"updateAt":version,"editAt":0,"type":"","message":"",
        "hashtags":"","isPinned":false,"cards":cards
    })
}

fn root(version: i64, cards: Value) -> PostChange {
    serde_json::from_value(post(ROOT, None, version, cards)).unwrap()
}

fn point(version: i64, cards: Value) -> PostObservation {
    serde_json::from_value(json!({"channelId":CHANNEL,"updateAt":version,"cards":cards})).unwrap()
}

fn get(view: &mut AccountHistory, id: &str) -> Option<Value> {
    let row = view.read_post(id).unwrap()?;
    serde_json::to_value(row).unwrap().get("cards").cloned()
}

#[test]
fn first_get_reads_cards_from_a_post_that_arrived_during_the_request() -> Result<(), HistoryError> {
    for (point_version, current_cards) in [(20, card("thread")), (30, json!([]))] {
        let temp = tempfile::tempdir().unwrap();
        let account = account(BASE, ALICE);
        let mut point_reader = AccountHistory::open(temp.path(), &account)?;
        let mut thread_reader = AccountHistory::open(temp.path(), &account)?;
        let uncached = point_reader.begin_cached_post_observation(ROOT.into())?;
        assert_eq!(
            point_reader.observe_cached_post(uncached, point(20, card("only REST")))?,
            CachedPostRead::Uncached
        );
        assert!(point_reader.read_post(ROOT)?.is_none());
        let first = point_reader.begin_cached_post_observation(ROOT.into())?;
        let page: ChannelHistoryPage = serde_json::from_value(json!({
            "source":{"kind":"thread","rootId":ROOT}, "channelId":CHANNEL, "collapsedThreads":false,
            "order":[], "changes":[post(ROOT, None, 30, current_cards.clone())]
        }))
        .unwrap();
        let load = thread_reader.begin_channel_load(CHANNEL)?;
        assert!(matches!(
            thread_reader.apply_channel_window(load, &page)?,
            PageWrite::Thread { .. }
        ));
        let result = point_reader.observe_cached_post(first, point(point_version, card("old")))?;
        assert!(matches!(
            result,
            CachedPostRead::Cached { changed: false, .. }
        ));
        assert_eq!(
            serde_json::to_value(result).unwrap()["cards"]["cards"],
            current_cards
        );
        assert_eq!(get(&mut point_reader, ROOT), Some(current_cards));
    }
    Ok(())
}

#[test]
fn late_get_distinguishes_a_missing_post_from_a_channel_invalidation() -> Result<(), HistoryError> {
    for created in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let account = account(BASE, ALICE);
        let mut view = AccountHistory::open(temp.path(), &account)?;
        let first = view.begin_cached_post_observation(ROOT.into())?;
        if created {
            let load = view.begin_channel_load(CHANNEL)?;
            view.apply_channel_page(load, &[root(30, card("through thread"))])?;
        }
        let load = view.begin_channel_load(CHANNEL)?;
        view.apply_channel_page(
            load,
            &[PostChange::Remove {
                id: ROOT.into(),
                channel_id: CHANNEL.into(),
            }],
        )?;
        assert_eq!(
            view.observe_cached_post(first, point(20, card("old")))?,
            CachedPostRead::Superseded
        );
        assert!(view.read_post(ROOT)?.is_none());

        let unknown = view.begin_cached_post_observation(ROOT.into())?;
        let load = view.begin_channel_load(CHANNEL)?;
        view.apply_channel_page(
            load,
            &[PostChange::Remove {
                id: REPLY.into(),
                channel_id: CHANNEL.into(),
            }],
        )?;
        assert_eq!(
            view.observe_cached_post(unknown, point(20, card("unrelated")))?,
            CachedPostRead::Superseded
        );
        let retry = view.begin_cached_post_observation(ROOT.into())?;
        assert_eq!(
            view.observe_cached_post(retry, point(20, card("fresh")))?,
            CachedPostRead::Uncached
        );

        let load = view.begin_channel_load(CHANNEL)?;
        view.apply_channel_page(load, &[root(30, card("available"))])?;
        let known = view.begin_cached_post_observation(ROOT.into())?;
        let load = view.begin_channel_load(CHANNEL)?;
        view.apply_channel_page(
            load,
            &[PostChange::Remove {
                id: REPLY.into(),
                channel_id: CHANNEL.into(),
            }],
        )?;
        assert_eq!(
            view.observe_cached_post(known, point(30, card("available")))?,
            CachedPostRead::Superseded
        );
        assert_eq!(get(&mut view, ROOT), Some(card("available")));
    }
    Ok(())
}

#[test]
fn an_unknown_anchor_respects_departure_and_owner_replacement() -> Result<(), HistoryError> {
    let temp = tempfile::tempdir().unwrap();
    let identity = account(BASE, ALICE);
    let mut view = AccountHistory::open(temp.path(), &identity)?;
    view.write(|tx| {
        tx.execute(
            "INSERT INTO channel_membership_change(channel_id,team_id) VALUES(?1,?2)",
            [CHANNEL, TEAM],
        )
    })?;
    let departed = view.begin_cached_post_observation(ROOT.into())?;
    let leave = view
        .begin_channel_membership_update(TEAM, CHANNEL)?
        .unwrap();
    assert!(view.finish_channel_membership_update(&leave, false)?);
    assert_eq!(
        view.observe_cached_post(departed, point(20, card("forbidden")))?,
        CachedPostRead::Unavailable
    );
    let retired = view.begin_cached_post_observation(ROOT.into())?;
    HistoryDatabase::purge_account(temp.path(), &identity)?;
    let mut current = AccountHistory::open(temp.path(), &identity)?;
    assert_eq!(
        current.observe_cached_post(retired, point(20, card("retired"))),
        Err(HistoryError::StaleOwner)
    );
    Ok(())
}

#[test]
fn ordered_cards_survive_partial_reads_and_accept_explicit_clearance() -> Result<(), HistoryError> {
    let temp = tempfile::tempdir().unwrap();
    let account = account(BASE, ALICE);
    let mut first = AccountHistory::open(temp.path(), &account)?;
    let mut second = AccountHistory::open(temp.path(), &account)?;

    let earlier = first.begin_channel_load(CHANNEL)?;
    let later = second.begin_channel_load(CHANNEL)?;
    second.apply_channel_page(later, &[root(20, card("latest"))])?;
    first.apply_channel_page(earlier, &[root(20, card("late older dispatch"))])?;
    assert_eq!(get(&mut first, ROOT), Some(card("latest")));

    let newer = second.begin_channel_load(CHANNEL)?;
    let partial = first.begin_channel_load(CHANNEL)?;
    first.apply_channel_page(partial, &[root(30, Value::Null)])?;
    assert_eq!(get(&mut first, ROOT), Some(card("latest")));
    second.apply_channel_page(newer, &[root(30, card("replacement"))])?;
    assert_eq!(get(&mut second, ROOT), Some(card("replacement")));

    let delayed = first.begin_channel_load(CHANNEL)?;
    let direct = second.begin_cached_post_observation(ROOT.into())?;
    assert!(matches!(
        second.observe_cached_post(direct, point(40, card("direct")))?,
        CachedPostRead::Cached { changed: true, .. }
    ));
    assert_eq!(second.read_post(ROOT)?.unwrap().update_at, 30);
    let unknown = first.begin_channel_load(CHANNEL)?;
    first.apply_channel_page(unknown, &[root(35, Value::Null)])?;
    first.apply_channel_page(delayed, &[root(35, card("older than direct"))])?;
    assert_eq!(get(&mut first, ROOT), Some(card("direct")));

    let latest_text = first.begin_channel_load(CHANNEL)?;
    first.apply_channel_page(latest_text, &[root(50, Value::Null)])?;
    let stale_direct = second.begin_cached_post_observation(ROOT.into())?;
    let stale = second.observe_cached_post(stale_direct, point(45, card("older than text")))?;
    assert!(matches!(
        stale,
        CachedPostRead::Cached { changed: false, .. }
    ));
    assert_eq!(
        serde_json::to_value(stale).unwrap()["cards"]["cards"],
        card("direct")
    );
    assert_eq!(get(&mut first, ROOT), Some(card("direct")));
    let obsolete = first.begin_channel_load(CHANNEL)?;
    let clear = second.begin_cached_post_observation(ROOT.into())?;
    assert!(matches!(
        second.observe_cached_post(clear, point(50, json!([])))?,
        CachedPostRead::Cached { changed: true, .. }
    ));
    first.apply_channel_page(obsolete, &[root(50, card("older dispatch"))])?;
    let late_thread: ChannelHistoryPage = serde_json::from_value(json!({
        "source":{"kind":"thread","rootId":ROOT}, "channelId":CHANNEL, "collapsedThreads":false, "order":[],
        "changes":[post(ROOT,None,50,card("old thread")),post(REPLY,Some(ROOT),50,card("reply"))]
    })).unwrap();
    let stale = first.begin_channel_load(CHANNEL)?;
    let clear = second.begin_cached_post_observation(ROOT.into())?;
    second.observe_cached_post(clear, point(50, json!([])))?;
    let response = first.apply_channel_window(stale, &late_thread)?;
    let response = serde_json::to_value(response).unwrap();
    assert_eq!(response["kind"], "thread");
    assert_eq!(response["cards"][0]["cards"], json!([]));
    assert_eq!(response["cards"][1]["cards"], card("reply"));
    drop(first);
    drop(second);
    let mut reopened = AccountHistory::open(temp.path(), &account)?;
    assert_eq!(get(&mut reopened, ROOT), Some(json!([])));
    Ok(())
}

#[test]
fn thread_membership_stays_out_of_windows_and_invalid_cards_roll_back() -> Result<(), HistoryError>
{
    let temp = tempfile::tempdir().unwrap();
    let identity = account(BASE, ALICE);
    let mut view = AccountHistory::open(temp.path(), &identity)?;
    let latest: ChannelHistoryPage = serde_json::from_value(json!({
        "source":{"kind":"latest"}, "channelId":CHANNEL, "collapsedThreads":false, "order":[ROOT],
        "changes":[post(ROOT, None, 10, card("original"))]
    }))
    .unwrap();
    let load = view.begin_channel_load(CHANNEL)?;
    let published = view.apply_channel_window(load, &latest)?;
    assert_eq!(
        serde_json::to_string(&published).unwrap(),
        r#"{"kind":"applied"}"#
    );
    let thread = |reply_cards| {
        serde_json::from_value::<ChannelHistoryPage>(json!({
            "source":{"kind":"thread","rootId":ROOT}, "channelId":CHANNEL, "collapsedThreads":false,
            "order":[],
            "changes":[post(ROOT,None,10,card("thread root")),post(REPLY,Some(ROOT),20,reply_cards)]
        }))
        .unwrap()
    };
    let invalid = json!([{"fields":[], "image":{"url":"https://image.example.test/x","metadata":{"width":0,"height":1}}}]);
    let load = view.begin_channel_load(CHANNEL)?;
    assert_eq!(
        view.apply_channel_window(load, &thread(invalid)),
        Err(HistoryError::InvalidPost)
    );
    assert_eq!(get(&mut view, ROOT), Some(card("original")));
    assert!(view.read_post(REPLY)?.is_none());

    let load = view.begin_channel_load(CHANNEL)?;
    let mut page = post(REPLY, Some(ROOT), 20, card("reply"));
    page["message"] = json!("versioned message ".repeat(8192));
    let mut thread_page = thread(card("reply"));
    thread_page.changes[1] = serde_json::from_value(page).unwrap();
    let published = view.apply_channel_window(load, &thread_page)?;
    assert!(serde_json::to_string(&published).unwrap().len() < 1000);
    let latest = view.read_latest_window(CHANNEL, false, 60)?.unwrap();
    assert_eq!(
        latest
            .posts
            .iter()
            .map(|post| post.id.as_str())
            .collect::<Vec<_>>(),
        [ROOT]
    );
    assert_eq!(get(&mut view, ROOT), Some(card("thread root")));
    assert_eq!(get(&mut view, REPLY), Some(card("reply")));
    let stale_thread = view.begin_channel_load(CHANNEL)?;
    let stale_point = view.begin_cached_post_observation(ROOT.into())?;
    let delete = view.begin_channel_load(CHANNEL)?;
    view.apply_channel_page(
        delete,
        &[PostChange::Remove {
            id: ROOT.into(),
            channel_id: CHANNEL.into(),
        }],
    )?;
    assert_eq!(
        view.apply_channel_window(stale_thread, &thread(card("deleted")))?,
        PageWrite::Superseded
    );
    assert!(view.read_post(ROOT)?.is_none());
    assert!(view.read_post(REPLY)?.is_none());
    assert_eq!(
        view.observe_cached_post(stale_point, point(30, card("deleted")))?,
        CachedPostRead::Unavailable
    );

    let stored = view.begin_channel_load(CHANNEL)?;
    view.apply_channel_window(stored, &thread(card("for purge")))?;
    let stale_owner = view.begin_channel_load(CHANNEL)?;
    let stale_point = view.begin_cached_post_observation(ROOT.into())?;
    HistoryDatabase::purge_account(temp.path(), &identity)?;
    let mut reopened = AccountHistory::open(temp.path(), &identity)?;
    assert!(reopened.read_post(ROOT)?.is_none());
    assert!(reopened.read_post(REPLY)?.is_none());
    assert_eq!(
        reopened.apply_channel_window(stale_owner, &thread(card("retired"))),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        reopened.observe_cached_post(stale_point, point(90, card("retired"))),
        Err(HistoryError::StaleOwner)
    );
    Ok(())
}

#[test]
fn migrates_v30_without_adding_cards_and_preserves_the_indexed_timeline() -> Result<(), HistoryError>
{
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path();
    let identity = account(BASE, ALICE);
    let prior = &MIGRATIONS[..30];
    let mut old = HistoryDatabase::open_with(path, BASE, prior)?;
    let owner = old.restore(&identity)?;
    old.write(&owner, |tx| {
        tx.execute(
            "WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000)
             INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
             SELECT CASE WHEN n=10000 THEN ?1 ELSE printf('%026d',n) END,?2,?3,n,n,0,'','cached','',0 FROM seq",
            params![ROOT, CHANNEL, ALICE],
        )?;
        tx.execute("INSERT INTO history_window(id,channel_id,collapsed,recent) VALUES(1,?1,0,1)", [CHANNEL])?;
        tx.execute("INSERT INTO history_window_post SELECT id,0,1,create_at,0 FROM history_post", [])?;
        tx.execute("INSERT INTO history_channel_deletion(channel_id,revision) VALUES(?1,123456)", [CHANNEL])?;
        Ok(())
    })?;
    let mut broken = prior
        .iter()
        .map(|step| Migration {
            statements: step.statements,
            objects: step.objects,
        })
        .collect::<Vec<_>>();
    const INTERRUPTED: &[&str] = &[
        MIGRATIONS[30].statements[0],
        "INSERT INTO missing VALUES(1)",
    ];
    broken.push(Migration {
        statements: INTERRUPTED,
        objects: MIGRATIONS[30].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(path, BASE, &broken),
        Err(HistoryError::Storage)
    ));
    assert_eq!(
        old.read(&owner, |tx| tx.query_row(
            "SELECT count(*) FROM history_post",
            [],
            |row| row.get::<_, u32>(0)
        ))?,
        10_000
    );

    let mut upgraded = AccountHistory::open(path, &identity)?;
    let legacy = upgraded.read_latest_window(CHANNEL, false, 60)?.unwrap();
    assert_eq!(legacy.posts[0].message, "cached");
    assert!(legacy.posts.iter().all(|post| post.cards.is_none()));
    let first = upgraded.begin_cached_post_observation(REPLY.into())?;
    assert_eq!(
        upgraded.observe_cached_post(first, point(100, card("only in REST")))?,
        CachedPostRead::Uncached
    );
    assert!(matches!(
        HistoryDatabase::open_with(path, BASE, prior),
        Err(HistoryError::UnsupportedSchema)
    ));
    assert_eq!(
        old.write(&owner, |_| -> rusqlite::Result<()> { panic!("old writer") }),
        Err(HistoryError::UnsupportedSchema)
    );

    upgraded.write(|tx| tx.execute_batch("UPDATE history_post SET cards='[]'; ANALYZE;"))?;
    upgraded.read(|tx| {
        for (sql, values, index) in [
            (READ, vec![ROOT], "USING PRIMARY KEY"),
            (LATEST, vec!["1", "60"], "history_window_order"),
        ] {
            let plan = tx
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?
                .query_map(rusqlite::params_from_iter(values), |row| {
                    row.get::<_, String>(3)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            assert!(plan.iter().any(|row| row.contains(index)));
            assert!(
                plan.iter()
                    .all(|row| !row.starts_with("SCAN ") && !row.contains("TEMP B-TREE"))
            );
            println!("SQLite v31: {plan:?}");
        }
        assert!(!tx.prepare("PRAGMA foreign_key_check")?.exists([])?);
        Ok(())
    })?;
    let load = upgraded.begin_channel_load(CHANNEL)?;
    upgraded.apply_channel_page(load, &[root(10_000, card("persisted"))])?;
    assert!(matches!(
        HistoryDatabase::open_with(path, BASE, prior),
        Err(HistoryError::UnsupportedSchema)
    ));
    drop(upgraded);
    let mut reopened = AccountHistory::open(path, &identity)?;
    assert_eq!(get(&mut reopened, ROOT), Some(card("persisted")));
    Ok(())
}
