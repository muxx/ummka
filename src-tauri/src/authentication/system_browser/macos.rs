use super::{PRESENTATION, PresentationError};
use crate::authentication::browser::CALLBACK;
use block2::RcBlock;
use objc2::{
    AnyThread, DefinedClass, MainThreadOnly, define_class, msg_send, rc::Retained,
    runtime::ProtocolObject,
};
use objc2_app_kit::NSWindow;
use objc2_authentication_services::{
    ASWebAuthenticationPresentationContextProviding, ASWebAuthenticationSession,
    ASWebAuthenticationSessionErrorCode, ASWebAuthenticationSessionErrorDomain,
};
use objc2_foundation::{MainThreadMarker, NSError, NSObject, NSObjectProtocol, NSString, NSURL};
use std::cell::RefCell;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::sync::oneshot;
use uuid::Uuid;

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Retained<NSWindow>]
    struct UmmkaBrowserAnchor;
    unsafe impl NSObjectProtocol for UmmkaBrowserAnchor {}
    unsafe impl ASWebAuthenticationPresentationContextProviding for UmmkaBrowserAnchor {
        #[unsafe(method_id(presentationAnchorForWebAuthenticationSession:))]
        fn presentation_anchor(&self, _session: &ASWebAuthenticationSession) -> Retained<NSWindow> {
            self.ivars().clone()
        }
    }
);

struct Presented {
    id: Uuid,
    session: Retained<ASWebAuthenticationSession>,
    // AuthenticationServices holds its presentation provider weakly.
    _anchor: Retained<UmmkaBrowserAnchor>,
}

thread_local! {
    static DISPLAYED: RefCell<Option<Presented>> = const { RefCell::new(None) };
}

fn remove(id: Uuid) -> Option<Presented> {
    DISPLAYED.with(|slot| slot.borrow_mut().take_if(|displayed| displayed.id == id))
}

pub(super) fn dismiss<R: Runtime>(app: &AppHandle<R>, id: Uuid) {
    let _ = app.run_on_main_thread(move || {
        if let Some(displayed) = remove(id) {
            // This retained session was created on the main thread for this exact request.
            unsafe { displayed.session.cancel() };
        }
    });
}

pub(super) async fn open<R: Runtime>(
    window: &WebviewWindow<R>,
    id: Uuid,
    url: reqwest::Url,
) -> Result<(), PresentationError> {
    let (send, started) = oneshot::channel();
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = send.send(start(&owner, id, &url));
        })
        .map_err(|_| PresentationError::Unavailable)?;
    started.await.map_err(|_| PresentationError::Unavailable)?
}

fn start<R: Runtime>(
    window: &WebviewWindow<R>,
    id: Uuid,
    url: &reqwest::Url,
) -> Result<(), PresentationError> {
    if PRESENTATION.waiting() != Some(id) {
        return Err(PresentationError::Cancelled);
    }
    if DISPLAYED.with(|slot| slot.borrow().is_some()) {
        return Err(PresentationError::Busy);
    }
    let prepared = prepare(window, id, url)?;
    let session = prepared.session.clone();
    DISPLAYED.with(|slot| slot.replace(Some(prepared)));
    if unsafe { session.start() } {
        Ok(())
    } else {
        remove(id);
        Err(PresentationError::Unavailable)
    }
}

fn prepare<R: Runtime>(
    window: &WebviewWindow<R>,
    id: Uuid,
    url: &reqwest::Url,
) -> Result<Presented, PresentationError> {
    let marker = MainThreadMarker::new().ok_or(PresentationError::Unavailable)?;
    let raw = window
        .ns_window()
        .map_err(|_| PresentationError::Unavailable)?;
    // Tauri returns the live NSWindow for this WebviewWindow. Keep it for the system dialog.
    let retained = unsafe { Retained::retain(raw.cast::<NSWindow>()) }
        .ok_or(PresentationError::Unavailable)?;
    let allocated = marker.alloc::<UmmkaBrowserAnchor>().set_ivars(retained);
    let anchor: Retained<UmmkaBrowserAnchor> = unsafe { msg_send![super(allocated), init] };
    let destination = NSURL::URLWithString(&NSString::from_str(url.as_str()))
        .ok_or(PresentationError::Unavailable)?;
    let scheme = NSString::from_str(
        CALLBACK
            .split_once(':')
            .expect("fixed absolute callback URL")
            .0,
    );
    let app = window.app_handle().clone();
    let completion = RcBlock::new(move |url: *mut NSURL, error: *mut NSError| {
        // Apple owns these optional objects until the completion block returns.
        let (url, error) = unsafe { (url.as_ref(), error.as_ref()) };
        let result = if let Some(error) = error {
            if &*error.domain() == unsafe { ASWebAuthenticationSessionErrorDomain }
                && error.code() == ASWebAuthenticationSessionErrorCode::CanceledLogin.0
            {
                Err(PresentationError::Cancelled)
            } else {
                Err(PresentationError::Unavailable)
            }
        } else {
            url.and_then(|url| url.absoluteString())
                .map(|url| url.to_string())
                .ok_or(PresentationError::Unavailable)
        };
        // Release the main-thread-only objects before a new presentation can be accepted.
        if app
            .run_on_main_thread(move || {
                remove(id);
                PRESENTATION.deliver(id, result);
            })
            .is_err()
        {
            PRESENTATION.deliver(id, Err(PresentationError::Unavailable));
        }
    });
    // This initializer is available on macOS 10.15, including releases predating the newer callback object.
    #[allow(deprecated)]
    let session = unsafe {
        ASWebAuthenticationSession::initWithURL_callbackURLScheme_completionHandler(
            ASWebAuthenticationSession::alloc(),
            &destination,
            Some(&scheme),
            RcBlock::as_ptr(&completion),
        )
    };
    // The retained anchor implements the required protocol on the main thread.
    unsafe { session.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*anchor))) };
    Ok(Presented {
        id,
        session,
        _anchor: anchor,
    })
}

#[cfg(feature = "webview-check")]
pub(super) fn check_anchor<R: Runtime>(
    window: &WebviewWindow<R>,
    url: &reqwest::Url,
) -> Result<(), PresentationError> {
    let marker = MainThreadMarker::new().ok_or(PresentationError::Unavailable)?;
    let presented = prepare(window, Uuid::new_v4(), url)?;
    // Read back the actual protocol provider from AuthenticationServices and ask it for its UI window.
    let provider = unsafe { presented.session.presentationContextProvider(marker) }
        .ok_or(PresentationError::Unavailable)?;
    let anchor =
        unsafe { provider.presentationAnchorForWebAuthenticationSession(&presented.session) };
    let actual = window
        .ns_window()
        .map_err(|_| PresentationError::Unavailable)?;
    if Retained::as_ptr(&anchor).cast_mut().cast() != actual {
        return Err(PresentationError::Unavailable);
    }
    Ok(())
}
