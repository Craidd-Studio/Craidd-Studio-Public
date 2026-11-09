//! `ServerIdentity → Session` for one window's solution session. Nothing
//! is shared across windows; closing the solution stops every session it
//! created. There is no automatic restart: a dead session stays dead until
//! the user restarts it.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Session generations are unique for the whole process, so a key the
/// frontend holds can never name a session from an earlier solution.
static GENERATION: AtomicU64 = AtomicU64::new(0);
use std::sync::Mutex;

use super::adapter::{ResolveNote, ServerContext, ServerIdentity};
use super::session::{Limits, Session};

#[derive(Default)]
struct State {
    closing: bool,
    sessions: HashMap<ServerIdentity, Session>,
    /// Navigated files without an owning project stay with the session
    /// that produced the location, for as long as they are open.
    bindings: HashMap<PathBuf, ServerIdentity>,
}

pub(crate) struct LspRegistry {
    state: Mutex<State>,
    limits: Limits,
    section: &'static str,
}

pub(crate) enum LaunchDecision {
    Attach(Session),
    Launch(Session),
    /// Not an error, and no warning: there is simply no launch.
    Skip(&'static str),
}

impl LspRegistry {
    pub(crate) fn new(limits: Limits, section: &'static str) -> Self {
        Self { state: Mutex::new(State::default()), limits, section }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> { self.state.lock().unwrap_or_else(|p| p.into_inner()) }

    /// Revalidate a deferred launch against the current world, then get or
    /// start. `current` is the adapter's fresh resolution: a changed
    /// toolchain or root simply yields a different identity.
    pub(crate) fn revalidate_and_ensure(&self, current: Result<ServerContext, ResolveNote>) -> LaunchDecision {
        let mut state = self.state();
        if state.closing { return LaunchDecision::Skip("solution is closing"); }
        let Ok(context) = current else { return LaunchDecision::Skip("project no longer resolves"); };
        let identity = context.identity();
        if let Some(session) = state.sessions.get(&identity) { return LaunchDecision::Attach(session.clone()); }
        let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
        let session = Session::start(context.launch_spec(self.section), self.limits.clone(), generation);
        state.sessions.insert(identity, session.clone());
        LaunchDecision::Launch(session)
    }

    pub(crate) fn session(&self, identity: &ServerIdentity) -> Option<Session> { self.state().sessions.get(identity).cloned() }
    pub(crate) fn by_generation(&self, generation: u64) -> Option<(ServerIdentity, Session)> {
        self.state().sessions.iter().find(|(_, s)| s.status().generation == generation).map(|(i, s)| (i.clone(), s.clone()))
    }
    pub(crate) fn len(&self) -> usize { self.state().sessions.len() }

    /// User-initiated restart of one identity (the status action).
    pub(crate) fn restart(&self, context: ServerContext) -> LaunchDecision {
        if let Some(old) = self.state().sessions.remove(&context.identity()) { old.stop(); }
        self.revalidate_and_ensure(Ok(context))
    }

    /// A superseded identity (for example after a toolchain change) is
    /// stopped once its last document closes.
    pub(crate) fn retire(&self, identity: &ServerIdentity) {
        let removed = {
            let mut state = self.state();
            state.bindings.retain(|_, bound| bound != identity);
            state.sessions.remove(identity)
        };
        if let Some(session) = removed { session.stop(); }
    }

    pub(crate) fn bind_navigated(&self, path: &Path, identity: ServerIdentity) {
        self.state().bindings.insert(path.to_path_buf(), identity);
    }

    /// The live session a navigated file is bound to. If that session has
    /// ended the tab stays open but unbound.
    pub(crate) fn binding(&self, path: &Path) -> Option<Session> {
        let state = self.state();
        let session = state.sessions.get(state.bindings.get(path)?)?;
        (!session.status().phase.is_terminal()).then(|| session.clone())
    }

    pub(crate) fn unbind(&self, path: &Path) { self.state().bindings.remove(path); }

    /// Solution or window close: refuse new launches, then stop everything.
    /// Never blocks on a server; the returned sessions can be observed.
    pub(crate) fn stop_all(&self) -> Vec<Session> {
        let sessions: Vec<Session> = {
            let mut state = self.state();
            state.closing = true;
            state.bindings.clear();
            state.sessions.drain().map(|(_, session)| session).collect()
        };
        for session in &sessions { session.stop(); }
        sessions
    }
}
