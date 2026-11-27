use super::{
    transfer::{confirm_workspace_upload, start_workspace_upload, workspace_upload_denial},
    *,
};
use crate::{
    native_http::{NativeHttp, TransportError},
    rest::{
        RestConnection,
        file_upload::{FileUploadError, SourceError, UploadedFile},
    },
    sessions::{
        AccountSessions,
        fixture::{TestVault, using},
    },
};
use reqwest::{Method, Request};
use std::{future::ready, path::Path, sync::Weak, time::Duration};

type Check<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
const LIMIT: u64 = 64 * 1024 * 1024;
const POLICY: UploadPolicy = UploadPolicy::Allowed {
    max_file_bytes: LIMIT,
};

struct Fixture<'a> {
    client: &'a NativeHttp,
    base: &'a str,
    directory: &'a Path,
}

async fn until<T>(mut check: impl FnMut() -> Option<T>, label: &str) -> T {
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if let Some(value) = check() {
                return value;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("draft did not reach {label}"))
}

impl Fixture<'_> {
    async fn stage(&self, name: &str, step: &str, expected: &str) -> Check {
        let response = self
            .client
            .send(Request::new(
                Method::GET,
                format!("{}/draft-upload-check/{name}/{step}", self.base).parse()?,
            ))
            .await?;
        assert_eq!(response.status(), 200);
        assert_eq!(response.text().await?, expected);
        Ok(())
    }

    async fn select(
        &self,
        account: &Session,
        workspace: ResourceId,
        draft: &DraftAddress,
        name: &str,
    ) -> Check<(Uuid, Weak<SelectedDocument>)> {
        #[cfg(target_os = "macos")]
        let source = {
            let path = self.directory.join(format!("{name}.txt"));
            let mut file = std::fs::File::create(&path)?;
            std::io::Write::write_all(&mut file, name.as_bytes())?;
            if name == "reading" {
                file.set_len(LIMIT)?;
            }
            SelectedDocument::from_panel_url(
                objc2_foundation::NSURL::from_file_path(&path).unwrap(),
            )
            .await?
        };
        #[cfg(target_os = "android")]
        let source = {
            let _ = self.directory;
            provider(name).await?
        };
        let weak = Arc::downgrade(&source);
        let files = add_to_workspace(
            account,
            workspace,
            draft,
            NonZeroU64::new(LIMIT).unwrap(),
            [ready(Ok(source))],
        )
        .await
        .unwrap();
        let [AddResult::Added(file)] = files.as_slice() else {
            panic!("selected {name}: {files:?}")
        };
        assert_eq!(file.upload, UploadState::Selected);
        Ok((file.id, weak))
    }
}

#[cfg(target_os = "android")]
async fn provider(name: &str) -> Result<Arc<SelectedDocument>, DocumentUnavailable> {
    SelectedDocument::from_picker_uri(format!(
        "content://io.github.muxx.ummka.dev.httpcheck.sourcecheck/draft-{name}"
    ))
    .await
}

async fn signed(
    client: &NativeHttp,
    accounts: &AccountSessions,
    installation: &str,
    user: &str,
    token: &str,
) -> Check<Session> {
    accounts.activate(installation, user, token).await?;
    let rest = RestConnection::with_client(installation, || Ok(client.clone()))?
        .for_account(accounts, user)
        .await?;
    Ok(Session::new(rest))
}

fn draft(channel: &str, root: Option<&str>) -> DraftAddress {
    DraftAddress::new(channel.repeat(26), root.map(|root| root.repeat(26))).unwrap()
}

fn state(account: &Session, workspace: ResourceId, draft: &DraftAddress, id: Uuid) -> UploadState {
    list_workspace(account, workspace, draft)
        .unwrap()
        .into_iter()
        .find(|file| file.id == id)
        .unwrap()
        .upload
}

async fn finish(
    account: &Session,
    workspace: ResourceId,
    draft: &DraftAddress,
    id: Uuid,
) -> UploadState {
    until(
        || match state(account, workspace, draft, id) {
            outcome @ (UploadState::Ready(_) | UploadState::Failed(_)) => Some(outcome),
            _ => None,
        },
        "terminal result",
    )
    .await
}

fn start(account: &Session, workspace: ResourceId, draft: &DraftAddress, id: Uuid) -> UploadState {
    start_workspace_upload(account, workspace, draft, id, POLICY)
        .unwrap()
        .upload
}

async fn ordering(
    fixture: &Fixture<'_>,
    account: &Session,
    workspace: ResourceId,
    channel: &DraftAddress,
) -> Check {
    let left = draft("c", Some("x"));
    let right = draft("c", Some("y"));
    let (slow, _) = fixture.select(account, workspace, channel, "slow").await?;
    let (fast, source) = fixture.select(account, workspace, channel, "fast").await?;
    let (a, _) = fixture
        .select(account, workspace, &left, "thread-a")
        .await?;
    let (b, _) = fixture
        .select(account, workspace, &right, "thread-b")
        .await?;
    assert_eq!(
        start(account, workspace, channel, slow),
        UploadState::Reading {
            bytes_read: 0,
            length: Some(4)
        }
    );
    fixture.stage("slow", "seen", "OK").await?;
    assert_eq!(
        start(account, workspace, channel, slow),
        UploadState::Processing { bytes_read: 4 }
    );
    assert_eq!(
        start_workspace_upload(account, workspace, &left, slow, POLICY),
        Err(DraftFilesError::UnknownFile)
    );
    start(account, workspace, &left, a);
    fixture.stage("thread-a", "seen", "OK").await?;
    start(account, workspace, &right, b);
    start(account, workspace, channel, fast);
    assert!(
        matches!(finish(account, workspace, &right, b).await, UploadState::Ready(file) if file.id == "b".repeat(26))
    );
    assert_eq!(
        finish(account, workspace, channel, fast).await,
        UploadState::Ready(UploadedFile {
            id: "f".repeat(26),
            name: "renamed.txt".into(),
            size: 20
        })
    );
    until(
        || source.upgrade().is_none().then_some(()),
        "source release after receipt",
    )
    .await;
    assert_eq!(
        state(account, workspace, &left, a),
        UploadState::Processing { bytes_read: 8 }
    );
    assert_eq!(
        state(account, workspace, channel, slow),
        UploadState::Processing { bytes_read: 4 }
    );
    assert!(matches!(
        start(account, workspace, channel, fast),
        UploadState::Ready(_)
    ));
    fixture.stage("thread-a", "release", "OK").await?;
    fixture.stage("slow", "release", "OK").await?;
    assert!(
        matches!(finish(account, workspace, &left, a).await, UploadState::Ready(file) if file.id == "a".repeat(26))
    );
    assert!(
        matches!(finish(account, workspace, channel, slow).await, UploadState::Ready(file) if file.id == "s".repeat(26))
    );
    assert_eq!(
        list_workspace(account, workspace, channel)
            .unwrap()
            .iter()
            .map(|file| file.id)
            .collect::<Vec<_>>(),
        [slow, fast]
    );
    fixture.stage("slow", "count", "1").await?;
    fixture.stage("fast", "count", "1").await?;
    Ok(())
}

async fn outcomes(
    fixture: &Fixture<'_>,
    account: &Session,
    workspace: ResourceId,
    channel: &DraftAddress,
) -> Check {
    for (name, expected) in [
        (
            "retry",
            UploadFailure::Upload(FileUploadError::Transport(TransportError::Network)),
        ),
        (
            "invalid",
            UploadFailure::Upload(FileUploadError::InvalidReceipt),
        ),
    ] {
        let (id, source) = fixture.select(account, workspace, channel, name).await?;
        start(account, workspace, channel, id);
        assert_eq!(
            finish(account, workspace, channel, id).await,
            UploadState::Failed(expected)
        );
        assert!(source.upgrade().is_some());
        if name == "retry" {
            fixture.stage("retry", "count", "1").await?;
            assert_eq!(
                start(account, workspace, channel, id),
                UploadState::Reading {
                    bytes_read: 0,
                    length: Some(5)
                }
            );
            assert!(matches!(
                finish(account, workspace, channel, id).await,
                UploadState::Ready(file) if file.id == "r".repeat(26)
            ));
            fixture.stage("retry", "count", "2").await?;
        }
        remove_from_workspace(account, workspace, channel, id).unwrap();
    }
    let (id, _) = fixture
        .select(account, workspace, channel, "over-local")
        .await?;
    for (policy, expected) in [
        (UploadPolicy::Unknown, UploadFailure::PolicyUnavailable),
        (
            UploadPolicy::Allowed { max_file_bytes: 0 },
            UploadFailure::TooLarge(None),
        ),
        (UploadPolicy::Denied, UploadFailure::PermissionDenied(None)),
    ] {
        start_workspace_upload(account, workspace, channel, id, policy).unwrap();
        assert_eq!(
            finish(account, workspace, channel, id).await,
            UploadState::Failed(expected)
        );
    }
    assert_eq!(
        start_workspace_upload(
            account,
            workspace,
            channel,
            id,
            UploadPolicy::Allowed {
                max_file_bytes: u64::MAX
            },
        ),
        Err(DraftFilesError::InvalidUploadPolicy)
    );
    let (id, _) = fixture
        .select(account, workspace, channel, "server-limit")
        .await?;
    start(account, workspace, channel, id);
    assert!(matches!(
        finish(account, workspace, channel, id).await,
        UploadState::Failed(UploadFailure::TooLarge(Some(response))) if response.status_code == 413
    ));
    Ok(())
}

async fn unavailable_source(
    fixture: &Fixture<'_>,
    account: &Session,
    workspace: ResourceId,
    channel: &DraftAddress,
) -> Check {
    let (old, original) = fixture
        .select(account, workspace, channel, "absent")
        .await?;
    let document = list_workspace(account, workspace, channel)
        .unwrap()
        .into_iter()
        .find(|file| file.id == old)
        .unwrap()
        .document;
    #[cfg(target_os = "macos")]
    let (path, moved) = {
        let path = fixture.directory.join("absent.txt");
        let moved = fixture.directory.join("absent.moved");
        std::fs::rename(&path, &moved)?;
        (path, moved)
    };
    start(account, workspace, channel, old);
    let failure = UploadFailure::Upload(FileUploadError::Source(SourceError::Unreadable));
    assert!(!failure.can_retry());
    assert_eq!(
        finish(account, workspace, channel, old).await,
        UploadState::Failed(failure.clone())
    );
    until(
        || original.upgrade().is_none().then_some(()),
        "unreadable source release",
    )
    .await;
    #[cfg(target_os = "macos")]
    std::fs::rename(moved, path)?;
    #[cfg(target_os = "android")]
    {
        assert_eq!(provider("absent-opens").await?.info().size, Some(1));
        provider("restore").await?;
    }
    let previous = start_workspace_upload(account, workspace, channel, old, POLICY).unwrap();
    assert_eq!(previous.upload, UploadState::Failed(failure));
    assert_eq!(previous.document, document);
    fixture.stage("absent", "count", "0").await?;
    #[cfg(target_os = "android")]
    assert_eq!(provider("absent-opens").await?.info().size, Some(1));
    let (new, _) = fixture
        .select(account, workspace, channel, "absent")
        .await?;
    assert_ne!(new, old);
    let current = start_workspace_upload(account, workspace, channel, new, POLICY).unwrap();
    assert_eq!(current.document, document);
    assert!(matches!(
        finish(account, workspace, channel, new).await,
        UploadState::Ready(_)
    ));
    #[cfg(target_os = "android")]
    assert_eq!(provider("absent-opens").await?.info().size, Some(2));
    fixture.stage("absent", "count", "1").await?;
    Ok(())
}

async fn access(
    fixture: &Fixture<'_>,
    account: &Session,
    workspace: ResourceId,
    channel: &DraftAddress,
) -> Check {
    let left = draft("c", Some("x"));
    let right = draft("c", Some("y"));
    let (late, _) = fixture
        .select(account, workspace, &left, "late-denied")
        .await?;
    let (early, _) = fixture
        .select(account, workspace, channel, "denied")
        .await?;
    start(account, workspace, &left, late);
    fixture.stage("late-denied", "seen", "OK").await?;
    start(account, workspace, channel, early);
    assert!(matches!(
        finish(account, workspace, channel, early).await,
        UploadState::Failed(UploadFailure::PermissionDenied(Some(response))) if response.status_code == 403
    ));
    let original = workspace_upload_denial(account, workspace, &right)
        .unwrap()
        .unwrap();
    assert_eq!(
        original.response.id.as_deref(),
        Some("api.context.permissions.app_error")
    );
    remove_from_workspace(account, workspace, channel, early).unwrap();
    assert_eq!(
        workspace_upload_denial(account, workspace, &left).unwrap(),
        Some(original.clone())
    );
    assert_eq!(
        workspace_upload_denial(account, workspace, &draft("z", None)).unwrap(),
        None
    );
    let second_workspace = open_workspace(account).unwrap();
    assert_eq!(
        workspace_upload_denial(account, second_workspace, &left).unwrap(),
        None
    );
    close_workspace(account, second_workspace).unwrap();
    let (blocked, source) = fixture
        .select(account, workspace, &right, "blocked")
        .await?;
    let refusal = UploadFailure::PermissionDenied(Some(original.response));
    assert!(!refusal.can_retry());
    assert_eq!(
        start(account, workspace, &right, blocked),
        UploadState::Failed(refusal.clone())
    );
    assert!(source.upgrade().is_none());
    fixture.stage("late-denied", "release", "OK").await?;
    assert!(matches!(
        finish(account, workspace, &left, late).await,
        UploadState::Failed(UploadFailure::PermissionDenied(_))
    ));
    let latest = workspace_upload_denial(account, workspace, channel)
        .unwrap()
        .unwrap();
    for (revision, policy) in [
        (original.revision, POLICY),
        (latest.revision, UploadPolicy::Unknown),
    ] {
        assert!(!confirm_workspace_upload(account, workspace, channel, revision, policy).unwrap());
        assert_eq!(
            workspace_upload_denial(account, workspace, &right).unwrap(),
            Some(latest.clone())
        );
    }
    assert!(confirm_workspace_upload(account, workspace, &left, latest.revision, POLICY).unwrap());
    assert_eq!(
        workspace_upload_denial(account, workspace, &right).unwrap(),
        None
    );
    assert!(matches!(
        start(account, workspace, &left, late),
        UploadState::Failed(UploadFailure::PermissionDenied(_))
    ));
    assert_eq!(
        start(account, workspace, &right, blocked),
        UploadState::Failed(refusal)
    );
    fixture.stage("late-denied", "count", "1").await?;
    fixture.stage("blocked", "count", "0").await?;
    let (selected_again, _) = fixture
        .select(account, workspace, &right, "blocked")
        .await?;
    assert_ne!(selected_again, blocked);
    start(account, workspace, &right, selected_again);
    assert!(matches!(
        finish(account, workspace, &right, selected_again).await,
        UploadState::Ready(_)
    ));
    fixture.stage("blocked", "count", "1").await?;
    Ok(())
}

async fn cancel_requests(
    fixture: &Fixture<'_>,
    account: &Session,
    workspace: ResourceId,
    channel: &DraftAddress,
) -> Check {
    let (reading, source) = fixture
        .select(account, workspace, channel, "reading")
        .await?;
    start(account, workspace, channel, reading);
    fixture.stage("reading", "seen", "OK").await?;
    let progress = until(
        || match state(account, workspace, channel, reading) {
            progress @ UploadState::Reading {
                bytes_read: 1.., ..
            } => Some(progress),
            _ => None,
        },
        "body progress",
    )
    .await;
    #[cfg(target_os = "android")]
    assert_eq!(
        progress,
        UploadState::Reading {
            bytes_read: 5,
            length: None
        }
    );
    #[cfg(target_os = "macos")]
    assert!(
        matches!(progress, UploadState::Reading { bytes_read, length: Some(LIMIT) } if bytes_read < LIMIT)
    );
    remove_from_workspace(account, workspace, channel, reading).unwrap();
    fixture.stage("reading", "release", "OK").await?;
    fixture.stage("reading", "closed", "OK").await?;
    until(
        || source.upgrade().is_none().then_some(()),
        "source release after removing a reading upload",
    )
    .await;

    let (processing, source) = fixture
        .select(account, workspace, channel, "cancel-response")
        .await?;
    start(account, workspace, channel, processing);
    fixture.stage("cancel-response", "seen", "OK").await?;
    assert_eq!(
        state(account, workspace, channel, processing),
        UploadState::Processing { bytes_read: 15 }
    );
    remove_from_workspace(account, workspace, channel, processing).unwrap();
    fixture.stage("cancel-response", "closed", "OK").await?;
    fixture.stage("cancel-response", "release", "OK").await?;
    until(
        || source.upgrade().is_none().then_some(()),
        "source release after removing a processing upload",
    )
    .await;
    assert_eq!(
        workspace_upload_denial(account, workspace, channel).unwrap(),
        None
    );
    for removed in [reading, processing] {
        assert_eq!(
            start_workspace_upload(account, workspace, channel, removed, POLICY),
            Err(DraftFilesError::UnknownFile)
        );
    }
    Ok(())
}

pub(crate) async fn wire(client: &NativeHttp, base: &str, directory: &Path) -> Check {
    tokio::time::timeout(Duration::from_secs(40), exercise(client, base, directory))
        .await
        .expect("draft upload fixture timed out")
}

async fn exercise(client: &NativeHttp, base: &str, directory: &Path) -> Check {
    let fixture = Fixture {
        client,
        base,
        directory,
    };
    let installation = format!("{base}/Drafts%20Site//A%2FB");
    let accounts = using(Arc::new(TestVault::default()));
    let member = "a".repeat(26);
    let account = signed(client, &accounts, &installation, &member, "draft-member").await?;
    let workspace = open_workspace(&account).unwrap();
    let channel = draft("c", None);
    ordering(&fixture, &account, workspace, &channel).await?;
    outcomes(&fixture, &account, workspace, &channel).await?;
    unavailable_source(&fixture, &account, workspace, &channel).await?;
    access(&fixture, &account, workspace, &channel).await?;
    cancel_requests(&fixture, &account, workspace, &channel).await?;
    #[cfg(target_os = "android")]
    {
        let (stream, _) = fixture
            .select(&account, workspace, &channel, "stream")
            .await?;
        let capped = UploadPolicy::Allowed { max_file_bytes: 4 };
        start_workspace_upload(&account, workspace, &channel, stream, capped).unwrap();
        assert_eq!(
            finish(&account, workspace, &channel, stream).await,
            UploadState::Failed(UploadFailure::TooLarge(None))
        );
        fixture.stage("stream", "count", "0").await?;
        start(&account, workspace, &channel, stream);
        assert!(
            matches!(finish(&account, workspace, &channel, stream).await, UploadState::Ready(file) if file.size == 5)
        );
    }
    let (closed, source) = fixture
        .select(&account, workspace, &channel, "close")
        .await?;
    start(&account, workspace, &channel, closed);
    fixture.stage("close", "seen", "OK").await?;
    close_workspace(&account, workspace).unwrap();
    fixture.stage("close", "closed", "OK").await?;
    let next = open_workspace(&account).unwrap();
    fixture.stage("close", "release", "OK").await?;
    assert_eq!(
        list_workspace(&account, workspace, &channel),
        Err(DraftFilesError::UnknownWorkspace)
    );
    assert!(list_workspace(&account, next, &channel).unwrap().is_empty());
    until(
        || source.upgrade().is_none().then_some(()),
        "closing the workspace",
    )
    .await;

    let (retired, source) = fixture.select(&account, next, &channel, "retire").await?;
    start(&account, next, &channel, retired);
    fixture.stage("retire", "seen", "OK").await?;
    accounts.forget(&installation, &member).await?;
    fixture.stage("retire", "closed", "OK").await?;
    let peer = Arc::new(
        signed(
            client,
            &accounts,
            &installation,
            &"b".repeat(26),
            "draft-peer",
        )
        .await?,
    );
    let ws = open_workspace(&peer).unwrap();
    fixture.stage("retire", "release", "OK").await?;
    assert_eq!(
        list_workspace(&account, next, &channel),
        Err(DraftFilesError::AccountUnavailable)
    );
    assert!(list_workspace(&peer, ws, &channel).unwrap().is_empty());
    assert_eq!(workspace_upload_denial(&peer, ws, &channel).unwrap(), None);
    until(
        || source.upgrade().is_none().then_some(()),
        "ending the login",
    )
    .await;
    let peer_draft = draft("p", None);
    let (file, _) = fixture.select(&peer, ws, &peer_draft, "peer").await?;
    start(&peer, ws, &peer_draft, file);
    assert!(
        matches!(finish(&peer, ws, &peer_draft, file).await, UploadState::Ready(file) if file.id == "p".repeat(26))
    );
    let (pending, source) = fixture.select(&peer, ws, &peer_draft, "disconnect").await?;
    start(&peer, ws, &peer_draft, pending);
    fixture.stage("disconnect", "seen", "OK").await?;
    Resource::close(peer.clone());
    fixture.stage("disconnect", "closed", "OK").await?;
    fixture.stage("disconnect", "release", "OK").await?;
    assert_eq!(
        list_workspace(&peer, ws, &peer_draft),
        Err(DraftFilesError::AccountUnavailable)
    );
    until(
        || source.upgrade().is_none().then_some(()),
        "closing the connection",
    )
    .await;
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
#[tokio::test]
#[ignore = "requires a disposable Mattermost installation"]
async fn mattermost() -> Check {
    #[derive(serde::Deserialize)]
    struct Installation {
        base: String,
        member_id: String,
        token: String,
        allowed: String,
        denied: String,
        max_size: u64,
    }
    let data = std::fs::read(std::env::var_os("UMMKA_DRAFT_MM_DATA").ok_or("fixture data")?)?;
    let server: Installation = serde_json::from_slice(&data)?;
    let url = reqwest::Url::parse(&server.base)?;
    assert_eq!(url.scheme(), "https");
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    let pem = std::fs::read(std::env::var_os("UMMKA_HTTP_TEST_CA").ok_or("fixture CA")?)?;
    let ca = reqwest::Certificate::from_pem(&pem)?;
    let client = NativeHttp::from_builder(reqwest::Client::builder().tls_certs_merge([ca]))?;
    let directory = tempfile::tempdir()?;
    let fixture = Fixture {
        client: &client,
        base: &server.base,
        directory: directory.path(),
    };
    let accounts = using(Arc::new(TestVault::default()));
    let account = signed(
        &client,
        &accounts,
        &server.base,
        &server.member_id,
        &server.token,
    )
    .await?;
    let workspace = open_workspace(&account).unwrap();
    let policy = UploadPolicy::Allowed {
        max_file_bytes: server.max_size,
    };
    let allowed = DraftAddress::new(server.allowed, None).unwrap();
    let (file, _) = fixture
        .select(&account, workspace, &allowed, "native")
        .await?;
    start_workspace_upload(&account, workspace, &allowed, file, policy).unwrap();
    let result = finish(&account, workspace, &allowed, file).await;
    let UploadState::Ready(receipt) = result else {
        panic!("ordinary member upload failed: {result:?}");
    };
    assert!(is_mattermost_id(&receipt.id));
    assert_eq!((receipt.name.as_str(), receipt.size), ("native.txt", 6));
    let mut download = Request::new(
        Method::GET,
        format!("{}/api/v4/files/{}", server.base, receipt.id).parse()?,
    );
    download.headers_mut().insert(
        reqwest::header::AUTHORIZATION,
        format!("Bearer {}", server.token).parse()?,
    );
    let response = client.send(download).await?;
    assert_eq!(response.status(), 200);
    assert_eq!(response.bytes().await?, b"native".as_slice());
    let denied = DraftAddress::new(server.denied, None).unwrap();
    let (file, _) = fixture
        .select(&account, workspace, &denied, "restricted")
        .await?;
    start_workspace_upload(&account, workspace, &denied, file, policy).unwrap();
    assert!(matches!(
        finish(&account, workspace, &denied, file).await,
        UploadState::Failed(UploadFailure::PermissionDenied(Some(response)))
            if response.status_code == 403
                && response.id.as_deref() == Some("api.context.permissions.app_error")
    ));
    Ok(())
}
