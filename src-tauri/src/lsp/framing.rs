//! `Content-Length` framing shared by the DAP and LSP clients.
//!
//! Framing errors are typed so each client keeps its own policy: DAP maps
//! them to its historical strings (and treats EOF in a header as a clean
//! end), LSP fails the session because the stream position is lost. The
//! body size cap is a parameter, never a shared constant.
use std::io::{BufRead, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::Arc;

#[derive(Clone, Copy, Debug)]
pub(crate) struct FrameLimits {
    pub max_body: usize,
    /// `None` keeps DAP's unbounded header lines exactly as before.
    pub max_header_line: Option<usize>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum FrameError {
    Io(String),
    /// EOF after at least one header byte, before the blank separator line.
    EofInHeaders,
    MissingLength,
    InvalidLength(String),
    TooLarge { length: usize, max: usize },
    HeaderTooLong,
    /// EOF or I/O failure while reading a body: never a complete message.
    Body(String),
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) | Self::Body(error) | Self::InvalidLength(error) => f.write_str(error),
            Self::EofInHeaders => f.write_str("stream ended inside message headers"),
            Self::MissingLength => f.write_str("message omitted Content-Length"),
            Self::TooLarge { length, max } => write!(f, "message of {length} bytes exceeds the {max}-byte limit"),
            Self::HeaderTooLong => f.write_str("message header line is too long"),
        }
    }
}

/// Read one frame. `Ok(None)` is a clean EOF before any header byte.
/// Other headers (for example `Content-Type`) are tolerated and ignored;
/// a repeated `Content-Length` keeps the last value, as DAP always did.
pub(crate) fn read_frame(reader: &mut impl BufRead, limits: FrameLimits) -> Result<Option<Vec<u8>>, FrameError> {
    let mut length = None;
    let mut started = false;
    loop {
        let mut line = String::new();
        let read = match limits.max_header_line {
            None => reader.read_line(&mut line),
            Some(max) => {
                let read = std::io::Read::take(&mut *reader, max as u64 + 1).read_line(&mut line);
                if matches!(read, Ok(n) if n > max) { return Err(FrameError::HeaderTooLong); }
                read
            }
        }.map_err(|e| FrameError::Io(e.to_string()))?;
        if read == 0 { return if started { Err(FrameError::EofInHeaders) } else { Ok(None) }; }
        started = true;
        if line == "\r\n" || line == "\n" { break; }
        if let Some(number) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            length = Some(number.trim().parse::<usize>().map_err(|e| FrameError::InvalidLength(e.to_string()))?);
        }
    }
    let length = length.ok_or(FrameError::MissingLength)?;
    if length > limits.max_body { return Err(FrameError::TooLarge { length, max: limits.max_body }); }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(|e| FrameError::Body(e.to_string()))?;
    Ok(Some(bytes))
}

/// `body.len()` is the UTF-8 byte length, which is what both protocols count.
pub(crate) fn encode(body: &str) -> Vec<u8> {
    format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
}

pub(crate) enum QueueError { Full, Closed }

/// Dedicated writer thread behind a bounded queue. `try_send` never blocks,
/// so a peer that stops reading cannot stall the caller. `depth` counts
/// packets accepted but not yet written, which lets a client hold back part
/// of the capacity for traffic that must not be starved.
pub(crate) struct FrameWriter {
    sender: SyncSender<Vec<u8>>,
    depth: Arc<AtomicUsize>,
    capacity: usize,
    thread: std::thread::JoinHandle<()>,
}

impl FrameWriter {
    pub(crate) fn spawn(writer: impl Write + Send + 'static, capacity: usize,
        on_error: impl FnOnce(String) + Send + 'static) -> Self {
        let (sender, receiver) = sync_channel::<Vec<u8>>(capacity);
        let depth = Arc::new(AtomicUsize::new(0));
        let written = depth.clone();
        let thread = std::thread::spawn(move || {
            let mut writer = writer;
            while let Ok(packet) = receiver.recv() {
                let result = writer.write_all(&packet).and_then(|_| writer.flush());
                written.fetch_sub(1, Ordering::AcqRel);
                if let Err(error) = result { on_error(error.to_string()); return; }
            }
        });
        Self { sender, depth, capacity, thread }
    }

    /// Close the queue; the thread ends after its current write. Join the
    /// returned handle once the peer can no longer block that write.
    pub(crate) fn close(self) -> std::thread::JoinHandle<()> {
        drop(self.sender);
        self.thread
    }

    /// Bounded only by the channel itself, exactly as the DAP writer was.
    pub(crate) fn try_send(&self, packet: Vec<u8>) -> Result<(), QueueError> {
        self.depth.fetch_add(1, Ordering::AcqRel);
        self.enqueue(packet)
    }

    /// Admit only while fewer than `limit` packets are waiting or being written.
    pub(crate) fn try_send_within(&self, packet: Vec<u8>, limit: usize) -> Result<(), QueueError> {
        let before = self.depth.fetch_add(1, Ordering::AcqRel);
        if before >= limit.min(self.capacity) {
            self.depth.fetch_sub(1, Ordering::AcqRel);
            return Err(QueueError::Full);
        }
        self.enqueue(packet)
    }

    fn enqueue(&self, packet: Vec<u8>) -> Result<(), QueueError> {
        self.sender.try_send(packet).map_err(|error| {
            self.depth.fetch_sub(1, Ordering::AcqRel);
            match error { TrySendError::Full(_) => QueueError::Full, TrySendError::Disconnected(_) => QueueError::Closed }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Read};

    const LSP: FrameLimits = FrameLimits { max_body: 64, max_header_line: Some(128) };

    /// Hands out at most `step` bytes per read, to split frames anywhere.
    struct Trickle<'a> { bytes: &'a [u8], step: usize }
    impl Read for Trickle<'_> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let n = self.step.min(buf.len()).min(self.bytes.len());
            buf[..n].copy_from_slice(&self.bytes[..n]);
            self.bytes = &self.bytes[n..];
            Ok(n)
        }
    }

    #[test]
    fn split_reads_at_every_byte_boundary_yield_whole_utf8_bodies() {
        let mut stream = encode(r#"{"a":"λ😀"}"#);
        stream.extend(b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: 2\r\n\r\n{}");
        for step in 1..=stream.len() {
            for capacity in [1, 2, 7, 64] {
                let mut reader = BufReader::with_capacity(capacity, Trickle { bytes: &stream, step });
                assert_eq!(read_frame(&mut reader, LSP).unwrap().unwrap(), r#"{"a":"λ😀"}"#.as_bytes());
                assert_eq!(read_frame(&mut reader, LSP).unwrap().unwrap(), b"{}");
                assert_eq!(read_frame(&mut reader, LSP).unwrap(), None);
            }
        }
    }

    #[test]
    fn malformed_frames_are_typed_errors_never_partial_bodies() {
        let read = |bytes: &[u8]| read_frame(&mut BufReader::new(bytes), LSP);
        assert_eq!(read(b"Content-Type: x\r\n\r\n{}"), Err(FrameError::MissingLength));
        assert!(matches!(read(b"Content-Length: -1\r\n\r\n"), Err(FrameError::InvalidLength(_))));
        assert!(matches!(read(b"Content-Length: two\r\n\r\n"), Err(FrameError::InvalidLength(_))));
        assert_eq!(read(b"Content-Length: 65\r\n\r\n"), Err(FrameError::TooLarge { length: 65, max: 64 }));
        assert!(matches!(read(b"Content-Length: 10\r\n\r\n{}"), Err(FrameError::Body(_))));
        assert_eq!(read(b"Content-Length: 2\r\n"), Err(FrameError::EofInHeaders));
        assert_eq!(read(b"Content-Len"), Err(FrameError::EofInHeaders));
        assert_eq!(read(&[b'x'; 200]), Err(FrameError::HeaderTooLong));
        assert_eq!(read(b""), Ok(None));
    }

    #[test]
    fn admission_limit_holds_back_reserved_capacity() {
        struct Blocked(std::sync::mpsc::Receiver<()>);
        impl Write for Blocked {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> { self.0.recv().ok(); Ok(bytes.len()) }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let (release, blocked) = std::sync::mpsc::channel();
        let writer = FrameWriter::spawn(Blocked(blocked), 8, |_| {});
        let admitted = (0..10).filter(|_| writer.try_send_within(encode("{}"), 6).is_ok()).count();
        assert_eq!(admitted, 6);
        assert!(writer.try_send(encode("{}")).is_ok(), "reserve stays available");
        for _ in 0..16 { let _ = release.send(()); }
    }
}
