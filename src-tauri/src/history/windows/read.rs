use super::{WindowEdge, WindowSlice};
use crate::history::{AccountHistory, HistoryError, StoredPost, posts::READ};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, Params, Transaction, params};

pub(in crate::history) const LATEST: &str = "SELECT post_id FROM history_window_post WHERE window_id=?1 ORDER BY created DESC,tie DESC LIMIT ?2";
pub(in crate::history) const OLDER: &str = "SELECT post_id FROM history_window_post WHERE window_id=?1 AND (created,tie)<(?2,?3) ORDER BY created DESC,tie DESC LIMIT ?4";
pub(in crate::history) const NEWER: &str = "SELECT post_id FROM history_window_post WHERE window_id=?1 AND (created,tie)>(?2,?3) ORDER BY created,tie LIMIT ?4";
pub(in crate::history) const RECENT_ID: &str =
    "SELECT id FROM history_window WHERE channel_id=?1 AND collapsed=?2 AND recent=1";

fn ids(tx: &Transaction<'_>, sql: &str, args: impl Params) -> rusqlite::Result<Vec<String>> {
    tx.prepare_cached(sql)?
        .query_map(args, |r| r.get(0))?
        .collect()
}

fn continuation(rows: &mut Vec<String>, limit: u16) -> Option<String> {
    if rows.len() > usize::from(limit) {
        rows.pop()
    } else {
        None
    }
}

fn slice(
    tx: &Transaction<'_>,
    window: i64,
    order: Vec<String>,
    newer: Option<String>,
    older: Option<String>,
) -> rusqlite::Result<WindowSlice> {
    let (newer_hint, older_hint, inaccessible): (Option<String>, Option<String>, i64) = tx
        .prepare_cached("SELECT newer,older,inaccessible FROM history_window WHERE id=?1")?
        .query_row([window], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    let mut read = tx.prepare_cached(READ)?;
    let posts = order
        .into_iter()
        .map(|id| read.query_row([id], StoredPost::from_row))
        .collect::<rusqlite::Result<_>>()?;
    Ok(WindowSlice {
        posts,
        newer: WindowEdge::from(newer.or(newer_hint)),
        older: WindowEdge::from(older.or(older_hint)),
        first_inaccessible_post_time: inaccessible,
    })
}

impl AccountHistory {
    pub fn read_latest_window(
        &mut self,
        channel: &str,
        collapsed: bool,
        limit: u16,
    ) -> Result<Option<WindowSlice>, HistoryError> {
        if !is_mattermost_id(channel) || limit == 0 {
            return Err(HistoryError::InvalidPost);
        }
        self.read(|tx| {
            let window: Option<i64> = tx
                .prepare_cached(RECENT_ID)?
                .query_row(params![channel, collapsed], |r| r.get(0))
                .optional()?;
            let Some(window) = window else {
                return Ok(None);
            };
            let mut order = ids(tx, LATEST, params![window, u32::from(limit) + 1])?;
            let older = continuation(&mut order, limit);
            slice(tx, window, order, None, older).map(Some)
        })
    }

    pub fn read_window_around(
        &mut self,
        channel: &str,
        collapsed: bool,
        post_id: &str,
        newer: u16,
        older: u16,
    ) -> Result<Option<WindowSlice>, HistoryError> {
        if !is_mattermost_id(channel) || !is_mattermost_id(post_id) {
            return Err(HistoryError::InvalidPost);
        }
        self.read(|tx| {
            let anchor: Option<(i64,i64,i64)> = tx.prepare_cached(
                "SELECT m.window_id,m.created,m.tie FROM history_window_post m JOIN history_window w ON w.id=m.window_id WHERE m.post_id=?1 AND m.collapsed=?2 AND w.channel_id=?3")?
                .query_row(params![post_id,collapsed,channel], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
            let Some((window,stamp,tie))=anchor else {return Ok(None)};
            let mut top=ids(tx,NEWER,params![window,stamp,tie,u32::from(newer)+1])?;
            let mut bottom=ids(tx,OLDER,params![window,stamp,tie,u32::from(older)+1])?;
            let newer_edge=continuation(&mut top,newer);
            let older_edge=continuation(&mut bottom,older);
            top.reverse();
            top.push(post_id.to_owned());
            top.extend(bottom);
            slice(tx,window,top,newer_edge,older_edge).map(Some)
        })
    }
}
