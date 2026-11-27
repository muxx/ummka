use super::{ALICE, BOB, account};
use crate::history::{
    AccountHistory, HistoryDatabase, HistoryError, PageWrite, PostChange, StoredPost,
    posts::{READ, REMOVE},
};
use rusqlite::params;
use std::path::Path;

pub(crate) const CHANNEL: &str = "cccccccccccccccccccccccccc";
pub(crate) const ROOT: &str = "rrrrrrrrrrrrrrrrrrrrrrrrrr";
const REPLY: &str = "pppppppppppppppppppppppppp";
const OTHER: &str = "oooooooooooooooooooooooooo";
const UNSEEN: &str = "uuuuuuuuuuuuuuuuuuuuuuuuuu";
const PEER: &str = "eeeeeeeeeeeeeeeeeeeeeeeeee";
const URL: &str = "https://history.example.test/posts";

pub(crate) fn fixture() -> Vec<PostChange> {
    serde_json::from_str(include_str!(
        "../../../../contracts/mattermost/fixtures/channel-post-changes.json"
    ))
    .unwrap()
}

fn save(id: &str, channel: &str, root: Option<&str>, version: i64, text: &str) -> PostChange {
    PostChange::Save(Box::new(StoredPost {
        id: id.into(),
        channel_id: channel.into(),
        user_id: ALICE.into(),
        root_id: root.map(str::to_owned),
        create_at: 50,
        update_at: version,
        edit_at: version,
        post_type: String::new(),
        message: text.into(),
        message_source: None,
        hashtags: String::new(),
        is_pinned: false,
        from_webhook: None,
        display_priority: None,
        ai_attribution: None,
        thread_summary: None,
        attachments: None,
    }))
}

fn remove(id: &str) -> PostChange {
    PostChange::Remove {
        id: id.into(),
        channel_id: CHANNEL.into(),
    }
}

fn apply(
    view: &mut AccountHistory,
    channel: &str,
    changes: &[PostChange],
) -> Result<(), HistoryError> {
    let load = view.begin_channel_load(channel)?;
    assert_eq!(view.apply_channel_page(load, changes)?, PageWrite::Applied);
    Ok(())
}

fn check_plans(view: &mut AccountHistory) -> Result<(), HistoryError> {
    view.write(|tx| {
        tx.execute("WITH RECURSIVE seq(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM seq WHERE n<2047)
            INSERT INTO history_post(id, channel_id, user_id, root_id, create_at, update_at, edit_at, type, message, hashtags, is_pinned)
            SELECT printf('%026d',n), ?1, ?2, CASE WHEN n%8>0 THEN printf('%026d', n-n%8) END,
            10, 10, 0, '', 'sample', '', 0 FROM seq", params![CHANNEL, ALICE])?;
        tx.execute_batch("ANALYZE")?;
        let mut read = tx.prepare(&format!("EXPLAIN QUERY PLAN {READ}"))?;
        let lookup: String = read.query_row([ROOT], |r| r.get(3))?;
        assert!(lookup.contains("USING PRIMARY KEY"), "{lookup}");
        #[cfg(test)]
        println!("SQLite history post lookup: {lookup}");
        let mut remove = tx.prepare(&format!("EXPLAIN QUERY PLAN {REMOVE}"))?;
        let steps = remove.query_map([CHANNEL, ROOT], |r| r.get::<_, String>(3))?
            .collect::<Result<Vec<_>, _>>()?.join(" ");
        assert!(steps.contains("USING PRIMARY KEY") && steps.contains("history_post_replies") && !steps.contains("SCAN history_post"), "{steps}");
        Ok(())
    })
}

pub(crate) fn round_trip(root: &Path) -> Result<(), HistoryError> {
    let root = root.join("channel-post-records");
    let alice = account(URL, ALICE);
    let mut first = AccountHistory::open(&root, &alice)?;
    let changes = fixture();
    apply(&mut first, CHANNEL, &changes)?;
    drop(first);
    let mut first = AccountHistory::open(&root, &alice)?;
    for change in &changes {
        if let PostChange::Save(expected) = change {
            assert_eq!(
                first.read_post(&expected.id)?.as_ref(),
                Some(expected.as_ref())
            );
        }
    }
    apply(&mut first, CHANNEL, &[])?;
    for version in [109, 110] {
        apply(
            &mut first,
            CHANNEL,
            &[save(ROOT, CHANNEL, None, version, "older or equal")],
        )?;
    }
    assert_eq!(first.read_post(ROOT)?.unwrap().update_at, 110);
    assert!(first.read_post(ROOT)?.unwrap().message_source.is_some());
    apply(
        &mut first,
        CHANNEL,
        &[save(ROOT, CHANNEL, None, 111, "edited")],
    )?;
    let edited = first.read_post(ROOT)?.unwrap();
    assert_eq!(edited.message, "edited");
    assert_eq!(edited.message_source, None);
    assert_eq!(edited.from_webhook, Some(true));

    let mut second = AccountHistory::open(&root, &alice)?;
    let earlier = first.begin_channel_load(CHANNEL)?;
    let peer = first.begin_channel_load(PEER)?;
    apply(&mut second, CHANNEL, &[remove(UNSEEN)])?;
    assert_eq!(
        first.apply_channel_page(earlier, &[save(UNSEEN, CHANNEL, None, 50, "obsolete")])?,
        PageWrite::Superseded
    );
    assert_eq!(first.read_post(UNSEEN)?, None);
    assert_eq!(
        first.apply_channel_page(peer, &[save(OTHER, PEER, None, 50, "other channel")])?,
        PageWrite::Applied
    );

    let earlier = first.begin_channel_load(CHANNEL)?;
    apply(&mut second, CHANNEL, &[remove(REPLY)])?;
    assert_eq!(
        first.apply_channel_page(earlier, &changes)?,
        PageWrite::Superseded
    );
    assert_eq!(first.read_post(REPLY)?, None);
    assert_eq!(first.read_post(ROOT)?.unwrap().message, "edited");
    apply(
        &mut second,
        CHANNEL,
        &[
            remove(ROOT),
            save(REPLY, CHANNEL, Some(ROOT), 120, "same page"),
        ],
    )?;
    assert_eq!(first.read_post(ROOT)?, None);
    assert_eq!(first.read_post(REPLY)?, None);
    assert!(first.read_post(OTHER)?.is_some());

    let still_current = first.begin_channel_load(CHANNEL)?;
    let invalid = second.begin_channel_load(CHANNEL)?;
    assert_eq!(
        second.apply_channel_page(
            invalid,
            &[
                save(ROOT, CHANNEL, None, 123, "must roll back"),
                save(OTHER, CHANNEL, None, 124, "wrong channel for existing ID"),
            ]
        ),
        Err(HistoryError::InvalidPost)
    );
    assert_eq!(first.read_post(ROOT)?, None);
    second.write(|tx| {
        tx.execute_batch(
            "CREATE TEMP TRIGGER reject_fixture BEFORE INSERT ON history_post
         WHEN NEW.message = 'reject' BEGIN SELECT RAISE(ABORT, 'fixture'); END",
        )
    })?;
    let failing = second.begin_channel_load(CHANNEL)?;
    assert_eq!(
        second.apply_channel_page(
            failing,
            &[
                remove(UNSEEN),
                save(ROOT, CHANNEL, None, 125, "must roll back"),
                save(REPLY, CHANNEL, Some(ROOT), 126, "reject"),
            ]
        ),
        Err(HistoryError::Storage)
    );
    assert_eq!(first.read_post(ROOT)?, None);
    assert_eq!(
        first.apply_channel_page(still_current, &[])?,
        PageWrite::Applied
    );
    check_plans(&mut first)?;

    let old = first.begin_channel_load(CHANNEL)?;
    second.database.new_login(&alice)?;
    let mut current = AccountHistory::open(&root, &alice)?;
    assert_eq!(
        current.apply_channel_page(old, &[]),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(first.read_post(OTHER), Err(HistoryError::StaleOwner));
    HistoryDatabase::purge_account(&root, &alice)?;
    let mut next = AccountHistory::open(&root, &account(URL, BOB))?;
    assert_eq!(next.read_post(OTHER)?, None);
    next.read(|tx| {
        let rows: (i64, i64) = tx.query_row("SELECT (SELECT count(*) FROM history_post), (SELECT count(*) FROM history_channel_deletion)", [], |r| Ok((r.get(0)?, r.get(1)?)))?;
        assert_eq!(rows, (0, 0));
        Ok(())
    })
}

#[cfg(test)]
#[test]
fn keeps_offline_posts_and_rejects_late_pages() {
    round_trip(tempfile::tempdir().unwrap().path()).unwrap();
}

#[cfg(test)]
#[test]
fn upgrades_populated_history_and_refreshes_only_confirmed_origin() -> Result<(), HistoryError> {
    use super::windows::{apply as apply_window, page};
    use crate::history::{
        WindowSource,
        schema::{MIGRATIONS, Migration},
    };

    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let alice = account(URL, ALICE);
    let prior = &MIGRATIONS[..28];
    let mut old = HistoryDatabase::open_with(root, URL, prior)?;
    let owner = old.restore(&alice)?;
    old.write(&owner, |tx| {
        tx.execute(
            "INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
             VALUES (?1,?3,?4,150,150,0,'','legacy webhook','',0),
                    (?2,?3,?4,100,100,0,'','legacy regular','',0)",
            params![ROOT, OTHER, CHANNEL, ALICE],
        )?;
        tx.execute("INSERT INTO history_window(id,channel_id,collapsed,recent) VALUES(1,?1,0,1)", [CHANNEL])?;
        tx.execute("INSERT INTO history_window_post SELECT id,0,1,create_at,0 FROM history_post", [])?;
        tx.execute("INSERT INTO history_post_attachment(post_id,payload) VALUES(?1,'{\"fileIds\":[]}')", [OTHER])?;
        Ok(())
    })?;
    drop(old);

    let mut migrations: Vec<_> = prior
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    const INTERRUPTED: &[&str] = &[
        MIGRATIONS[28].statements[0],
        "CREATE INDEX interrupted ON missing(id)",
    ];
    migrations.push(Migration {
        statements: INTERRUPTED,
        objects: MIGRATIONS[28].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(root, URL, &migrations),
        Err(HistoryError::Storage)
    ));
    let mut reopened = HistoryDatabase::open_with(root, URL, prior)?;
    reopened.read(&owner, |tx| {
        let count: u32 = tx.query_row("SELECT count(*) FROM history_post", [], |row| row.get(0))?;
        assert_eq!(count, 2);
        Ok(())
    })?;
    drop(reopened);

    let mut view = AccountHistory::open(root, &alice)?;
    let latest = view.read_latest_window(CHANNEL, false, 8)?.unwrap();
    let [webhook, regular] = &latest.posts[..] else {
        panic!("migrated two posts")
    };
    assert_eq!(webhook.id, ROOT);
    assert_eq!(regular.id, OTHER);
    for post in [webhook, regular] {
        assert_eq!(post.from_webhook, None);
        assert!(
            serde_json::to_value(post)
                .unwrap()
                .get("fromWebhook")
                .is_none()
        );
    }
    assert_eq!(
        serde_json::to_value(regular.attachments.as_ref().unwrap()).unwrap(),
        serde_json::json!({"fileIds": []})
    );
    view.read(|tx| {
        assert!(!tx.prepare("PRAGMA foreign_key_check")?.exists([])?);
        Ok(())
    })?;

    let observed = |id: &str, version: i64, from_webhook| {
        let PostChange::Save(mut post) = save(id, CHANNEL, None, version, "fresh text") else {
            unreachable!();
        };
        post.create_at = if id == ROOT { 150 } else { 100 };
        post.from_webhook = from_webhook;
        PostChange::Save(post)
    };
    let mut refreshed = page(WindowSource::Latest, &[(ROOT, 150), (OTHER, 100)]);
    refreshed.changes = vec![
        observed(ROOT, 150, Some(true)),
        observed(OTHER, 100, Some(false)),
    ];
    assert_eq!(apply_window(&mut view, &refreshed)?, PageWrite::Applied);
    drop(view);
    let mut view = AccountHistory::open(root, &alice)?;
    let around = view
        .read_window_around(CHANNEL, false, ROOT, 0, 1)?
        .unwrap();
    let [webhook, regular] = &around.posts[..] else {
        panic!("refreshed two posts")
    };
    assert_eq!(webhook.message, "legacy webhook");
    assert_eq!(webhook.from_webhook, Some(true));
    assert_eq!(regular.from_webhook, Some(false));

    let mut peer = AccountHistory::open(root, &alice)?;
    let late = peer.begin_channel_load(CHANNEL)?;
    apply(&mut view, CHANNEL, &[observed(ROOT, 152, None)])?;
    assert_eq!(view.read_post(ROOT)?.unwrap().from_webhook, Some(true));
    assert_eq!(
        peer.apply_channel_page(late, &[observed(ROOT, 151, Some(false))])?,
        PageWrite::Applied
    );
    apply(&mut view, CHANNEL, &[observed(ROOT, 152, Some(false))])?;
    assert_eq!(peer.read_post(ROOT)?.unwrap().from_webhook, Some(true));
    apply(&mut view, CHANNEL, &[observed(ROOT, 153, Some(false))])?;
    assert_eq!(peer.read_post(ROOT)?.unwrap().from_webhook, Some(false));

    let late = peer.begin_channel_load(CHANNEL)?;
    apply(&mut view, CHANNEL, &[remove(ROOT)])?;
    assert_eq!(
        peer.apply_channel_page(late, &refreshed.changes)?,
        PageWrite::Superseded
    );
    assert_eq!(view.read_post(ROOT)?, None);
    HistoryDatabase::purge_account(root, &alice)?;
    let mut bob = AccountHistory::open(root, &account(URL, BOB))?;
    assert!(bob.read_latest_window(CHANNEL, false, 8)?.is_none());
    assert_eq!(bob.read_post(OTHER)?, None);
    println!(
        "SQLite rejected the interrupted v29 migration, then kept v28 history and attachment positions, refreshed both origins, and rejected a late observation after deletion."
    );
    Ok(())
}
