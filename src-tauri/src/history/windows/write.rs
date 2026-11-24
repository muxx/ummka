use super::{ChannelHistoryPage, WindowSource, order, read::RECENT_ID};
use crate::history::{HistoryError, PageWrite};
use rusqlite::{OptionalExtension, Transaction, params};
use std::collections::{BTreeMap, BTreeSet, HashSet};

#[derive(Default)]
struct Bounds {
    newest: Option<String>,
    oldest: Option<String>,
    newer: Option<String>,
    older: Option<String>,
    inaccessible: i64,
    recent: bool,
    mode: bool,
}

const BOUNDS: &str = "SELECT
    (SELECT post_id FROM history_window_post WHERE window_id=w.id ORDER BY created DESC,tie DESC LIMIT 1),
    (SELECT post_id FROM history_window_post WHERE window_id=w.id ORDER BY created,tie LIMIT 1),
    newer,older,inaccessible,recent,collapsed FROM history_window w WHERE id=?1";

fn bounds(tx: &Transaction<'_>, window: i64) -> rusqlite::Result<Bounds> {
    tx.prepare_cached(BOUNDS)?.query_row([window], |r| {
        Ok(Bounds {
            newest: r.get(0)?,
            oldest: r.get(1)?,
            newer: r.get(2)?,
            older: r.get(3)?,
            inaccessible: r.get(4)?,
            recent: r.get(5)?,
            mode: r.get(6)?,
        })
    })
}

fn visible_member(
    tx: &Transaction<'_>,
    page: &ChannelHistoryPage,
    id: &str,
) -> rusqlite::Result<Option<i64>> {
    tx.prepare_cached("SELECT m.window_id FROM history_window_post m JOIN history_window w ON w.id=m.window_id WHERE m.post_id=?1 AND m.collapsed=?2 AND w.channel_id=?3")?
        .query_row(params![id,page.collapsed_threads,page.channel_id],|r|r.get(0)).optional()
}

fn recent_id(tx: &Transaction<'_>, page: &ChannelHistoryPage) -> rusqlite::Result<Option<i64>> {
    tx.prepare_cached(RECENT_ID)?
        .query_row(params![page.channel_id, page.collapsed_threads], |r| {
            r.get(0)
        })
        .optional()
}

fn create(tx: &Transaction<'_>, page: &ChannelHistoryPage) -> rusqlite::Result<i64> {
    tx.prepare_cached(
        "INSERT INTO history_window(channel_id,collapsed) VALUES(?1,?2) RETURNING id",
    )?
    .query_row(params![page.channel_id, page.collapsed_threads], |r| {
        r.get(0)
    })
}

/// Keep an unresolved cursor with its direction and originating visible post.
fn track_hint(
    tx: &Transaction<'_>,
    window: i64,
    mode: bool,
    anchor: &str,
    older: bool,
    hint: Option<&str>,
) -> rusqlite::Result<()> {
    let Some(id) = hint else { return Ok(()) };
    if id.is_empty() || order::member(tx, id, mode)? == Some(window) {
        tx.prepare_cached(
            "DELETE FROM history_window_neighbor WHERE window_id=?1 AND anchor_id=?2 AND older=?3",
        )?
        .execute(params![window, anchor, older])?;
    } else {
        tx.prepare_cached("INSERT INTO history_window_neighbor(window_id,anchor_id,older,post_id) VALUES(?1,?2,?3,?4)
            ON CONFLICT(window_id,anchor_id,older) DO UPDATE SET post_id=excluded.post_id")?
            .execute(params![window,anchor,older,id])?;
    }
    Ok(())
}

fn empty_page(tx: &Transaction<'_>, page: &ChannelHistoryPage) -> Result<PageWrite, HistoryError> {
    let cutoff = page.first_inaccessible_post_time;
    match &page.source {
        WindowSource::Focused { .. } if cutoff.unwrap_or(0) > 0 => {
            return Ok(PageWrite::Inaccessible {
                first_inaccessible_post_time: cutoff.unwrap_or(0),
            });
        }
        WindowSource::Latest => {
            // WebApp leaves a populated recent block alone on an empty refresh.
            let window = match recent_id(tx, page)? {
                Some(id) if bounds(tx, id)?.newest.is_some() => return Ok(PageWrite::Applied),
                Some(id) => id,
                None => create(tx, page)?,
            };
            tx.prepare_cached(
                "UPDATE history_window SET recent=1,newer=?2,older=?3,inaccessible=?4 WHERE id=?1",
            )?
            .execute(params![
                window,
                page.next_post_id,
                page.prev_post_id,
                cutoff.unwrap_or(0)
            ])?;
        }
        WindowSource::Before { post_id } | WindowSource::After { post_id } => {
            if let Some(window) = visible_member(tx, page, post_id)? {
                let old = bounds(tx, window)?;
                if matches!(page.source, WindowSource::Before { .. })
                    && old.oldest.as_ref() == Some(post_id)
                {
                    track_hint(
                        tx,
                        window,
                        page.collapsed_threads,
                        post_id,
                        true,
                        page.prev_post_id.as_deref(),
                    )?;
                    tx.prepare_cached("UPDATE history_window SET older=coalesce(?2,older),inaccessible=coalesce(?3,inaccessible) WHERE id=?1")?
                        .execute(params![window,page.prev_post_id,cutoff])?;
                }
                if matches!(page.source, WindowSource::After { .. })
                    && old.newest.as_ref() == Some(post_id)
                {
                    track_hint(
                        tx,
                        window,
                        page.collapsed_threads,
                        post_id,
                        false,
                        page.next_post_id.as_deref(),
                    )?;
                    tx.prepare_cached(
                        "UPDATE history_window SET newer=coalesce(?2,newer) WHERE id=?1",
                    )?
                    .execute(params![window, page.next_post_id])?;
                }
            }
        }
        _ => {}
    }
    Ok(PageWrite::Applied)
}

struct Overlap<'a> {
    windows: BTreeSet<i64>,
    ties: BTreeMap<i64, order::TieGroup<'a>>,
}

fn candidates<'a>(
    tx: &Transaction<'_>,
    page: &ChannelHistoryPage,
    visible: &[(&'a str, i64)],
    newer: Option<&'a str>,
    older: Option<&'a str>,
) -> rusqlite::Result<Overlap<'a>> {
    let mut windows = BTreeSet::new();
    let mut ties: BTreeMap<i64, order::TieGroup<'a>> = BTreeMap::new();
    let mut waiting=tx.prepare_cached("SELECT n.window_id,n.anchor_id,n.older,m.created
        FROM history_window_neighbor n JOIN history_window_post m ON m.post_id=n.anchor_id AND m.window_id=n.window_id
        JOIN history_window w ON w.id=n.window_id WHERE n.post_id=?1 AND w.channel_id=?2 AND w.collapsed=?3")?;
    for &(id, stamp) in visible {
        if let Some(window) = visible_member(tx, page, id)? {
            windows.insert(window);
        }
        let group = ties.entry(stamp).or_default();
        group.observed.push(id);
        let rows =
            waiting.query_map(params![id, page.channel_id, page.collapsed_threads], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, bool>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
        for row in rows {
            let (window, anchor, target_is_older, anchor_stamp) = row?;
            windows.insert(window);
            if anchor_stamp == stamp {
                let edge = if target_is_older {
                    (anchor, id.to_owned())
                } else {
                    (id.to_owned(), anchor)
                };
                group.resolved.push(edge);
            }
        }
    }
    // A shared missing ID establishes no connection until it actually appears in order.
    for (hint, is_older) in [(newer, false), (older, true)] {
        if let Some(id) = hint.filter(|id| !id.is_empty())
            && let Some(window) = visible_member(tx, page, id)?
        {
            windows.insert(window);
            let stamp: i64 = tx
                .prepare_cached(
                    "SELECT created FROM history_window_post WHERE post_id=?1 AND collapsed=?2",
                )?
                .query_row(params![id, page.collapsed_threads], |r| r.get(0))?;
            let group = ties.entry(stamp).or_default();
            if is_older {
                group.observed.push(id);
            } else {
                group.observed.insert(0, id);
            }
        }
    }
    ties.retain(|_, group| group.observed.len() > 1 || !group.resolved.is_empty());
    for (&stamp, group) in &mut ties {
        for &window in &windows {
            group
                .previous
                .push(order::capture_previous(tx, window, stamp)?);
        }
    }
    Ok(Overlap { windows, ties })
}

fn unite(
    tx: &Transaction<'_>,
    page: &ChannelHistoryPage,
    matches: &BTreeSet<i64>,
) -> rusqlite::Result<i64> {
    let Some(&first) = matches.first() else {
        return create(tx, page);
    };
    if matches.len() == 1 {
        return Ok(first);
    }
    let mut winner = first;
    let mut largest = 0;
    let mut size =
        tx.prepare_cached("SELECT count(*) FROM history_window_post WHERE window_id=?1")?;
    for &id in matches {
        let count: i64 = size.query_row([id], |r| r.get(0))?;
        if count > largest {
            largest = count;
            winner = id;
        }
    }
    // Extending one window never relabels its history; when two meet only move the smaller side.
    for &other in matches.iter().filter(|&&id| id != winner) {
        tx.prepare_cached("UPDATE history_window_post SET window_id=?1 WHERE window_id=?2")?
            .execute(params![winner, other])?;
        tx.prepare_cached("UPDATE history_window_neighbor SET window_id=?1 WHERE window_id=?2")?
            .execute(params![winner, other])?;
        tx.prepare_cached("DELETE FROM history_window WHERE id=?1")?
            .execute([other])?;
    }
    Ok(winner)
}

fn outside(
    tx: &Transaction<'_>,
    window: i64,
    mode: bool,
    hint: Option<String>,
) -> rusqlite::Result<Option<String>> {
    if let Some(id) = hint.as_deref().filter(|id| !id.is_empty())
        && order::member(tx, id, mode)? == Some(window)
    {
        return Ok(None);
    }
    Ok(hint)
}

/// A newly observed pair replaces both earlier hints pointing out from that pair.
fn clear_replaced_neighbors(
    tx: &Transaction<'_>,
    window: i64,
    visible: &[(&str, i64)],
    newer: Option<&str>,
    older: Option<&str>,
) -> rusqlite::Result<()> {
    let sequence = newer
        .filter(|id| !id.is_empty())
        .into_iter()
        .chain(visible.iter().map(|&(id, _)| id))
        .chain(older.filter(|id| !id.is_empty()));
    let mut clear = tx.prepare_cached(
        "DELETE FROM history_window_neighbor WHERE window_id=?1 AND anchor_id=?2 AND older=?3",
    )?;
    let mut previous = None;
    for id in sequence {
        if let Some(previous) = previous {
            clear.execute(params![window, previous, true])?;
            clear.execute(params![window, id, false])?;
        }
        previous = Some(id);
    }
    Ok(())
}

pub(in crate::history) fn record(
    tx: &Transaction<'_>,
    page: &ChannelHistoryPage,
    removed: &HashSet<String>,
) -> Result<PageWrite, HistoryError> {
    if matches!(page.source, WindowSource::Since { .. }) {
        return Ok(PageWrite::Applied);
    }
    let mut stamp = tx.prepare_cached("SELECT create_at FROM history_post WHERE id=?1")?;
    let mut visible = Vec::with_capacity(page.order.len());
    for id in &page.order {
        if !removed.contains(id) {
            let created: i64 = stamp.query_row([id], |r| r.get(0))?;
            visible.push((id.as_str(), created));
        }
    }
    if visible.is_empty() {
        return if page.order.is_empty() {
            empty_page(tx, page)
        } else {
            Ok(PageWrite::Applied)
        };
    }
    if visible.windows(2).any(|pair| pair[0].1 < pair[1].1) {
        return Err(HistoryError::InvalidPost);
    }
    let newer = match &page.source {
        WindowSource::Before { post_id } => Some(post_id.as_str()),
        _ => page.next_post_id.as_deref(),
    }
    .filter(|id| !removed.contains(*id));
    let older = match &page.source {
        WindowSource::After { post_id } => Some(post_id.as_str()),
        _ => page.prev_post_id.as_deref(),
    }
    .filter(|id| !removed.contains(*id));
    let adjacent: Vec<_> = [newer, older]
        .into_iter()
        .flatten()
        .filter(|id| !id.is_empty())
        .collect();
    if adjacent
        .iter()
        .any(|id| visible.iter().any(|(post, _)| post == id))
        || (!adjacent.is_empty() && adjacent.len() == 2 && adjacent[0] == adjacent[1])
    {
        return Err(HistoryError::InvalidPost);
    }
    let mut overlaps = candidates(tx, page, &visible, newer, older)?;
    let latest = matches!(page.source, WindowSource::Latest)
        || (matches!(
            page.source,
            WindowSource::After { .. } | WindowSource::Focused { .. }
        ) && page.next_post_id.as_deref() == Some(""));
    if latest
        && let Some(id) = recent_id(tx, page)?
        && bounds(tx, id)?.newest.is_none()
    {
        overlaps.windows.insert(id);
    }
    let previous = overlaps
        .windows
        .iter()
        .map(|&id| bounds(tx, id))
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let window = unite(tx, page, &overlaps.windows)?;
    let mut resolve =
        tx.prepare_cached("DELETE FROM history_window_neighbor WHERE window_id=?1 AND post_id=?2")?;
    for &(id, stamp) in &visible {
        order::add(tx, window, page.collapsed_threads, id, stamp)?;
        resolve.execute(params![window, id])?;
    }
    for (&stamp, group) in &overlaps.ties {
        order::apply_tie_order(tx, window, stamp, group)?;
    }
    let first = visible[0].0;
    let last = visible[visible.len() - 1].0;
    clear_replaced_neighbors(tx, window, &visible, newer, older)?;
    track_hint(tx, window, page.collapsed_threads, first, false, newer)?;
    track_hint(tx, window, page.collapsed_threads, last, true, older)?;
    let full = bounds(tx, window)?;
    let old_top = previous.iter().find(|b| b.newest == full.newest);
    let old_bottom = previous.iter().find(|b| b.oldest == full.oldest);
    let at_top = full.newest.as_deref() == visible.first().map(|item| item.0);
    let at_bottom = full.oldest.as_deref() == visible.last().map(|item| item.0);
    let next = if at_top { newer } else { None }
        .map(str::to_owned)
        .or_else(|| old_top.and_then(|b| b.newer.clone()));
    let prev = if at_bottom { older } else { None }
        .map(str::to_owned)
        .or_else(|| old_bottom.and_then(|b| b.older.clone()));
    let cutoff = if at_bottom {
        page.first_inaccessible_post_time
    } else {
        None
    }
    .unwrap_or_else(|| old_bottom.map_or(0, |b| b.inaccessible));
    if latest {
        tx.prepare_cached("UPDATE history_window SET recent=0 WHERE channel_id=?1 AND collapsed=?2 AND recent=1 AND id<>?3")?
            .execute(params![page.channel_id,page.collapsed_threads,window])?;
    }
    let recent = latest || previous.iter().any(|b| b.recent);
    tx.prepare_cached(
        "UPDATE history_window SET recent=?2,newer=?3,older=?4,inaccessible=?5 WHERE id=?1",
    )?
    .execute(params![
        window,
        recent,
        outside(tx, window, page.collapsed_threads, next)?,
        outside(tx, window, page.collapsed_threads, prev)?,
        cutoff
    ])?;
    Ok(PageWrite::Applied)
}

pub(in crate::history) fn forget_posts(
    tx: &Transaction<'_>,
    channel: &str,
    removed: &HashSet<String>,
) -> rusqlite::Result<()> {
    let mut touched = BTreeSet::new();
    let mut memberships =
        tx.prepare_cached("SELECT window_id FROM history_window_post WHERE post_id=?1")?;
    for id in removed {
        for window in memberships.query_map([id], |r| r.get::<_, i64>(0))? {
            let window = window?;
            touched.insert(window);
            tx.prepare_cached(
                "DELETE FROM history_window_neighbor WHERE window_id=?1 AND anchor_id=?2",
            )?
            .execute(params![window, id])?;
        }
        tx.prepare_cached("UPDATE history_window SET newer=NULL WHERE channel_id=?1 AND newer=?2")?
            .execute(params![channel, id])?;
        tx.prepare_cached("UPDATE history_window SET older=NULL WHERE channel_id=?1 AND older=?2")?
            .execute(params![channel, id])?;
        tx.prepare_cached("DELETE FROM history_window_neighbor WHERE post_id=?1 AND EXISTS
            (SELECT 1 FROM history_window w WHERE w.id=history_window_neighbor.window_id AND w.channel_id=?2)")?
            .execute(params![id,channel])?;
        tx.prepare_cached("DELETE FROM history_window_post WHERE post_id=?1")?
            .execute([id])?;
    }
    for window in touched {
        let remaining = bounds(tx, window)?;
        if let (Some(first), Some(last)) = (remaining.newest, remaining.oldest) {
            track_hint(
                tx,
                window,
                remaining.mode,
                &first,
                false,
                remaining.newer.as_deref(),
            )?;
            track_hint(
                tx,
                window,
                remaining.mode,
                &last,
                true,
                remaining.older.as_deref(),
            )?;
        } else if !remaining.recent {
            tx.prepare_cached("DELETE FROM history_window WHERE id=?1")?
                .execute([window])?;
        }
    }
    Ok(())
}
