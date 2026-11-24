use rusqlite::{OptionalExtension, Transaction, params};
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap},
};

pub(super) fn member(tx: &Transaction<'_>, id: &str, mode: bool) -> rusqlite::Result<Option<i64>> {
    tx.prepare_cached(
        "SELECT window_id FROM history_window_post WHERE post_id=?1 AND collapsed=?2",
    )?
    .query_row(params![id, mode], |r| r.get(0))
    .optional()
}

fn next_tie(tx: &Transaction<'_>, created: i64) -> rusqlite::Result<i64> {
    tx.prepare_cached("SELECT coalesce(max(tie),0) + 1 FROM history_window_post WHERE created=?1")?
        .query_row([created], |r| r.get(0))
}

pub(in crate::history) fn move_post_time(
    tx: &Transaction<'_>,
    id: &str,
    created: i64,
) -> rusqlite::Result<()> {
    tx.prepare_cached(
        "UPDATE history_window_post SET created=?2, tie=?3+collapsed WHERE post_id=?1",
    )?
    .execute(params![id, created, next_tie(tx, created)?])?;
    Ok(())
}

pub(super) fn add(
    tx: &Transaction<'_>,
    window: i64,
    mode: bool,
    id: &str,
    created: i64,
) -> rusqlite::Result<()> {
    if member(tx, id, mode)?.is_none() {
        tx.prepare_cached("INSERT INTO history_window_post(post_id,collapsed,window_id,created,tie) VALUES(?1,?2,?3,?4,?5)")?
            .execute(params![id,mode,window,created,next_tie(tx,created)?])?;
    }
    Ok(())
}

/// Evidence is ordered by freshness: the page itself, the resolved cursors, then each
/// previous window's sequence. A newer explicit order wins when snapshots disagree.
#[derive(Default)]
pub(super) struct TieGroup<'a> {
    pub observed: Vec<&'a str>,
    pub resolved: Vec<(String, String)>,
    pub previous: Vec<Vec<String>>,
}

pub(super) fn capture_previous(
    tx: &Transaction<'_>,
    window: i64,
    stamp: i64,
) -> rusqlite::Result<Vec<String>> {
    tx.prepare_cached("SELECT post_id FROM history_window_post WHERE window_id=?1 AND created=?2 ORDER BY tie DESC")?
        .query_map(params![window,stamp],|r|r.get(0))?.collect()
}

struct Precedence {
    newer_to_older: Vec<Vec<usize>>,
    incoming: Vec<usize>,
}

impl Precedence {
    fn new(len: usize) -> Self {
        Self {
            newer_to_older: vec![Vec::new(); len],
            incoming: vec![0; len],
        }
    }

    fn add(&mut self, newer: usize, older: usize) {
        if newer == older || self.newer_to_older[newer].contains(&older) {
            return;
        }
        // A contradictory older observation cannot reverse an already observed path.
        if !self.newer_to_older[older].is_empty() && self.reaches(older, newer) {
            return;
        }
        self.newer_to_older[newer].push(older);
        self.incoming[older] += 1;
    }

    fn reaches(&self, from: usize, target: usize) -> bool {
        let mut stack = vec![from];
        let mut visited = vec![false; self.incoming.len()];
        while let Some(index) = stack.pop() {
            if index == target {
                return true;
            }
            if !visited[index] {
                visited[index] = true;
                stack.extend_from_slice(&self.newer_to_older[index]);
            }
        }
        false
    }

    fn ordered(mut self) -> Vec<usize> {
        // The previous order resolves ties for which the pages give no direction.
        let mut ready: BinaryHeap<_> = self
            .incoming
            .iter()
            .enumerate()
            .filter_map(|(index, &incoming)| (incoming == 0).then_some(Reverse(index)))
            .collect();
        let mut result = Vec::with_capacity(self.incoming.len());
        while let Some(Reverse(index)) = ready.pop() {
            result.push(index);
            for &next in &self.newer_to_older[index] {
                self.incoming[next] -= 1;
                if self.incoming[next] == 0 {
                    ready.push(Reverse(next));
                }
            }
        }
        result
    }
}

pub(super) fn apply_tie_order(
    tx: &Transaction<'_>,
    window: i64,
    stamp: i64,
    group: &TieGroup<'_>,
) -> rusqlite::Result<()> {
    let mut query = tx.prepare_cached("SELECT post_id,tie FROM history_window_post WHERE window_id=?1 AND created=?2 ORDER BY tie DESC")?;
    let existing = query
        .query_map(params![window, stamp], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let positions: HashMap<_, _> = existing
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (id.as_str(), i))
        .collect();
    let current: Vec<_> = group.observed.iter().map(|id| positions[id]).collect();
    if current.is_sorted()
        && group
            .resolved
            .iter()
            .all(|(a, b)| positions[a.as_str()] < positions[b.as_str()])
    {
        return Ok(());
    }
    let desired = if current.len() == existing.len() {
        current
    } else {
        let mut precedence = Precedence::new(existing.len());
        for pair in current.windows(2) {
            precedence.add(pair[0], pair[1]);
        }
        for (newer, older) in &group.resolved {
            precedence.add(positions[newer.as_str()], positions[older.as_str()]);
        }
        for previous in &group.previous {
            for pair in previous.windows(2) {
                precedence.add(positions[pair[0].as_str()], positions[pair[1].as_str()]);
            }
        }
        precedence.ordered()
    };
    let mut update = tx.prepare_cached(
        "UPDATE history_window_post SET tie=?1 WHERE window_id=?2 AND post_id=?3",
    )?;
    for (slot, &index) in desired.iter().enumerate() {
        if slot != index {
            update.execute(params![existing[slot].1, window, existing[index].0])?;
        }
    }
    Ok(())
}
