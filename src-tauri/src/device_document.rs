//! Native picker results can reopen just the selected document. The system locator stays native.
use std::{
    fmt, io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, ReadBuf};

pub mod picker;

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
use android::Location;
#[cfg(all(target_os = "android", feature = "native-http-check"))]
pub(crate) use android::checks::verify as check_android;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos::Location;

#[derive(Clone, Debug, Eq, PartialEq, serde::Deserialize)]
pub struct DocumentInfo {
    pub name: String,
    pub size: Option<u64>,
    pub mime_type: Option<String>,
}
impl DocumentInfo {
    fn valid(&self) -> bool {
        crate::rest::file_upload::file_name(&self.name)
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct DocumentUnavailable;
impl fmt::Display for DocumentUnavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("The selected document is no longer available")
    }
}
impl std::error::Error for DocumentUnavailable {}

pub struct SelectedDocument {
    info: DocumentInfo,
    location: Location,
}
impl SelectedDocument {
    pub fn info(&self) -> &DocumentInfo {
        &self.info
    }
}

pub struct OpenedDocument {
    reader: Pin<Box<dyn AsyncRead + Send>>,
    pub length: Option<u64>,
    // The OS grant must outlive the reader, including when its draft removes the selection.
    _source: Arc<SelectedDocument>,
}
impl AsyncRead for OpenedDocument {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.reader.as_mut().poll_read(cx, buf)
    }
}

#[cfg(all(target_os = "macos", test))]
mod tests;
