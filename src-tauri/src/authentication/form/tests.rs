use super::*;
use crate::authentication::PublicError;
use crate::rest::TransportError;

fn server_error(id: &str, status_code: u16) -> SignInError {
    SignInError::Authentication(AuthError::Server(PublicError {
        status_code,
        id: Some(id.to_owned()),
        message: None,
        request_id: None,
    }))
}

#[test]
fn accepts_six_ascii_digits_with_spaces_and_hyphens() {
    assert_eq!(
        one_time_code(" 01-2 34-5 ").unwrap(),
        SecretInput::new("012345".into())
    );
    for bad in [
        "",
        "12345",
        "1234567",
        "12x3456",
        "１２３４５６",
        "12\n3456",
    ] {
        assert_eq!(one_time_code(bad), Err(PasswordFormError::InvalidCode));
    }
}

#[test]
fn challenge_ids_mean_request_on_the_first_step_and_rejection_on_the_second() {
    let mut state = State::Submitting;
    for id in [
        "mfa.validate_token.authenticate.app_error",
        "ent.mfa.validate_token.authenticate.app_error",
    ] {
        assert_eq!(
            state.complete(LoginRequest::new(), false, Err(server_error(id, 401))),
            Ok(PasswordResult::SecondFactorRequired)
        );
        assert_eq!(state.stage(), PasswordStage::SecondFactor);
        assert_eq!(
            state.complete(LoginRequest::new(), true, Err(server_error(id, 401))),
            Err(PasswordFormError::InvalidCode)
        );
        assert_eq!(state.stage(), PasswordStage::SecondFactor);
    }
    assert_eq!(
        state.complete(
            LoginRequest::new(),
            true,
            Err(server_error(
                "api.user.check_user_mfa.bad_code.app_error",
                401
            ))
        ),
        Err(PasswordFormError::InvalidCode)
    );
    assert_eq!(state.stage(), PasswordStage::SecondFactor);
}

#[test]
fn transient_errors_preserve_the_second_step_and_rejected_credentials_release_it() {
    for (error, step) in [
        (
            server_error("unavailable", 503),
            PasswordStage::SecondFactor,
        ),
        (
            server_error("rate-limited", 429),
            PasswordStage::SecondFactor,
        ),
        (
            SignInError::Authentication(AuthError::Transport(TransportError::Network)),
            PasswordStage::SecondFactor,
        ),
        (
            server_error("api.user.login.invalid_credentials_email_username", 401),
            PasswordStage::Password,
        ),
        (SignInError::Interrupted, PasswordStage::Password),
    ] {
        let mut state = State::Submitting;
        assert!(matches!(
            state.complete(LoginRequest::new(), true, Err(error)),
            Err(PasswordFormError::SignIn(_))
        ));
        assert_eq!(state.stage(), step);
    }
}
