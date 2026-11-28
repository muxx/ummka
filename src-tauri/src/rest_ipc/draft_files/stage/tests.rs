use super::{
    super::{Entry, UploadFailure, close, list, open, remove},
    *,
};
use crate::{
    device_document::DocumentInfo,
    history::{AccountHistory, DraftSave},
    rest::{RestConnection, file_upload::UploadedFile},
    rest_ipc::close_rest_connection,
    sessions::fixture::{TestVault, using},
};
use std::{future::ready, sync::mpsc, time::Duration};
use tauri::{App, WebviewWindow, WebviewWindowBuilder, test::MockRuntime};
use tokio::sync::oneshot;

const SERVER: &str = "https://stage-draft.example.test";
const USER: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const CHANNEL: &str = "cccccccccccccccccccccccccc";

struct Fixture {
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    sessions: AccountSessions,
    rid: ResourceId,
    workspace: ResourceId,
    draft: DraftAddress,
    _directory: tempfile::TempDir,
}

async fn connection(
    view: &Webview<MockRuntime>,
    sessions: &AccountSessions,
    server: &str,
    user: &str,
) -> ResourceId {
    let transport = RestConnection::new(server)
        .unwrap()
        .for_account(sessions, user)
        .await
        .unwrap();
    view.resources_table().add(Session::new(transport))
}

impl Fixture {
    async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let sessions = using(Arc::new(TestVault::with_history(
            directory.path().to_owned(),
        )));
        sessions
            .activate(SERVER, USER, "stage-fixture")
            .await
            .unwrap();
        let app = tauri::test::mock_app();
        app.manage(sessions.clone());
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let view = window.as_ref();
        let rid = connection(view, &sessions, SERVER, USER).await;
        let workspace = open(view, rid).unwrap();
        Self {
            _app: app,
            window,
            sessions,
            rid,
            workspace,
            draft: DraftAddress::new(CHANNEL.into(), None).unwrap(),
            _directory: directory,
        }
    }

    fn view(&self) -> &Webview<MockRuntime> {
        self.window.as_ref()
    }

    fn owner(&self) -> Arc<Session> {
        account(self.view(), self.rid).unwrap()
    }

    async fn reopen(&self) -> AccountHistory {
        let session = self.sessions.restore(SERVER, USER).await.unwrap();
        self.sessions.open_history(session).await.unwrap()
    }

    fn append(&self, state: EntryState) -> Uuid {
        let id = Uuid::new_v4();
        with_workspace(&self.owner(), self.workspace, |owner| {
            owner
                .state
                .lock()
                .unwrap()
                .drafts
                .entry(self.draft.clone())
                .or_default()
                .push(Entry {
                    id,
                    document: DocumentInfo {
                        name: "selected.txt".into(),
                        size: Some(5),
                        mime_type: None,
                    },
                    state,
                });
        })
        .unwrap();
        id
    }

    fn append_ready(&self, letter: &str) -> Uuid {
        self.append(EntryState::Ready(UploadedFile {
            id: letter.repeat(26),
            name: "accepted.txt".into(),
            size: 9,
        }))
    }

    fn file_ids(&self) -> Vec<Uuid> {
        list(self.view(), self.rid, self.workspace, &self.draft)
            .unwrap()
            .into_iter()
            .map(|file| file.id)
            .collect()
    }

    async fn stage(
        &self,
        revision: Option<String>,
        files: Vec<Uuid>,
    ) -> Result<StagePost, DraftFilesError> {
        stage_post(
            self.view(),
            self.rid,
            self.workspace,
            self.draft.clone(),
            revision,
            files,
        )
        .await
    }
}

#[tokio::test]
async fn stale_order_failed_upload_and_refused_queue_transaction_keep_the_draft() {
    let fixture = Fixture::new().await;
    let mut history = fixture.reopen().await;
    let first = fixture.append_ready("a");
    let failed = fixture.append(EntryState::Failed(None, UploadFailure::PolicyUnavailable));
    let DraftSave::Saved(old) = history
        .save_draft(CHANNEL, None, None, "first version")
        .unwrap()
    else {
        panic!("original draft");
    };
    assert_eq!(
        fixture.stage(old.revision.clone(), vec![first]).await,
        Err(DraftFilesError::FilesChanged)
    );
    assert_eq!(
        fixture
            .stage(old.revision.clone(), vec![first, failed])
            .await,
        Err(DraftFilesError::FilesNotReady)
    );
    remove(
        fixture.view(),
        fixture.rid,
        fixture.workspace,
        &fixture.draft,
        failed,
    )
    .unwrap();
    let second = fixture.append_ready("b");
    let DraftSave::Saved(current) = history
        .save_draft(
            CHANNEL,
            None,
            old.revision.as_deref(),
            "edited in another window",
        )
        .unwrap()
    else {
        panic!("replacement draft");
    };
    assert_eq!(
        fixture
            .stage(current.revision.clone(), vec![second, first])
            .await,
        Err(DraftFilesError::FilesChanged)
    );
    let files = vec![first, second];
    let Ok(StagePost::NotStaged { draft: observed }) =
        fixture.stage(old.revision, files.clone()).await
    else {
        panic!("a stale text revision must return the current draft");
    };
    assert_eq!(observed, current);
    history
        .write(|db| {
            db.execute_batch(
                "CREATE TRIGGER reject_file BEFORE INSERT ON pending_post_file
        WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT, 'fixture rejects second file'); END;",
            )
        })
        .unwrap();
    assert_eq!(
        fixture.stage(current.revision.clone(), files.clone()).await,
        Err(DraftFilesError::HistoryUnavailable)
    );
    assert_eq!(fixture.file_ids(), files);
    assert_eq!(history.read_draft(CHANNEL, None).unwrap(), current);
    assert!(
        history
            .pending_posts(CHANNEL, None, 0, 10)
            .unwrap()
            .is_empty()
    );
    history
        .write(|db| db.execute_batch("DROP TRIGGER reject_file"))
        .unwrap();
    let Ok(StagePost::Created { post, .. }) = fixture.stage(current.revision, files.clone()).await
    else {
        panic!("same file set should succeed once SQLite accepts the write");
    };
    assert_eq!(post.message, "edited in another window");
    let next = fixture.append_ready("n");
    assert_eq!(
        fixture.stage(None, files).await,
        Err(DraftFilesError::FilesChanged)
    );
    assert_eq!(fixture.file_ids(), [next]);
    assert_eq!(history.pending_posts(CHANNEL, None, 0, 10).unwrap(), [post]);
}

#[tokio::test]
async fn another_workspace_account_window_or_departed_channel_cannot_consume_a_file() {
    let fixture = Fixture::new().await;
    let view = fixture.view();
    let file = fixture.append_ready("f");
    let other_workspace = open(view, fixture.rid).unwrap();
    assert_eq!(
        stage_post(
            view,
            fixture.rid,
            other_workspace,
            fixture.draft.clone(),
            None,
            vec![file]
        )
        .await,
        Err(DraftFilesError::FilesChanged)
    );
    let sibling = crate::ipc_test::sibling(view);
    assert_eq!(
        stage_post(
            &sibling,
            fixture.rid,
            fixture.workspace,
            fixture.draft.clone(),
            None,
            vec![file]
        )
        .await,
        Err(DraftFilesError::AccountUnavailable)
    );
    let peer = "https://another-stage.example.test";
    fixture
        .sessions
        .activate(peer, &"b".repeat(26), "peer")
        .await
        .unwrap();
    let rid = connection(view, &fixture.sessions, peer, &"b".repeat(26)).await;
    assert_eq!(
        stage_post(
            view,
            rid,
            fixture.workspace,
            fixture.draft.clone(),
            None,
            vec![file]
        )
        .await,
        Err(DraftFilesError::UnknownWorkspace)
    );
    let mut history = fixture.reopen().await;
    let team = "t".repeat(26);
    history
        .write(|db| {
            db.execute(
                "INSERT INTO channel_membership_change(channel_id,team_id) VALUES (?1,?2)",
                [CHANNEL, &team],
            )
        })
        .unwrap();
    let update = history
        .begin_channel_membership_update(&team, CHANNEL)
        .unwrap()
        .unwrap();
    assert!(
        history
            .finish_channel_membership_update(&update, false)
            .unwrap()
    );
    let draft = history.read_draft(CHANNEL, None).unwrap();
    assert_eq!(
        fixture.stage(draft.revision.clone(), vec![file]).await,
        Ok(StagePost::NotStaged { draft })
    );
    assert_eq!(fixture.file_ids(), [file]);
    assert!(
        history
            .pending_posts(CHANNEL, None, 0, 10)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn remove_or_close_before_the_queued_history_work_leaves_no_row() {
    for closes in [false, true] {
        let fixture = Fixture::new().await;
        let file = fixture.append_ready("f");
        let (entered, waiting) = oneshot::channel();
        let (release, blocked) = mpsc::channel();
        let owner = fixture.owner();
        let sessions = fixture.sessions.clone();
        let holder = tokio::spawn(async move {
            owner
                .with_history(&sessions, move |_| {
                    entered.send(()).unwrap();
                    blocked.recv_timeout(Duration::from_secs(8)).unwrap();
                    Ok(())
                })
                .await
                .unwrap();
        });
        waiting.await.unwrap();
        let stage = fixture.stage(None, vec![file]);
        tokio::pin!(stage);
        tokio::select! {
            biased;
            result = &mut stage => panic!("stage escaped its queue: {result:?}"),
            _ = ready(()) => {}
        }
        let error = if closes {
            close(fixture.view(), fixture.rid, fixture.workspace).unwrap();
            DraftFilesError::UnknownWorkspace
        } else {
            remove(
                fixture.view(),
                fixture.rid,
                fixture.workspace,
                &fixture.draft,
                file,
            )
            .unwrap();
            DraftFilesError::FilesChanged
        };
        release.send(()).unwrap();
        holder.await.unwrap();
        assert_eq!(stage.await, Err(error));
        assert!(
            fixture
                .reopen()
                .await
                .pending_posts(CHANNEL, None, 0, 10)
                .unwrap()
                .is_empty()
        );
    }
}

async fn hold_writer(fixture: &Fixture) -> (mpsc::Sender<()>, tokio::task::JoinHandle<()>) {
    let mut writer = fixture.reopen().await;
    let (entered, waiting) = oneshot::channel();
    let (release, blocked) = mpsc::channel();
    let writer = tokio::task::spawn_blocking(move || {
        writer
            .write(|_| {
                entered.send(()).unwrap();
                blocked.recv_timeout(Duration::from_secs(8)).unwrap();
                Ok(())
            })
            .unwrap();
    });
    waiting.await.unwrap();
    (release, writer)
}

async fn await_held_workspace(workspace: &super::super::Workspace) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while workspace.state.try_lock().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("stage never entered the workspace critical section");
}

#[tokio::test]
async fn sqlite_contention_leaves_other_resources_available_and_late_close_keeps_the_row() {
    let fixture = Fixture::new().await;
    let file = fixture.append_ready("f");
    let owner = fixture.owner();
    owner
        .with_history(&fixture.sessions, |_| Ok(()))
        .await
        .unwrap();
    let workspace = with_workspace(&owner, fixture.workspace, Arc::clone).unwrap();
    let (release, writer) = hold_writer(&fixture).await;
    let stage = fixture.stage(None, vec![file]);
    tokio::pin!(stage);
    tokio::select! {
        biased;
        result = &mut stage => panic!("stage replied before acknowledgement was paused: {result:?}"),
        _ = ready(()) => {}
    }
    // The writer prevents the stage from committing. Wait until the stage owns
    // the workspace lock before asking the same connection for another resource.
    await_held_workspace(&workspace).await;
    let independent = tokio::task::spawn_blocking(move || {
        let pending = owner.prepare().unwrap();
        owner.cancel(pending).unwrap();
    });
    let independent = tokio::time::timeout(Duration::from_secs(2), independent).await;
    release.send(()).unwrap();
    writer.await.unwrap();
    independent
        .expect("account resource was blocked behind SQLite")
        .unwrap();
    // Keep the first responder unpolled while a new reader observes the commit.
    let mut observer = fixture.reopen().await;
    let post = tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if let Some(post) = observer.pending_posts(CHANNEL, None, 0, 10).unwrap().pop() {
                break post;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(fixture.file_ids().is_empty());
    close_rest_connection(fixture.view().clone(), fixture.rid).unwrap();
    assert_eq!(stage.await, Err(DraftFilesError::Cancelled));
    let mut reopened = fixture.reopen().await;
    assert_eq!(
        reopened.pending_posts(CHANNEL, None, 0, 10).unwrap(),
        [post]
    );
}

#[tokio::test]
async fn closing_the_connection_before_the_sqlite_writer_is_available_does_not_queue() {
    let fixture = Fixture::new().await;
    let file = fixture.append_ready("f");
    let owner = fixture.owner();
    let DraftSave::Saved(draft) = owner
        .with_history(&fixture.sessions, |history| {
            history.save_draft(CHANNEL, None, None, "Keep this text")
        })
        .await
        .unwrap()
    else {
        panic!("text draft");
    };
    let workspace = with_workspace(&owner, fixture.workspace, Arc::clone).unwrap();
    let (release, writer) = hold_writer(&fixture).await;
    let stage = fixture.stage(draft.revision.clone(), vec![file]);
    tokio::pin!(stage);
    tokio::select! {
        biased;
        result = &mut stage => panic!("stage escaped the writer barrier: {result:?}"),
        _ = ready(()) => {}
    }
    await_held_workspace(&workspace).await;
    close_rest_connection(fixture.view().clone(), fixture.rid).unwrap();
    assert_eq!(stage.await, Err(DraftFilesError::Cancelled));
    release.send(()).unwrap();
    writer.await.unwrap();
    // The caller already received cancellation. Join the detached native work
    // by taking the lock it has held since before the writer was released.
    tokio::task::spawn_blocking(move || drop(workspace.state.lock().unwrap()))
        .await
        .unwrap();
    let mut reopened = fixture.reopen().await;
    assert!(
        reopened
            .pending_posts(CHANNEL, None, 0, 10)
            .unwrap()
            .is_empty()
    );
    assert_eq!(reopened.read_draft(CHANNEL, None).unwrap(), draft);
}
