use super::{
    ALICE, account,
    posts::{CHANNEL, ROOT},
};
use crate::history::{
    AccountHistory, ChannelHistoryPage, HistoryDatabase, HistoryError, PageWrite, PostChange,
    StoredPost, WindowEdge, WindowSlice, WindowSource,
    schema::MIGRATIONS,
    windows::read::{LATEST, NEWER, OLDER},
};
use rusqlite::params;
use std::path::Path;

const URL: &str = "https://history.example.test/windows";
const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const C: &str = "cccccccccccccccccccccccccc";
const D: &str = "dddddddddddddddddddddddddd";
const E: &str = "eeeeeeeeeeeeeeeeeeeeeeeeee";
const F: &str = "ffffffffffffffffffffffffff";

fn save(id: &str, stamp: i64) -> PostChange {
    PostChange::Save(StoredPost {
        id: id.into(),
        channel_id: CHANNEL.into(),
        user_id: ALICE.into(),
        root_id: None,
        create_at: stamp,
        update_at: stamp,
        edit_at: 0,
        post_type: String::new(),
        message: id.into(),
        message_source: None,
        hashtags: String::new(),
        is_pinned: false,
        thread_summary: None,
        attachments: None,
    })
}

pub(super) fn page(source: WindowSource, posts: &[(&str, i64)]) -> ChannelHistoryPage {
    ChannelHistoryPage {
        channel_id: CHANNEL.into(),
        collapsed_threads: false,
        source,
        order: posts.iter().map(|(id, _)| (*id).into()).collect(),
        changes: posts.iter().map(|&(id, time)| save(id, time)).collect(),
        prev_post_id: None,
        next_post_id: None,
        first_inaccessible_post_time: None,
    }
}
fn focus(id: &str) -> WindowSource {
    WindowSource::Focused { post_id: id.into() }
}
pub(super) fn apply(
    view: &mut AccountHistory,
    page: &ChannelHistoryPage,
) -> Result<PageWrite, HistoryError> {
    let load = view.begin_channel_load(&page.channel_id)?;
    view.apply_channel_window(load, page)
}
fn ids(slice: &WindowSlice) -> Vec<&str> {
    slice.posts.iter().map(|p| p.id.as_str()).collect()
}

fn ties_and_visibility(root: &Path) -> Result<(), HistoryError> {
    let identity = account(URL, ALICE);
    let mut view = AccountHistory::open(root, &identity)?;
    assert!(view.read_latest_window(CHANNEL, false, 8)?.is_none());
    apply(&mut view, &page(WindowSource::Latest, &[(A, 100)]))?;
    apply(&mut view, &page(focus(C), &[(C, 100)]))?;
    drop(view);
    let mut view = AccountHistory::open(root, &identity)?;
    for id in [A, C] {
        assert_eq!(
            ids(&view.read_window_around(CHANNEL, false, id, 4, 4)?.unwrap()),
            [id]
        );
    }
    let mut bridge = page(WindowSource::Latest, &[(A, 100), (B, 100), (C, 100)]);
    bridge.next_post_id = Some(String::new());
    bridge.prev_post_id = Some(D.into());
    bridge.first_inaccessible_post_time = Some(80);
    for _ in 0..2 {
        assert_eq!(apply(&mut view, &bridge)?, PageWrite::Applied);
    }
    let latest = view.read_latest_window(CHANNEL, false, 2)?.unwrap();
    assert_eq!(ids(&latest), [A, B]);
    assert_eq!(latest.older, WindowEdge::More(C.into()));
    assert_eq!(latest.newer, WindowEdge::End);
    let center = view.read_window_around(CHANNEL, false, B, 0, 0)?.unwrap();
    assert_eq!(ids(&center), [B]);
    assert_eq!(center.newer, WindowEdge::More(A.into()));
    assert_eq!(center.older, WindowEdge::More(C.into()));
    let entire = view.read_window_around(CHANNEL, false, B, 3, 3)?.unwrap();
    assert_eq!(ids(&entire), [A, B, C]);
    assert_eq!(entire.older, WindowEdge::More(D.into()));
    assert_eq!(entire.first_inaccessible_post_time, 80);
    apply(&mut view, &page(focus(B), &[(C, 100), (B, 100), (A, 100)]))?;
    assert_eq!(
        ids(&view.read_latest_window(CHANNEL, false, 8)?.unwrap()),
        [C, B, A]
    );

    // Exercise exactly the same normalized payload as the TypeScript generated-client fixture.
    let mut wire: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../contracts/mattermost/fixtures/channel-window-page.json"
    ))
    .unwrap();
    wire["changes"] = serde_json::from_str(include_str!(
        "../../../../contracts/mattermost/fixtures/channel-post-changes.json"
    ))
    .unwrap();
    let receipt = serde_json::from_value(wire).unwrap();
    apply(&mut view, &receipt)?;
    let reply = "pppppppppppppppppppppppppp";
    assert!(view.read_post(reply)?.is_some());
    assert!(
        view.read_window_around(CHANNEL, true, reply, 5, 5)?
            .is_none()
    );
    assert!(view.read_latest_window(CHANNEL, true, 8)?.is_none());
    let upper = view.read_window_around(CHANNEL, true, ROOT, 3, 3)?.unwrap();
    assert_eq!(ids(&upper), [ROOT]);
    assert_eq!(upper.newer, WindowEdge::More(E.into()));
    assert_eq!(upper.older, WindowEdge::End);
    assert!(
        view.read_window_around(CHANNEL, false, ROOT, 3, 3)?
            .is_none()
    );
    Ok(())
}

fn explicit_neighbors(root: &Path) -> Result<(), HistoryError> {
    for reverse in [false, true] {
        let mut view = AccountHistory::open(&root.join(reverse.to_string()), &account(URL, ALICE))?;
        let mut first = page(WindowSource::Latest, &[(A, 300)]);
        first.prev_post_id = Some(B.into());
        let mut second = page(focus(C), &[(C, 100)]);
        second.next_post_id = Some(B.into());
        for p in [&first, &second] {
            apply(&mut view, p)?;
        }
        for id in [A, C] {
            assert_eq!(
                ids(&view.read_window_around(CHANNEL, false, id, 8, 8)?.unwrap()),
                [id]
            );
        }
        let middle = page(focus(B), &[(B, 200)]);
        apply(&mut view, &middle)?;
        assert_eq!(
            ids(&view.read_latest_window(CHANNEL, false, 8)?.unwrap()),
            [A, B, C]
        );
        let tail = page(WindowSource::Before { post_id: D.into() }, &[(E, 20)]);
        let anchor = page(focus(D), &[(D, 40)]);
        for p in if reverse {
            [&tail, &anchor]
        } else {
            [&anchor, &tail]
        } {
            apply(&mut view, p)?;
        }
        assert_eq!(
            ids(&view.read_window_around(CHANNEL, false, D, 8, 8)?.unwrap()),
            [D, E]
        );
        let mut empty = page(WindowSource::Before { post_id: E.into() }, &[]);
        empty.prev_post_id = Some(String::new());
        empty.next_post_id = Some(E.into());
        empty.first_inaccessible_post_time = Some(10);
        apply(&mut view, &empty)?;
        let slice = view.read_window_around(CHANNEL, false, E, 8, 8)?.unwrap();
        assert_eq!(slice.older, WindowEdge::End);
        assert_eq!(slice.first_inaccessible_post_time, 10);
        // An empty result next to an interior post cannot mark an entire window complete.
        empty.source = WindowSource::Before { post_id: B.into() };
        empty.next_post_id = Some(B.into());
        apply(&mut view, &empty)?;
        assert_eq!(
            view.read_latest_window(CHANNEL, false, 8)?.unwrap().older,
            WindowEdge::Unknown
        );
        let mut archived = page(focus(F), &[]);
        archived.first_inaccessible_post_time = Some(88);
        assert_eq!(
            apply(&mut view, &archived)?,
            PageWrite::Inaccessible {
                first_inaccessible_post_time: 88
            }
        );
        assert!(view.read_window_around(CHANNEL, false, F, 8, 8)?.is_none());
        let mut empty_channel = page(WindowSource::Latest, &[]);
        empty_channel.channel_id = F.into();
        empty_channel.prev_post_id = Some(String::new());
        empty_channel.next_post_id = Some(String::new());
        apply(&mut view, &empty_channel)?;
        let empty = view.read_latest_window(F, false, 9)?.unwrap();
        assert!(empty.posts.is_empty());
        assert_eq!(empty.older, WindowEdge::End);
    }
    for source in [focus(A), WindowSource::After { post_id: B.into() }] {
        let dir = if matches!(source, WindowSource::Focused { .. }) {
            "focused-head"
        } else {
            "after-head"
        };
        let mut view = AccountHistory::open(&root.join(dir), &account(URL, ALICE))?;
        let mut head = page(source, &[(A, 300)]);
        head.next_post_id = Some(String::new());
        apply(&mut view, &head)?;
        let latest = view.read_latest_window(CHANNEL, false, 2)?.unwrap();
        assert_eq!(ids(&latest), [A]);
        assert_eq!(latest.newer, WindowEdge::End);
    }

    let mut view = AccountHistory::open(&root.join("revised-edge"), &account(URL, ALICE))?;
    let mut latest = page(WindowSource::Latest, &[(A, 300)]);
    latest.prev_post_id = Some(D.into());
    apply(&mut view, &latest)?;
    let mut end = page(WindowSource::Before { post_id: A.into() }, &[]);
    end.prev_post_id = Some(String::new());
    end.next_post_id = Some(A.into());
    apply(&mut view, &end)?;
    apply(&mut view, &page(focus(D), &[(D, 200)]))?;
    assert_eq!(
        ids(&view.read_latest_window(CHANNEL, false, 8)?.unwrap()),
        [A]
    );
    Ok(())
}

fn replaced_neighbors(root: &Path) -> Result<(), HistoryError> {
    for older in [false, true] {
        for with_anchor in [false, true] {
            let path = root.join(format!("{older}-{with_anchor}"));
            let identity = account(URL, ALICE);
            let mut view = AccountHistory::open(&path, &identity)?;
            let mut first = page(focus(A), &[(A, 200)]);
            let mut replacement = if older {
                first.prev_post_id = Some(D.into());
                if with_anchor {
                    page(WindowSource::Before { post_id: A.into() }, &[(B, 150)])
                } else {
                    page(focus(A), &[(A, 200), (B, 150)])
                }
            } else {
                first.next_post_id = Some(D.into());
                if with_anchor {
                    page(WindowSource::After { post_id: A.into() }, &[(B, 250)])
                } else {
                    page(focus(A), &[(B, 250), (A, 200)])
                }
            };
            if older {
                replacement.prev_post_id = Some(String::new());
            } else {
                replacement.next_post_id = Some(String::new());
            }
            apply(&mut view, &first)?;
            apply(&mut view, &replacement)?;
            drop(view);
            let mut view = AccountHistory::open(&path, &identity)?;
            apply(
                &mut view,
                &page(focus(D), &[(D, if older { 100 } else { 300 })]),
            )?;
            let slice = view.read_window_around(CHANNEL, false, A, 8, 8)?.unwrap();
            assert_eq!(ids(&slice), if older { [A, B] } else { [B, A] });
            assert_eq!(
                if older { slice.older } else { slice.newer },
                WindowEdge::End
            );
            assert_eq!(
                ids(&view.read_window_around(CHANNEL, false, D, 8, 8)?.unwrap()),
                [D]
            );
        }
    }
    Ok(())
}

fn delayed_tie_edges(root: &Path) -> Result<(), HistoryError> {
    for (n, sequence) in [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ]
    .iter()
    .enumerate()
    {
        let path = root.join(n.to_string());
        let identity = account(URL, ALICE);
        let mut left = page(WindowSource::Latest, &[(D, 100), (A, 100)]);
        left.prev_post_id = Some(B.into());
        let mut right = page(focus(C), &[(C, 100), (E, 100)]);
        right.next_post_id = Some(B.into());
        let middle = page(focus(B), &[(B, 100)]);
        let pages = [left, right, middle];
        for &i in sequence {
            let mut view = AccountHistory::open(&path, &identity)?;
            apply(&mut view, &pages[i])?;
        }
        let mut reopened = AccountHistory::open(&path, &identity)?;
        assert_eq!(
            ids(&reopened.read_latest_window(CHANNEL, false, 9)?.unwrap()),
            [D, A, B, C, E],
            "arrival order {sequence:?}"
        );
    }
    Ok(())
}

fn sparse_and_removal(root: &Path) -> Result<(), HistoryError> {
    let identity = account(URL, ALICE);
    let mut a = AccountHistory::open(root, &identity)?;
    let mut b = AccountHistory::open(root, &identity)?;
    let mut initial = page(WindowSource::Latest, &[(A, 300), (B, 200), (C, 100)]);
    if let PostChange::Save(reply) = &mut initial.changes[0] {
        reply.root_id = Some(B.into());
    }
    initial.prev_post_id = Some(D.into());
    apply(&mut a, &initial)?;
    let mut collapsed = page(WindowSource::Latest, &[(B, 200), (C, 100)]);
    collapsed.collapsed_threads = true;
    apply(&mut a, &collapsed)?;
    let late = a.begin_channel_load(CHANNEL)?;
    let mut sparse = page(WindowSource::Since { since: 1 }, &[(F, 50)]);
    for id in [B, D] {
        sparse.order.push(id.into());
        sparse.changes.push(PostChange::Remove {
            id: id.into(),
            channel_id: CHANNEL.into(),
        });
    }
    apply(&mut b, &sparse)?;
    assert_eq!(
        a.apply_channel_window(late, &initial)?,
        PageWrite::Superseded
    );
    assert!(a.read_post(F)?.is_some());
    assert!(a.read_window_around(CHANNEL, false, F, 1, 1)?.is_none());
    for mode in [false, true] {
        let slice = a.read_latest_window(CHANNEL, mode, 8)?.unwrap();
        assert_eq!(ids(&slice), [C]);
        assert_eq!(slice.older, WindowEdge::Unknown);
    }
    assert!(a.read_post(A)?.is_none());
    assert!(a.read_post(B)?.is_none());
    let mut invalid = page(WindowSource::Latest, &[(E, 10)]);
    invalid.order.push(D.into());
    assert_eq!(apply(&mut a, &invalid), Err(HistoryError::InvalidPost));
    assert!(a.read_post(E)?.is_none());
    assert_eq!(ids(&a.read_latest_window(CHANNEL, false, 9)?.unwrap()), [C]);
    b.database.purge(&b.owner)?;
    assert_eq!(
        a.read_latest_window(CHANNEL, false, 8),
        Err(HistoryError::StaleOwner)
    );
    let mut fresh = AccountHistory::open(root, &identity)?;
    assert!(fresh.read_latest_window(CHANNEL, false, 8)?.is_none());
    fresh.read(|tx| {
        for sql in [
            "SELECT count(*) FROM history_window_post",
            "SELECT count(*) FROM history_window_neighbor",
            "SELECT count(*) FROM history_window",
        ] {
            assert_eq!(tx.query_row(sql, [], |r| r.get::<_, i64>(0))?, 0);
        }
        Ok(())
    })?;
    Ok(())
}

fn upgrade_and_plans(root: &Path) -> Result<(), HistoryError> {
    let identity = account(URL, ALICE);
    let mut v2 = HistoryDatabase::open_with(root, URL, &MIGRATIONS[..2])?;
    let owner = v2.restore(&identity)?;
    v2.write(&owner,|tx|tx.execute(
        "INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
        VALUES(?1,?2,?3,1,1,0,'','v2 message','',0)",params![A,CHANNEL,ALICE]))?;
    let mut v3 = AccountHistory::open(root, &identity)?;
    assert_eq!(
        v2.read(&owner, |_| Ok(())),
        Err(HistoryError::UnsupportedSchema)
    );
    assert_eq!(v3.read_post(A)?.unwrap().message, "v2 message");
    assert!(v3.read_window_around(CHANNEL, false, A, 5, 5)?.is_none());
    v3.write(|tx|{
        let window:i64=tx.query_row("INSERT INTO history_window(channel_id,collapsed,recent) VALUES(?1,0,1) RETURNING id",[CHANNEL],|r|r.get(0))?;
        tx.execute("WITH RECURSIVE s(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM s WHERE n<4096)
            INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
            SELECT printf('%026d',n),?1,?2,n,n,0,'','indexed','',0 FROM s", params![CHANNEL,ALICE])?;
        tx.execute("INSERT INTO history_window_post SELECT id,0,?1,create_at,1 FROM history_post WHERE id<>?2",params![window,A])?;
        tx.execute_batch("ANALYZE")?;
        for (sql,args) in [(LATEST,vec![window,61]),(OLDER,vec![window,2048,1,31]),(NEWER,vec![window,2048,1,31])] {
            let mut query=tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
            let plan=query.query_map(rusqlite::params_from_iter(args),|r|r.get::<_,String>(3))?.collect::<rusqlite::Result<Vec<_>>>()?.join(" ");
            assert!(plan.contains("history_window_order") && !plan.contains("TEMP B-TREE") && !plan.contains("SCAN history_window_post"),"{plan}");
        }
        Ok(())
    })?;
    let slice = v3
        .read_window_around(CHANNEL, false, &format!("{:026}", 2048), 30, 30)?
        .unwrap();
    assert_eq!(slice.posts.len(), 61);
    assert_eq!(slice.posts[30].create_at, 2048);
    Ok(())
}

pub(crate) fn round_trip(root: &Path) -> Result<(), HistoryError> {
    let root = root.join("stored-channel-windows");
    ties_and_visibility(&root.join("ties"))?;
    explicit_neighbors(&root.join("neighbors"))?;
    replaced_neighbors(&root.join("replacement"))?;
    delayed_tie_edges(&root.join("delayed"))?;
    sparse_and_removal(&root.join("removal"))?;
    super::thread_summaries::run(&root.join("summaries"))?;
    super::attachments::run(&root.join("attachments"))?;
    upgrade_and_plans(&root.join("upgrade"))
}

#[test]
fn retains_only_observed_channel_connections_across_restarts() {
    round_trip(tempfile::tempdir().unwrap().path()).unwrap();
}
