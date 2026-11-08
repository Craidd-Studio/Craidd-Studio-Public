//! `adapter::rust`: rust-analyzer, rooted at the Cargo workspace.
//!
//! Merge gate: this adapter must not merge until verifications V1, V5, V6,
//! V7 and V8 are recorded against a real rust-analyzer install (see
//! results-lsp-stage-1.md). Stop and revisit the design if V1 shows the
//! server cannot watch files itself.
use std::collections::HashMap;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{json, Value};

use super::adapter::{LanguageAdapter, ProjectRef, ResolveNote, ServerContext, ToolRef};

/// ◇ Bound on one `cargo metadata --no-deps` run (V8 measured ~9 ms on small workspaces).
pub(crate) const METADATA_TIMEOUT: Duration = Duration::from_secs(10);
/// Output cap; `--no-deps` output is small, a runaway is not.
const METADATA_MAX_BYTES: u64 = 16 * 1024 * 1024;

/// Craidd's defaults, never user-editable in Stage 1, hashed into identity.
/// `files.watcher = "server"`: the server watches files itself (V1 pending).
/// `cargo.targetDir = true`: rust-analyzer's own `target/rust-analyzer`
/// directory, so its check never holds the Build lock (V4 pending, G3).
pub(crate) fn default_init_options() -> Value {
    json!({ "files": { "watcher": "server" }, "cargo": { "targetDir": true } })
}

type Stamp = Option<(SystemTime, u64)>;
/// The workspace root and the manifests that belong to it: the root's own
/// and every member's (`cargo metadata --no-deps` lists members as packages).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Workspace { pub root: PathBuf, pub manifests: Vec<PathBuf> }
type Root = Result<Workspace, String>;

fn stamp(path: &Path) -> Stamp {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

struct Cached { stamps: Vec<(PathBuf, Stamp)>, root: Root }

#[derive(Default)]
struct Flight { done: Mutex<Option<Root>>, ready: Condvar }

pub(crate) struct RustAdapter {
    tool: Box<dyn Fn() -> Result<ToolRef, String> + Send + Sync>,
    cargo: Box<dyn Fn() -> Result<PathBuf, String> + Send + Sync>,
    timeout: Duration,
    cache: Mutex<HashMap<PathBuf, Cached>>,
    flights: Mutex<HashMap<PathBuf, Arc<Flight>>>,
    runs: AtomicUsize,
}

impl RustAdapter {
    pub(crate) fn new() -> Self {
        Self::with(
            || crate::commands::toolchain::resolve_tool_entry("rust", "language_server")
                .map(|tool| ToolRef { path: PathBuf::from(tool.path), version: tool.version }),
            || crate::commands::toolchain::resolve_tool("rust", "build"),
            METADATA_TIMEOUT)
    }

    pub(crate) fn with(tool: impl Fn() -> Result<ToolRef, String> + Send + Sync + 'static,
        cargo: impl Fn() -> Result<PathBuf, String> + Send + Sync + 'static, timeout: Duration) -> Self {
        Self { tool: Box::new(tool), cargo: Box::new(cargo), timeout, cache: Mutex::default(), flights: Mutex::default(), runs: AtomicUsize::new(0) }
    }

    /// A user restart retries discovery even if the manifest is unchanged.
    pub(crate) fn forget(&self, folder: &Path) {
        let key = folder.canonicalize().unwrap_or_else(|_| folder.to_path_buf());
        self.cache.lock().unwrap_or_else(|p| p.into_inner()).remove(&key);
    }

    pub(crate) fn metadata_runs(&self) -> usize { self.runs.load(Ordering::Acquire) }

    /// Cached by the canonical folder plus manifest stamps; failures are
    /// cached too; concurrent callers for one folder share one subprocess.
    pub(crate) fn workspace_root(&self, folder: &Path) -> Result<PathBuf, String> { self.workspace(folder).map(|w| w.root) }

    pub(crate) fn workspace(&self, folder: &Path) -> Root {
        let key = folder.canonicalize().unwrap_or_else(|_| folder.to_path_buf());
        if let Some(cached) = self.cache.lock().unwrap_or_else(|p| p.into_inner()).get(&key) {
            if cached.stamps.iter().all(|(path, old)| stamp(path) == *old) { return cached.root.clone(); }
        }
        let (flight, leader) = {
            let mut flights = self.flights.lock().unwrap_or_else(|p| p.into_inner());
            match flights.get(&key) {
                Some(flight) => (flight.clone(), false),
                None => { let flight = Arc::new(Flight::default()); flights.insert(key.clone(), flight.clone()); (flight, true) }
            }
        };
        if !leader {
            let mut done = flight.done.lock().unwrap_or_else(|p| p.into_inner());
            while done.is_none() { done = flight.ready.wait(done).unwrap_or_else(|p| p.into_inner()); }
            return done.clone().unwrap();
        }
        let manifest = key.join("Cargo.toml");
        let before = stamp(&manifest);
        let root = (self.cargo)().and_then(|cargo| { self.runs.fetch_add(1, Ordering::AcqRel); run_metadata(&cargo, &key, self.timeout) });
        let mut stamps = vec![(manifest, before)];
        if let Ok(found) = &root {
            let workspace = found.root.join("Cargo.toml");
            if workspace != stamps[0].0 { stamps.push((workspace.clone(), stamp(&workspace))); }
        }
        self.cache.lock().unwrap_or_else(|p| p.into_inner()).insert(key.clone(), Cached { stamps, root: root.clone() });
        *flight.done.lock().unwrap_or_else(|p| p.into_inner()) = Some(root.clone());
        flight.ready.notify_all();
        self.flights.lock().unwrap_or_else(|p| p.into_inner()).remove(&key);
        root
    }
}

/// Supervised like every IDE-owned child: registered before it can run,
/// bounded in time and output, never on the UI thread.
fn run_metadata(cargo: &Path, folder: &Path, timeout: Duration) -> Root {
    let mut command = Command::new(cargo);
    command.args(["metadata", "--no-deps", "--format-version", "1"]).current_dir(folder)
        .env("CARGO_TERM_COLOR", "never").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    unsafe { command.pre_exec(|| { if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); } Ok(()) }); }
    let mut child = crate::process_supervisor::spawn(&mut command).map_err(|e| format!("could not run cargo metadata: {e}"))?;
    let pid = child.id() as i32;
    let birth = crate::process_supervisor::process_birth(pid);
    let mut stdout = child.stdout.take().ok_or("cargo metadata output unavailable")?;
    let mut stderr = child.stderr.take().ok_or("cargo metadata errors unavailable")?;
    let out = std::thread::spawn(move || { let mut bytes = vec![]; let _ = (&mut stdout).take(METADATA_MAX_BYTES + 1).read_to_end(&mut bytes); bytes });
    let err = std::thread::spawn(move || { let mut bytes = vec![]; let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut bytes); bytes });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            _ => {
                match birth.and_then(|birth| crate::process_supervisor::capture_cancel_tree(pid, birth)) {
                    Some(cancel) => cancel(),
                    None => { let _ = child.kill(); }
                }
                let _ = child.wait();
                let _ = (out.join(), err.join());
                return Err(format!("cargo metadata timed out after {} s", timeout.as_secs_f32()));
            }
        }
    };
    let (bytes, errors) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    if !status.success() {
        let text = String::from_utf8_lossy(&errors);
        let first = text.lines().find(|line| !line.trim().is_empty()).unwrap_or("no error output").trim();
        return Err(format!("cargo metadata failed: {first}"));
    }
    if bytes.len() as u64 > METADATA_MAX_BYTES { return Err("cargo metadata output is too large".into()); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| format!("cargo metadata output is not JSON: {e}"))?;
    let root = value.get("workspace_root").and_then(Value::as_str).map(PathBuf::from)
        .ok_or_else(|| "cargo metadata reported no workspace_root".to_string())?;
    let mut manifests = vec![root.join("Cargo.toml")];
    for package in value.get("packages").and_then(Value::as_array).into_iter().flatten() {
        if let Some(path) = package.get("manifest_path").and_then(Value::as_str) { manifests.push(PathBuf::from(path)); }
    }
    manifests.sort();
    manifests.dedup();
    Ok(Workspace { root, manifests })
}

impl LanguageAdapter for RustAdapter {
    fn language(&self) -> &'static str { "rust" }
    fn document_extensions(&self) -> &'static [&'static str] { &["rs"] }
    fn configuration_section(&self) -> &'static str { "rust-analyzer" }
    fn workspace_layout(&self, project: &ProjectRef) -> Option<(PathBuf, Vec<PathBuf>)> { self.workspace(&project.folder).ok().map(|w| (w.root, w.manifests)) }

    fn resolve(&self, project: &ProjectRef) -> Result<ServerContext, ResolveNote> {
        let implementation = (self.tool)().map_err(ResolveNote)?;
        let (root, manifests, notes) = match self.workspace(&project.folder) {
            Ok(found) => (found.root, Some(found.manifests), vec![]),
            Err(error) => (project.folder.clone(), None, vec![format!("Cargo workspace discovery failed; using the project folder ({error})")]),
        };
        Ok(ServerContext { implementation, args: vec![], root, projects: vec![project.clone()],
            init_options: default_init_options(), env: vec![], lsp_language_id: "rust",
            // Decision 17: silent workspace-load and proc-macro failures are reported this way.
            experimental: serde_json::json!({ "serverStatusNotification": true }),
            // V27: health stays `error` after a fixed manifest until the workspace reloads.
            reload_method: Some("rust-analyzer/reloadWorkspace"),
            manifests, notes })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Dir(PathBuf);
    impl Drop for Dir { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    fn dir(name: &str) -> Dir {
        let path = std::env::temp_dir().join(format!("craidd-ra-{name}-{}-{}", std::process::id(),
            SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&path).unwrap();
        Dir(path.canonicalize().unwrap())
    }
    fn write(path: PathBuf, text: &str) { std::fs::create_dir_all(path.parent().unwrap()).unwrap(); std::fs::write(path, text).unwrap(); }
    fn krate(dir: &Path, name: &str) {
        write(dir.join("Cargo.toml"), &format!("[package]\nname = \"{name}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n"));
        write(dir.join("src/lib.rs"), "");
    }
    fn cargo() -> Result<PathBuf, String> {
        crate::commands::toolchain::find_executable("cargo").ok_or_else(|| "cargo not installed".into())
    }
    fn adapter() -> RustAdapter {
        RustAdapter::with(|| Ok(ToolRef { path: "/usr/bin/rust-analyzer".into(), version: "test".into() }), cargo, METADATA_TIMEOUT)
    }
    fn project(folder: &Path) -> ProjectRef {
        ProjectRef { id: folder.display().to_string(), name: "p".into(), language: "rust".into(), folder: folder.into() }
    }

    #[test]
    fn workspace_manifests_are_the_root_and_members_only() {
        let ws = dir("members");
        write(ws.0.join("Cargo.toml"), "[workspace]\nmembers = [\"a\"]\nresolver = \"2\"\n");
        krate(&ws.0.join("a"), "a");
        // A separate crate nested under the root, not a member (its own workspace).
        write(ws.0.join("tools/gen/Cargo.toml"), "[package]\nname = \"gen\"\nversion = \"0.1.0\"\nedition = \"2021\"\n[workspace]\n");
        write(ws.0.join("tools/gen/src/main.rs"), "fn main() {}");
        let found = adapter().workspace(&ws.0.join("a")).unwrap();
        let canon = |p: &Path| p.canonicalize().unwrap();
        let manifests: Vec<PathBuf> = found.manifests.iter().map(|p| canon(p)).collect();
        assert!(manifests.contains(&canon(&ws.0.join("Cargo.toml"))) && manifests.contains(&canon(&ws.0.join("a/Cargo.toml"))));
        assert!(!manifests.contains(&canon(&ws.0.join("tools/gen/Cargo.toml"))), "{manifests:?}");
        assert!(!super::super::commands::manifest_affects(&ws.0.join("tools/gen/Cargo.toml"), &found.root, &[&found.manifests]));
    }

    #[test]
    fn projects_in_one_cargo_workspace_share_one_identity() {
        let ws = dir("ws");
        write(ws.0.join("Cargo.toml"), "[workspace]\nmembers = [\"a\", \"b\"]\nresolver = \"2\"\n");
        krate(&ws.0.join("a"), "a");
        krate(&ws.0.join("b"), "b");
        let alone = dir("alone");
        krate(&alone.0, "alone");
        let adapter = adapter();
        let a = adapter.resolve(&project(&ws.0.join("a"))).unwrap();
        let b = adapter.resolve(&project(&ws.0.join("b"))).unwrap();
        let other = adapter.resolve(&project(&alone.0)).unwrap();
        assert_eq!(a.root, ws.0);
        assert_eq!(a.identity(), b.identity(), "one rust-analyzer for the workspace");
        assert_ne!(a.identity(), other.identity());
        assert!(a.notes.is_empty());
        // V8 in miniature: discovery never creates a lockfile.
        assert!(!ws.0.join("Cargo.lock").exists() && !alone.0.join("Cargo.lock").exists());
    }

    #[test]
    fn failures_fall_back_with_a_note_are_cached_and_retry_when_the_manifest_changes() {
        let broken = dir("broken");
        write(broken.0.join("Cargo.toml"), "[package\nname = ");
        let adapter = adapter();
        let first = adapter.resolve(&project(&broken.0)).unwrap();
        assert_eq!(first.root, broken.0, "falls back to the project folder");
        assert!(first.notes[0].starts_with("Cargo workspace discovery failed"));
        adapter.resolve(&project(&broken.0)).unwrap();
        assert_eq!(adapter.metadata_runs(), 1, "a broken manifest is not re-run on every open");
        std::thread::sleep(Duration::from_millis(20));
        krate(&broken.0, "fixed");
        let fixed = adapter.resolve(&project(&broken.0)).unwrap();
        assert!(fixed.notes.is_empty(), "{:?}", fixed.notes);
        assert_eq!(adapter.metadata_runs(), 2);
        adapter.forget(&broken.0);
        adapter.resolve(&project(&broken.0)).unwrap();
        assert_eq!(adapter.metadata_runs(), 3, "a user restart forces a retry");
    }

    #[test]
    fn concurrent_opens_in_one_project_share_one_subprocess() {
        let krate_dir = dir("flight");
        krate(&krate_dir.0, "flight");
        let slow = krate_dir.0.join("slow-cargo");
        // A cargo stand-in that is slow enough for the callers to overlap.
        crate::test_exec::install_script(&slow, &format!("#!/bin/sh\nsleep 0.3\nexec '{}' \"$@\"\n", cargo().unwrap().display()));
        let adapter = Arc::new(RustAdapter::with(|| Ok(ToolRef { path: "/x".into(), version: "t".into() }),
            move || Ok(slow.clone()), METADATA_TIMEOUT));
        let roots: Vec<_> = (0..8).map(|_| {
            let (adapter, folder) = (adapter.clone(), krate_dir.0.clone());
            std::thread::spawn(move || adapter.workspace_root(&folder))
        }).collect::<Vec<_>>().into_iter().map(|t| t.join().unwrap()).collect();
        assert!(roots.iter().all(|root| root.as_ref() == Ok(&krate_dir.0)));
        assert_eq!(adapter.metadata_runs(), 1);
    }

    #[test]
    fn a_hung_cargo_is_bounded_and_a_missing_server_is_a_note() {
        let hung = dir("hung");
        let fake = hung.0.join("cargo");
        crate::test_exec::install_script(&fake, "#!/bin/sh\nexec sleep 30\n");
        let adapter = RustAdapter::with(|| Ok(ToolRef { path: "/x".into(), version: "t".into() }), move || Ok(fake.clone()), Duration::from_millis(200));
        let began = Instant::now();
        let context = adapter.resolve(&project(&hung.0)).unwrap();
        assert!(began.elapsed() < Duration::from_secs(5));
        assert!(context.notes[0].contains("timed out"));
        let missing = RustAdapter::with(|| Err("No language_server tool found for rust.".into()), cargo, METADATA_TIMEOUT);
        assert_eq!(missing.resolve(&project(&hung.0)).err(), Some(ResolveNote("No language_server tool found for rust.".into())));
    }
}
