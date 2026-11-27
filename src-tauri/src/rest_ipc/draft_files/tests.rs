use super::*;
use crate::{
    rest::RestConnection,
    rest_ipc::{clear_connections, close_rest_connection},
    sessions::{
        AccountSessions,
        fixture::{TestVault, using},
    },
};
use objc2_foundation::NSURL;
use std::{fs, future::ready, path::Path, time::Duration};
use tauri::{App, Manager, WebviewWindow, WebviewWindowBuilder, test::MockRuntime};
use tokio::{io::AsyncReadExt, sync::oneshot};

const SERVER: &str = "https://chat.example.test";
const PEER: &str = "https://other.example.test";
const SIZE: NonZeroU64 = NonZeroU64::new(5).unwrap();

fn fixture() -> (
    App<MockRuntime>,
    WebviewWindow<MockRuntime>,
    AccountSessions,
) {
    let app = tauri::test::mock_app();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    (app, window, using(Arc::new(TestVault::default())))
}

async fn signed(
    view: &Webview<MockRuntime>,
    sessions: &AccountSessions,
    base: &str,
    user: &str,
) -> ResourceId {
    let connection = RestConnection::new(base)
        .unwrap()
        .for_account(sessions, user)
        .await
        .unwrap();
    view.resources_table().add(Session::new(connection))
}

fn address(root: Option<&str>) -> DraftAddress {
    DraftAddress::new("c".repeat(26), root.map(|letter| letter.repeat(26))).unwrap()
}

async fn document(path: &Path, bytes: &[u8]) -> Arc<SelectedDocument> {
    fs::write(path, bytes).unwrap();
    SelectedDocument::from_panel_url(NSURL::from_file_path(path).unwrap())
        .await
        .unwrap()
}

fn added(result: AddResult) -> DraftFile {
    match result {
        AddResult::Added(file) => file,
        other => panic!("expected an attached file, got {other:?}"),
    }
}

#[tokio::test]
async fn identical_metadata_keeps_chooser_order_and_each_address_owns_its_source() {
    assert!(DraftAddress::new("bad".into(), None).is_err());
    assert!(DraftAddress::new("c".repeat(26), Some("bad".into())).is_err());
    let (_app, window, accounts) = fixture();
    let view = window.as_ref();
    let user = "a".repeat(26);
    let other_user = "b".repeat(26);
    accounts.activate(SERVER, &user, "first").await.unwrap();
    accounts
        .activate(PEER, &other_user, "second")
        .await
        .unwrap();
    let rid = signed(view, &accounts, SERVER, &user).await;
    let peer = signed(view, &accounts, PEER, &other_user).await;
    let anonymous = view
        .resources_table()
        .add(Session::new(RestConnection::new(SERVER).unwrap()));
    assert_eq!(
        open(view, anonymous),
        Err(DraftFilesError::AccountUnavailable)
    );
    let ws = open(view, rid).unwrap();
    let another = open(view, rid).unwrap();
    let other = open(view, peer).unwrap();
    let sibling = crate::ipc_test::sibling(view);
    assert_eq!(
        open(&sibling, rid),
        Err(DraftFilesError::AccountUnavailable)
    );

    let channel = address(None);
    let thread_one = address(Some("t"));
    let thread_two = address(Some("s"));
    let dir = tempfile::tempdir().unwrap();
    let child = dir.path().join("child");
    fs::create_dir(&child).unwrap();
    let results = add(
        view,
        rid,
        ws,
        &channel,
        SIZE,
        [
            document(&dir.path().join("план.txt"), b"first").await,
            document(&child.join("план.txt"), b"other").await,
        ]
        .into_iter()
        .map(|source| ready(Ok(source))),
    )
    .await
    .unwrap();
    let mut results = results.into_iter().map(added);
    let first = results.next().unwrap();
    let second = results.next().unwrap();
    assert_eq!(first.document, second.document);
    assert_ne!(first.id, second.id);
    assert_eq!(
        list(view, rid, ws, &channel).unwrap(),
        [first.clone(), second.clone()]
    );

    let first_source = source(view, rid, ws, &channel, first.id).unwrap();
    let mut first_reader = first_source.open().await.unwrap();
    let mut second_reader = source(view, rid, ws, &channel, second.id)
        .unwrap()
        .open()
        .await
        .unwrap();
    assert_eq!(first_reader.read_u8().await.unwrap(), b'f');
    let mut text = String::new();
    second_reader.read_to_string(&mut text).await.unwrap();
    assert_eq!(text, "other");

    for thread in [&thread_one, &thread_two] {
        assert!(list(view, rid, ws, thread).unwrap().is_empty());
        assert_eq!(
            source(view, rid, ws, thread, first.id).err(),
            Some(DraftFilesError::UnknownFile)
        );
        add(
            view,
            rid,
            ws,
            thread,
            SIZE,
            [ready(Ok(first_source.clone()))],
        )
        .await
        .unwrap();
    }
    assert_ne!(
        list(view, rid, ws, &thread_one).unwrap()[0].id,
        list(view, rid, ws, &thread_two).unwrap()[0].id
    );
    assert!(list(view, rid, another, &channel).unwrap().is_empty());
    assert!(list(view, peer, other, &channel).unwrap().is_empty());
    assert!(source(view, peer, ws, &channel, first.id).is_err());
    assert_eq!(
        remove(view, rid, another, &channel, first.id),
        Err(DraftFilesError::UnknownFile)
    );
    assert!(source(view, rid, ws, &channel, first.id).is_ok());
    remove(view, rid, ws, &channel, first.id).unwrap();
    assert_eq!(
        source(view, rid, ws, &channel, first.id).err(),
        Some(DraftFilesError::UnknownFile)
    );
    assert_eq!(list(view, rid, ws, &channel).unwrap(), [second]);
    drop(first_source);
    text.clear();
    first_reader.read_to_string(&mut text).await.unwrap();
    assert_eq!(text, "irst");
}

#[tokio::test]
async fn rejects_bad_metadata_without_consuming_slots_and_serializes_concurrent_additions() {
    let (_app, window, accounts) = fixture();
    let view = window.as_ref();
    let user = "a".repeat(26);
    accounts.activate(SERVER, &user, "fixture").await.unwrap();
    let rid = signed(view, &accounts, SERVER, &user).await;
    let ws = open(view, rid).unwrap();
    let draft = address(None);
    let dir = tempfile::tempdir().unwrap();
    let exact = document(&dir.path().join("exact"), b"12345").await;
    let large = document(&dir.path().join("large"), b"123456").await;
    let empty = document(&dir.path().join("empty"), b"").await;
    let ready_exact = || ready(Ok(exact.clone()));
    let outcome = add(
        view,
        rid,
        ws,
        &draft,
        SIZE,
        std::iter::repeat_with(ready_exact).take(9),
    )
    .await
    .unwrap();
    assert!(
        outcome
            .iter()
            .all(|result| matches!(result, AddResult::Added(_)))
    );
    let outcome = add(
        view,
        rid,
        ws,
        &draft,
        SIZE,
        [
            ready(Err(DocumentUnavailable)),
            ready(Ok(empty.clone())),
            ready(Ok(large.clone())),
            ready_exact(),
            ready_exact(),
        ],
    )
    .await
    .unwrap();
    assert!(matches!(outcome[0], AddResult::Unavailable));
    assert_eq!(outcome[1], AddResult::Empty(empty.info().clone()));
    assert_eq!(outcome[2], AddResult::TooLarge(large.info().clone()));
    assert!(matches!(outcome[3], AddResult::Added(_)));
    assert_eq!(outcome[4], AddResult::LimitReached(exact.info().clone()));
    let list_before = list(view, rid, ws, &draft).unwrap();
    assert_eq!(list_before.len(), 10);
    remove(view, rid, ws, &draft, list_before[0].id).unwrap();

    let (start_a, started_a) = oneshot::channel();
    let (start_b, started_b) = oneshot::channel();
    let (release_a, pending_a) = oneshot::channel();
    let (release_b, pending_b) = oneshot::channel();
    let a = add(
        view,
        rid,
        ws,
        &draft,
        SIZE,
        [async {
            start_a.send(()).unwrap();
            pending_a.await.unwrap();
            Ok(exact.clone())
        }],
    );
    let b = add(
        view,
        rid,
        ws,
        &draft,
        SIZE,
        [async {
            start_b.send(()).unwrap();
            pending_b.await.unwrap();
            Ok(exact.clone())
        }],
    );
    let release = async {
        started_a.await.unwrap();
        started_b.await.unwrap();
        assert_eq!(list(view, rid, ws, &draft).unwrap().len(), 9);
        release_a.send(()).unwrap();
        release_b.send(()).unwrap();
    };
    let (a, b, ()) = tokio::join!(a, b, release);
    let outcomes: Vec<_> = a.unwrap().into_iter().chain(b.unwrap()).collect();
    let accepted = outcomes
        .iter()
        .filter(|r| matches!(r, AddResult::Added(_)))
        .count();
    assert_eq!(accepted, 1);
    assert!(outcomes.contains(&AddResult::LimitReached(exact.info().clone())));
    assert_eq!(list(view, rid, ws, &draft).unwrap().len(), 10);
}

#[tokio::test]
async fn preparation_releases_the_eleventh_valid_source_before_waiting_for_the_next() {
    let (_app, window, accounts) = fixture();
    let view = window.as_ref();
    let user = "a".repeat(26);
    accounts.activate(SERVER, &user, "fixture").await.unwrap();
    let rid = signed(view, &accounts, SERVER, &user).await;
    let ws = open(view, rid).unwrap();
    let draft = address(None);
    let dir = tempfile::tempdir().unwrap();
    for (name, bytes) in [
        ("empty", b"".as_slice()),
        ("large", b"123456".as_slice()),
        ("exact", b"12345".as_slice()),
        ("extra", b"hello".as_slice()),
        ("waiting", b"world".as_slice()),
    ] {
        fs::write(dir.path().join(name), bytes).unwrap();
    }
    let (send_extra, extra) = oneshot::channel();
    let (send_waiting, waiting) = oneshot::channel();
    let (send_release, release) = oneshot::channel();
    let mut send_extra = Some(send_extra);
    let mut pause = Some((send_waiting, release));
    let paths = ["missing", "empty", "large"]
        .into_iter()
        .chain(std::iter::repeat_n("exact", 10))
        .chain(["extra", "waiting"]);
    let documents = paths.map(|name| {
        let path = dir.path().join(name);
        let report = (name == "extra").then(|| send_extra.take().unwrap());
        let pause = (name == "waiting").then(|| pause.take().unwrap());
        async move {
            if let Some((started, resume)) = pause {
                started.send(()).unwrap();
                resume.await.unwrap();
            }
            let source =
                SelectedDocument::from_panel_url(NSURL::from_file_path(&path).unwrap()).await?;
            if let Some(report) = report {
                report.send(Arc::downgrade(&source)).unwrap();
            }
            Ok(source)
        }
    });
    let adding = add(view, rid, ws, &draft, SIZE, documents);
    let observe = async {
        waiting.await.unwrap();
        assert!(extra.await.unwrap().upgrade().is_none());
        assert!(list(view, rid, ws, &draft).unwrap().is_empty());
        send_release.send(()).unwrap();
    };
    let (result, ()) = tokio::join!(adding, observe);
    let results = result.unwrap();
    assert!(matches!(results[0], AddResult::Unavailable));
    assert!(matches!(results[1], AddResult::Empty(_)));
    assert!(matches!(results[2], AddResult::TooLarge(_)));
    assert_eq!(results.len(), 15);
    assert!(
        results[3..13]
            .iter()
            .all(|r| matches!(r, AddResult::Added(_)))
    );
    assert!(matches!(&results[13], AddResult::LimitReached(info) if info.name == "extra"));
    assert!(matches!(&results[14], AddResult::LimitReached(info) if info.name == "waiting"));
}

#[tokio::test]
async fn closing_the_workspace_window_or_login_prevents_late_additions() {
    let (_app, window, accounts) = fixture();
    let view = window.as_ref();
    let user = "a".repeat(26);
    accounts.activate(SERVER, &user, "current").await.unwrap();
    let draft = address(None);
    let dir = tempfile::tempdir().unwrap();

    for retirement in ["workspace", "window", "connection", "login"] {
        let rid = signed(view, &accounts, SERVER, &user).await;
        let ws = open(view, rid).unwrap();
        let retained = document(&dir.path().join("retained"), b"hello").await;
        let weak = Arc::downgrade(&retained);
        add(view, rid, ws, &draft, SIZE, [ready(Ok(retained))])
            .await
            .unwrap();
        let staged = document(&dir.path().join("late"), b"hello").await;
        let weak_staged = Arc::downgrade(&staged);
        let (start, started) = oneshot::channel();
        let (finish, finishing) = oneshot::channel();
        let metadata = tokio::spawn(async move {
            start.send(()).unwrap();
            finishing.await.unwrap();
            staged
        });
        let delayed = add(
            view,
            rid,
            ws,
            &draft,
            SIZE,
            [async { Ok(metadata.await.unwrap()) }],
        );
        let stop = async {
            started.await.unwrap();
            match retirement {
                "workspace" => close(view, rid, ws).unwrap(),
                "window" => clear_connections(view),
                "connection" => close_rest_connection(view.clone(), rid).unwrap(),
                "login" => accounts
                    .activate(SERVER, &user, "replacement")
                    .await
                    .unwrap(),
                _ => unreachable!(),
            }
            let new_rid = if retirement == "workspace" {
                rid
            } else {
                signed(view, &accounts, SERVER, &user).await
            };
            let reopened = open(view, new_rid).unwrap();
            finish.send(()).unwrap();
            (new_rid, reopened)
        };
        let (result, (new_rid, reopened)) = tokio::join!(delayed, stop);
        assert_eq!(result, Err(DraftFilesError::Cancelled), "{retirement}");
        assert!(list(view, rid, ws, &draft).is_err(), "{retirement}");
        assert!(list(view, new_rid, reopened, &draft).unwrap().is_empty());
        tokio::time::timeout(Duration::from_secs(1), async {
            while weak.upgrade().is_some() || weak_staged.upgrade().is_some() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("{retirement} retained a document"));
        close_rest_connection(view.clone(), new_rid).unwrap();
    }
}
