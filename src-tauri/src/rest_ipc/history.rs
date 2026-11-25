use super::exchange::{ExchangeError, Session};
use crate::{
    history::{
        AccountHistory, ChannelHistoryPage, ChannelPostLoad, HistoryError, PageWrite, WindowSlice,
    },
    rest::TransportError,
    sessions::AccountSessions,
};
use serde::Deserialize;
use std::sync::{Arc, Weak};
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};
use tokio::sync::{Mutex, OnceCell};

// Mattermost v10.10.1 server/channels/web/params.go bounds one response at 200 posts.
pub(super) const MAX_POSTS: u32 = 200;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ChannelWindowQuery {
    Latest {
        channel_id: String,
        collapsed_threads: bool,
        limit: u16,
    },
    Around {
        channel_id: String,
        collapsed_threads: bool,
        post_id: String,
        newer: u16,
        older: u16,
    },
}

impl ChannelWindowQuery {
    fn read(self, history: &mut AccountHistory) -> Result<Option<WindowSlice>, HistoryError> {
        match self {
            Self::Latest {
                channel_id,
                collapsed_threads,
                limit,
            } if u32::from(limit) <= MAX_POSTS => {
                history.read_latest_window(&channel_id, collapsed_threads, limit)
            }
            Self::Around {
                channel_id,
                collapsed_threads,
                post_id,
                newer,
                older,
            } if 1 + u32::from(newer) + u32::from(older) <= MAX_POSTS => {
                history.read_window_around(&channel_id, collapsed_threads, &post_id, newer, older)
            }
            _ => Err(HistoryError::InvalidPost),
        }
    }
}

impl From<HistoryError> for ExchangeError {
    fn from(cause: HistoryError) -> Self {
        match cause {
            HistoryError::InvalidPost
            | HistoryError::InvalidInstallation
            | HistoryError::InvalidDraft => ExchangeError::InvalidHistoryRequest,
            HistoryError::InvalidDirectory => ExchangeError::InvalidDirectory,
            HistoryError::StaleOwner | HistoryError::OwnerConflict => {
                ExchangeError::Transport(TransportError::SessionUnavailable)
            }
            HistoryError::Storage | HistoryError::UnsupportedSchema => {
                ExchangeError::Transport(TransportError::HistoryStorageUnavailable)
            }
        }
    }
}

pub(super) type LocalHistory = OnceCell<Weak<Mutex<AccountHistory>>>;

impl Session {
    fn cache_history(&self, view: AccountHistory) -> Weak<Mutex<AccountHistory>> {
        let history = Arc::new(Mutex::new(view));
        let cached = Arc::downgrade(&history);
        let lifetime = self.lifetime.clone();
        // Either closing this WebView resource or retiring its parent login releases
        // the idle SQLite connection, even if the renderer keeps the old resource ID.
        tauri::async_runtime::spawn(async move {
            lifetime.cancelled().await;
            drop(history);
        });
        cached
    }

    pub(super) async fn with_history<T: Send + 'static>(
        &self,
        sessions: &AccountSessions,
        operation: impl FnOnce(&mut AccountHistory) -> Result<T, HistoryError> + Send + 'static,
    ) -> Result<T, ExchangeError> {
        let work = async {
            let history = self
                .history
                .get_or_try_init(|| async {
                    self.http
                        .open_history(sessions)
                        .await
                        .map(|view| self.cache_history(view))
                        .map_err(ExchangeError::Transport)
                })
                .await?
                .upgrade()
                .ok_or(ExchangeError::Cancelled)?;
            // Queue on this connection before assigning a blocking worker to SQLite.
            let mut view = history.lock_owned().await;
            let lifetime = self.lifetime.clone();
            tauri::async_runtime::spawn_blocking(move || {
                if lifetime.is_cancelled() {
                    return Err(ExchangeError::Cancelled);
                }
                operation(&mut view).map_err(ExchangeError::from)
            })
            .await
            .map_err(|_| ExchangeError::Transport(TransportError::HistoryStorageUnavailable))?
        };
        tokio::select! {
            biased;
            _=self.lifetime.cancelled()=>Err(ExchangeError::Cancelled),
            answer=work=>self.finish_if_open(answer),
        }
    }

    async fn read_channel_window(
        &self,
        sessions: &AccountSessions,
        query: ChannelWindowQuery,
    ) -> Result<Option<WindowSlice>, ExchangeError> {
        self.with_history(sessions, move |view| query.read(view))
            .await
    }

    async fn begin_history_load(
        &self,
        sessions: &AccountSessions,
        channel_id: String,
    ) -> Result<ResourceId, ExchangeError> {
        let load = self
            .with_history(sessions, move |view| view.begin_channel_load(&channel_id))
            .await?;
        Ok(self.open_resources()?.add(PendingLoad(load)))
    }

    fn take_history_load(&self, load: ResourceId) -> Result<ChannelPostLoad, ExchangeError> {
        self.take_pending::<PendingLoad>(load, ExchangeError::UnknownHistoryLoad)
            .map(|entry| entry.0)
    }

    async fn store_history_page(
        &self,
        sessions: &AccountSessions,
        load: ResourceId,
        page: serde_json::Value,
    ) -> Result<PageWrite, ExchangeError> {
        let ticket = self.take_history_load(load)?;
        self.with_history(sessions, move |view| {
            // Consume the ticket even when the renderer submits an invalid page.
            let page: ChannelHistoryPage =
                serde_json::from_value(page).map_err(|_| HistoryError::InvalidPost)?;
            view.apply_channel_window(ticket, &page)
        })
        .await
    }
}

struct PendingLoad(ChannelPostLoad);
impl Resource for PendingLoad {}

#[tauri::command]
pub(crate) async fn begin_channel_history_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    channel_id: String,
) -> Result<ResourceId, ExchangeError> {
    super::session(&webview, rid)?
        .begin_history_load(&webview.state::<AccountSessions>(), channel_id)
        .await
}

#[tauri::command]
pub(crate) async fn store_channel_history_page<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
    page: serde_json::Value,
) -> Result<PageWrite, ExchangeError> {
    super::session(&webview, rid)?
        .store_history_page(&webview.state::<AccountSessions>(), load, page)
        .await
}

#[tauri::command]
pub(crate) fn cancel_channel_history_load<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    load: ResourceId,
) -> Result<(), ExchangeError> {
    super::session(&webview, rid)?
        .take_history_load(load)
        .map(drop)
}

#[tauri::command]
pub(crate) async fn read_channel_window<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    query: ChannelWindowQuery,
) -> Result<Option<WindowSlice>, ExchangeError> {
    super::session(&webview, rid)?
        .read_channel_window(&webview.state::<AccountSessions>(), query)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rest::RestConnection;
    use crate::sessions::Account;
    use std::time::Duration;
    use tauri::Resource;

    #[tokio::test]
    async fn retiring_an_account_cancels_a_queued_write_without_restoring_its_post() {
        let base = "https://local.example.test/replace";
        let user = "a".repeat(26);
        let channel = "c".repeat(26);
        let id = "r".repeat(26);
        let root = tempfile::tempdir().unwrap();
        let sessions = AccountSessions::default();
        sessions.activate(base, &user, "old").await.unwrap();
        let account = Account::new(base, &user).unwrap();
        let session = Session::new(
            RestConnection::new(base)
                .unwrap()
                .for_account(&sessions, &user)
                .await
                .unwrap(),
        );
        let opened = session.cache_history(AccountHistory::open(root.path(), &account).unwrap());
        assert!(session.history.set(opened.clone()).is_ok());

        let load = session
            .begin_history_load(&sessions, channel.clone())
            .await
            .unwrap();
        let exchange = session.prepare().unwrap();
        assert_eq!(session.cancel(load), Err(ExchangeError::UnknownExchange));
        assert!(matches!(
            session.take_history_load(exchange),
            Err(ExchangeError::UnknownHistoryLoad)
        ));
        session.cancel(exchange).unwrap();

        let data = serde_json::json!({
            "channelId": channel, "source": {"kind":"latest"}, "collapsedThreads": false, "order":[id],
            "changes":[{"kind":"save", "id":id, "channelId":channel, "userId":user, "rootId":null,
                       "createAt":100,"updateAt":100,"editAt":0,"type":"","message":"old","messageSource":null,
                       "hashtags":"","isPinned":false}]
        });
        let mut view = opened.upgrade().unwrap().lock_owned().await;
        let write = session.store_history_page(&sessions, load, data);
        tokio::pin!(write);
        tokio::select! { biased; ready = &mut write => panic!("write was not pending: {ready:?}"), _=std::future::ready(())=>{} }
        sessions.activate(base, &user, "new").await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(5), write)
                .await
                .unwrap(),
            Err(ExchangeError::Cancelled)
        );
        assert!(view.read_post(&id).unwrap().is_none());
    }

    #[tokio::test]
    async fn a_queued_read_loses_access_on_close_or_replacement() {
        let base = "https://local.example.test/offline";
        let user = "a".repeat(26);
        for replace in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let sessions = AccountSessions::default();
            sessions.activate(base, &user, "first").await.unwrap();
            let http = RestConnection::new(base)
                .unwrap()
                .for_account(&sessions, &user)
                .await
                .unwrap();
            let session = Arc::new(Session::new(http));
            let account = Account::new(base, &user).unwrap();
            let opened =
                session.cache_history(AccountHistory::open(root.path(), &account).unwrap());
            assert!(session.history.set(opened.clone()).is_ok());
            let guard = opened.upgrade().unwrap().lock_owned().await;
            let query = ChannelWindowQuery::Latest {
                channel_id: "c".repeat(26),
                collapsed_threads: false,
                limit: 1,
            };
            let read = session.read_channel_window(&sessions, query);
            tokio::pin!(read);
            // Poll once with the real database held; the read is pending on its connection.
            tokio::select! { biased; ready = &mut read => panic!("read was not pending: {ready:?}"), _=std::future::ready(())=>{} }
            if replace {
                sessions.activate(base, &user, "second").await.unwrap();
            } else {
                session.clone().close();
            }
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(5), read)
                    .await
                    .unwrap(),
                Err(ExchangeError::Cancelled)
            );
            drop(guard);
            // The renderer may keep the retired resource ID indefinitely.
            tokio::time::timeout(Duration::from_secs(1), async {
                while opened.strong_count() > 0 {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("retired resource kept its SQLite connection");
        }
    }
}
