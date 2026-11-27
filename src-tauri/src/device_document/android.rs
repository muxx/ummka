use super::*;
use rustix::fs::{OFlags, fcntl_getfl, fcntl_setfl};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    os::unix::fs::FileTypeExt,
    task::ready,
};
use tokio::io::{AsyncReadExt, unix::AsyncFd};

mod bridge;
#[cfg(feature = "native-http-check")]
pub(super) mod checks;

pub(super) struct Location(String);

impl SelectedDocument {
    /// Receives a temporary document URI directly from the platform picker.
    pub async fn from_picker_uri(uri: String) -> Result<Arc<Self>, DocumentUnavailable> {
        let info = bridge::describe(&uri).await?;
        if !info.valid() {
            return Err(DocumentUnavailable);
        }
        Ok(Arc::new(Self {
            info,
            location: Location(uri),
        }))
    }
    pub async fn open(self: &Arc<Self>) -> Result<OpenedDocument, DocumentUnavailable> {
        let (file, offset, declared, asset) = bridge::open(&self.location.0).await?;
        let source = self.clone();
        tokio::task::spawn_blocking(move || {
            let (reader, length) = open_region(file, offset, declared, source.info.size)
                .map_err(|_| DocumentUnavailable)?;
            let reader = CheckedReader {
                reader,
                asset,
                remaining: length,
                finished: false,
            };
            Ok(OpenedDocument {
                reader: Box::pin(reader),
                length,
                _source: source,
            })
        })
        .await
        .map_err(|_| DocumentUnavailable)?
    }
}

type Reader = Pin<Box<dyn AsyncRead + Send>>;
fn open_region(
    mut file: File,
    offset: u64,
    declared: Option<u64>,
    reported: Option<u64>,
) -> io::Result<(Reader, Option<u64>)> {
    let meta = file.metadata()?;
    let kind = meta.file_type();
    let reader: Reader = if kind.is_file() {
        if offset != 0 {
            file.seek(SeekFrom::Start(offset))?;
        }
        Box::pin(tokio::fs::File::from_std(file))
    } else if (kind.is_fifo() || kind.is_socket()) && offset == 0 {
        // A cloud provider may pause indefinitely. Dropping an AsyncFd cancels a pending read
        // without leaving a blocking thread behind.
        fcntl_setfl(&file, fcntl_getfl(&file)? | OFlags::NONBLOCK)?;
        // This private File owns the fd. No method can close or swap it while registered.
        let fd = unsafe { AsyncFd::register(file) }.map_err(io::Error::from)?;
        Box::pin(Pipe(fd))
    } else {
        return Err(io::ErrorKind::InvalidInput.into());
    };
    if reported
        .zip(declared)
        .is_some_and(|(size, extent)| size != extent)
    {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let length = declared.or(reported);
    let reader: Reader = match declared {
        Some(n) => Box::pin(reader.take(n)),
        None => reader,
    };
    Ok((reader, length))
}

struct Pipe(AsyncFd<File>);
impl AsyncRead for Pipe {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        loop {
            let mut ready = ready!(self.0.poll_read_ready(cx))?;
            match ready.try_io(|fd| fd.get_ref().read(buf.initialize_unfilled())) {
                Ok(result) => {
                    buf.advance(result?);
                    return Poll::Ready(Ok(()));
                }
                Err(_) => continue,
            }
        }
    }
}

struct CheckedReader {
    reader: Reader,
    asset: bridge::Asset,
    remaining: Option<u64>,
    finished: bool,
}
impl AsyncRead for CheckedReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.finished || buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        let before = buf.filled().len();
        ready!(self.reader.as_mut().poll_read(cx, buf))?;
        let read = (buf.filled().len() - before) as u64;
        if let Some(remaining) = self.remaining.as_mut() {
            if read > *remaining {
                buf.set_filled(before);
                return Poll::Ready(Err(io::ErrorKind::InvalidData.into()));
            }
            *remaining -= read;
            if read == 0 && *remaining != 0 {
                return Poll::Ready(Err(io::ErrorKind::UnexpectedEof.into()));
            }
        }
        if read == 0 {
            self.asset.check()?;
            self.finished = true;
        }
        Poll::Ready(Ok(()))
    }
}
