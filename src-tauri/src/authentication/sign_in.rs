use super::{AuthError, NativeAuthentication};
use crate::models::LoginRequest;
use crate::rest::TransportError;
use crate::sessions::{Account, AccountSessions};
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Revocation {
    Confirmed,
    Unconfirmed,
}

#[derive(Debug, Eq, PartialEq)]
pub enum SignInError {
    Authentication(AuthError),
    NotSaved {
        cause: TransportError,
        revocation: Revocation,
    },
    Interrupted,
}

impl fmt::Display for SignInError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Authentication(error) => error.fmt(f),
            Self::NotSaved { cause, revocation } => {
                write!(f, "{cause}. ")?;
                f.write_str(match revocation {
                    Revocation::Confirmed => "The server confirmed revocation of the new session",
                    Revocation::Unconfirmed => {
                        "Revocation of the new session could not be confirmed"
                    }
                })
            }
            Self::Interrupted => f.write_str("Native sign-in was interrupted"),
        }
    }
}

impl std::error::Error for SignInError {}

impl NativeAuthentication {
    /// The native form receives the account only after durable storage and local activation.
    pub async fn sign_in(
        &self,
        sessions: &AccountSessions,
        input: LoginRequest,
    ) -> Result<Account, SignInError> {
        let client = self.clone();
        let sessions = sessions.clone();
        // Closing the form must not strand a grant between issuance, saving and revocation.
        tauri::async_runtime::spawn(async move {
            let grant = client
                .login(&input)
                .await
                .map_err(SignInError::Authentication)?;
            drop(input);
            if let Err(cause) = sessions
                .activate_verified(grant.account.clone(), grant.token.clone())
                .await
            {
                let revocation = match client.logout(&grant).await {
                    Ok(()) => Revocation::Confirmed,
                    Err(_) => Revocation::Unconfirmed,
                };
                return Err(SignInError::NotSaved { cause, revocation });
            }
            Ok(grant.account)
        })
        .await
        .map_err(|_| SignInError::Interrupted)?
    }
}
