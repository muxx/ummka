//! Wire models for native-only Mattermost REST operations.
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretInput(String);

impl SecretInput {
    pub fn new(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for SecretInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[redacted]")
    }
}

mod login_request {
    include!("../../vendor/mattermost-native/login_request.rs");
}

pub use login_request::LoginRequest;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn uses_the_server_wire_format_and_redacts_both_secrets() {
        for id in ["fixture-user", "fixture@example.test"] {
            let mut request = LoginRequest {
                login_id: Some(id.into()),
                password: Some(SecretInput::new("synthetic-password".into())),
                ..Default::default()
            };
            assert!(
                serde_json::to_value(&request).unwrap()
                    == json!({"login_id":id,"password":"synthetic-password"})
            );
            request.token = Some(SecretInput::new("synthetic-otp".into()));
            request.ldap_only = Some("true".into());
            assert!(
                serde_json::to_value(&request).unwrap()
                    == json!({"login_id":id,"password":"synthetic-password","token":"synthetic-otp","ldap_only":"true"})
            );
            let diagnostic = format!("{request:?}");
            assert!(!diagnostic.contains("synthetic-"));
            assert_eq!(diagnostic.matches("[redacted]").count(), 2);
        }
    }
}
