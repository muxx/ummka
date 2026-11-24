use super::exchange::{ExchangeError, Session};
use crate::{
    history::{AccountHistory, HistoryError, WindowSlice},
    rest::TransportError,
    sessions::AccountSessions,
};
use serde::Deserialize;
use std::sync::{Arc, Weak};
use tauri::{Manager, ResourceId, Runtime, Webview};
use tokio::sync::{Mutex, OnceCell};

// Mattermost v10.10.1 server/channels/web/params.go bounds one response at 200 posts.
const MAX_POSTS: u32 = 200;

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
    fn read(self, history: &mut AccountHistory) -> Result<Option<WindowSlice>, ExchangeError> {
        let output = match self {
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
            _ => return Err(ExchangeError::InvalidHistoryRequest),
        };
        output.map_err(|cause| match cause {
            HistoryError::InvalidPost | HistoryError::InvalidInstallation => {
                ExchangeError::InvalidHistoryRequest
            }
            HistoryError::StaleOwner | HistoryError::OwnerConflict => {
                ExchangeError::Transport(TransportError::SessionUnavailable)
            }
            HistoryError::Storage | HistoryError::UnsupportedSchema => {
                ExchangeError::Transport(TransportError::HistoryStorageUnavailable)
            }
        })
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

    async fn read_channel_window(
        &self,
        sessions: &AccountSessions,
        query: ChannelWindowQuery,
    ) -> Result<Option<WindowSlice>, ExchangeError> {
        let read = async {
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
            tauri::async_runtime::spawn_blocking(move || query.read(&mut view))
                .await
                .map_err(|_| ExchangeError::Transport(TransportError::HistoryStorageUnavailable))?
        };
        tokio::select! {
            biased;
            _=self.lifetime.cancelled()=>Err(ExchangeError::Cancelled),
            answer=read=>self.finish_if_open(answer),
        }
    }
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
