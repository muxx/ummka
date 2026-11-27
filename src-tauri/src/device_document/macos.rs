use super::*;
use objc2::rc::Retained;
use objc2_foundation::NSURL;
use rustix::fs::{Mode, OFlags, open};
use std::{fs::File, os::unix::fs::MetadataExt, path::Path};

struct ScopedUrl {
    url: Retained<NSURL>,
    started: bool,
}
impl Drop for ScopedUrl {
    fn drop(&mut self) {
        if self.started {
            // Balance precisely the successful start on this retained picker URL.
            unsafe { self.url.stopAccessingSecurityScopedResource() };
        }
    }
}

pub(super) struct Location {
    scope: ScopedUrl,
    device: u64,
    inode: u64,
}
fn read_file(path: &Path) -> Result<(File, std::fs::Metadata), DocumentUnavailable> {
    // A picker result may have been replaced by a FIFO since selection.
    let fd = open(
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    )
    .map_err(|_| DocumentUnavailable)?;
    let file = File::from(fd);
    let meta = file.metadata().map_err(|_| DocumentUnavailable)?;
    if !meta.is_file() {
        return Err(DocumentUnavailable);
    }
    Ok((file, meta))
}

impl SelectedDocument {
    pub async fn from_panel_url(url: Retained<NSURL>) -> Result<Arc<Self>, DocumentUnavailable> {
        tokio::task::spawn_blocking(move || {
            if !url.isFileURL() {
                return Err(DocumentUnavailable);
            }
            // Ordinary local URLs can already be accessible without a security scope.
            let started = unsafe { url.startAccessingSecurityScopedResource() };
            let scope = ScopedUrl { url, started };
            let path = scope.url.to_file_path().ok_or(DocumentUnavailable)?;
            let (_, meta) = read_file(&path)?;
            let info = DocumentInfo {
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or(DocumentUnavailable)?
                    .into(),
                size: Some(meta.len()),
                mime_type: None,
            };
            if !info.valid() {
                return Err(DocumentUnavailable);
            }
            Ok(Arc::new(Self {
                info,
                location: Location {
                    scope,
                    device: meta.dev(),
                    inode: meta.ino(),
                },
            }))
        })
        .await
        .map_err(|_| DocumentUnavailable)?
    }

    pub async fn open(self: &Arc<Self>) -> Result<OpenedDocument, DocumentUnavailable> {
        let source = self.clone();
        tokio::task::spawn_blocking(move || {
            let path = source
                .location
                .scope
                .url
                .to_file_path()
                .ok_or(DocumentUnavailable)?;
            let (file, meta) = read_file(&path)?;
            if source.location.device != meta.dev()
                || source.location.inode != meta.ino()
                || source.info.size != Some(meta.len())
            {
                return Err(DocumentUnavailable);
            }
            Ok(OpenedDocument {
                reader: Box::pin(tokio::fs::File::from_std(file)),
                length: Some(meta.len()),
                _source: source,
            })
        })
        .await
        .map_err(|_| DocumentUnavailable)?
    }
}
