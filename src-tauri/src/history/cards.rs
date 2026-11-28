use super::HistoryError;
use rusqlite::{OptionalExtension, Row, Statement, Transaction, params, types::Type};
use serde::{Deserialize, Serialize};

const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
pub(super) const READ: &str = "SELECT cards, card_update_at, card_observation FROM history_post WHERE id=?1 AND channel_id=?2";

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSnapshot {
    cards: Vec<IntegrationCard>,
    update_at: i64,
    dispatch: i64,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct IntegrationCard {
    #[serde(skip_serializing_if = "Option::is_none")]
    fallback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pretext: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    author_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    author_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    author_icon: Option<CardImage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    fields: Vec<CardField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<CardImage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail: Option<CardImage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    footer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    footer_icon: Option<CardImage>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CardField {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    short: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CardImage {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<ImageMetadata>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImageMetadata {
    width: u64,
    height: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_count: Option<u64>,
}

fn valid_cards(cards: &[IntegrationCard]) -> bool {
    cards.iter().all(|card| {
        [
            &card.author_icon,
            &card.image,
            &card.thumbnail,
            &card.footer_icon,
        ]
        .into_iter()
        .flatten()
        .all(|image| {
            !image.url.is_empty()
                && image.metadata.as_ref().is_none_or(|metadata| {
                    (1..=MAX_SAFE_INTEGER).contains(&metadata.width)
                        && (1..=MAX_SAFE_INTEGER).contains(&metadata.height)
                        && metadata
                            .frame_count
                            .is_none_or(|count| count <= MAX_SAFE_INTEGER)
                })
        })
    })
}

pub(super) fn encode(cards: &[IntegrationCard]) -> Result<String, HistoryError> {
    if !valid_cards(cards) {
        return Err(HistoryError::InvalidPost);
    }
    serde_json::to_string(cards).map_err(|_| HistoryError::InvalidPost)
}

pub(super) fn from_row(
    row: &Row<'_>,
    column: usize,
) -> rusqlite::Result<Option<Vec<IntegrationCard>>> {
    let raw: Option<String> = row.get(column)?;
    let Some(raw) = raw else { return Ok(None) };
    let invalid =
        |error| rusqlite::Error::FromSqlConversionFailure(column, Type::Text, Box::new(error));
    let cards: Vec<IntegrationCard> = serde_json::from_str(&raw).map_err(invalid)?;
    if !valid_cards(&cards) {
        return Err(invalid(serde::de::Error::custom(
            "invalid stored integration cards",
        )));
    }
    Ok(Some(cards))
}

pub(super) fn read(
    statement: &mut Statement<'_>,
    post_id: &str,
    channel_id: &str,
) -> rusqlite::Result<Option<Option<CardSnapshot>>> {
    statement
        .query_row(params![post_id, channel_id], |row| {
            let Some(cards) = from_row(row, 0)? else {
                return Ok(None);
            };
            Ok(Some(CardSnapshot {
                cards,
                update_at: row.get(1)?,
                dispatch: row.get(2)?,
            }))
        })
        .optional()
}

/// A point read can confirm newer cards without advancing the stored post or its window.
pub(super) fn store(
    tx: &Transaction<'_>,
    post_id: &str,
    channel_id: &str,
    update_at: i64,
    stamp: i64,
    payload: &str,
) -> rusqlite::Result<bool> {
    let changed = tx
        .prepare_cached(
            "UPDATE history_post SET cards=?5, card_update_at=?3, card_observation=?4
         WHERE id=?1 AND channel_id=?2 AND update_at<=?3
           AND (card_update_at IS NULL OR (card_update_at,card_observation)<(?3,?4))",
        )?
        .execute(params![post_id, channel_id, update_at, stamp, payload])?;
    Ok(changed != 0)
}
