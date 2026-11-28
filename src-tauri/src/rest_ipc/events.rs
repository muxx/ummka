use super::{Session, exchange::ExchangeError, session};
use crate::realtime::{
    ChannelPostChange, Continuity, EventActivity, EventAvailability, EventConnectionError,
    EventRoute, EventSettings,
};
use serde::Serialize;
use tauri::{ResourceId, Runtime, Webview, ipc::Channel};
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Notice {
    Posts { changes: Vec<ChannelPostChange> },
    Reconcile,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum EventPacket {
    Notice {
        receipt: String,
        generation: u32,
        notice: Notice,
    },
    Cancel {
        receipt: String,
    },
}

struct Listener {
    id: String,
    foreground: bool,
    generation: u32,
    switch: EventActivity,
    receiver: Option<EventAvailability>,
    pending: Option<Receipt>,
}

struct Receipt {
    id: String,
    valid: bool,
    ack: oneshot::Sender<()>,
}

impl Listener {
    fn set_running(&mut self, active: bool) {
        self.switch.set_active(active);
        if !active && let Some(receipt) = &mut self.pending {
            receipt.valid = false;
        }
    }
}

#[derive(Default)]
pub(super) struct WindowEvents {
    allowed: bool,
    listener: Option<Listener>,
}

impl WindowEvents {
    pub(super) fn set_route(&mut self, route: &EventRoute) {
        self.allowed = matches!(route, EventRoute::SameInstallation);
        if let Some(listener) = &mut self.listener {
            listener.set_running(self.allowed && listener.foreground);
        }
    }

    fn current(&mut self, id: &str) -> Option<&mut Listener> {
        self.listener.as_mut().filter(|listener| listener.id == id)
    }
}

#[tauri::command]
pub(crate) fn prepare_channel_observer<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    active: bool,
) -> Result<String, ExchangeError> {
    let owner = session(&webview, rid)?;
    owner
        .http
        .account_user_id()
        .ok_or(ExchangeError::InvalidExchangeState)?;
    let _open = owner.open_resources()?;
    let mut window = owner.events.lock().unwrap();
    if window.listener.is_some() {
        return Err(ExchangeError::InvalidExchangeState);
    }
    let id = Uuid::new_v4().to_string();
    let (switch, receiver) = EventActivity::new(window.allowed && active);
    window.listener = Some(Listener {
        id: id.clone(),
        foreground: active,
        generation: 0,
        switch,
        receiver: Some(receiver),
        pending: None,
    });
    Ok(id)
}

#[tauri::command]
pub(crate) fn set_channel_observer_active<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    observer: String,
    active: bool,
    generation: u32,
) -> Result<(), ExchangeError> {
    let owner = session(&webview, rid)?;
    let mut state = owner.events.lock().unwrap();
    let allowed = state.allowed;
    let listener = state.current(&observer).ok_or(ExchangeError::Cancelled)?;
    if generation > listener.generation {
        listener.generation = generation;
        listener.foreground = active;
        listener.set_running(allowed && active);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn close_channel_observer<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    observer: String,
) -> Result<(), ExchangeError> {
    let owner = session(&webview, rid)?;
    let mut state = owner.events.lock().unwrap();
    if state.current(&observer).is_some() {
        state.listener = None;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn acknowledge_channel_notice<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    observer: String,
    receipt: String,
) -> Result<bool, ExchangeError> {
    let owner = session(&webview, rid)?;
    let mut state = owner.events.lock().unwrap();
    if !state.allowed {
        return Ok(false);
    }
    let Some(listener) = state.current(&observer) else {
        return Ok(false);
    };
    if !listener.foreground
        || !listener
            .pending
            .as_ref()
            .is_some_and(|pending| pending.valid && pending.id == receipt)
    {
        return Ok(false);
    }
    Ok(listener
        .pending
        .take()
        .expect("matched receipt")
        .ack
        .send(())
        .is_ok())
}

struct Delivery<'a> {
    owner: &'a Session,
    observer: &'a str,
    events: &'a Channel<EventPacket>,
    receipt: String,
    done: bool,
}

impl Drop for Delivery<'_> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        if let Some(listener) = self.owner.events.lock().unwrap().current(self.observer)
            && listener
                .pending
                .as_ref()
                .is_some_and(|pending| pending.id == self.receipt)
        {
            listener.pending = None;
        }
        let _ = self.events.send(EventPacket::Cancel {
            receipt: std::mem::take(&mut self.receipt),
        });
    }
}

async fn deliver(
    owner: &Session,
    observer: &str,
    events: &Channel<EventPacket>,
    notice: Notice,
) -> Result<(), EventConnectionError> {
    let receipt = Uuid::new_v4().to_string();
    let (sent, completed) = oneshot::channel();
    let generation = {
        let mut state = owner.events.lock().unwrap();
        let listener = state
            .current(observer)
            .ok_or(EventConnectionError::ConsumerUnavailable)?;
        listener.pending = Some(Receipt {
            id: receipt.clone(),
            valid: true,
            ack: sent,
        });
        listener.generation
    };
    let mut pending = Delivery {
        owner,
        observer,
        events,
        receipt: receipt.clone(),
        done: false,
    };
    events
        .send(EventPacket::Notice {
            receipt,
            generation,
            notice,
        })
        .map_err(|_| EventConnectionError::ConsumerUnavailable)?;
    completed
        .await
        .map_err(|_| EventConnectionError::ConsumerUnavailable)?;
    pending.done = true;
    Ok(())
}

enum Address {
    Post(ChannelPostChange),
    Reconcile,
}

struct WindowSink {
    user: String,
    owner: std::sync::Arc<Session>,
    observer: String,
    events: Channel<EventPacket>,
}

impl crate::realtime::EventConsumer for WindowSink {
    type Item = Address;
    const LIMIT: usize = 32;
    fn project(
        &self,
        event: crate::realtime::ServerEvent,
        continuity: Continuity,
    ) -> Result<Option<Address>, EventConnectionError> {
        if continuity == Continuity::ReplacedConnection {
            return Ok(Some(Address::Reconcile));
        }
        event
            .channel_post_change(&self.user)
            .map(|change| change.map(Address::Post))
    }
    async fn apply(&mut self, addresses: Vec<Address>) -> Result<(), EventConnectionError> {
        let mut changes = Vec::new();
        for address in addresses {
            match address {
                Address::Post(post) => changes.push(post),
                Address::Reconcile => {
                    if !changes.is_empty() {
                        deliver(
                            &self.owner,
                            &self.observer,
                            &self.events,
                            Notice::Posts {
                                changes: std::mem::take(&mut changes),
                            },
                        )
                        .await?;
                    }
                    deliver(&self.owner, &self.observer, &self.events, Notice::Reconcile).await?;
                }
            }
        }
        if !changes.is_empty() {
            deliver(
                &self.owner,
                &self.observer,
                &self.events,
                Notice::Posts { changes },
            )
            .await?;
        }
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn run_channel_observer<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    observer: String,
    events: Channel<EventPacket>,
) -> Result<(), ExchangeError> {
    let owner = session(&webview, rid)?;
    let active = owner
        .events
        .lock()
        .unwrap()
        .current(&observer)
        .and_then(|listener| listener.receiver.take())
        .ok_or(ExchangeError::InvalidExchangeState)?;
    let user = owner
        .http
        .account_user_id()
        .ok_or(ExchangeError::InvalidExchangeState)?;
    let sink = WindowSink {
        user: user.to_owned(),
        owner: owner.clone(),
        observer,
        events,
    };
    let run = async {
        let mut applied = owner.event_position.lock().await;
        crate::realtime::run_groups(
            &owner.http,
            &mut applied,
            active,
            EventSettings::default(),
            sink,
            tokio::time::sleep,
        )
        .await
    };
    tokio::select! {
        biased;
        () = owner.lifetime.cancelled() => Err(ExchangeError::Cancelled),
        result = run => result.map_err(|error| match error {
            EventConnectionError::SessionUnavailable => ExchangeError::Cancelled,
            _ => ExchangeError::EventStreamFailed,
        }),
    }
}
