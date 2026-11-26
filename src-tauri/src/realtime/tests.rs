use super::*;
use serde_json::json;

const ORIGINAL: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPLACEMENT: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";

fn event(name: &str, sequence: i64, data: Value) -> Value {
    json!({"event": name, "seq": sequence, "data": data, "broadcast": {"channel_id":"", "omit_users":null}})
}

fn hello(id: &str, sequence: i64) -> Value {
    event(
        "hello",
        sequence,
        json!({"connection_id":id,"server_hostname":"fixture"}),
    )
}

fn read(message: Value, applied: Option<&EventCursor>) -> Result<IncomingFrame, StreamError> {
    read_frame(&serde_json::to_vec(&message).unwrap(), applied)
}

fn delivered(
    message: Value,
    applied: Option<&EventCursor>,
) -> (ServerEvent, Continuity, EventCursor) {
    let IncomingFrame::Event {
        event,
        continuity,
        after,
    } = read(message, applied).unwrap()
    else {
        panic!("expected an event");
    };
    (event, continuity, after)
}

#[test]
fn starts_at_zero_and_resumes_with_the_next_applied_sequence() {
    let (_, continuity, first) = delivered(hello(ORIGINAL, 0), None);
    assert_eq!(continuity, Continuity::FirstConnection);
    assert_eq!(
        (first.connection_id(), first.next_sequence()),
        (ORIGINAL, 1)
    );

    let private_post = r#"{"id":"fixture","message":"Only visible to you"}"#;
    let message = event("ephemeral_message", 1, json!({"post":private_post}));
    let (post, continuity, offered) = delivered(message.clone(), Some(&first));
    assert_eq!(continuity, Continuity::Continuing);
    assert_eq!(post.data["post"], private_post);
    assert!(post.broadcast["omit_users"].is_null());

    // A failed write leaves the same event eligible after reconnect.
    assert_eq!(delivered(message, Some(&first)).2, offered);
    let (_, continuity, after_unknown) =
        delivered(event("future_event", 2, json!({})), Some(&offered));
    assert_eq!(continuity, Continuity::Continuing);
    let (post, _, last) = delivered(
        event("posted", 3, json!({"post":"{}"})),
        Some(&after_unknown),
    );
    assert_eq!(post.name, "posted");
    assert_eq!(last.next_sequence(), 4);
}

#[test]
fn replies_are_independent_before_hello_and_between_events() {
    for (status, expected) in [("OK", ReplyStatus::Ok), ("FAIL", ReplyStatus::Fail)] {
        let message = json!({"status":status,"seq_reply":4,"data":{"text":"private"},"error":{"detailed_error":"private"}});
        let cursor = delivered(hello(ORIGINAL, 0), None).2;
        for applied in [None, Some(&cursor)] {
            assert!(
                matches!(read(message.clone(), applied), Ok(IncomingFrame::Reply { request_sequence:4, status, .. }) if status == expected)
            );
        }
        assert_eq!(
            delivered(event("posted", 1, json!({})), Some(&cursor))
                .2
                .next_sequence(),
            2
        );
    }
}

#[test]
fn a_new_stream_requires_sync_and_a_same_id_hello_keeps_its_sequence() {
    let cursor = delivered(hello(ORIGINAL, 0), None).2;
    assert_eq!(
        delivered(hello(ORIGINAL, 1), Some(&cursor)).1,
        Continuity::Continuing
    );
    let (_, continuity, replacement) = delivered(hello(REPLACEMENT, 0), Some(&cursor));
    assert_eq!(continuity, Continuity::ReplacedConnection);
    assert_eq!(
        (replacement.connection_id(), replacement.next_sequence()),
        (REPLACEMENT, 1)
    );
    assert_eq!(
        read(hello(REPLACEMENT, 3), Some(&cursor)).err(),
        Some(StreamError::SequenceMismatch {
            expected: 0,
            received: 3
        })
    );
}

#[test]
fn gaps_duplicates_missing_hello_and_exhausted_counters_stop_delivery() {
    assert_eq!(
        read(event("posted", 0, json!({})), None).err(),
        Some(StreamError::MissingHello)
    );
    let mut cursor = delivered(hello(ORIGINAL, 0), None).2;
    for received in [0, 3] {
        assert_eq!(
            read(event("ignored", received, json!({})), Some(&cursor)).err(),
            Some(StreamError::SequenceMismatch {
                expected: 1,
                received
            })
        );
    }
    cursor.next_sequence = i64::MAX;
    assert_eq!(
        read(event("ignored", i64::MAX, json!({})), Some(&cursor)).err(),
        Some(StreamError::SequenceExhausted)
    );
}

#[test]
fn malformed_messages_do_not_yield_a_checkpoint_or_expose_the_frame() {
    for invalid in [
        json!(null),
        json!([]),
        json!([null, null, null, null, 1, "OK"]),
        json!({}),
        json!({"status":"OK","seq_reply":0}),
        json!({"status":"UNKNOWN","seq_reply":1}),
        json!({"status":"OK","seq_reply":1,"seq":0}),
        json!({"event":"hello","seq":0,"data":{},"broadcast":{},"seq_reply":1,"status":"OK"}),
        json!({"event":"hello","seq":0,"data":[],"broadcast":{}}),
        json!({"event":"hello","seq":0,"data":{},"broadcast":null}),
        json!({"event":"hello","seq":1.5,"data":{},"broadcast":{}}),
        json!({"event":"","seq":0,"data":{},"broadcast":{}}),
        event("hello", -1, json!({})),
    ] {
        assert_eq!(read(invalid, None).err(), Some(StreamError::InvalidFrame));
    }
    for id in ["", "short", "aaaaaaaaaaaaaaaaaaaaaaaaa!"] {
        assert_eq!(
            read(hello(id, 0), None).err(),
            Some(StreamError::InvalidConnectionId)
        );
    }
    for bytes in [
        b"{" as &[u8],
        br#"{"seq":9223372036854775808,"event":"hello","data":{},"broadcast":{}}"#,
    ] {
        assert_eq!(
            read_frame(bytes, None).err(),
            Some(StreamError::InvalidFrame)
        );
    }
}

#[test]
fn only_the_matching_successful_application_pong_completes_a_ping() {
    for (seq, status, text, expected) in [
        (1, "OK", "pong", true),
        (2, "OK", "pong", false),
        (1, "FAIL", "pong", false),
        (1, "OK", "other", false),
    ] {
        let reply = read(
            json!({"seq_reply":seq,"status":status,"data":{"text":text}}),
            None,
        )
        .unwrap();
        assert_eq!(reply.confirms_ping(1), expected);
    }
    assert!(!read(hello(ORIGINAL, 0), None).unwrap().confirms_ping(1));
}

#[test]
fn typing_identifies_a_channel_or_thread_and_rejects_incomplete_addresses() {
    let cursor = delivered(hello(ORIGINAL, 0), None).2;
    for (channel, user, root, valid) in [
        (ORIGINAL, REPLACEMENT, Some(""), true),
        (ORIGINAL, REPLACEMENT, Some(ORIGINAL), true),
        ("", REPLACEMENT, Some(""), false),
        (ORIGINAL, "", Some(""), false),
        (ORIGINAL, REPLACEMENT, Some("bad"), false),
        (ORIGINAL, REPLACEMENT, None, false),
    ] {
        let mut data = json!({"user_id":user});
        if let Some(root) = root {
            data["parent_id"] = json!(root);
        }
        let mut wire = event("typing", 1, data);
        wire["broadcast"]["channel_id"] = json!(channel);
        let frame = delivered(wire, Some(&cursor)).0;
        if valid {
            assert_eq!(
                frame.typing().unwrap(),
                Some(TypingEvent {
                    channel_id: channel,
                    user_id: user,
                    root_id: root.filter(|v| !v.is_empty())
                })
            );
        } else {
            assert_eq!(frame.typing(), Err(StreamError::InvalidFrame));
        }
    }
    assert!(
        delivered(hello(ORIGINAL, 0), None)
            .0
            .typing()
            .unwrap()
            .is_none()
    );
}
