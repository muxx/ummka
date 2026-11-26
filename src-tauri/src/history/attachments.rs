use super::{HistoryError, StoredPost};
use crate::rest::is_mattermost_id;
use rusqlite::{OptionalExtension, Row, Transaction, params, types::Type};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub(super) const LAST_OBSERVATION: &str =
    "SELECT COALESCE(MAX(observation),0) FROM history_post_attachment";
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PostAttachments {
    #[serde(skip_serializing_if = "Option::is_none")]
    file_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    files: Option<Vec<ReceivedFile>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    redacted_file_count: Option<u64>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReceivedFile {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_preview_image: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    archived: Option<bool>,
}

fn unique_ids<'a>(mut ids: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = HashSet::new();
    ids.all(|id| is_mattermost_id(id) && seen.insert(id))
}

impl PostAttachments {
    fn hidden(&self) -> bool {
        self.redacted_file_count.is_some_and(|count| count > 0)
    }

    pub(super) fn validate(&self) -> Result<(), HistoryError> {
        let ids = self.file_ids.as_deref().unwrap_or_default();
        let files = self.files.as_deref().unwrap_or_default();
        if (self.file_ids.is_none() && self.files.is_none() && self.redacted_file_count.is_none())
            || self
                .redacted_file_count
                .is_some_and(|v| v > MAX_SAFE_INTEGER)
            || (self.hidden() && (!ids.is_empty() || !files.is_empty()))
            || !unique_ids(ids.iter().map(String::as_str))
            || !unique_ids(files.iter().map(|file| file.id.as_str()))
            || files.iter().any(|f| {
                [f.size, f.width, f.height]
                    .into_iter()
                    .flatten()
                    .any(|v| v > MAX_SAFE_INTEGER)
            })
        {
            return Err(HistoryError::InvalidPost);
        }
        Ok(())
    }

    fn decode(raw: &str, column: usize) -> rusqlite::Result<Self> {
        let parse_error = |error: serde_json::Error| {
            rusqlite::Error::FromSqlConversionFailure(column, Type::Text, Box::new(error))
        };
        let observed: Self = serde_json::from_str(raw).map_err(parse_error)?;
        observed.validate().map_err(|_| {
            parse_error(serde::de::Error::custom(
                "invalid stored attachment observation",
            ))
        })?;
        Ok(observed)
    }

    pub(super) fn from_row(row: &Row<'_>) -> rusqlite::Result<Option<Box<Self>>> {
        let raw: Option<String> = row.get(15)?;
        raw.as_deref()
            .map(|text| Self::decode(text, 15).map(Box::new))
            .transpose()
    }
}

pub(super) fn store(
    tx: &Transaction<'_>,
    post: &StoredPost,
    at_start: i64,
) -> Result<(), HistoryError> {
    // Absence of a conflicting row and a competing observation that cleared all data are distinct.
    let conflict: Option<Option<String>> = tx
        .prepare_cached(
            "SELECT payload FROM history_post_attachment WHERE post_id=?1 AND observation>?2",
        )?
        .query_row(params![post.id, at_start], |r| r.get(0))
        .optional()?;
    let current = conflict
        .as_ref()
        .and_then(|raw| raw.as_deref())
        .map(|raw| PostAttachments::decode(raw, 0))
        .transpose()?;
    let observed = post.attachments.as_deref();
    let keep = match current.as_ref() {
        current if conflict.is_none() || current == observed => observed,
        Some(stored) if stored.hidden() => Some(stored),
        _ => observed.filter(|data| data.hidden()),
    };
    let json = keep
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| HistoryError::InvalidPost)?;
    // An identical second clearance must still invalidate a read begun between the two clearances.
    tx.prepare_cached(
        "INSERT OR REPLACE INTO history_post_attachment(post_id,payload) VALUES(?1,?2)",
    )?
    .execute(params![post.id, json])?;
    Ok(())
}
