//! Session, registry and lifecycle tests against the scripted fake server.
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::adapter::{ServerContext, ToolRef};
use super::delivery::{Delivered, Phase};
use super::fake_server;
use super::protocol::{LogSource, Outcome};
use super::registry::{LaunchDecision, LspRegistry};
use super::session::{LaunchSpec, Limits, RequestError, SendError, Session};

const WAIT: Duration = Duration::from_secs(10);

fn limits() -> Limits {
    Limits { initialize_timeout: Duration::from_secs(2), shutdown_wait: Duration::from_millis(500),
        exit_wait: Duration::from_millis(500), ..Limits::default() }
}

fn spec(script: &str) -> LaunchSpec {
    let (program, args, env) = fake_server::command(script);
    LaunchSpec { program, args, env, cwd: std::env::temp_dir(), root_uri: "file:///ws".into(), workspace_name: "ws".into(),
        init_options: json!({"cargo": {"targetDir": true}}), configuration: json!({"rust-analyzer": {"cargo": {"targetDir": true}}}),
        lazy_additional_edits: false }
}

fn start(script: &str) -> Session { Session::start(spec(script), limits(), 1) }

fn ready(script: &str) -> Session {
    let session = start(script);
    assert!(session.wait_until(WAIT, |s| s.phase == Phase::Ready || s.phase.is_terminal()));
    assert_eq!(session.status().phase, Phase::Ready, "{:?}", session.status().terminal_reason);
    session
}

fn alive(pid: i32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()
        .and_then(|stat| stat.rfind(')').map(|end| !stat[end + 2..].starts_with('Z')))
        .unwrap_or(false)
}

fn eventually(mut condition: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + WAIT;
    while Instant::now() < deadline {
        if condition() { return true; }
        std::thread::sleep(Duration::from_millis(20));
    }
    condition()
}

fn log_text(session: &Session, prefix: &str) -> Option<String> {
    session.logs().0.into_iter().find(|line| line.text.starts_with(prefix)).map(|line| line.text)
}

/// The invariants every terminal cause must leave behind.
fn assert_clean_end(session: &Session, phase: Phase, reason: &str) {
    assert!(session.wait_until(WAIT, |s| s.phase.is_terminal()), "never terminal (expected {reason:?}): {:?}", session.status().phase);
    let status = session.status();
    assert_eq!(status.phase, phase, "reason: {:?}", status.terminal_reason);
    assert!(status.terminal_reason.as_deref().unwrap_or("").contains(reason), "reason {:?} lacks {reason:?}", status.terminal_reason);
    assert_eq!(session.pending_len(), 0, "no pending entry left");
    assert_eq!(session.snapshot_keys(), 0, "no class S entry left");
    assert!(eventually(|| session.torn_down() && session.live_threads() == 0 && !session.has_writer()),
        "threads remain: {}, writer held: {}", session.live_threads(), session.has_writer());
    if let Some(pid) = session.pid() { assert!(eventually(|| !alive(pid)), "server {pid} still alive"); }
    // A second cause changes nothing.
    let before = session.counters().later_terminal_causes;
    assert!(!session.terminate(Phase::Failed, "second cause"));
    assert_eq!(session.status().phase, phase);
    assert_eq!(session.counters().later_terminal_causes, before + 1);
}

#[test]
fn handshake_validates_capabilities_and_stop_is_graceful() {
    let session = ready("");
    let caps = session.caps().unwrap();
    assert!(caps.completion.as_ref().is_some_and(|c| c.resolve && c.trigger_characters == [":", ".", "'"]));
    assert!(log_text(&session, "[lsp] ready after").is_some_and(|line| line.contains("sync Incremental")));
    assert_eq!(session.request("test/echo", json!({"x": "λ"}), WAIT), Ok(Outcome::Result(json!({"x": "λ"}))));
    session.stop();
    assert_clean_end(&session, Phase::Exited, "stopped");
    assert_eq!(session.request("test/echo", json!(1), WAIT), Err(RequestError::NotReady));
}

#[test]
fn server_requests_are_answered_by_the_backend_alone() {
    let session = ready("asks");
    // Nobody consumes deliveries in this test: answers must not depend on it.
    assert!(eventually(|| log_text(&session, "replies ").is_some()));
    let replies: Vec<Value> = serde_json::from_str(log_text(&session, "replies ").unwrap().trim_start_matches("replies ")).unwrap();
    let by_id = |id: Value| replies.iter().find(|r| r["id"] == id).unwrap().clone();
    assert_eq!(by_id(json!(1001))["result"], Value::Null);
    assert_eq!(by_id(json!("c1"))["result"], json!([{"targetDir": true}, null, {"rust-analyzer": {"cargo": {"targetDir": true}}}]));
    assert_eq!(by_id(json!(1002))["result"], json!([{"uri": "file:///ws", "name": "ws"}]));
    assert!(by_id(json!(1003)).get("error").is_some(), "registration is refused, never acknowledged as success");
    assert_eq!(by_id(json!(1004))["result"], Value::Null);
    assert_eq!(by_id(json!(1005))["error"]["code"], -32601);
    let counters = session.counters();
    assert_eq!((counters.server_requests, counters.capability_gaps, counters.notices), (6, 1, 1));
    assert!(session.logs().0.iter().any(|l| l.source == LogSource::Show && l.text == "pick one"));
    session.stop();
    assert_clean_end(&session, Phase::Exited, "stopped");
}

#[test]
fn a_stalled_consumer_never_stalls_the_server_or_loses_replaceable_state() {
    let session = ready("flood=4000");
    // No batch is taken while the server floods; the reader must keep draining.
    assert!(eventually(|| log_text(&session, "flood done").is_some()), "server blocked on a full pipe");
    assert_eq!(session.request("test/echo", json!("after flood"), WAIT), Ok(Outcome::Result(json!("after flood"))));
    assert!(session.snapshot_keys() <= 3 + 1000, "bounded by distinct keys, not messages");
    let (_, dropped) = session.logs();
    assert!(dropped > 0, "log drops are counted");
    // The consumer resumes: drain everything with bounded, acknowledged batches.
    let mut delivered = vec![];
    while let Some(batch) = session.take_batch(256, 1 << 20) {
        if batch.is_empty() { break; }
        delivered.extend(batch);
        assert!(session.take_batch(256, 1 << 20).is_none(), "next batch waits for the acknowledgement");
        session.ack_batch();
    }
    let last = |uri: &str| delivered.iter().rev().find_map(|d| match d {
        Delivered::Diagnostics { uri: u, diagnostics, .. } if u == uri => Some(diagnostics.clone()), _ => None });
    assert_eq!(last("file:///f0.rs"), Some(vec![]), "the clearing set is delivered");
    assert_eq!(last("file:///f1.rs"), Some(vec![json!({"message": "d3997"})]));
    assert_eq!(last("file:///f2.rs"), Some(vec![json!({"message": "d3998"})]));
    let ended = delivered.iter().filter(|d| matches!(d, Delivered::ProgressEnd { .. } | Delivered::ProgressCompleted { .. })).count();
    assert_eq!(ended, 1000, "every progress end is delivered");
    session.stop();
    assert_clean_end(&session, Phase::Exited, "stopped");
    assert!(session.status().phase.is_terminal(), "the terminal phase is pullable after the stall");
}

#[test]
fn cancellation_wakes_the_caller_and_drops_the_late_reply() {
    let session = ready("");
    let request = session.begin_request("test/late", Value::Null).unwrap();
    session.cancel(request.id);
    assert_eq!(session.pending_len(), 1, "kept until the server replies");
    assert!(eventually(|| session.pending_stats().dropped_cancelled == 1));
    assert_eq!(session.pending_len(), 0);
    // A request that never gets a reply times out to no result and is cancelled.
    assert_eq!(session.request("test/never", Value::Null, Duration::from_millis(100)), Ok(Outcome::NoResult));
    assert_eq!(session.pending_len(), 1);
    session.stop();
    assert_clean_end(&session, Phase::Exited, "stopped");
}

#[test]
fn bad_bodies_are_skipped_until_the_bound_then_fail() {
    let session = ready("");
    for _ in 0..3 { session.notify("test/bad_body", Value::Null).unwrap(); }
    assert_eq!(session.request("test/echo", json!(1), WAIT), Ok(Outcome::Result(json!(1))), "still aligned and usable");
    assert_eq!(session.counters().bad_bodies, 3);
    session.notify("test/bad_body", Value::Null).unwrap();
    assert_clean_end(&session, Phase::Failed, "more than 3 invalid messages");
}

#[test]
fn a_reply_with_an_id_we_never_issued_is_ignored() {
    let session = ready("");
    session.notify("test/panic_body", Value::Null).unwrap();
    assert!(eventually(|| session.pending_stats().unknown == 1));
    assert_eq!(session.status().phase, Phase::Ready);
    session.stop();
    assert_clean_end(&session, Phase::Exited, "stopped");
}

#[test]
fn a_full_writer_refuses_requests_before_sync_and_is_never_silent() {
    let session = ready("stall_reads");
    let payload = "x".repeat(16 * 1024);
    let mut requests = 0;
    let busy = loop {
        match session.begin_request("test/echo", json!(payload)) {
            Ok(_) => requests += 1,
            Err(error) => break error,
        }
        assert!(requests < 10_000);
    };
    assert_eq!(busy, RequestError::Busy);
    assert!(requests <= limits().pending_cap);
    // Sync notifications may still use the reserve, until the queue is truly full.
    let mut admitted = 0;
    let full = loop {
        match session.notify("textDocument/didChange", json!(payload)) {
            Ok(()) => admitted += 1,
            Err(error) => break error,
        }
        assert!(admitted < 10_000);
    };
    assert_eq!(full, SendError::Full, "the caller is told, so it can mark the document desynced");
    session.stop();
    assert_clean_end(&session, Phase::Exited, "stopped");
}

#[test]
fn a_server_that_ignores_shutdown_exit_and_term_is_still_removed_with_its_descendants() {
    let session = ready("child,ignore_shutdown,ignore_exit,ignore_term");
    assert!(eventually(|| log_text(&session, "child ").is_some()));
    let child: i32 = log_text(&session, "child ").unwrap().trim_start_matches("child ").parse().unwrap();
    let server = session.pid().unwrap();
    assert!(alive(child) && alive(server));
    session.stop();
    assert_clean_end(&session, Phase::Exited, "stopped");
    assert!(eventually(|| !alive(child)), "descendant {child} survived");
}

#[test]
fn every_terminal_cause_leaves_the_same_invariants() {
    // Spawn failure.
    let mut missing = spec("");
    missing.program = PathBuf::from("/nonexistent/language-server");
    let session = Session::start(missing, limits(), 1);
    assert_clean_end(&session, Phase::Failed, "Could not start");
    // Handshake timeout (process alive, initialize never answered).
    assert_clean_end(&start("silent_init"), Phase::Failed, "initialize timed out");
    // Initialize error and invalid capabilities.
    assert_clean_end(&start("init_error"), Phase::Failed, "initialize failed");
    assert_clean_end(&start("encoding=utf-8"), Phase::Failed, "position encoding");
    // Unexpected exit with a code, and with a signal; a waiting request resolves.
    let session = ready("stderr");
    let waiting = session.begin_request("test/never", Value::Null).unwrap();
    assert!(eventually(|| log_text(&session, "fake stderr line 4").is_some()));
    session.notify("test/crash", Value::Null).unwrap();
    assert_clean_end(&session, Phase::Crashed, "exited with code 3");
    assert!(session.status().terminal_reason.unwrap().contains("fake stderr line"), "last stderr lines are kept");
    assert!(session.logs().0.iter().any(|l| l.source == LogSource::Stderr), "the log ring survives the end");
    drop(waiting);
    let session = ready("");
    let waiting = session.begin_request("test/never", Value::Null).unwrap();
    session.notify("test/segv", Value::Null).unwrap();
    assert_clean_end(&session, Phase::Crashed, "SIGSEGV");
    drop(waiting);
    // Framing error.
    let session = ready("");
    session.notify("test/bad_framing", Value::Null).unwrap();
    assert_clean_end(&session, Phase::Failed, "framing error");
    // Thread panic.
    let session = ready("");
    session.spawn_tracked_for_test(|| panic!("injected"));
    assert_clean_end(&session, Phase::Crashed, "panicked");
    // Internal error.
    let session = ready("");
    session.terminate(Phase::Failed, "internal error");
    assert_clean_end(&session, Phase::Failed, "internal error");
    // Stop before initialization completes.
    let session = start("silent_init");
    assert!(session.wait_until(WAIT, |s| s.phase == Phase::Initializing));
    session.stop();
    assert_clean_end(&session, Phase::Exited, "before initialization");
}

fn context(script: &str, root: &str) -> ServerContext {
    let (program, args, env) = fake_server::command(script);
    ServerContext { implementation: ToolRef { path: program, version: "fake".into() }, args, root: root.into(),
        projects: vec![], init_options: json!({}), env, lsp_language_id: "rust", notes: vec![] }
}

#[test]
fn registry_shares_one_server_per_identity_and_solution_close_stops_all() {
    let root = std::env::temp_dir();
    let registry = LspRegistry::new(limits(), "rust-analyzer");
    let LaunchDecision::Launch(first) = registry.revalidate_and_ensure(Ok(context("child", &root.to_string_lossy()))) else { panic!() };
    let LaunchDecision::Attach(same) = registry.revalidate_and_ensure(Ok(context("child", &root.to_string_lossy()))) else { panic!() };
    assert_eq!(first.pid(), same.pid());
    let other_root = root.join("..").canonicalize().unwrap();
    let LaunchDecision::Launch(_) = registry.revalidate_and_ensure(Ok(context("", &other_root.to_string_lossy()))) else { panic!() };
    assert_eq!(registry.len(), 2);
    assert!(matches!(registry.revalidate_and_ensure(Err(super::adapter::ResolveNote("gone".into()))), LaunchDecision::Skip(_)));
    // Navigated-file bindings follow the session's life.
    let navigated = PathBuf::from("/home/u/.cargo/registry/src/x/lib.rs");
    registry.bind_navigated(&navigated, context("child", &root.to_string_lossy()).identity());
    assert!(first.wait_until(WAIT, |s| s.phase == Phase::Ready));
    assert!(registry.binding(&navigated).is_some());
    assert!(eventually(|| log_text(&first, "child ").is_some()));
    let child: i32 = log_text(&first, "child ").unwrap().trim_start_matches("child ").parse().unwrap();
    let stopped = registry.stop_all();
    assert_eq!(stopped.len(), 2);
    for session in &stopped { assert_clean_end(session, Phase::Exited, "stop"); }
    assert!(eventually(|| !alive(child)), "descendant survived solution close");
    assert!(registry.binding(&navigated).is_none());
    assert!(matches!(registry.revalidate_and_ensure(Ok(context("", &root.to_string_lossy()))), LaunchDecision::Skip("solution is closing")));
}

#[test]
fn a_dead_session_is_not_restarted_automatically() {
    let root = std::env::temp_dir().to_string_lossy().into_owned();
    let registry = LspRegistry::new(limits(), "rust-analyzer");
    let LaunchDecision::Launch(session) = registry.revalidate_and_ensure(Ok(context("", &root))) else { panic!() };
    assert!(session.wait_until(WAIT, |s| s.phase == Phase::Ready));
    session.notify("test/crash", Value::Null).unwrap();
    assert!(session.wait_until(WAIT, |s| s.phase == Phase::Crashed));
    let LaunchDecision::Attach(dead) = registry.revalidate_and_ensure(Ok(context("", &root))) else { panic!("restarted on its own") };
    assert_eq!(dead.status().phase, Phase::Crashed);
    let LaunchDecision::Launch(fresh) = registry.restart(context("", &root)) else { panic!() };
    assert!(fresh.wait_until(WAIT, |s| s.phase == Phase::Ready));
    for session in registry.stop_all() { assert_clean_end(&session, Phase::Exited, "stop"); }
}
