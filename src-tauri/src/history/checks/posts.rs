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
    PostChange::Save(StoredPost {
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
        thread_summary: None,
        attachments: None,
    })
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
            assert_eq!(first.read_post(&expected.id)?.as_ref(), Some(expected));
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
