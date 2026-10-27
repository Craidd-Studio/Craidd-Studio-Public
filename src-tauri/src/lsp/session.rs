//! One language-server process: state machine, transport threads, the
//! pending table, delivery state and the single terminal transition.
//!
//! Every entry into a terminal phase goes through `Session::terminate`.
//! Bookkeeping (status, pending, snapshots) never waits on process teardown,
//! which runs on its own thread.
use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::commands::containment::{guard, signal_name};
use super::caps::{self, NegotiatedCaps};
use super::delivery::{Coalescer, Delivered, LogRing, Phase, StatusRecord};
use super::framing::{encode, read_frame, FrameLimits, FrameWriter, QueueError};
use super::pending::PendingTable;
use super::protocol::{self, Inbound, LogLine, LogSource, Outcome, METHOD_NOT_FOUND, REQUEST_FAILED};

/// Initial ◇ values from the design, to be tuned from measurement.
#[derive(Clone, Debug)]
pub(crate) struct Limits {
    pub initialize_timeout: Duration,
    pub shutdown_wait: Duration,
    pub exit_wait: Duration,
    pub writer_capacity: usize,
    /// Writer slots held back from new requests, for sync, replies and cancels.
    pub request_reserve: usize,
    pub pending_cap: usize,
    pub cancelled_expiry: Duration,
    pub bad_body_tolerance: usize,
    pub max_message: usize,
    pub max_header_line: usize,
    pub stderr_lines: usize,
    pub stderr_line_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            initialize_timeout: Duration::from_secs(30),
            shutdown_wait: Duration::from_secs(2),
            exit_wait: Duration::from_secs(2),
            writer_capacity: 128,
            request_reserve: 16,
            pending_cap: 64,
            cancelled_expiry: Duration::from_secs(30),
            bad_body_tolerance: 3,
            max_message: 64 * 1024 * 1024,
            max_header_line: 8 * 1024,
            stderr_lines: 1_000,
            stderr_line_bytes: 16 * 1024,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub root_uri: String,
    pub workspace_name: String,
    pub init_options: Value,
    /// Answers `workspace/configuration`, by dotted section.
    pub configuration: Value,
    pub lazy_additional_edits: bool,
}

/// ◇ How often a running server's process tree is re-read.
const TREE_REFRESH: Duration = Duration::from_millis(500);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RequestError { NotReady, Busy, Closed }

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SendError { NotReady, Full, Closed }

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Counters {
    pub ignored_notifications: u64,
    pub server_requests: u64,
    pub notices: u64,
    pub capability_gaps: u64,
    pub bad_bodies: u64,
    pub later_terminal_causes: u64,
}

struct Process { child: Child, pid: i32 }

struct Inner {
    spec: LaunchSpec,
    limits: Limits,
    status: Mutex<StatusRecord>,
    changed: Condvar,
    pending: Mutex<PendingTable>,
    snapshots: Mutex<Coalescer>,
    logs: Mutex<LogRing>,
    writer: Mutex<Option<FrameWriter>>,
    process: Mutex<Option<Process>>,
    /// The server's process tree, refreshed while it runs so descendants
    /// stay known after the root exits.
    tree: Mutex<Option<crate::process_supervisor::OwnedTree>>,
    pid: Mutex<Option<i32>>,
    threads: Mutex<Vec<JoinHandle<()>>>,
    live_threads: AtomicUsize,
    torn_down: AtomicBool,
    counters: Mutex<Counters>,
}

/// A request already on the wire; wait for it or cancel it by `id`.
pub(crate) struct PendingRequest { pub id: i64, receiver: Receiver<Outcome> }

#[derive(Clone)]
pub(crate) struct Session(Arc<Inner>);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> { mutex.lock().unwrap_or_else(|poison| poison.into_inner()) }

/// Exit status of `pid` without reaping it, so its process group stays
/// identifiable for tree cleanup. `None` while it is still running.
fn peek_exit(pid: i32) -> Option<String> {
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::waitid(libc::P_PID, pid as libc::id_t, &mut info, libc::WEXITED | libc::WNOWAIT | libc::WNOHANG) };
    if result != 0 || unsafe { info.si_pid() } == 0 { return None; }
    let status = unsafe { info.si_status() };
    Some(match info.si_code {
        libc::CLD_EXITED => format!("exited with code {status}"),
        libc::CLD_KILLED | libc::CLD_DUMPED => format!("was killed by {}", signal_name(status)),
        _ => "stopped unexpectedly".into(),
    })
}

impl Session {
    /// Returns at once in `Spawning`; spawn and handshake run off-thread.
    pub(crate) fn start(spec: LaunchSpec, limits: Limits, generation: u64) -> Self {
        let inner = Arc::new(Inner {
            pending: Mutex::new(PendingTable::new(limits.pending_cap, limits.cancelled_expiry)),
            logs: Mutex::new(LogRing::new(limits.stderr_lines)),
            status: Mutex::new(StatusRecord::new(generation)),
            changed: Condvar::new(),
            snapshots: Mutex::new(Coalescer::default()),
            writer: Mutex::new(None),
            process: Mutex::new(None),
            tree: Mutex::new(None),
            pid: Mutex::new(None),
            threads: Mutex::new(vec![]),
            live_threads: AtomicUsize::new(0),
            torn_down: AtomicBool::new(false),
            counters: Mutex::new(Counters::default()),
            spec, limits,
        });
        let session = Self(inner);
        let launcher = session.clone();
        session.spawn_tracked("lsp launcher", move || launcher.launch());
        session
    }

    fn spawn_tracked(&self, label: &'static str, work: impl FnOnce() + Send + 'static) {
        let inner = self.0.clone();
        inner.live_threads.fetch_add(1, Ordering::AcqRel);
        let handle = std::thread::Builder::new().name(label.into()).spawn(move || {
            if guard(label, work).is_none() {
                Session(inner.clone()).terminate(Phase::Crashed, &format!("{label} thread panicked"));
            }
            inner.live_threads.fetch_sub(1, Ordering::AcqRel);
            inner.changed.notify_all();
        });
        match handle {
            Ok(handle) => lock(&self.0.threads).push(handle),
            Err(error) => {
                self.0.live_threads.fetch_sub(1, Ordering::AcqRel);
                self.terminate(Phase::Failed, &format!("could not start {label} thread: {error}"));
            }
        }
    }

    fn launch(&self) {
        let spec = &self.0.spec;
        let mut command = Command::new(&spec.program);
        command.args(&spec.args).current_dir(&spec.cwd).envs(spec.env.iter().cloned())
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        unsafe { command.pre_exec(|| { if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); } Ok(()) }); }
        let mut child = match crate::process_supervisor::spawn(&mut command) {
            Ok(child) => child,
            Err(error) => {
                self.terminate(Phase::Failed, &format!("Could not start {}: {error}", spec.program.display()));
                return;
            }
        };
        let pid = child.id() as i32;
        let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take()) else {
            self.own_process(child, pid);
            self.terminate(Phase::Failed, "server pipes unavailable");
            return;
        };
        let weak = Arc::downgrade(&self.0);
        let writer = FrameWriter::spawn(stdin, self.0.limits.writer_capacity, move |error| Session::transport_error(&weak, error));
        *lock(&self.0.writer) = Some(writer);
        self.own_process(child, pid);
        let reader = self.clone();
        self.spawn_tracked("lsp reader", move || reader.read_loop(stdout));
        let drain = self.clone();
        self.spawn_tracked("lsp stderr", move || drain.drain_stderr(stderr));
        let watcher = self.clone();
        self.spawn_tracked("lsp tree", move || watcher.watch_tree());
        // A stop that raced the spawn already ran terminate(); tear down what we just made.
        if lock(&self.0.status).phase.is_terminal() { self.start_teardown(); return; }
        {
            let mut status = lock(&self.0.status);
            // A stop during spawn moved the phase on; never move it back.
            if status.phase != Phase::Spawning || !status.advance(Phase::Initializing) { return; }
        }
        self.0.changed.notify_all();
        self.handshake();
    }

    fn own_process(&self, child: Child, pid: i32) {
        *lock(&self.0.pid) = Some(pid);
        *lock(&self.0.tree) = crate::process_supervisor::process_birth(pid)
            .and_then(|birth| crate::process_supervisor::capture_tree(pid, birth));
        *lock(&self.0.process) = Some(Process { child, pid });
    }

    fn refresh_tree(&self) {
        if let Some(tree) = lock(&self.0.tree).as_mut() { tree.refresh(); }
    }

    /// Descendants such as `cargo check` or a proc-macro server can start at
    /// any time; refresh so they are known before a crash orphans them.
    fn watch_tree(&self) {
        while !self.wait_until(TREE_REFRESH, |status| status.phase.is_terminal()) { self.refresh_tree(); }
    }

    fn handshake(&self) {
        let spec = &self.0.spec;
        let folders = json!([{ "uri": spec.root_uri, "name": spec.workspace_name }]);
        let params = json!({
            "processId": std::process::id(),
            "clientInfo": { "name": "Craidd Studio", "version": env!("CARGO_PKG_VERSION") },
            "rootUri": spec.root_uri,
            "workspaceFolders": folders,
            "capabilities": caps::client_capabilities(spec.lazy_additional_edits),
            "initializationOptions": spec.init_options,
            "trace": "off",
        });
        let started = Instant::now();
        let outcome = match self.send_request("initialize", params, &[Phase::Initializing]) {
            Ok(request) => request.receiver.recv_timeout(self.0.limits.initialize_timeout).map_err(|_| request.id),
            Err(error) => {
                // A stop that arrived first owns the ending; only a real send failure is ours.
                if lock(&self.0.status).phase == Phase::Initializing {
                    self.terminate(Phase::Failed, &format!("could not send initialize: {error:?}"));
                }
                return;
            }
        };
        match outcome {
            Ok(Outcome::Result(result)) => match caps::validate(&result) {
                Err(reason) => { self.terminate(Phase::Failed, &format!("invalid initialize result: {reason}")); }
                Ok(negotiated) => {
                    if self.notify_in("initialized", json!({}), &[Phase::Initializing]).is_err() {
                        if lock(&self.0.status).phase == Phase::Initializing {
                            self.terminate(Phase::Failed, "could not send initialized");
                        }
                        return;
                    }
                    let line = format!("[lsp] ready after {} ms: {}", started.elapsed().as_millis(), negotiated.summary_line());
                    let notes = negotiated.notes.clone();
                    if lock(&self.0.status).set_ready(negotiated) {
                        let mut logs = lock(&self.0.logs);
                        logs.push(LogLine { source: LogSource::Log, severity: 3, text: line });
                        for note in notes { logs.push(LogLine { source: LogSource::Log, severity: 2, text: format!("[lsp] capability note: {note}") }); }
                    }
                    self.0.changed.notify_all();
                }
            },
            Ok(Outcome::Error { code, message }) => { self.terminate(Phase::Failed, &format!("initialize failed ({code}): {message}")); }
            // The session ended while waiting; terminate() already recorded why.
            Ok(Outcome::NoResult) => {}
            Err(id) => {
                lock(&self.0.pending).cancel(id, Instant::now());
                self.terminate(Phase::Failed, &format!("initialize timed out after {} s", self.0.limits.initialize_timeout.as_secs_f32()));
            }
        }
    }

    fn read_loop(&self, stdout: impl Read) {
        let limits = FrameLimits { max_body: self.0.limits.max_message, max_header_line: Some(self.0.limits.max_header_line) };
        let mut reader = BufReader::with_capacity(64 * 1024, stdout);
        loop {
            match read_frame(&mut reader, limits) {
                Ok(Some(body)) => self.dispatch(&body),
                Ok(None) => break,
                Err(error) => {
                    let phase = lock(&self.0.status).phase;
                    if phase.is_terminal() || phase == Phase::ShuttingDown { break; }
                    // The stream position is lost; never guess at a resync.
                    self.terminate(Phase::Failed, &format!("framing error: {error}"));
                    // Keep draining so the server cannot block on a full pipe before teardown.
                    let _ = std::io::copy(&mut reader, &mut std::io::sink());
                    return;
                }
            }
        }
        self.on_stream_end();
    }

    fn on_stream_end(&self) {
        let phase = lock(&self.0.status).phase;
        if phase.is_terminal() { return; }
        if phase == Phase::ShuttingDown { self.terminate(Phase::Exited, "stopped"); return; }
        let pid = *lock(&self.0.pid);
        let deadline = Instant::now() + Duration::from_secs(1);
        let mut exit = None;
        while let Some(pid) = pid {
            exit = peek_exit(pid);
            if exit.is_some() || Instant::now() >= deadline { break; }
            std::thread::sleep(Duration::from_millis(10));
        }
        let tail = lock(&self.0.logs).tail(5).join(" | ");
        let what = exit.unwrap_or_else(|| "closed its output".into());
        self.terminate(Phase::Crashed, &if tail.is_empty() { format!("server {what}") } else { format!("server {what}; last output: {tail}") });
    }

    fn transport_error(weak: &Weak<Inner>, error: String) {
        let Some(inner) = weak.upgrade() else { return; };
        let session = Session(inner);
        let phase = lock(&session.0.status).phase;
        if phase.is_terminal() || phase == Phase::ShuttingDown { return; }
        // A crashed server also breaks the pipe; the reader reports that cause.
        let pid = *lock(&session.0.pid);
        let deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < deadline {
            if pid.is_some_and(|pid| peek_exit(pid).is_some()) || lock(&session.0.status).phase.is_terminal() { return; }
            std::thread::sleep(Duration::from_millis(10));
        }
        session.terminate(Phase::Failed, &format!("transport failed: {error}"));
    }

    fn dispatch(&self, body: &[u8]) {
        if lock(&self.0.status).phase.is_terminal() { return; }
        match protocol::classify(body) {
            Err(bad) => {
                let count = { let mut c = lock(&self.0.counters); c.bad_bodies += 1; c.bad_bodies };
                lock(&self.0.logs).push(LogLine { source: LogSource::Log, severity: 2, text: format!("[lsp] skipped invalid message: {}", bad.0) });
                if count > self.0.limits.bad_body_tolerance as u64 {
                    self.terminate(Phase::Failed, &format!("more than {} invalid messages", self.0.limits.bad_body_tolerance));
                }
            }
            Ok(Inbound::Response { id, outcome }) => { lock(&self.0.pending).on_response(id, outcome); }
            Ok(Inbound::Request { id, method, params }) => {
                lock(&self.0.counters).server_requests += 1;
                let answer = protocol::reply(&id, self.answer_server_request(&method, &params));
                // Replies may use the reserve: a server request is always answered exactly once.
                if let Err(error) = self.write(encode(&answer), None) {
                    self.terminate(Phase::Failed, &format!("could not answer server request {method}: {error:?}"));
                }
            }
            Ok(Inbound::Snapshot(snapshot)) => { lock(&self.0.snapshots).push(snapshot); self.0.changed.notify_all(); }
            Ok(Inbound::Log(line)) => { lock(&self.0.logs).push(line); }
            Ok(Inbound::Ignored { .. }) => { lock(&self.0.counters).ignored_notifications += 1; }
        }
    }

    /// Class Q, answered by the backend from a static table, never by the frontend.
    fn answer_server_request(&self, method: &str, params: &Value) -> Result<Value, (i64, String)> {
        let spec = &self.0.spec;
        match method {
            "window/workDoneProgress/create" => Ok(Value::Null),
            "workspace/configuration" => Ok(Value::Array(params.get("items").and_then(Value::as_array).map(|items| items.iter().map(|item| {
                match item.get("section").and_then(Value::as_str) {
                    None | Some("") => spec.configuration.clone(),
                    Some(section) => section.split('.').try_fold(&spec.configuration, |value, key| value.get(key)).cloned().unwrap_or(Value::Null),
                }
            }).collect()).unwrap_or_default())),
            "workspace/workspaceFolders" => Ok(json!([{ "uri": spec.root_uri, "name": spec.workspace_name }])),
            "client/registerCapability" | "client/unregisterCapability" => {
                lock(&self.0.counters).capability_gaps += 1;
                lock(&self.0.logs).push(LogLine { source: LogSource::Log, severity: 2,
                    text: format!("[lsp] capability gap: server sent {method} {params}") });
                Err((REQUEST_FAILED, "Dynamic registration is not supported by this client".into()))
            }
            "window/showMessageRequest" => {
                lock(&self.0.counters).notices += 1;
                lock(&self.0.logs).push(LogLine { source: LogSource::Show,
                    severity: params.get("type").and_then(Value::as_u64).filter(|t| (1..=4).contains(t)).unwrap_or(3) as u8,
                    text: params.get("message").and_then(Value::as_str).unwrap_or("").into() });
                Ok(Value::Null)
            }
            _ => Err((METHOD_NOT_FOUND, format!("Unhandled method {method}"))),
        }
    }

    fn drain_stderr(&self, stderr: impl Read) {
        let mut reader = BufReader::new(stderr);
        loop {
            let mut line = vec![];
            match (&mut reader).take(self.0.limits.stderr_line_bytes as u64).read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => return,
                Ok(_) => {
                    let text = String::from_utf8_lossy(&line).trim_end().to_string();
                    lock(&self.0.logs).push(LogLine { source: LogSource::Stderr, severity: 4, text });
                }
            }
        }
    }

    /// `limit = Some(n)` admits only below `n` queued packets; `None` may use the reserve.
    fn write(&self, packet: Vec<u8>, limit: Option<usize>) -> Result<(), SendError> {
        let writer = lock(&self.0.writer);
        let Some(writer) = writer.as_ref() else { return Err(SendError::Closed); };
        match limit { Some(limit) => writer.try_send_within(packet, limit), None => writer.try_send(packet) }
            .map_err(|error| match error { QueueError::Full => SendError::Full, QueueError::Closed => SendError::Closed })
    }

    fn send_request(&self, method: &str, params: Value, phases: &[Phase]) -> Result<PendingRequest, RequestError> {
        if !phases.contains(&lock(&self.0.status).phase) { return Err(RequestError::NotReady); }
        let (id, receiver) = lock(&self.0.pending).admit(Instant::now()).map_err(|_| RequestError::Busy)?;
        let limit = self.0.limits.writer_capacity.saturating_sub(self.0.limits.request_reserve);
        match self.write(encode(&protocol::request(id, method, params)), Some(limit)) {
            Ok(()) => Ok(PendingRequest { id, receiver }),
            Err(error) => {
                lock(&self.0.pending).abandon(id);
                Err(if error == SendError::Closed { RequestError::Closed } else { RequestError::Busy })
            }
        }
    }

    pub(crate) fn begin_request(&self, method: &str, params: Value) -> Result<PendingRequest, RequestError> {
        self.send_request(method, params, &[Phase::Ready])
    }

    /// Best effort: the caller is woken with no result at once and
    /// `$/cancelRequest` is sent; the entry waits for the server's reply.
    pub(crate) fn cancel(&self, id: i64) {
        if lock(&self.0.pending).cancel(id, Instant::now()) {
            let _ = self.write(encode(&protocol::notification_body("$/cancelRequest", json!({ "id": id }))), None);
        }
    }

    /// A request that times out resolves to no result; typing is never gated on it.
    pub(crate) fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Outcome, RequestError> {
        let request = self.begin_request(method, params)?;
        match request.receiver.recv_timeout(timeout) {
            Ok(outcome) => Ok(outcome),
            Err(RecvTimeoutError::Timeout) => { self.cancel(request.id); Ok(Outcome::NoResult) }
            Err(RecvTimeoutError::Disconnected) => Ok(Outcome::NoResult),
        }
    }

    fn notify_in(&self, method: &str, params: Value, phases: &[Phase]) -> Result<(), SendError> {
        if !phases.contains(&lock(&self.0.status).phase) { return Err(SendError::NotReady); }
        self.write(encode(&protocol::notification_body(method, params)), None)
    }

    /// Notifications (document sync from Stage 1b) may use the reserve.
    /// `Full` is never silent: the caller marks the document desynced.
    pub(crate) fn notify(&self, method: &str, params: Value) -> Result<(), SendError> {
        self.notify_in(method, params, &[Phase::Ready])
    }

    /// The only way into a terminal phase. Idempotent; first cause wins.
    pub(crate) fn terminate(&self, phase: Phase, reason: &str) -> bool {
        {
            let mut status = lock(&self.0.status);
            if !status.set_terminal(phase, reason) {
                drop(status);
                lock(&self.0.counters).later_terminal_causes += 1;
                return false;
            }
        }
        self.0.changed.notify_all();
        // 1. Done above: new requests, writes and dispatch are now refused.
        // 2. No caller is left waiting.
        lock(&self.0.pending).resolve_all();
        // 3. Snapshots from a dead session are discarded; the log ring is kept.
        lock(&self.0.snapshots).discard_all();
        // 4. Documents return to Pending: the document table arrives in Stage 1b.
        // 5. Process teardown, never awaited by the bookkeeping above.
        self.start_teardown();
        true
    }

    fn start_teardown(&self) {
        let session = self.clone();
        self.spawn_tracked("lsp teardown", move || {
            // Refresh before closing stdin: a server exits on EOF, and its
            // descendants must already be known when they are reparented.
            session.refresh_tree();
            let writer_thread = lock(&session.0.writer).take().map(FrameWriter::close);
            let tree = lock(&session.0.tree).take();
            if let Some(mut process) = lock(&session.0.process).take() {
                // Identity-scoped TERM, bounded grace, then KILL of the whole tree.
                match tree {
                    Some(tree) => tree.cancel(),
                    None => { let _ = process.child.kill(); }
                }
                let _ = process.child.wait();
            }
            if let Some(handle) = writer_thread { let _ = handle.join(); }
            let current = std::thread::current().id();
            let handles: Vec<_> = lock(&session.0.threads).drain(..).collect();
            for handle in handles {
                if handle.thread().id() == current { continue; }
                // Launcher/stop threads may still be finishing; they never block on the process.
                let _ = handle.join();
            }
            session.0.torn_down.store(true, Ordering::Release);
        });
    }

    /// User-initiated stop: `ShuttingDown` refuses new requests, then the
    /// graceful sequence runs off-thread and ends in `terminate(Exited)`.
    pub(crate) fn stop(&self) {
        let was_ready = {
            let mut status = lock(&self.0.status);
            match status.phase {
                phase if phase.is_terminal() || phase == Phase::ShuttingDown => return,
                Phase::Ready => { status.advance(Phase::ShuttingDown); true }
                _ => { status.advance(Phase::ShuttingDown); false }
            }
        };
        self.0.changed.notify_all();
        let session = self.clone();
        self.spawn_tracked("lsp stop", move || {
            if !was_ready {
                // Partial initialisation: straight to process-tree termination.
                session.terminate(Phase::Exited, "stopped before initialization completed");
                return;
            }
            let limits = session.0.limits.clone();
            if let Ok(request) = session.send_request("shutdown", Value::Null, &[Phase::ShuttingDown]) {
                let _ = request.receiver.recv_timeout(limits.shutdown_wait);
            }
            session.refresh_tree();
            let _ = session.notify_in("exit", Value::Null, &[Phase::ShuttingDown]);
            let pid = *lock(&session.0.pid);
            let deadline = Instant::now() + limits.exit_wait;
            while Instant::now() < deadline && !lock(&session.0.status).phase.is_terminal() {
                if pid.is_some_and(|pid| peek_exit(pid).is_some()) { break; }
                std::thread::sleep(Duration::from_millis(10));
            }
            session.terminate(Phase::Exited, "stopped");
        });
    }

    pub(crate) fn status(&self) -> StatusRecord { lock(&self.0.status).clone() }
    pub(crate) fn caps(&self) -> Option<NegotiatedCaps> { lock(&self.0.status).caps.clone() }

    /// Wait (bounded) for a status condition. Used by tests and later by the delivery task.
    pub(crate) fn wait_until(&self, timeout: Duration, condition: impl Fn(&StatusRecord) -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        let mut status = lock(&self.0.status);
        loop {
            if condition(&status) { return true; }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() { return false; }
            status = self.0.changed.wait_timeout(status, left.min(Duration::from_millis(50)))
                .unwrap_or_else(|poison| poison.into_inner()).0;
        }
    }

    pub(crate) fn take_batch(&self, max_count: usize, max_bytes: usize) -> Option<Vec<Delivered>> {
        lock(&self.0.snapshots).take_batch(max_count, max_bytes)
    }
    pub(crate) fn ack_batch(&self) { lock(&self.0.snapshots).ack(); }
    pub(crate) fn snapshot_keys(&self) -> usize { lock(&self.0.snapshots).keys() }
    pub(crate) fn logs(&self) -> (Vec<LogLine>, u64) { let logs = lock(&self.0.logs); (logs.lines(), logs.dropped) }
    pub(crate) fn counters(&self) -> Counters { *lock(&self.0.counters) }
    pub(crate) fn pending_len(&self) -> usize { lock(&self.0.pending).len() }
    pub(crate) fn pending_stats(&self) -> super::pending::PendingStats { lock(&self.0.pending).stats }
    pub(crate) fn pid(&self) -> Option<i32> { *lock(&self.0.pid) }
    pub(crate) fn live_threads(&self) -> usize { self.0.live_threads.load(Ordering::Acquire) }
    pub(crate) fn torn_down(&self) -> bool { self.0.torn_down.load(Ordering::Acquire) }
    pub(crate) fn has_writer(&self) -> bool { lock(&self.0.writer).is_some() }

    #[cfg(test)]
    pub(crate) fn spawn_tracked_for_test(&self, work: impl FnOnce() + Send + 'static) { self.spawn_tracked("lsp test", work); }
}
