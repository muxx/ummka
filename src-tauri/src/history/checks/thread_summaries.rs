use super::{
    ALICE, BOB, account,
    posts::CHANNEL,
    windows::{apply, page},
};
use crate::history::{
    AccountHistory, HistoryDatabase, HistoryError, PageWrite, PostChange, WindowSource,
    posts::READ,
    schema::MIGRATIONS,
    thread_summary::{LAST_OBSERVATION, ThreadSummary},
};
use rusqlite::params;
use std::path::Path;

const URL: &str = "https://history.example.test/summary";
const ROOT: &str = "rrrrrrrrrrrrrrrrrrrrrrrrrr";
const OTHER: &str = "oooooooooooooooooooooooooo";

fn root_page(version: i64, reply_count: i64) -> crate::history::ChannelHistoryPage {
    let mut result = page(WindowSource::Latest, &[(ROOT, 1)]);
    result.collapsed_threads = true;
    let PostChange::Save(post) = &mut result.changes[0] else {
        unreachable!()
    };
    post.update_at = version;
    post.thread_summary = Some(Box::new(ThreadSummary {
        reply_count,
        last_reply_at: if reply_count > 0 { 10 } else { 0 },
        participant_ids: if reply_count > 0 {
            Some(vec![ALICE.to_string()])
        } else {
            None
        },
    }));
    result
}

fn interrupted_upgrade(root: &Path) -> Result<(), HistoryError> {
    use crate::history::schema::Migration;
    let mut broken: Vec<_> = MIGRATIONS[..23]
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    broken.push(Migration {
        statements: &[
            include_str!("../migrations/0024_thread_summary.sql"),
            "INSERT INTO missing_table VALUES(1)",
        ],
        objects: MIGRATIONS[23].objects,
    });
    assert_eq!(
        HistoryDatabase::open_with(root, URL, &broken).err(),
        Some(HistoryError::Storage)
    );
    // Schema inspection on reopen also detects an unexpected table left by failed DDL.
    let mut prior = HistoryDatabase::open_with(root, URL, &MIGRATIONS[..23])?;
    let owner = prior.restore(&account(URL, ALICE))?;
    assert_eq!(
        prior.read(&owner, |tx| tx.query_row(
            "SELECT message FROM history_post WHERE id=?1",
            [ROOT],
            |row| row.get::<_, String>(0)
        ))?,
        "prior"
    );
    Ok(())
}

pub(super) fn run(root: &Path) -> Result<(), HistoryError> {
    let owner = account(URL, ALICE);
    let mut old = HistoryDatabase::open_with(root, URL, &MIGRATIONS[..23])?;
    let handle = old.restore(&owner)?;
    old.write(&handle, |tx| tx.execute("INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned) VALUES(?1,?2,?3,1,1,0,'','prior','',0)",params![ROOT,CHANNEL,ALICE]))?;
    interrupted_upgrade(root)?;
    let mut first = AccountHistory::open(root, &owner)?;
    assert_eq!(
        old.read(&handle, |_| Ok(())),
        Err(HistoryError::UnsupportedSchema)
    );
    let before = first.read_post(ROOT)?.unwrap();
    assert_eq!(before.message, "prior");
    assert!(before.thread_summary.is_none());
    let mut second = AccountHistory::open(root, &owner)?;
    let delayed = first.begin_channel_load(CHANNEL)?;
    apply(&mut second, &root_page(2, 2))?;
    assert_eq!(
        first.apply_channel_window(delayed, &root_page(2, 1))?,
        PageWrite::Applied
    );
    apply(&mut first, &page(WindowSource::Latest, &[(ROOT, 3)]))?;
    assert_eq!(
        first
            .read_post(ROOT)?
            .unwrap()
            .thread_summary
            .unwrap()
            .reply_count,
        2
    );
    apply(&mut first, &root_page(3, 0))?;
    apply(&mut second, &root_page(2, 2))?;
    drop(first);
    let mut first = AccountHistory::open(root, &owner)?;
    let window = first.read_latest_window(CHANNEL, true, 5)?.unwrap();
    assert_eq!(
        window.posts[0].thread_summary.as_ref().unwrap().reply_count,
        0
    );
    let observed =
        first.read(|tx| tx.query_row(LAST_OBSERVATION, [], |row| row.get::<_, i64>(0)))?;
    apply(&mut first, &root_page(3, 0))?;
    assert_eq!(
        observed,
        first.read(|tx| tx.query_row(LAST_OBSERVATION, [], |row| row.get::<_, i64>(0)))?
    );
    let mut invalid = root_page(4, -1);
    invalid.changes.insert(
        0,
        page(WindowSource::Latest, &[(OTHER, 1)]).changes.remove(0),
    );
    assert_eq!(apply(&mut first, &invalid), Err(HistoryError::InvalidPost));
    assert!(first.read_post(OTHER)?.is_none());
    let mut flat = root_page(4, 1);
    flat.collapsed_threads = false;
    assert_eq!(apply(&mut first, &flat), Err(HistoryError::InvalidPost));
    let mut replies = root_page(4, 1);
    let PostChange::Save(post) = &mut replies.changes[0] else {
        unreachable!()
    };
    post.root_id = Some(OTHER.into());
    assert_eq!(apply(&mut first, &replies), Err(HistoryError::InvalidPost));

    verify_query_plans(&mut first)?;
    let load = first.begin_channel_load(CHANNEL)?;
    first.apply_channel_page(
        load,
        &[PostChange::Remove {
            id: ROOT.into(),
            channel_id: CHANNEL.into(),
        }],
    )?;
    assert!(!first.read(|tx| tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM history_thread_summary WHERE post_id=?1)",
        [ROOT],
        |r| r.get::<_, bool>(0)
    ))?);
    let stale = first.begin_channel_load(CHANNEL)?;
    HistoryDatabase::purge_account(root, &owner)?;
    assert_eq!(
        second.apply_channel_window(stale, &root_page(4, 1)),
        Err(HistoryError::StaleOwner)
    );
    let mut other = AccountHistory::open(root, &account(URL, BOB))?;
    assert_eq!(
        other.read(|tx| tx
            .query_row("SELECT COUNT(*) FROM history_thread_summary", [], |r| r
                .get::<_, i64>(0)))?,
        0
    );
    Ok(())
}

fn verify_query_plans(first: &mut AccountHistory) -> Result<(), HistoryError> {
    first.write(|tx|{
        tx.execute_batch("WITH RECURSIVE roots(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM roots WHERE n<2000)
         INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
         SELECT printf('%026d',n),'cccccccccccccccccccccccccc','aaaaaaaaaaaaaaaaaaaaaaaaaa',1,1,0,'','','',0 FROM roots;
         INSERT INTO history_thread_summary(post_id,root_version,reply_count,last_reply_at)
         SELECT id,1,0,0 FROM history_post WHERE id GLOB '0*';
         INSERT INTO history_post_attachment(post_id,payload)
         SELECT id,NULL FROM history_post WHERE id GLOB '0*'; ANALYZE;")?;
        let mut query=tx.prepare(&format!("EXPLAIN QUERY PLAN {READ}"))?;
        let steps=query.query_map([ROOT],|row|row.get::<_,String>(3))?.collect::<rusqlite::Result<Vec<_>>>()?.join(" ");
        assert!(steps.contains("USING PRIMARY KEY") && steps.contains("sqlite_autoindex_history_thread_summary") && !steps.contains("SCAN"),"{steps}");
        let peak:String=tx.query_row(&format!("EXPLAIN QUERY PLAN {LAST_OBSERVATION}"),[],|r|r.get(3))?;
        assert!(peak.contains("SEARCH history_thread_summary"),"{peak}");
        Ok(())
    })
}
