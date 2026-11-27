use super::{AccountHistory, HistoryError, HistoryOwner, posts};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, Transaction, params};

/// Bound to one login, team, channel and attempt. Reusable after a failed SQLite commit.
pub struct ChannelMembershipUpdate {
    owner: HistoryOwner,
    team: String,
    channel: String,
    attempt: [u8; 16],
}

const BEGIN: &str = "INSERT INTO channel_membership_change(channel_id,team_id,pending)
    SELECT ?2,?1,randomblob(16) WHERE
        EXISTS(SELECT 1 FROM sidebar_channel WHERE team_id=?1 AND channel_id=?2 AND kind IN ('O','P'))
        OR EXISTS(SELECT 1 FROM channel_membership_change WHERE team_id=?1 AND channel_id=?2)
    ON CONFLICT(channel_id) DO UPDATE SET pending=excluded.pending
    WHERE team_id=excluded.team_id RETURNING pending";

const TAKE_UPDATE: &str = "UPDATE channel_membership_change SET pending=NULL
    WHERE channel_id=?1 AND team_id=?2 AND pending=?3 RETURNING departed";
const SET_DEPARTED: &str = "UPDATE channel_membership_change
    SET departed=?2, empty_revision=lower(hex(randomblob(16))) WHERE channel_id=?1";
const INVALIDATE_SIDEBAR: &str = "UPDATE sidebar_team SET pending=NULL,
    selected_channel=CASE WHEN ?2 AND selected_channel=?3 THEN NULL ELSE selected_channel END
    WHERE team_id=?1";

pub(super) const REMOVE_POSTS: &str = "DELETE FROM history_post WHERE channel_id=?1";
pub(super) const REMOVE_WINDOWS: &str = "DELETE FROM history_window WHERE channel_id=?1";

pub(super) fn is_departed(tx: &Transaction<'_>, channel: &str) -> rusqlite::Result<bool> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM channel_membership_change WHERE channel_id=?1 AND departed=1)",
        [channel],
        |row| row.get(0),
    )
}

impl AccountHistory {
    /// Reserve a local update before changing or verifying membership in a known O/P channel.
    pub fn begin_channel_membership_update(
        &mut self,
        team: &str,
        channel: &str,
    ) -> Result<Option<ChannelMembershipUpdate>, HistoryError> {
        if !is_mattermost_id(team) || !is_mattermost_id(channel) {
            return Err(HistoryError::InvalidDirectory);
        }
        let attempt = self.write(|tx| {
            tx.query_row(BEGIN, [team, channel], |r| r.get(0))
                .optional()
        })?;
        Ok(attempt.map(|attempt| ChannelMembershipUpdate {
            owner: self.owner.clone(),
            team: team.to_owned(),
            channel: channel.to_owned(),
            attempt,
        }))
    }

    /// Apply confirmed membership once. A newer attempt or login supersedes this observation.
    pub fn finish_channel_membership_update(
        &mut self,
        update: &ChannelMembershipUpdate,
        member: bool,
    ) -> Result<bool, HistoryError> {
        if self.owner != update.owner {
            return Err(HistoryError::StaleOwner);
        }
        let channel = &update.channel;
        let team = &update.team;
        self.write(|tx| {
            let prior = tx
                .query_row(TAKE_UPDATE, params![channel, team, update.attempt], |row| {
                    row.get::<_, bool>(0)
                })
                .optional()?;
            let Some(was_departed) = prior else {
                return Ok(false);
            };
            let departed = !member;
            if was_departed == departed {
                return Ok(true);
            }
            tx.execute(SET_DEPARTED, params![channel, departed])?;
            posts::advance_deletion_revision(tx, channel)?;
            tx.execute(INVALIDATE_SIDEBAR, params![team, departed, channel])?;
            if departed {
                tx.execute(
                    "DELETE FROM sidebar_channel WHERE team_id=?1 AND channel_id=?2",
                    [team, channel],
                )?;
                tx.execute(REMOVE_WINDOWS, [channel])?;
                tx.execute(REMOVE_POSTS, [channel])?;
                tx.execute("DELETE FROM composer_draft WHERE channel_id=?1", [channel])?;
                tx.execute("DELETE FROM pending_post WHERE channel_id=?1", [channel])?;
            }
            Ok(true)
        })
    }
}
