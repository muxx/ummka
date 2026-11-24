use super::response::{self, ResponseBody, ResponseHead};
use crate::rest::{RestConnection, TransportError};
use reqwest::{
    Method, Request, Url,
    header::{HeaderName, HeaderValue},
};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{Resource, ResourceId, ResourceTable};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExchangeError {
    UnknownConnection,
    UnknownExchange,
    InvalidHistoryRequest,
    InvalidExchangeState,
    Cancelled,
    #[serde(untagged)]
    Transport(TransportError),
}

enum Phase {
    Prepared,
    Body(ResponseBody),
}

struct Exchange {
    // A guard held across the await represents the sending or reading stage.
    phase: AsyncMutex<Phase>,
    cancel: CancellationToken,
}
impl Resource for Exchange {}

pub(super) struct Session {
    pub(super) http: RestConnection,
    exchanges: Mutex<ResourceTable>,
    pub(super) history: super::history::LocalHistory,
    pub(super) lifetime: CancellationToken,
}

impl Resource for Session {
    fn close(self: Arc<Self>) {
        let mut active = self.exchanges.lock().unwrap();
        self.lifetime.cancel();
        *active = ResourceTable::default();
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.lifetime.cancel();
    }
}

impl Session {
    pub(super) fn new(http: RestConnection) -> Self {
        let lifetime = http.lifetime();
        Self {
            http,
            exchanges: Mutex::default(),
            history: super::history::LocalHistory::new(),
            lifetime,
        }
    }

    pub(super) fn prepare(&self) -> Result<ResourceId, ExchangeError> {
        let mut active = self.exchanges.lock().unwrap();
        if self.lifetime.is_cancelled() {
            return Err(ExchangeError::UnknownConnection);
        }
        Ok(active.add(Exchange {
            phase: AsyncMutex::new(Phase::Prepared),
            cancel: self.lifetime.child_token(),
        }))
    }

    pub(super) fn finish_if_open<T>(
        &self,
        value: Result<T, ExchangeError>,
    ) -> Result<T, ExchangeError> {
        let _guard = self.exchanges.lock().unwrap();
        if self.lifetime.is_cancelled() {
            return Err(ExchangeError::Cancelled);
        }
        value
    }

    fn exchange(&self, id: ResourceId) -> Result<Arc<Exchange>, ExchangeError> {
        let active = self.exchanges.lock().unwrap();
        if self.lifetime.is_cancelled() {
            return Err(ExchangeError::UnknownConnection);
        }
        active
            .get::<Exchange>(id)
            .map_err(|_| ExchangeError::UnknownExchange)
    }

    pub(super) fn cancel(&self, id: ResourceId) -> Result<(), ExchangeError> {
        let mut active = self.exchanges.lock().unwrap();
        if self.lifetime.is_cancelled() {
            return Err(ExchangeError::UnknownConnection);
        }
        let exchange = active
            .take::<Exchange>(id)
            .map_err(|_| ExchangeError::UnknownExchange)?;
        exchange.cancel.cancel();
        Ok(())
    }

    // Commit completion under the same lock used by explicit cancellation and owner cleanup.
    fn complete<T>(
        &self,
        id: ResourceId,
        exchange: &Arc<Exchange>,
        result: Result<T, TransportError>,
        terminal: bool,
    ) -> Result<T, ExchangeError> {
        let mut active = self.exchanges.lock().unwrap();
        if self.lifetime.is_cancelled()
            || !active
                .get::<Exchange>(id)
                .is_ok_and(|entry| Arc::ptr_eq(&entry, exchange))
        {
            return Err(ExchangeError::Cancelled);
        }
        if terminal || result.is_err() {
            // Another caller may already hold an Arc while waiting to acquire this exchange.
            active
                .take::<Exchange>(id)
                .expect("registered exchange")
                .cancel
                .cancel();
        }
        result.map_err(ExchangeError::Transport)
    }

    pub(super) async fn send(
        &self,
        id: ResourceId,
        method: &str,
        url: &str,
        headers: Vec<(String, String)>,
        body: Option<String>,
    ) -> Result<ResponseHead, ExchangeError> {
        let exchange = self.exchange(id)?;
        let mut phase = exchange
            .phase
            .try_lock()
            .map_err(|_| ExchangeError::InvalidExchangeState)?;
        if !matches!(*phase, Phase::Prepared) {
            return Err(ExchangeError::InvalidExchangeState);
        }
        let request = async {
            self.http
                .exchange(request(method, url, headers, body)?, response::split)
                .await
        };
        let result = tokio::select! {
            biased;
            _ = exchange.cancel.cancelled() => return Err(ExchangeError::Cancelled),
            result = request => result,
        };
        let terminal = result.as_ref().is_ok_and(|(head, _)| !head.has_body);
        let (head, body) = self.complete(id, &exchange, result, terminal)?;
        if head.has_body {
            *phase = Phase::Body(body);
        }
        Ok(head)
    }

    pub(super) async fn read(&self, id: ResourceId) -> Result<Vec<u8>, ExchangeError> {
        let exchange = self.exchange(id)?;
        let mut phase = exchange
            .phase
            .try_lock()
            .map_err(|_| ExchangeError::InvalidExchangeState)?;
        let Phase::Body(response) = &mut *phase else {
            return Err(ExchangeError::InvalidExchangeState);
        };
        let result = tokio::select! {
            biased;
            _ = exchange.cancel.cancelled() => return Err(ExchangeError::Cancelled),
            result = response.next() => result,
        };
        let eof = result.as_ref().is_ok_and(Vec::is_empty);
        self.complete(id, &exchange, result, eof)
    }
}

fn request(
    method: &str,
    url: &str,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<Request, TransportError> {
    let method =
        Method::from_bytes(method.as_bytes()).map_err(|_| TransportError::OperationDenied)?;
    let url = Url::parse(url).map_err(|_| TransportError::OutsideInstallation)?;
    let mut request = Request::new(method, url);
    for (name, value) in headers {
        let name =
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| TransportError::OperationDenied)?;
        let bytes = value
            .chars()
            .map(|c| u8::try_from(u32::from(c)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| TransportError::OperationDenied)?;
        let value = HeaderValue::from_bytes(&bytes).map_err(|_| TransportError::OperationDenied)?;
        request.headers_mut().append(name, value);
    }
    *request.body_mut() = body.map(Into::into);
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;

    #[test]
    fn request_body_preserves_absence_empty_text_and_original_utf8_bytes() {
        for text in [None, Some(""), Some("\u{feff}  [\"Привет 👋\"]\n")] {
            let req = request(
                "POST",
                "https://fixture.invalid/api/v4/users/ids",
                vec![],
                text.map(str::to_owned),
            )
            .unwrap();
            assert_eq!(
                req.body().and_then(reqwest::Body::as_bytes),
                text.map(str::as_bytes)
            );
        }
    }

    #[tokio::test]
    async fn cleanup_wins_over_a_late_completion() {
        let session = Arc::new(Session::new(
            RestConnection::new("https://chat.example.test").unwrap(),
        ));
        let id = session.prepare().unwrap();
        let held = session.exchange(id).unwrap();
        let (ready, started) = oneshot::channel();
        let (release, wait) = oneshot::channel();
        let owner = session.clone();
        let late = tokio::spawn(async move {
            ready.send(()).unwrap();
            wait.await.unwrap();
            owner.complete(id, &held, Ok(()), false)
        });
        started.await.unwrap();
        session.clone().close();
        release.send(()).unwrap();
        assert_eq!(late.await.unwrap(), Err(ExchangeError::Cancelled));
        assert_eq!(session.prepare(), Err(ExchangeError::UnknownConnection));
        assert_eq!(session.exchanges.lock().unwrap().names().count(), 0);
    }

    #[test]
    fn a_terminal_result_invalidates_handles_already_looked_up_by_another_caller() {
        let owner = Session::new(RestConnection::new("https://chat.example.test").unwrap());
        let id = owner.prepare().unwrap();
        let held = owner.exchange(id).unwrap();
        owner.complete(id, &held, Ok(()), true).unwrap();
        assert!(held.cancel.is_cancelled());
        assert_eq!(owner.cancel(id), Err(ExchangeError::UnknownExchange));
    }
}
