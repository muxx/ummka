use super::{AccountHistory, HistoryError};
use crate::rest::is_mattermost_id;
use rusqlite::params;

const RECENT_LIMIT: i64 = 15;
const LIST: &str =
    "SELECT term FROM team_search WHERE team_id = ?1 ORDER BY position DESC LIMIT ?2";
const REMOVE: &str = "DELETE FROM team_search WHERE team_id = ?1 AND term = ?2";
const TRIM: &str = "DELETE FROM team_search WHERE team_id = ?1 AND position <= (
    SELECT position FROM team_search WHERE team_id = ?1 ORDER BY position DESC LIMIT 1 OFFSET ?2)";

fn check_team(team_id: &str) -> Result<(), HistoryError> {
    if is_mattermost_id(team_id) {
        Ok(())
    } else {
        Err(HistoryError::InvalidDirectory)
    }
}

impl AccountHistory {
    /// Most recent submitted terms for this team, including their original modifiers.
    pub fn recent_team_searches(&mut self, team_id: &str) -> Result<Vec<String>, HistoryError> {
        check_team(team_id)?;
        self.read(|tx| {
            tx.prepare_cached(LIST)?
                .query_map(params![team_id, RECENT_LIMIT], |row| row.get(0))?
                .collect()
        })
    }

    /// Returns false if a directory refresh already removed the team.
    pub fn remember_team_search(
        &mut self,
        team_id: &str,
        term: &str,
    ) -> Result<bool, HistoryError> {
        check_team(team_id)?;
        if term.trim().is_empty() {
            return Err(HistoryError::InvalidDirectory);
        }
        self.write(|tx| {
            // Replacing an exact match assigns a new rowid, ordering both windows by their commits.
            let added = tx
                .prepare_cached(
                    "INSERT OR REPLACE INTO team_search(team_id, term)
                SELECT team_id, ?2 FROM joined_team WHERE team_id = ?1",
                )?
                .execute(params![team_id, term])?;
            if added != 0 {
                tx.prepare_cached(TRIM)?
                    .execute(params![team_id, RECENT_LIMIT])?;
            }
            Ok(added != 0)
        })
    }

    pub fn forget_team_search(&mut self, team_id: &str, term: &str) -> Result<(), HistoryError> {
        check_team(team_id)?;
        if term.trim().is_empty() {
            return Err(HistoryError::InvalidDirectory);
        }
        self.write(|tx| {
            tx.prepare_cached(REMOVE)?.execute(params![team_id, term])?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests;
