//! Decode a Mattermost message against the last event applied by this account.

#[cfg(all(feature = "native-http-check", any(test, target_os = "android")))]
pub(crate) mod checks;
mod connection;
mod delivery;
pub use connection::{EventConnectionError, EventReader, EventSettings};

use crate::rest::is_mattermost_id;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::sync::Arc;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventCursor {
    connection_id: Arc<str>,
    next_sequence: i64,
}

impl EventCursor {
    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }

    pub fn next_sequence(&self) -> i64 {
        self.next_sequence
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Continuity {
    FirstConnection,
    Continuing,
    /// The previous server queue is gone. Synchronize account data with REST.
    ReplacedConnection,
}

pub struct ServerEvent {
    pub name: String,
    pub data: Map<String, Value>,
    pub broadcast: Map<String, Value>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum ReplyStatus {
    Ok,
    Fail,
}

pub enum IncomingFrame {
    Reply {
        request_sequence: i64,
        status: ReplyStatus,
    },
    Event {
        event: ServerEvent,
        continuity: Continuity,
        /// Keep this only after applying the event and any required synchronization.
        after: EventCursor,
    },
}

#[derive(Debug, Eq, PartialEq)]
pub enum StreamError {
    InvalidFrame,
    MissingHello,
    InvalidConnectionId,
    SequenceMismatch { expected: i64, received: i64 },
    SequenceExhausted,
}

#[derive(Deserialize)]
struct WireFrame {
    event: Option<String>,
    seq: Option<i64>,
    data: Option<Map<String, Value>>,
    broadcast: Option<Map<String, Value>>,
    seq_reply: Option<i64>,
    status: Option<ReplyStatus>,
}

/// A reply never moves the cursor. An error leaves the caller's checkpoint intact.
pub fn read_frame(
    bytes: &[u8],
    applied: Option<&EventCursor>,
) -> Result<IncomingFrame, StreamError> {
    // Serde also supports positional arrays for structs. Mattermost sends named JSON objects.
    if bytes.iter().copied().find(|b| !b.is_ascii_whitespace()) != Some(b'{') {
        return Err(StreamError::InvalidFrame);
    }
    let wire: WireFrame = serde_json::from_slice(bytes).map_err(|_| StreamError::InvalidFrame)?;
    match (wire.event, wire.seq, wire.seq_reply, wire.status) {
        (None, None, Some(request_sequence), Some(status)) if request_sequence > 0 => {
            Ok(IncomingFrame::Reply {
                request_sequence,
                status,
            })
        }
        (Some(name), Some(sequence), None, None) if !name.is_empty() && sequence >= 0 => {
            let event = ServerEvent {
                name,
                data: wire.data.ok_or(StreamError::InvalidFrame)?,
                broadcast: wire.broadcast.ok_or(StreamError::InvalidFrame)?,
            };
            sequence_event(event, sequence, applied)
        }
        _ => Err(StreamError::InvalidFrame),
    }
}

fn sequence_event(
    event: ServerEvent,
    sequence: i64,
    applied: Option<&EventCursor>,
) -> Result<IncomingFrame, StreamError> {
    let hello_id = if event.name == "hello" {
        let id = event
            .data
            .get("connection_id")
            .and_then(Value::as_str)
            .filter(|id| is_mattermost_id(id))
            .ok_or(StreamError::InvalidConnectionId)?;
        Some(id)
    } else {
        None
    };
    let (connection_id, expected, continuity) = match (applied, hello_id) {
        (None, None) => return Err(StreamError::MissingHello),
        (None, Some(id)) => (Arc::from(id), 0, Continuity::FirstConnection),
        (Some(cursor), Some(id)) if id != cursor.connection_id() => {
            (Arc::from(id), 0, Continuity::ReplacedConnection)
        }
        (Some(cursor), _) => (
            Arc::clone(&cursor.connection_id),
            cursor.next_sequence,
            Continuity::Continuing,
        ),
    };
    if sequence != expected {
        return Err(StreamError::SequenceMismatch {
            expected,
            received: sequence,
        });
    }
    let next_sequence = sequence
        .checked_add(1)
        .ok_or(StreamError::SequenceExhausted)?;
    Ok(IncomingFrame::Event {
        event,
        continuity,
        after: EventCursor {
            connection_id,
            next_sequence,
        },
    })
}

#[cfg(test)]
mod tests;
