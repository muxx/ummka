use super::{AuthError, NativeAuthentication, SignInError};
use crate::models::{LoginRequest, SecretInput};
use crate::sessions::{Account, AccountSessions};
use std::fmt;
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PasswordStage {
    Password,
    SecondFactor,
    Submitting,
    SignedIn,
    Cancelled,
}

#[derive(Eq, PartialEq)]
pub enum PasswordResult {
    SecondFactorRequired,
    SignedIn(Account),
}

impl fmt::Debug for PasswordResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::SecondFactorRequired => "SecondFactorRequired",
            Self::SignedIn(_) => "SignedIn",
        })
    }
}

#[derive(Debug, Eq, PartialEq)]
pub enum PasswordFormError {
    Unavailable,
    MissingLogin,
    MissingPassword,
    InvalidCode,
    SignIn(SignInError),
}

impl fmt::Display for PasswordFormError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => f.write_str("This sign-in action is unavailable"),
            Self::MissingLogin => f.write_str("Enter a login"),
            Self::MissingPassword => f.write_str("Enter a password"),
            Self::InvalidCode => f.write_str("Enter a valid six-digit code"),
            Self::SignIn(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for PasswordFormError {}

enum State {
    Password,
    SecondFactor(LoginRequest),
    Submitting,
    SignedIn,
    Cancelled,
}

impl State {
    fn stage(&self) -> PasswordStage {
        match self {
            Self::Password => PasswordStage::Password,
            Self::SecondFactor(_) => PasswordStage::SecondFactor,
            Self::Submitting => PasswordStage::Submitting,
            Self::SignedIn => PasswordStage::SignedIn,
            Self::Cancelled => PasswordStage::Cancelled,
        }
    }

    fn complete(
        &mut self,
        credentials: LoginRequest,
        sent_code: bool,
        result: Result<Account, SignInError>,
    ) -> Result<PasswordResult, PasswordFormError> {
        match result {
            Ok(account) => {
                *self = Self::SignedIn;
                Ok(PasswordResult::SignedIn(account))
            }
            Err(SignInError::Authentication(AuthError::Server(ref error)))
                if matches!(
                    error.id.as_deref(),
                    Some(
                        "mfa.validate_token.authenticate.app_error"
                            | "ent.mfa.validate_token.authenticate.app_error"
                    )
                ) =>
            {
                *self = Self::SecondFactor(credentials);
                if sent_code {
                    Err(PasswordFormError::InvalidCode)
                } else {
                    Ok(PasswordResult::SecondFactorRequired)
                }
            }
            Err(SignInError::Authentication(AuthError::Server(ref error)))
                if sent_code
                    && error.id.as_deref()
                        == Some("api.user.check_user_mfa.bad_code.app_error") =>
            {
                *self = Self::SecondFactor(credentials);
                Err(PasswordFormError::InvalidCode)
            }
            Err(error) => {
                let retryable = matches!(
                    &error,
                    SignInError::Authentication(AuthError::Transport(_))
                ) || matches!(&error, SignInError::Authentication(AuthError::Server(e)) if e.status_code == 429 || e.status_code >= 500);
                *self = if sent_code && retryable {
                    Self::SecondFactor(credentials)
                } else {
                    Self::Password
                };
                Err(PasswordFormError::SignIn(error))
            }
        }
    }
}

fn one_time_code(text: &str) -> Result<SecretInput, PasswordFormError> {
    let mut digits = String::with_capacity(6);
    for byte in text.bytes() {
        match byte {
            b'0'..=b'9' if digits.len() < 6 => digits.push(char::from(byte)),
            b' ' | b'-' => {}
            _ => return Err(PasswordFormError::InvalidCode),
        }
    }
    if digits.len() != 6 {
        return Err(PasswordFormError::InvalidCode);
    }
    Ok(SecretInput::new(digits))
}

/// Native credentials never cross the WebView boundary. Each form owns one in-flight attempt.
pub struct PasswordForm {
    state: Arc<Mutex<State>>,
    client: NativeAuthentication,
    sessions: AccountSessions,
}

impl PasswordForm {
    pub fn new(client: NativeAuthentication, sessions: AccountSessions) -> Self {
        Self {
            state: Arc::new(Mutex::new(State::Password)),
            client,
            sessions,
        }
    }

    pub fn stage(&self) -> PasswordStage {
        self.state.lock().expect("sign-in state poisoned").stage()
    }

    pub fn back(&self) -> bool {
        let mut state = self.state.lock().expect("sign-in state poisoned");
        if !matches!(*state, State::SecondFactor(_)) {
            return false;
        }
        *state = State::Password;
        true
    }

    pub fn cancel(&self) -> bool {
        let mut state = self.state.lock().expect("sign-in state poisoned");
        if !matches!(*state, State::Password | State::SecondFactor(_)) {
            return false;
        }
        *state = State::Cancelled;
        true
    }

    pub async fn submit_password(
        &self,
        login: &str,
        password: String,
        ldap_only: bool,
    ) -> Result<PasswordResult, PasswordFormError> {
        let login = login.trim();
        {
            let mut state = self.state.lock().expect("sign-in state poisoned");
            if !matches!(*state, State::Password) {
                return Err(PasswordFormError::Unavailable);
            }
            if login.is_empty() {
                return Err(PasswordFormError::MissingLogin);
            }
            if password.is_empty() {
                return Err(PasswordFormError::MissingPassword);
            }
            *state = State::Submitting;
        }
        let mut credentials = LoginRequest::new();
        credentials.login_id = Some(login.to_owned());
        credentials.password = Some(SecretInput::new(password));
        if ldap_only {
            credentials.ldap_only = Some("true".to_owned());
        }
        self.exchange(credentials, None).await
    }

    pub async fn submit_code(&self, text: &str) -> Result<PasswordResult, PasswordFormError> {
        let (credentials, code) = {
            let mut state = self.state.lock().expect("sign-in state poisoned");
            if !matches!(*state, State::SecondFactor(_)) {
                return Err(PasswordFormError::Unavailable);
            }
            let code = one_time_code(text)?;
            let State::SecondFactor(credentials) =
                std::mem::replace(&mut *state, State::Submitting)
            else {
                unreachable!()
            };
            (credentials, code)
        };
        self.exchange(credentials, Some(code)).await
    }

    async fn exchange(
        &self,
        credentials: LoginRequest,
        code: Option<SecretInput>,
    ) -> Result<PasswordResult, PasswordFormError> {
        let state = Arc::clone(&self.state);
        let client = self.client.clone();
        let sessions = self.sessions.clone();
        // Disposing the observer detaches this task. Complete both persistence and the stage transition.
        tauri::async_runtime::spawn(async move {
            let sent_code = code.is_some();
            let mut request = credentials.clone();
            request.token = code;
            let result = client.sign_in(&sessions, request).await;
            state
                .lock()
                .expect("sign-in state poisoned")
                .complete(credentials, sent_code, result)
        })
        .await
        .map_err(|_| PasswordFormError::SignIn(SignInError::Interrupted))?
    }
}

#[cfg(test)]
mod tests;
