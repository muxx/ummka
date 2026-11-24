use super::NativeAuthentication;
use crate::credentials::Removal;
use crate::rest::TransportError;
use crate::sessions::{AccountSession, AccountSessions};
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SignOut {
    SignedOut,
    Unconfirmed,
    Superseded,
    ServerConfirmedLocalRemovalFailed { cause: TransportError },
}

impl NativeAuthentication {
    pub(crate) async fn sign_out_account(
        self,
        sessions: AccountSessions,
        session: Arc<AccountSession>,
    ) -> Result<SignOut, TransportError> {
        // Once requested, a confirmed logout must finish the local step even if the caller leaves.
        tauri::async_runtime::spawn(async move {
            let auth = &self;
            let account = session.account();
            let confirmation = session
                .dispatch(
                    |token| async move { Ok(auth.logout_session(account, &token).await.is_ok()) },
                )
                .await;
            match confirmation {
                Err(TransportError::SessionUnavailable) => return Ok(SignOut::Superseded),
                Err(error) => return Err(error),
                Ok(false) => return Ok(SignOut::Unconfirmed),
                Ok(true) => {}
            }
            Ok(match sessions.forget_current(session).await {
                Ok(Removal::Removed) => SignOut::SignedOut,
                Ok(Removal::Superseded) => SignOut::Superseded,
                Err(cause) => SignOut::ServerConfirmedLocalRemovalFailed { cause },
            })
        })
        .await
        .map_err(|_| TransportError::OperationInterrupted)?
    }
}
