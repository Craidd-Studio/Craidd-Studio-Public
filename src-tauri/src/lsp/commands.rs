//! Tauri surface for the language-server client. One registry per window
//! solution session; nothing is shared across windows. No command holds a
//! lock or blocks the async runtime across a server round trip: waits run
//! on blocking threads and are bounded.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{State, WebviewWindow};

use crate::ownership::{DiskProbe, LanguageFiles};
use crate::types::CraiddSolution;
use super::adapter::{file_uri, LanguageAdapter, ServerIdentity};
use super::delivery::StatusRecord;
use super::documents::{DocError, DocView};
use super::protocol::{LogLine, Outcome};
use super::registry::{LaunchDecision, LspRegistry};
use super::router::{project_ref, route, NotRouted, Route};
use super::rust_adapter::RustAdapter;
use super::session::{Batch, Limits, PullError, RequestError, Session};

/// ◇ Delivery batch bounds. The design sets them from G3 measurements,
/// which are not recorded yet; these are provisional safety values.
const BATCH_COUNT: usize = 256;
const BATCH_BYTES: usize = 1 << 20;
const BATCH_LOGS: usize = 500;
/// ◇ How long a delivery thread sleeps when nothing signals it.
const DELIVERY_IDLE: Duration = Duration::from_millis(250);
/// ◇ A pull that the server never answers resolves to no result.
const PULL_TIMEOUT: Duration = Duration::from_secs(30);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> { mutex.lock().unwrap_or_else(|p| p.into_inner()) }

/// `CRAIDD_LSP=0` disables the subsystem so G1 has a baseline on the same build.
fn enabled() -> bool { std::env::var("CRAIDD_LSP").map_or(true, |v| v != "0") }

struct Tracked {
    session: Session, identity: ServerIdentity, project_folder: PathBuf,
    /// The session root: manifests under it are affected (decision 21).
    root: PathBuf,
    /// Content hash of each manifest when its last reload was sent.
    reloaded_against: HashMap<PathBuf, u64>,
}

struct WindowLsp {
    registry: LspRegistry,
    adapters: Vec<Box<dyn LanguageAdapter>>,
    sessions: Mutex<HashMap<u64, Tracked>>,
}

pub(crate) struct LspManager {
    windows: Mutex<HashMap<String, Arc<WindowLsp>>>,
    channels: Arc<Mutex<HashMap<String, Channel<LspEvent>>>>,
    rust: Arc<RustAdapter>,
}

impl Default for LspManager {
    fn default() -> Self {
        Self { windows: Mutex::default(), channels: Arc::default(), rust: Arc::new(RustAdapter::new()) }
    }
}

/// The adapter is shared so its `cargo metadata` cache survives a solution reopen.
struct SharedRust(Arc<RustAdapter>);
impl LanguageAdapter for SharedRust {
    fn language(&self) -> &'static str { self.0.language() }
    fn document_extensions(&self) -> &'static [&'static str] { self.0.document_extensions() }
    fn resolve(&self, project: &super::adapter::ProjectRef) -> Result<super::adapter::ServerContext, super::adapter::ResolveNote> { self.0.resolve(project) }
    fn configuration_section(&self) -> &'static str { self.0.configuration_section() }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LspEvent { session: u64, batch: Batch }

impl LspManager {
    fn window(&self, label: &str) -> Arc<WindowLsp> {
        lock(&self.windows).entry(label.into()).or_insert_with(|| Arc::new(WindowLsp {
            registry: LspRegistry::new(Limits::default(), "rust-analyzer"),
            adapters: vec![Box::new(SharedRust(self.rust.clone()))],
            sessions: Mutex::default(),
        })).clone()
    }

    fn session(&self, label: &str, generation: u64) -> Result<Session, String> {
        let window = lock(&self.windows).get(label).cloned().ok_or("no language-server session for this window")?;
        let sessions = lock(&window.sessions);
        sessions.get(&generation).map(|t| t.session.clone()).ok_or_else(|| format!("language-server session {generation} is gone"))
    }

    /// Solution or window close: every session stops through the normal
    /// stop path, on background threads. Never waits for a server.
    pub(crate) fn close_window_solution(&self, label: &str) {
        if let Some(window) = lock(&self.windows).remove(label) { window.registry.stop_all(); }
    }

    fn start_delivery(&self, label: &str, window: &Arc<WindowLsp>, session: Session) {
        let channels = self.channels.clone();
        let (label, window) = (label.to_string(), Arc::downgrade(window));
        // Not a session-tracked thread: teardown must never wait on the frontend.
        let _ = std::thread::Builder::new().name("lsp delivery".into()).spawn(move || deliver(&label, &window, &channels, &session));
    }
}

fn deliver(label: &str, window: &Weak<WindowLsp>, channels: &Mutex<HashMap<String, Channel<LspEvent>>>, session: &Session) {
    let generation = session.status().generation;
    loop {
        // The window's solution closed: nobody is listening for this session any more.
        if window.upgrade().is_none() { return; }
        if let Some(batch) = session.next_batch(BATCH_COUNT, BATCH_BYTES, BATCH_LOGS) {
            let terminal = batch.status.as_ref().is_some_and(|s| s.phase.is_terminal());
            let channel = lock(channels).get(label).cloned();
            match channel {
                Some(channel) => { if channel.send(LspEvent { session: generation, batch }).is_err() { session.ack_batch(); } }
                // No subscriber yet: the state stays pullable; release the gate.
                None => session.ack_batch(),
            }
            if terminal { return; }
        }
        session.wait_for_delivery(DELIVERY_IDLE);
    }
}

#[tauri::command]
pub(crate) fn lsp_enabled() -> bool { enabled() }

/// The window's delivery channel. A reload subscribes again; every live
/// session then re-sends its status and its acknowledgement gate opens.
#[tauri::command]
pub(crate) fn lsp_subscribe(window: WebviewWindow, state: State<'_, LspManager>, channel: Channel<LspEvent>) {
    lock(&state.channels).insert(window.label().into(), channel);
    if let Some(lsp) = lock(&state.windows).get(window.label()).cloned() {
        for tracked in lock(&lsp.sessions).values() { tracked.session.reset_delivery(); }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum AttachReply {
    Routed {
        session: u64, uri: String, canonical: String, language_id: String,
        project_id: String, project_name: String, launched: bool,
        server: String, version: String, root: String, notes: Vec<String>, status: StatusRecord,
    },
    /// Not an error and no warning: this file has no language server.
    NotRouted { reason: String },
    /// Revalidation failed or the solution is closing; simply no launch.
    Skipped { reason: String },
    /// The project routes but the server cannot be resolved (not installed, …).
    Unavailable { reason: String },
    Disabled,
}

fn not_routed(reason: NotRouted) -> String {
    match reason {
        NotRouted::NoOwner => "no owning project".into(),
        NotRouted::Ambiguous(names) => format!("owned by more than one project: {}", names.join(", ")),
        NotRouted::ConfigFacet => "a project configuration file".into(),
        NotRouted::NoLanguage => "the owning project declares no language".into(),
        NotRouted::NoAdapter(language) => format!("no language server for {language}"),
        NotRouted::NotADocument => "not a source document for this language".into(),
    }
}

/// Route a file and get or start its session (the deferred launch's
/// backend half). The frontend has already revalidated what it owns:
/// solution open, document visible and active, startup finished.
#[tauri::command]
pub(crate) async fn lsp_attach(window: WebviewWindow, state: State<'_, LspManager>, file: String,
    solution: CraiddSolution, languages: HashMap<String, LanguageFiles>, reason: String) -> Result<AttachReply, String> {
    if !enabled() { return Ok(AttachReply::Disabled); }
    let label = window.label().to_string();
    let lsp = state.window(&label);
    let worker = lsp.clone();
    let started = Instant::now();
    let reply = tauri::async_runtime::spawn_blocking(move || -> Result<(AttachReply, Option<Session>), String> {
        let path = PathBuf::from(&file);
        let lookup = |language: &str| languages.get(language).cloned();
        let (project, adapter) = match route(&path, &solution, &lookup, &DiskProbe, &worker.adapters) {
            Route::NotRouted(reason) => return Ok((AttachReply::NotRouted { reason: not_routed(reason) }, None)),
            Route::Routed { project, adapter } => (project, adapter),
        };
        let reference = project_ref(&solution, project);
        let context = adapter.resolve(&reference);
        let (notes, server, version, root, language_id) = match &context {
            Ok(c) => (c.notes.clone(), c.implementation.path.display().to_string(), c.implementation.version.clone(),
                c.root.display().to_string(), c.lsp_language_id.to_string()),
            Err(note) => return Ok((AttachReply::Unavailable { reason: note.0.clone() }, None)),
        };
        let identity = context.as_ref().ok().map(|c| c.identity());
        let session_root = context.as_ref().map(|c| c.root.clone()).unwrap_or_default();
        let (session, launched) = match worker.registry.revalidate_and_ensure(context) {
            LaunchDecision::Skip(reason) => return Ok((AttachReply::Skipped { reason: reason.into() }, None)),
            LaunchDecision::Attach(session) => (session, false),
            LaunchDecision::Launch(session) => (session, true),
        };
        let generation = session.status().generation;
        lock(&worker.sessions).entry(generation).or_insert_with(|| Tracked {
            session: session.clone(), identity: identity.expect("resolved"), project_folder: reference.folder.clone(), root: session_root, reloaded_against: HashMap::new() });
        let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone()).display().to_string();
        Ok((AttachReply::Routed {
            session: generation, uri: file_uri(&path), canonical, language_id,
            project_id: project.id.clone(), project_name: project.name.clone(), launched,
            server, version, root, notes, status: session.status(),
        }, launched.then_some(session)))
    }).await.map_err(|e| e.to_string())??;
    if let (AttachReply::Routed { session: generation, launched: true, .. }, Some(session)) = &reply {
        // One log for G1: why the launch fired and how long resolution took.
        session.note(&format!("[lsp] launch {generation} ({reason}) after {} ms of resolution", started.elapsed().as_millis()));
        state.start_delivery(&label, &lsp, session.clone());
    }
    Ok(reply.0)
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Attribution { path: String, project_id: Option<String>, project_name: Option<String>, ambiguous: Vec<String> }

/// Project attribution through the single ownership resolver (the one the
/// Explorer uses): explicit includes, config-facet files and ambiguity
/// included. Not owned means external.
pub(crate) fn attribute(paths: &[String], solution: &CraiddSolution, languages: &HashMap<String, LanguageFiles>,
    probe: &dyn crate::ownership::TreeProbe) -> Vec<Attribution> {
    let lookup = |language: &str| languages.get(language).cloned();
    paths.iter().map(|path| match crate::ownership::owning_project(solution, std::path::Path::new(path), &lookup, probe) {
        crate::ownership::Ownership::Owned { project, .. } =>
            Attribution { path: path.clone(), project_id: Some(project.id.clone()), project_name: Some(project.name.clone()), ambiguous: vec![] },
        crate::ownership::Ownership::NotOwned => Attribution { path: path.clone(), project_id: None, project_name: None, ambiguous: vec![] },
        crate::ownership::Ownership::Ambiguous(found) =>
            Attribution { path: path.clone(), project_id: None, project_name: None, ambiguous: found.iter().map(|p| p.name.clone()).collect() },
    }).collect()
}

#[tauri::command]
pub(crate) async fn lsp_attribute(paths: Vec<String>, solution: CraiddSolution, languages: HashMap<String, LanguageFiles>) -> Result<Vec<Attribution>, String> {
    tauri::async_runtime::spawn_blocking(move || attribute(&paths, &solution, &languages, &DiskProbe)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn lsp_open(window: WebviewWindow, state: State<'_, LspManager>, session: u64, uri: String,
    language_id: String, text: String) -> Result<DocView, DocError> {
    let session = state.session(window.label(), session).map_err(|_| DocError::Closed)?;
    session.open_document(&uri, &language_id, &text)
}

#[tauri::command]
pub(crate) fn lsp_change(window: WebviewWindow, state: State<'_, LspManager>, session: u64, uri: String,
    epoch: u64, changes: Vec<Value>) -> Result<DocView, DocError> {
    let session = state.session(window.label(), session).map_err(|_| DocError::Closed)?;
    session.change_document(&uri, epoch, changes)
}

#[tauri::command]
pub(crate) fn lsp_mark_desynced(window: WebviewWindow, state: State<'_, LspManager>, session: u64, uri: String,
    reason: String) -> Result<DocView, DocError> {
    let session = state.session(window.label(), session).map_err(|_| DocError::Closed)?;
    session.mark_desynced(&uri, &reason)
}

#[tauri::command]
pub(crate) fn lsp_resync(window: WebviewWindow, state: State<'_, LspManager>, session: u64, uri: String,
    text: String) -> Result<DocView, DocError> {
    let session = state.session(window.label(), session).map_err(|_| DocError::Closed)?;
    session.resync_document(&uri, &text)
}

#[tauri::command]
pub(crate) fn lsp_save(window: WebviewWindow, state: State<'_, LspManager>, session: u64, uri: String,
    text: String) -> Result<DocView, DocError> {
    let session = state.session(window.label(), session).map_err(|_| DocError::Closed)?;
    session.save_document(&uri, &text)
}

#[tauri::command]
pub(crate) fn lsp_close(window: WebviewWindow, state: State<'_, LspManager>, session: u64, uri: String) -> Result<(), DocError> {
    let session = state.session(window.label(), session).map_err(|_| DocError::Closed)?;
    session.close_document(&uri)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum PullReply {
    /// The report as the server sent it (`full` or `unchanged`).
    Report { report: Value },
    /// Cancelled, content modified, timed out or the session ended.
    NoResult,
    /// The server asked for the pull to be sent again later.
    Retrigger,
    /// Not admitted (writer reserve or pending cap): flag pull-needed.
    Busy,
    /// Not open or desynced: nothing to pull until it is synced.
    NotSynced,
    /// The workspace has not reported ready; the first pull waits (decision 20).
    NotReady,
    Disabled,
    Error { code: i64, message: String },
}

#[tauri::command]
pub(crate) async fn lsp_pull(window: WebviewWindow, state: State<'_, LspManager>, session: u64, uri: String,
    previous_result_id: Option<String>) -> Result<PullReply, String> {
    let session = state.session(window.label(), session)?;
    let request = match session.begin_pull(&uri, previous_result_id.as_deref()) {
        Ok(request) => request,
        Err(PullError::Disabled) => return Ok(PullReply::Disabled),
        Err(PullError::NotReady) => return Ok(PullReply::NotReady),
        Err(PullError::NotSynced) => return Ok(PullReply::NotSynced),
        Err(PullError::Request(RequestError::Busy)) => return Ok(PullReply::Busy),
        Err(PullError::Request(_)) => return Ok(PullReply::NoResult),
    };
    let id = request.id;
    let canceller = session.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let outcome = request.wait(PULL_TIMEOUT);
        if outcome == Outcome::NoResult { canceller.cancel(id); }
        canceller.finish_pull(&uri, id);
        outcome
    }).await.map_err(|e| e.to_string())?;
    Ok(match outcome {
        Outcome::Result(report) => PullReply::Report { report },
        Outcome::NoResult => PullReply::NoResult,
        Outcome::Retrigger => PullReply::Retrigger,
        Outcome::Error { code, message } => PullReply::Error { code, message },
    })
}

/// A change restarted the document's debounce: its in-flight pull is cancelled.
#[tauri::command]
pub(crate) fn lsp_cancel_pull(window: WebviewWindow, state: State<'_, LspManager>, session: u64, uri: String) -> Result<(), String> {
    state.session(window.label(), session)?.cancel_pull(&uri);
    Ok(())
}

/// Decision 21: Craidd saved, or reloaded from disk, the manifest at
/// `path`. Each live session whose root contains it reloads its workspace,
/// unless it is not Ready, its health is `ok` (a healthy server reloads by
/// itself, measured), or the content equals the one it last reloaded
/// against. A manifest changed by another program is not detected here
/// (the accepted external-change limitation); the manual restart stays.
#[tauri::command]
pub(crate) fn lsp_manifest_changed(window: WebviewWindow, state: State<'_, LspManager>, path: String) -> Vec<u64> {
    let Some(lsp) = lock(&state.windows).get(window.label()).cloned() else { return vec![]; };
    let path = PathBuf::from(path);
    if path.file_name().and_then(|n| n.to_str()) != Some("Cargo.toml") { return vec![]; }
    let content = std::fs::read(&path).ok().map(|bytes| super::adapter::configuration_identity(&Value::String(String::from_utf8_lossy(&bytes).into()), &[]));
    let mut reloaded = vec![];
    for (generation, tracked) in lock(&lsp.sessions).iter_mut() {
        if !path.starts_with(&tracked.root) { continue; }
        let status = tracked.session.status();
        if status.phase != super::delivery::Phase::Ready || status.health.is_some_and(|h| h.health == "ok") { continue; }
        if content.is_some() && tracked.reloaded_against.get(&path) == content.as_ref() { continue; }
        if tracked.session.reload_workspace(&format!("{} changed", path.display())) {
            if let Some(hash) = content { tracked.reloaded_against.insert(path.clone(), hash); }
            reloaded.push(*generation);
        }
    }
    reloaded
}

#[tauri::command]
pub(crate) fn lsp_ack(window: WebviewWindow, state: State<'_, LspManager>, session: u64) -> Result<(), String> {
    state.session(window.label(), session)?.ack_batch();
    Ok(())
}

/// The status record by pull, so a reload or a missed batch loses nothing.
#[tauri::command]
pub(crate) fn lsp_status(window: WebviewWindow, state: State<'_, LspManager>, session: u64) -> Option<StatusRecord> {
    state.session(window.label(), session).ok().map(|s| s.status())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Logs { lines: Vec<LogLine>, dropped: u64 }

/// The whole bounded log ring; kept after the session ends, for the post-mortem.
#[tauri::command]
pub(crate) fn lsp_logs(window: WebviewWindow, state: State<'_, LspManager>, session: u64) -> Result<Logs, String> {
    let (lines, dropped) = state.session(window.label(), session)?.logs();
    Ok(Logs { lines, dropped })
}

/// The user's restart action. The old session stops; the next attach of
/// the active document starts a fresh one (no automatic restart).
#[tauri::command]
pub(crate) fn lsp_restart(window: WebviewWindow, state: State<'_, LspManager>, session: u64) -> Result<(), String> {
    let lsp = lock(&state.windows).get(window.label()).cloned().ok_or("no language-server session for this window")?;
    let tracked = lock(&lsp.sessions).remove(&session).ok_or("that session is gone")?;
    state.rust.forget(&tracked.project_folder);
    lsp.registry.retire(&tracked.identity);
    // A session that already ended is no longer in the registry: stopping it again changes nothing.
    tracked.session.stop();
    Ok(())
}

#[tauri::command]
pub(crate) fn lsp_close_solution(window: WebviewWindow, state: State<'_, LspManager>) {
    state.close_window_solution(window.label());
}

/// Window close hook (native event loop): never waits for a server.
pub(crate) fn close_window(app: &tauri::AppHandle, label: &str) {
    use tauri::Manager;
    let state = app.state::<LspManager>();
    state.close_window_solution(label);
    lock(&state.channels).remove(label);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ownership::tests::{languages, project, solution, Scripted};

    #[test]
    fn tabless_diagnostics_are_attributed_by_the_ownership_resolver_not_by_folder() {
        let mut app = project("app", "app/app.craidd", "rust");
        app.config_enabled = true;
        // A nested project inside app's folder is a boundary: its files are not app's.
        let nested = project("inner", "app/inner/inner.craidd", "rust");
        let s = solution(vec![app, nested]);
        let table: HashMap<String, LanguageFiles> = ["rust", "config"].iter().filter_map(|l| languages(l).map(|f| (l.to_string(), f))).collect();
        let mut probe = Scripted::default();
        probe.markers.insert("/ws/app/inner".into());
        let got = attribute(&["/ws/app/src/main.rs".into(), "/ws/app/inner/src/lib.rs".into(), "/ws/app/settings.json".into(), "/ws/elsewhere/x.rs".into()],
            &s, &table, &probe);
        assert_eq!(got[0].project_name.as_deref(), Some("app"));
        assert_eq!(got[1].project_name.as_deref(), Some("inner"), "the deepest folder is not guessed; the boundary rule decides");
        assert_eq!(got[2].project_name.as_deref(), Some("app"), "config-facet files are the project's");
        assert_eq!((got[3].project_id.clone(), got[3].ambiguous.len()), (None, 0), "not owned is external");
    }
}
