use super::{ALICE, account};
use crate::history::{
    HistoryDatabase, HistoryError,
    departure::{REMOVE_POSTS, REMOVE_WINDOWS},
    schema::{MIGRATIONS, Migration},
};
use rusqlite::Transaction;
use std::path::Path;

const URL: &str = "https://local.example.test/departure-schema";
const POLICY: &str = r#"{"collapsedThreads":"default_on","separateUnreads":false,"nameFormat":"username","lockNameFormat":false,"dmRecipientScope":"team"}"#;
const CHANNEL: &str = "00000000000000000000000000";

fn check_plans(tx: &Transaction<'_>, indexed: bool) -> rusqlite::Result<()> {
    for (sql, scan, index) in [
        (REMOVE_POSTS, "SCAN history_post", "history_post_by_channel"),
        (
            REMOVE_WINDOWS,
            "SCAN history_window",
            "history_window_by_channel",
        ),
    ] {
        let mut explain = tx.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
        let steps = explain
            .query_map([CHANNEL], |row| row.get::<_, String>(3))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if indexed {
            assert!(
                steps.iter().any(|step| step.contains(index))
                    && steps.iter().all(|step| !step.starts_with("SCAN ")),
                "{steps:?}"
            );
        } else {
            assert!(steps.iter().any(|step| step == scan), "{steps:?}");
        }
        #[cfg(test)]
        {
            let version: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
            println!("SQLite v{version}: {sql}: {steps:?}");
        }
    }
    Ok(())
}

pub(super) fn check(root: &Path) -> Result<(), HistoryError> {
    let identity = account(URL, ALICE);
    let prior = &MIGRATIONS[..27];
    let mut old = HistoryDatabase::open_with(root, URL, prior)?;
    let owner = old.restore(&identity)?;
    old.write(&owner, |tx| {
        tx.execute("INSERT INTO workspace_settings(owner,server) VALUES(1,?1)", [POLICY])?;
        tx.execute_batch("
        WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10000)
        INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
        SELECT printf('%026d',n),printf('%026d',n%100),'aaaaaaaaaaaaaaaaaaaaaaaaaa',n,n,0,'','original','',0 FROM seq;
        WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1000)
        INSERT INTO history_window(id,channel_id,collapsed) SELECT n,printf('%026d',n%100),0 FROM seq;
        INSERT INTO history_window_post SELECT id,0,((create_at-1)%1000)+1,create_at,0 FROM history_post;
        INSERT INTO history_post_attachment(post_id,payload) SELECT id,json_object('fileIds',json_array()) FROM history_post WHERE create_at%100=0;
    ")})?;

    let mut interrupted: Vec<_> = prior
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    const INTERRUPTED: &[&str] = &[
        MIGRATIONS[27].statements[0],
        MIGRATIONS[27].statements[1],
        "CREATE INDEX interrupted ON missing(channel_id)",
    ];
    interrupted.push(Migration {
        statements: INTERRUPTED,
        objects: MIGRATIONS[27].objects,
    });
    assert!(matches!(
        HistoryDatabase::open_with(root, URL, &interrupted),
        Err(HistoryError::Storage)
    ));
    let mut reopened = HistoryDatabase::open_with(root, URL, prior)?;
    assert!(reopened.restore(&identity)? == owner);
    let preserved = |tx: &Transaction<'_>| {
        let policy: String = tx.query_row(
            "SELECT server FROM workspace_settings WHERE owner=1",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(policy, POLICY);
        let counts: (u32, u32, u32, u32) = tx.query_row(
            "SELECT (SELECT count(*) FROM history_post),
            (SELECT count(*) FROM history_window),(SELECT count(*) FROM history_window_post),
            (SELECT count(*) FROM history_post_attachment WHERE payload=json_object('fileIds',json_array()))",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        assert_eq!(counts, (10000, 1000, 10000, 100));
        Ok(())
    };
    reopened.read(&owner, preserved)?;
    reopened.read(&owner, |tx| check_plans(tx, false))?;
    let mut current = HistoryDatabase::open_with(root, URL, &MIGRATIONS[..28])?;
    assert!(current.restore(&identity)? == owner);
    current.read(&owner, preserved)?;
    assert!(matches!(
        old.read(&owner, |_| Ok(())),
        Err(HistoryError::UnsupportedSchema)
    ));
    assert!(matches!(
        HistoryDatabase::open_with(root, URL, prior),
        Err(HistoryError::UnsupportedSchema)
    ));

    current.write(&owner, |tx| tx.execute_batch("ANALYZE"))?;
    current.read(&owner, |tx| {
        #[cfg(test)]
        {
            let library: String = tx.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
            println!("SQLite {library}: rollback to v27 and upgrade to v28 retained policy, 10000 posts, 1000 windows, 10000 positions and 100 attachments; v27 refused v28");
        }
        check_plans(tx, true)
    })
}
