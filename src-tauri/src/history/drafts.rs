use super::{AccountHistory, HistoryError};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, Row, Transaction, params};
use serde::Serialize;

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerDraft {
    pub message: String,
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleared_by_submission: Option<bool>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "draft", rename_all = "camelCase")]
pub enum DraftSave {
    Saved(ComposerDraft),
    Conflict(ComposerDraft),
}

const READ: &str = "SELECT message, revision, cleared_by_submission FROM composer_draft WHERE channel_id=?1 AND root_id=?2";
const SAVE: &str =
    "INSERT INTO composer_draft(channel_id, root_id, message, revision, cleared_by_submission)
    VALUES (?1, ?2, ?3, lower(hex(randomblob(16))), ?4)
    ON CONFLICT(channel_id, root_id) DO UPDATE SET message=excluded.message,
        revision=excluded.revision, cleared_by_submission=excluded.cleared_by_submission
    RETURNING message, revision, cleared_by_submission";

fn read_row(row: &Row<'_>) -> rusqlite::Result<ComposerDraft> {
    Ok(ComposerDraft {
        message: row.get(0)?,
        revision: Some(row.get(1)?),
        cleared_by_submission: row.get(2)?,
    })
}

pub(super) fn draft(
    tx: &Transaction<'_>,
    channel: &str,
    root: &str,
) -> rusqlite::Result<ComposerDraft> {
    Ok(tx
        .query_row(READ, [channel, root], read_row)
        .optional()?
        .unwrap_or_default())
}

pub(super) fn root_key<'a>(channel: &str, root: Option<&'a str>) -> Result<&'a str, HistoryError> {
    if !is_mattermost_id(channel) || root.is_some_and(|id| !is_mattermost_id(id)) {
        return Err(HistoryError::InvalidDraft);
    }
    Ok(root.unwrap_or(""))
}

pub(super) fn validate_revision(revision: &str) -> Result<(), HistoryError> {
    if revision.len() == 32
        && revision
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        Ok(())
    } else {
        Err(HistoryError::InvalidDraft)
    }
}

pub(super) fn write_draft(
    tx: &Transaction<'_>,
    channel: &str,
    root: &str,
    message: &str,
    cleared_by_submission: Option<bool>,
) -> rusqlite::Result<ComposerDraft> {
    tx.query_row(
        SAVE,
        params![channel, root, message, cleared_by_submission],
        read_row,
    )
}

impl AccountHistory {
    pub fn read_draft(
        &mut self,
        channel: &str,
        root: Option<&str>,
    ) -> Result<ComposerDraft, HistoryError> {
        let root = root_key(channel, root)?;
        self.read(|tx| draft(tx, channel, root))
    }

    pub fn save_draft(
        &mut self,
        channel: &str,
        root: Option<&str>,
        expected_revision: Option<&str>,
        message: &str,
    ) -> Result<DraftSave, HistoryError> {
        let root = root_key(channel, root)?;
        if let Some(revision) = expected_revision {
            validate_revision(revision)?;
        }
        // An immediate transaction serializes the comparison and update across app windows.
        self.write(|tx| {
            let current = draft(tx, channel, root)?;
            if current.revision.is_some() && current.message == message {
                return Ok(DraftSave::Saved(current));
            }
            if current.revision.as_deref() != expected_revision {
                return Ok(DraftSave::Conflict(current));
            }
            Ok(DraftSave::Saved(write_draft(
                tx,
                channel,
                root,
                message,
                message.is_empty().then_some(false),
            )?))
        })
    }
}

#[cfg(test)]
mod tests;
