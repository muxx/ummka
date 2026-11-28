use super::{
    ALICE, BOB, account,
    posts::{CHANNEL, ROOT},
};
use crate::history::{
    AccountHistory, CachedPostRead, HistoryDatabase, HistoryError, PageWrite, PostChange,
    PostObservation,
    posts::{AiAttribution, DisplayPriority, READ},
    schema::{MIGRATIONS, Migration},
    windows::read::LATEST,
};
use rusqlite::params;
use serde_json::json;
use std::time::Instant;

const URL: &str = "https://history.example.test/observations";
const VERSION: i64 = 10_000;
const OTHER_CHANNEL: &str = "eeeeeeeeeeeeeeeeeeeeeeeeee";
const OTHER_POST: &str = "pppppppppppppppppppppppppp";

fn sample(
    id: &str,
    channel: &str,
    version: i64,
    priority: Option<DisplayPriority>,
    ai: Option<AiAttribution>,
) -> PostChange {
    serde_json::from_value(json!({
        "kind":"save","id":id,"channelId":channel,"userId":ALICE,"rootId":null,
        "createAt":VERSION,"updateAt":version,"editAt":0,"type":"","message":"network",
        "hashtags":"","isPinned":false,"displayPriority":priority,"aiAttribution":ai
    }))
    .unwrap()
}

fn apply(view: &mut AccountHistory, channel: &str, row: PostChange) -> Result<(), HistoryError> {
    let request = view.begin_channel_load(channel)?;
    assert_eq!(
        view.apply_channel_page(request, &[row])?,
        PageWrite::Applied
    );
    Ok(())
}

#[test]
fn equal_post_versions_follow_sqlite_request_order_across_connections() -> Result<(), HistoryError>
{
    let directory = tempfile::tempdir().unwrap();
    let account = account(URL, ALICE);
    let mut first = AccountHistory::open(directory.path(), &account)?;
    let mut second = AccountHistory::open(directory.path(), &account)?;
    let important = || {
        [sample(
            ROOT,
            CHANNEL,
            VERSION,
            Some(DisplayPriority::Important),
            None,
        )]
    };
    let standard = || {
        [sample(
            ROOT,
            CHANNEL,
            VERSION,
            Some(DisplayPriority::Standard),
            None,
        )]
    };
    let priority = |view: &mut AccountHistory| {
        Ok::<_, HistoryError>(view.read_post(ROOT)?.unwrap().display_priority)
    };
    for older_returns_first in [true, false] {
        let older = first.begin_channel_load(CHANNEL)?;
        let newer = second.begin_channel_load(CHANNEL)?;
        if older_returns_first {
            assert_eq!(
                first.apply_channel_page(older, &important())?,
                PageWrite::Applied
            );
            assert_eq!(priority(&mut second)?, Some(DisplayPriority::Important));
            assert_eq!(
                second.apply_channel_page(newer, &standard())?,
                PageWrite::Applied
            );
        } else {
            assert_eq!(
                second.apply_channel_page(newer, &standard())?,
                PageWrite::Applied
            );
            assert_eq!(
                first.apply_channel_page(older, &important())?,
                PageWrite::Applied
            );
        }
        assert_eq!(priority(&mut first)?, Some(DisplayPriority::Standard));
        assert_eq!(priority(&mut second)?, Some(DisplayPriority::Standard));
    }
    Ok(())
}

#[test]
fn cached_point_observations_share_page_order_and_respect_owner_and_removal()
-> Result<(), HistoryError> {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let account = account(URL, ALICE);
    let mut first = AccountHistory::open(root, &account)?;
    let mut second = AccountHistory::open(root, &account)?;
    let sample_root = |priority| sample(ROOT, CHANNEL, VERSION, priority, None);
    let observation = |priority| PostObservation {
        channel_id: CHANNEL.into(),
        update_at: VERSION,
        display_priority: Some(priority),
        ai_attribution: Some(AiAttribution::None),
        cards: None,
    };
    let source = || AiAttribution::Source {
        user_id: BOB.into(),
        has_username: true,
    };
    apply(
        &mut first,
        CHANNEL,
        sample_root(Some(DisplayPriority::Important)),
    )?;
    let stale_page = first.begin_channel_load(CHANNEL)?;
    let point = second.begin_cached_post_observation(ROOT.into())?;
    assert!(matches!(
        second.observe_cached_post(
            point,
            PostObservation {
                ai_attribution: Some(source()),
                ..observation(DisplayPriority::Standard)
            }
        )?,
        CachedPostRead::Cached { changed: true, .. }
    ));
    assert_eq!(
        first.apply_channel_page(stale_page, &[sample_root(Some(DisplayPriority::Important))])?,
        PageWrite::Applied
    );
    assert_eq!(
        first.read_post(ROOT)?.unwrap().display_priority,
        Some(DisplayPriority::Standard)
    );
    let stale_point = second.begin_cached_post_observation(ROOT.into())?;
    apply(
        &mut first,
        CHANNEL,
        sample_root(Some(DisplayPriority::Standard)),
    )?;
    assert!(matches!(
        second.observe_cached_post(stale_point, observation(DisplayPriority::Important))?,
        CachedPostRead::Cached { changed: false, .. }
    ));
    let old_version = second.begin_cached_post_observation(ROOT.into())?;
    assert!(matches!(
        second.observe_cached_post(
            old_version,
            PostObservation {
                update_at: VERSION - 1,
                ..observation(DisplayPriority::Important)
            }
        )?,
        CachedPostRead::Cached { changed: false, .. }
    ));
    apply(&mut first, CHANNEL, sample_root(None))?;
    let confirmed = second.read_post(ROOT)?.unwrap();
    assert_eq!(confirmed.display_priority, Some(DisplayPriority::Standard));
    assert_eq!(confirmed.ai_attribution, Some(source()));

    let removed = second.begin_cached_post_observation(ROOT.into())?;
    apply(
        &mut first,
        CHANNEL,
        PostChange::Remove {
            id: ROOT.into(),
            channel_id: CHANNEL.into(),
        },
    )?;
    assert_eq!(
        second.observe_cached_post(removed, observation(DisplayPriority::Important))?,
        CachedPostRead::Unavailable
    );
    assert!(first.read_post(ROOT)?.is_none());
    apply(
        &mut first,
        CHANNEL,
        sample_root(Some(DisplayPriority::Standard)),
    )?;
    let retired = second.begin_cached_post_observation(ROOT.into())?;
    let stale = first.begin_channel_load(CHANNEL)?;
    second.database.new_login(&account)?;
    let mut current = AccountHistory::open(root, &account)?;
    assert_eq!(
        current.observe_cached_post(retired, observation(DisplayPriority::Important)),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        current.apply_channel_page(stale, &[sample_root(Some(DisplayPriority::Important))]),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        current.read_post(ROOT)?.unwrap().display_priority,
        Some(DisplayPriority::Standard)
    );
    Ok(())
}

#[test]
fn migrates_populated_posts_and_orders_full_priority_observations() -> Result<(), HistoryError> {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let identity = account(URL, ALICE);
    let prior = &MIGRATIONS[..29];
    let mut old = HistoryDatabase::open_with(root, URL, prior)?;
    let owner = old.restore(&identity)?;
    old.write(&owner, |tx| {
        tx.execute(
            "WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000)
             INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned,from_webhook)
             SELECT CASE WHEN n=10000 THEN ?1 ELSE printf('%026d',n) END,?2,?3,n,n,0,'','cached','',0,0 FROM seq",
            params![ROOT, CHANNEL, ALICE],
        )?;
        tx.execute("INSERT INTO history_window(id,channel_id,collapsed,recent) VALUES(1,?1,0,1)", [CHANNEL])?;
        tx.execute("INSERT INTO history_window_post SELECT id,0,1,create_at,0 FROM history_post", [])?;
        Ok(())
    })?;
    drop(old);
    let mut bad = prior
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect::<Vec<_>>();
    const INTERRUPTED: &[&str] = &[
        MIGRATIONS[29].statements[0],
        "CREATE INDEX bad ON missing(id)",
    ];
    bad.push(Migration {
        statements: INTERRUPTED,
        objects: MIGRATIONS[29].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(root, URL, &bad),
        Err(HistoryError::Storage)
    ));
    let mut recovered = HistoryDatabase::open_with(root, URL, prior)?;
    recovered.read(&owner, |tx| {
        assert_eq!(
            tx.query_row("SELECT count(*) FROM history_window_post", [], |r| r
                .get::<_, u32>(0))?,
            10_000
        );
        Ok(())
    })?;
    drop(recovered);
    let mut view = AccountHistory::open(root, &identity)?;
    assert!(matches!(
        HistoryDatabase::open_with(root, URL, prior),
        Err(HistoryError::UnsupportedSchema)
    ));
    view.write(|tx| tx.execute_batch("ANALYZE"))?;
    view.read(|tx| {
        for (sql, values, index) in [
            (READ, vec![ROOT], "USING PRIMARY KEY"),
            (LATEST, vec!["1", "60"], "history_window_order"),
        ] {
            let mut explain = tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
            let rows = explain
                .query_map(rusqlite::params_from_iter(values), |r| {
                    r.get::<_, String>(3)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            assert!(
                rows.iter().any(|row| row.contains(index))
                    && rows
                        .iter()
                        .all(|row| !row.starts_with("SCAN ") && !row.contains("TEMP B-TREE")),
                "{rows:?}"
            );
            println!("SQLite v30 read on 10,000 posts: {rows:?}");
        }
        assert!(!tx.prepare("PRAGMA foreign_key_check")?.exists([])?);
        Ok(())
    })?;
    let started = Instant::now();
    assert_eq!(
        view.read_latest_window(CHANNEL, false, 60)?
            .unwrap()
            .posts
            .len(),
        60
    );
    println!(
        "SQLite v30 60-post window on 10,000 history rows: {:?}",
        started.elapsed()
    );
    let page = view.read_latest_window(CHANNEL, false, 10_000)?.unwrap();
    assert_eq!(page.posts.len(), 10_000);
    let cached = &page.posts[0];
    assert_eq!(cached.id, ROOT);
    assert_eq!(cached.message, "cached");
    assert_eq!(cached.from_webhook, Some(false));
    assert_eq!(cached.display_priority, None);
    assert_eq!(cached.ai_attribution, None);

    let source = |named| AiAttribution::Source {
        user_id: BOB.into(),
        has_username: named,
    };
    apply(
        &mut view,
        CHANNEL,
        sample(
            ROOT,
            CHANNEL,
            VERSION,
            Some(DisplayPriority::Important),
            Some(source(true)),
        ),
    )?;
    drop(view);
    let mut view = AccountHistory::open(root, &identity)?;
    let mut peer = AccountHistory::open(root, &identity)?;
    let current = view
        .read_window_around(CHANNEL, false, ROOT, 0, 0)?
        .unwrap();
    assert_eq!(
        current.posts[0].display_priority,
        Some(DisplayPriority::Important)
    );
    assert_eq!(current.posts[0].ai_attribution, Some(source(true)));
    assert_eq!(current.posts[0].message, "cached");

    // Deleting the post that received the newest stamp in another channel
    // must not roll back the account clock.
    apply(
        &mut view,
        OTHER_CHANNEL,
        sample(
            OTHER_POST,
            OTHER_CHANNEL,
            1,
            Some(DisplayPriority::Urgent),
            None,
        ),
    )?;
    let stale = peer.begin_channel_load(CHANNEL)?;
    apply(
        &mut view,
        OTHER_CHANNEL,
        PostChange::Remove {
            id: OTHER_POST.into(),
            channel_id: OTHER_CHANNEL.into(),
        },
    )?;
    apply(
        &mut view,
        CHANNEL,
        sample(
            ROOT,
            CHANNEL,
            VERSION,
            Some(DisplayPriority::Standard),
            None,
        ),
    )?;
    assert_eq!(
        peer.apply_channel_page(
            stale,
            &[sample(
                ROOT,
                CHANNEL,
                VERSION,
                Some(DisplayPriority::Important),
                Some(AiAttribution::None)
            )]
        )?,
        PageWrite::Applied
    );
    apply(
        &mut view,
        CHANNEL,
        sample(
            ROOT,
            CHANNEL,
            VERSION - 1,
            Some(DisplayPriority::Important),
            Some(AiAttribution::None),
        ),
    )?;
    apply(
        &mut view,
        CHANNEL,
        sample(ROOT, CHANNEL, VERSION + 1, None, None),
    )?;
    let partial = view.read_post(ROOT)?.unwrap();
    assert_eq!(partial.display_priority, Some(DisplayPriority::Standard));
    assert_eq!(partial.ai_attribution, Some(source(true)));
    apply(
        &mut view,
        CHANNEL,
        sample(
            ROOT,
            CHANNEL,
            VERSION + 1,
            Some(DisplayPriority::Urgent),
            None,
        ),
    )?;
    apply(
        &mut view,
        CHANNEL,
        sample(ROOT, CHANNEL, VERSION + 2, None, Some(source(false))),
    )?;
    let again = view.read_post(ROOT)?.unwrap();
    assert_eq!(again.display_priority, Some(DisplayPriority::Urgent));
    assert_eq!(again.ai_attribution, Some(source(false)));
    apply(
        &mut view,
        CHANNEL,
        sample(
            ROOT,
            CHANNEL,
            VERSION + 3,
            Some(DisplayPriority::Standard),
            Some(AiAttribution::None),
        ),
    )?;
    let ordinary = view.read_post(ROOT)?.unwrap();
    assert_eq!(ordinary.display_priority, Some(DisplayPriority::Standard));
    assert_eq!(ordinary.ai_attribution, Some(AiAttribution::None));
    apply(
        &mut view,
        CHANNEL,
        sample(
            ROOT,
            CHANNEL,
            VERSION + 3,
            Some(DisplayPriority::Other),
            None,
        ),
    )?;
    assert_eq!(
        peer.read_post(ROOT)?.unwrap().display_priority,
        Some(DisplayPriority::Other)
    );

    let late = peer.begin_channel_load(CHANNEL)?;
    apply(
        &mut view,
        CHANNEL,
        PostChange::Remove {
            id: ROOT.into(),
            channel_id: CHANNEL.into(),
        },
    )?;
    assert_eq!(
        peer.apply_channel_page(
            late,
            &[sample(
                ROOT,
                CHANNEL,
                VERSION + 3,
                Some(DisplayPriority::Other),
                Some(source(true))
            )]
        )?,
        PageWrite::Superseded
    );
    assert_eq!(peer.read_post(ROOT)?, None);
    println!(
        "SQLite v30 kept 10,000 migrated posts, rejected rollback and late writes, and observed same-version priority changes."
    );
    Ok(())
}
