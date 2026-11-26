use super::{
    ALICE, BOB, account,
    posts::CHANNEL,
    windows::{apply, page},
};
use crate::history::{
    AccountHistory, ChannelHistoryPage, HistoryDatabase, HistoryError, PageWrite, PostChange,
    StoredPost, WindowSource,
    attachments::LAST_OBSERVATION,
    posts::READ,
    schema::{MIGRATIONS, Migration},
};
use serde_json::{Value, json};
use std::path::Path;

const URL: &str = "https://offline.example.test/attachments";
const ROOT: &str = "rrrrrrrrrrrrrrrrrrrrrrrrrr";
const REPLY: &str = "pppppppppppppppppppppppppp";
const FILE: &str = "ffffffffffffffffffffffffff";
const SECOND: &str = "ssssssssssssssssssssssssss";

fn sample(version: i64, observed: Value) -> ChannelHistoryPage {
    let mut result = page(WindowSource::Latest, &[(ROOT, 1)]);
    let PostChange::Save(row) = &mut result.changes[0] else {
        unreachable!()
    };
    row.update_at = version;
    row.attachments = serde_json::from_value(observed).unwrap();
    result
}
fn data(row: &StoredPost) -> Value {
    serde_json::to_value(&row.attachments).unwrap()
}
fn read(view: &mut AccountHistory) -> Result<Value, HistoryError> {
    Ok(data(&view.read_post(ROOT)?.unwrap()))
}
fn allowed() -> Value {
    json!({"fileIds":[SECOND,FILE],"files":[{"id":FILE,"name":"same.txt","size":0,"archived":false},{"id":SECOND,"name":"same.txt"}]})
}

fn migration(root: &Path) -> Result<(), HistoryError> {
    let prior = &MIGRATIONS[..25];
    let identity = account(URL, ALICE);
    let mut old = HistoryDatabase::open_with(root, URL, prior)?;
    let owner = old.restore(&identity)?;
    old.write(&owner,|tx|tx.execute(
        "INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned) VALUES(?1,?2,?3,1,1,0,'','old', '',0)",
        [ROOT,CHANNEL,ALICE]))?;
    let mut interrupted: Vec<_> = prior
        .iter()
        .map(|m| Migration {
            statements: m.statements,
            objects: m.objects,
        })
        .collect();
    interrupted.push(Migration {
        statements: &[
            include_str!("../migrations/0026_post_attachment.sql"),
            "INSERT INTO missing_table VALUES(1)",
        ],
        objects: MIGRATIONS[25].objects,
    });
    assert_eq!(
        HistoryDatabase::open_with(root, URL, &interrupted).err(),
        Some(HistoryError::Storage)
    );
    let mut reopened = HistoryDatabase::open_with(root, URL, prior)?;
    assert_eq!(
        reopened.read(&owner, |tx| tx.query_row(
            "SELECT message FROM history_post WHERE id=?1",
            [ROOT],
            |r| r.get::<_, String>(0)
        ))?,
        "old"
    );
    let mut upgraded = AccountHistory::open(root, &identity)?;
    let post = upgraded.read_post(ROOT)?.unwrap();
    assert_eq!(post.message, "old");
    assert_eq!(post.attachments, None);
    assert_eq!(
        old.read(&owner, |_| Ok(())),
        Err(HistoryError::UnsupportedSchema)
    );
    Ok(())
}

fn race(root: &Path) -> Result<(), HistoryError> {
    let identity = account(URL, ALICE);
    let mut first = AccountHistory::open(root, &identity)?;
    let mut second = AccountHistory::open(root, &identity)?;
    let visible = allowed();
    let restricted = json!({"fileIds":[],"redactedFileCount":2});
    let empty = json!({"fileIds":[]});
    for (early, late, want) in [
        (&visible, &restricted, &restricted),
        (&restricted, &visible, &restricted),
        (&visible, &empty, &Value::Null),
        (&empty, &visible, &Value::Null),
    ] {
        let ticket = first.begin_channel_load(CHANNEL)?;
        apply(&mut second, &sample(2, early.clone()))?;
        first.apply_channel_window(ticket, &sample(2, late.clone()))?;
        assert_eq!(read(&mut second)?, *want);
        apply(&mut first, &sample(2, visible.clone()))?;
        assert_eq!(read(&mut second)?, visible);
    }
    for clear in [&restricted, &empty, &Value::Null] {
        apply(&mut first, &sample(2, clear.clone()))?;
        let delayed = second.begin_channel_load(CHANNEL)?;
        apply(&mut first, &sample(2, clear.clone()))?;
        drop(first);
        first = AccountHistory::open(root, &identity)?;
        second.apply_channel_window(delayed, &sample(2, visible.clone()))?;
        assert_eq!(
            read(&mut first)?,
            if clear == &restricted {
                restricted.clone()
            } else {
                Value::Null
            }
        );
        apply(&mut first, &sample(2, visible.clone()))?;
        assert_eq!(read(&mut second)?, visible);
    }
    let delayed = second.begin_channel_load(CHANNEL)?;
    apply(&mut first, &sample(2, restricted.clone()))?;
    second.apply_channel_window(delayed, &sample(3, visible.clone()))?;
    assert_eq!(first.read_post(ROOT)?.unwrap().update_at, 3);
    assert_eq!(read(&mut first)?, restricted);
    apply(&mut second, &sample(2, visible.clone()))?;
    assert_eq!(read(&mut first)?, restricted);
    apply(&mut second, &sample(3, visible))?;
    assert_eq!(read(&mut first)?, allowed());
    Ok(())
}

fn windows_and_cleanup(root: &Path) -> Result<(), HistoryError> {
    let identity = account(URL, ALICE);
    let mut view = AccountHistory::open(root, &identity)?;
    let mut batch = page(WindowSource::Latest, &[(REPLY, 3), (ROOT, 1)]);
    let PostChange::Save(reply) = &mut batch.changes[0] else {
        unreachable!()
    };
    reply.root_id = Some(ROOT.into());
    reply.attachments = serde_json::from_value(json!({"redactedFileCount":2})).unwrap();
    let PostChange::Save(root_post) = &mut batch.changes[1] else {
        unreachable!()
    };
    root_post.attachments = serde_json::from_value(allowed()).unwrap();
    apply(&mut view, &batch)?;
    drop(view);
    let mut view = AccountHistory::open(root, &identity)?;
    for slice in [
        view.read_latest_window(CHANNEL, false, 60)?,
        view.read_window_around(CHANNEL, false, REPLY, 30, 30)?,
    ] {
        let slice = slice.unwrap();
        assert_eq!(slice.posts.len(), 2);
        assert_eq!(
            data(slice.posts.iter().find(|p| p.id == ROOT).unwrap()),
            allowed()
        );
        assert_eq!(
            data(slice.posts.iter().find(|p| p.id == REPLY).unwrap()),
            json!({"redactedFileCount":2})
        );
    }
    let mut invalid = sample(4, json!({"redactedFileCount":1,"files":[{"id":FILE}]}));
    let mut first = page(WindowSource::Latest, &[(SECOND, 4)]);
    invalid.changes.insert(0, first.changes.remove(0));
    assert_eq!(apply(&mut view, &invalid), Err(HistoryError::InvalidPost));
    assert!(view.read_post(SECOND)?.is_none());
    assert_eq!(read(&mut view)?, allowed());
    let delayed = view.begin_channel_load(CHANNEL)?;
    let deletion = PostChange::Remove {
        id: ROOT.into(),
        channel_id: CHANNEL.into(),
    };
    let ticket = view.begin_channel_load(CHANNEL)?;
    view.apply_channel_page(ticket, &[deletion])?;
    assert_eq!(
        view.apply_channel_window(delayed, &batch)?,
        PageWrite::Superseded
    );
    assert!(view.read_post(ROOT)?.is_none() && view.read_post(REPLY)?.is_none());
    assert_eq!(count(&mut view)?, 0);
    apply(&mut view, &batch)?;
    let old = view.begin_channel_load(CHANNEL)?;
    HistoryDatabase::purge_account(root, &identity)?;
    assert_eq!(
        view.apply_channel_window(old, &batch),
        Err(HistoryError::StaleOwner)
    );
    assert_eq!(
        count(&mut AccountHistory::open(root, &account(URL, BOB))?)?,
        0
    );
    Ok(())
}
fn count(view: &mut AccountHistory) -> Result<i64, HistoryError> {
    view.read(|tx| {
        tx.query_row("SELECT COUNT(*) FROM history_post_attachment", [], |r| {
            r.get(0)
        })
    })
}
fn plans_and_validation(root: &Path) -> Result<(), HistoryError> {
    let mut view = AccountHistory::open(root, &account(URL, ALICE))?;
    apply(&mut view, &sample(1, allowed()))?;
    for invalid in [
        json!({}),
        json!({"fileIds":[FILE,FILE]}),
        json!({"files":[{"id":FILE},{"id":FILE}]}),
        json!({"files":[{"id":"bad"}]}),
        json!({"files":[{"id":FILE,"size":9007199254740992_u64}]}),
        json!({"fileIds":[FILE],"redactedFileCount":1}),
    ] {
        assert_eq!(
            apply(&mut view, &sample(1, invalid)),
            Err(HistoryError::InvalidPost)
        );
    }
    view.write(|tx| {
        tx.execute_batch("WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM rows WHERE n<2000)
          INSERT INTO history_post(id,channel_id,user_id,create_at,update_at,edit_at,type,message,hashtags,is_pinned)
          SELECT printf('%026d',n),'cccccccccccccccccccccccccc','aaaaaaaaaaaaaaaaaaaaaaaaaa',1,1,0,'','','',0 FROM rows;
          INSERT INTO history_thread_summary(post_id,root_version,reply_count,last_reply_at) SELECT id,1,0,0 FROM history_post WHERE id GLOB '0*';
          INSERT INTO history_post_attachment(post_id,payload) SELECT id,NULL FROM history_post WHERE id GLOB '0*'; ANALYZE;")?;
        let mut query=tx.prepare(&format!("EXPLAIN QUERY PLAN {READ}"))?;
        let steps=query.query_map([ROOT],|r|r.get::<_,String>(3))?.collect::<rusqlite::Result<Vec<_>>>()?.join(" ");
        assert!(steps.contains("sqlite_autoindex_history_post_attachment")&&!steps.contains("SCAN"),"{steps}");
        let clock:String=tx.query_row(&format!("EXPLAIN QUERY PLAN {LAST_OBSERVATION}"),[],|r|r.get(3))?;
        assert!(clock.contains("SEARCH history_post_attachment"),"{clock}");
        tx.execute("UPDATE history_post_attachment SET payload=?1 WHERE post_id=?2",["{\"fileIds\":[\"bad\"]}",ROOT])?;
        Ok(())
    })?;
    assert_eq!(view.read_post(ROOT), Err(HistoryError::Storage));
    Ok(())
}
pub(super) fn run(root: &Path) -> Result<(), HistoryError> {
    migration(&root.join("migration"))?;
    race(&root.join("race"))?;
    windows_and_cleanup(&root.join("windows"))?;
    plans_and_validation(&root.join("plans"))
}
