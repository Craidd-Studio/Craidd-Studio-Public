//! Window-owned native perf capture. Target processes are read-only identities, never owned children.
use crate::perf_model::{self as model, Options, SampleSet, TreeQuery, RAW_CAP};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap},
    fs::{self, File, OpenOptions},
    io::{self, BufReader, Read},
    os::unix::{
        fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
        process::{CommandExt, ExitStatusExt},
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

struct OwnedChild(Child);
impl std::ops::Deref for OwnedChild {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.0
    }
}
impl std::ops::DerefMut for OwnedChild {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.0
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}
fn spawn(c: &mut Command) -> io::Result<OwnedChild> {
    crate::process_supervisor::spawn(c).map(OwnedChild)
}
const POLL_MS: u64 = 25;
const THREAD_POLL_MS: u64 = 100;
const STDERR_LIMIT: usize = 64 * 1024;
const SCRIPT_LIMIT: u64 = 512 * 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub pid: i32,
    pub birth: u64,
}
pub fn identity(pid: i32) -> Result<Target, String> {
    if pid <= 1 {
        return Err("Select a user process with PID greater than 1".into());
    }
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).map_err(|e| e.to_string())?;
    let birth = stat
        .rsplit_once(')')
        .and_then(|(_, tail)| tail.split_whitespace().nth(19))
        .and_then(|v| v.parse().ok())
        .ok_or("Invalid process start tick")?;
    Ok(Target { pid, birth })
}
fn verify(target: &Target) -> Result<(), String> {
    if identity(target.pid)? != *target {
        return Err("Target exited or PID was reused; capture attribution is invalid".into());
    }
    Ok(())
}
fn check_target(target: &Target) -> Result<(), String> {
    verify(target)?;
    if fs::metadata(format!("/proc/{}", target.pid))
        .map_err(|e| e.to_string())?
        .uid()
        != unsafe { libc::geteuid() }
    {
        return Err("Only current-user processes can be sampled".into());
    }
    let status =
        fs::read_to_string(format!("/proc/{}/status", target.pid)).map_err(|e| e.to_string())?;
    let tracer = status
        .lines()
        .find_map(|l| l.strip_prefix("TracerPid:"))
        .and_then(|s| s.trim().parse::<u32>().ok())
        .ok_or("Cannot establish target debugger state")?;
    if tracer != 0 {
        return Err(format!("Target is traced by PID {tracer}. LLDB/perf coexistence is not qualified; end the debugger before sampling"));
    }
    Ok(())
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadIdentity {
    pub tid: u32,
    pub birth: u64,
    pub name: String,
}
fn threads(target: &Target) -> Result<Vec<ThreadIdentity>, String> {
    verify(target)?;
    let mut rows = Vec::new();
    for entry in fs::read_dir(format!("/proc/{}/task", target.pid))
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let Some(tid) = entry
            .file_name()
            .to_str()
            .and_then(|v| v.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(stat) = fs::read_to_string(entry.path().join("stat")) else {
            continue;
        };
        let Some(birth) = stat
            .rsplit_once(')')
            .and_then(|(_, s)| s.split_whitespace().nth(19))
            .and_then(|v| v.parse().ok())
        else {
            continue;
        };
        let name = fs::read_to_string(entry.path().join("comm"))
            .unwrap_or_default()
            .trim()
            .to_owned();
        rows.push(ThreadIdentity { tid, birth, name });
    }
    if rows.len() > 4096 {
        return Err("Target exceeds the 4096-thread capture limit".into());
    }
    rows.sort_by_key(|t| t.tid);
    if rows.is_empty() {
        return Err("Target has no readable threads".into());
    }
    Ok(rows)
}
fn find_tool(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|p| p.join(name))
        .find(|p| p.is_file() && fs::metadata(p).is_ok_and(|m| m.permissions().mode() & 0o111 != 0))
        .and_then(|p| p.canonicalize().ok())
}
fn command(tool: &Path) -> Command {
    let mut c = Command::new(tool);
    c.env("LC_ALL", "C")
        .env("DEBUGINFOD_URLS", "")
        .stdin(Stdio::null());
    c
}
fn drain(mut stream: impl Read, cap: usize) -> (Vec<u8>, u64) {
    let mut kept = Vec::new();
    let mut total = 0_u64;
    let mut b = [0_u8; 8192];
    while let Ok(n) = stream.read(&mut b) {
        if n == 0 {
            break;
        }
        total += n as u64;
        let room = cap.saturating_sub(kept.len());
        kept.extend_from_slice(&b[..n.min(room)]);
    }
    (kept, total)
}
fn stop_owned(child: &mut Child, signal: i32) {
    unsafe {
        libc::kill(child.id() as i32, signal);
    }
}
// Never signal after reaping: while unreaped, this PID belongs to our Child.
fn wait_tool(
    child: &mut Child,
    timeout: Duration,
    cancel: Option<&AtomicBool>,
) -> Result<std::process::ExitStatus, String> {
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(status);
        }
        if start.elapsed() > timeout || cancel.is_some_and(|v| v.load(Ordering::Acquire)) {
            stop_owned(child, libc::SIGKILL);
            let _ = child.wait();
            return Err("Collector-owned analysis stopped or exceeded its deadline".into());
        }
        thread::sleep(Duration::from_millis(POLL_MS));
    }
}
fn output(mut c: Command, timeout: Duration) -> Result<String, String> {
    c.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = spawn(&mut c).map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = thread::spawn(move || drain(stdout, 1024 * 1024));
    let err = thread::spawn(move || drain(stderr, STDERR_LIMIT));
    let status = wait_tool(&mut child, timeout, None);
    let (text, total) = out.join().map_err(|_| "Tool output reader failed")?;
    let (err, _) = err.join().map_err(|_| "Tool diagnostic reader failed")?;
    let status = status?;
    if !status.success() {
        return Err(String::from_utf8_lossy(&err).into());
    }
    if total > text.len() as u64 {
        return Err("Tool metadata exceeded its 1 MiB limit".into());
    }
    Ok(String::from_utf8_lossy(&text).into())
}
pub fn discover() -> serde_json::Value {
    let perf = find_tool("perf");
    let version = perf.as_ref().map(|p| {
        let mut c = command(p);
        c.arg("--version");
        output(c, Duration::from_secs(3))
    });
    let policy = |p: &str| fs::read_to_string(p).ok().map(|v| v.trim().to_owned());
    let cap = fs::read_to_string("/proc/self/status").ok().and_then(|s| {
        s.lines()
            .find_map(|l| l.strip_prefix("CapEff:").map(|v| v.trim().to_owned()))
    });
    serde_json::json!({"available":perf.is_some() && version.as_ref().is_some_and(|r|r.is_ok()),"path":perf,"version":version.as_ref().and_then(|r|r.as_ref().ok()).map(|v|v.trim()),
        "reason":if perf.is_none(){Some("perf executable was not found on PATH".to_owned())}else{version.and_then(Result::err)},
        "perfEventParanoid":policy("/proc/sys/kernel/perf_event_paranoid"),"kptrRestrict":policy("/proc/sys/kernel/kptr_restrict"),"effectiveCapabilitiesHex":cap,
        "modes":{"currentUserUserSpace":"requires a successful capture; policy values alone are insufficient","kernel":"not supported by this slice","otherUsers":"not supported by this slice"},
        "event":"cpu-clock:u","policy":"read only; no elevation or policy changes","debuginfod":"disabled for this slice"})
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub id: String,
    pub source_kind: String,
    pub generation: u32,
    pub label: String,
    pub solution: String,
    pub host: Target,
    pub attribution_valid: bool,
    pub target: Target,
    pub profile_id: String,
    pub owner: String,
    pub created_ms: u64,
    pub options: Options,
    pub event: String,
    pub clock_domain: String,
    pub clock_mapping: Option<String>,
    pub state: String,
    pub reasons: Vec<String>,
    pub pinned: bool,
    pub raw_sha256: Option<String>,
    pub raw_bytes: u64,
    pub raw_limit: u64,
    pub estimated_raw_bytes: u64,
    pub threads_at_start: Vec<ThreadIdentity>,
    pub threads_gained: Vec<ThreadIdentity>,
    pub omitted_thread_observations: u64,
    pub thread_poll_ms: u64,
    pub perf_version: String,
    pub record_argv: Vec<String>,
    pub collector_identity: Option<Target>,
    pub collector_exit: Option<i32>,
    pub collector_signal: Option<i32>,
    pub coverage: model::Coverage,
    pub summary: serde_json::Value,
    pub module_identity_ms: u64,
    pub decode_and_parse_ms: u64,
    pub parser_cpu_ms: u64,
    pub loss_scan_ms: u64,
    pub build_ids: Vec<SymbolIdentity>,
    pub jit_map: Option<PerfMapIdentity>,
    pub stderr: String,
    pub omitted_stderr_bytes: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolIdentity {
    pub module: String,
    pub captured_build_id: String,
    pub current_build_id: Option<String>,
    pub state: String,
    #[serde(default)]
    pub debug_files: Vec<DebugIdentity>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugIdentity {
    pub path: String,
    pub build_id: Option<String>,
    pub state: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfMapIdentity {
    pub path: String,
    pub bytes: u64,
    pub sha256: Option<String>,
    pub state: String,
    pub basis: String,
}
// Inspect a bounded set of conventional local debug candidates; perf remains the decoder.
// A candidate mismatch is conservative: withhold this module's names and source mappings.
fn elf_build_id(tool: &Path, path: &Path) -> Option<String> {
    let mut c = command(tool);
    c.args(["-n", "--"]).arg(path);
    output(c, Duration::from_secs(2))
        .ok()?
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix("Build ID:")
                .map(|v| v.trim().to_string())
        })
}
fn debug_identities(tool: &Path, module: &Path, expected: &str) -> Vec<DebugIdentity> {
    let mut candidates = BTreeSet::new();
    let mut c = command(tool);
    c.args(["--string-dump=.gnu_debuglink", "--"]).arg(module);
    if let Ok(text) = output(c, Duration::from_secs(2)) {
        let name = text.lines().find_map(|line| {
            let (offset, name) = line.trim().split_once(']')?;
            (offset.trim_start_matches('[').trim() == "0").then(|| name.trim())
        });
        if let (Some(name), Some(parent)) = (name, module.parent()) {
            if !name.is_empty() && name != "." && name != ".." && !name.contains('/') {
                candidates.insert(parent.join(name));
                candidates.insert(parent.join(".debug").join(name));
                if let Ok(relative) = parent.strip_prefix("/") {
                    candidates.insert(Path::new("/usr/lib/debug").join(relative).join(name));
                }
            }
        }
    }
    if expected.len() > 2 && expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        candidates.insert(
            Path::new("/usr/lib/debug/.build-id")
                .join(&expected[..2])
                .join(format!("{}.debug", &expected[2..])),
        );
    }
    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .map(|path| {
            let id = elf_build_id(tool, &path);
            let state = match id.as_deref() {
                Some(id) if id == expected => "matchedCandidate",
                Some(_) => "mismatch",
                None => "unverified",
            };
            DebugIdentity {
                path: path.to_string_lossy().into(),
                build_id: id,
                state: state.into(),
            }
        })
        .collect()
}
fn inspect_perf_map(pid: i32) -> PerfMapIdentity {
    let path = format!("/tmp/perf-{pid}.map");
    let mut result = PerfMapIdentity {
        path: path.clone(),
        bytes: 0,
        sha256: None,
        state: "missing".into(),
        basis:
            "Names reported by perf from the PID map; no ELF build-ID or source-line verification"
                .into(),
    };
    let read = (|| -> Result<(u64, String), String> {
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&path)
            .map_err(|e| {
                if e.kind() == io::ErrorKind::NotFound {
                    "missing".into()
                } else {
                    e.to_string()
                }
            })?;
        let before = file.metadata().map_err(|e| e.to_string())?;
        if !before.is_file()
            || before.uid() != unsafe { libc::geteuid() }
            || before.len() > 16 * 1024 * 1024
        {
            return Err("Map is not a current-user regular file within the 16 MiB limit".into());
        }
        let mut data = Vec::new();
        file.by_ref()
            .take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        let after = file.metadata().map_err(|e| e.to_string())?;
        if data.len() > 16 * 1024 * 1024
            || before.len() != after.len()
            || before.mtime() != after.mtime()
            || before.mtime_nsec() != after.mtime_nsec()
        {
            return Err("Map changed while being read".into());
        }
        Ok((data.len() as u64, format!("{:x}", Sha256::digest(&data))))
    })();
    match read {
        Ok((bytes, hash)) => {
            result.bytes = bytes;
            result.sha256 = Some(hash);
            result.state = "observed".into();
        }
        Err(reason) => result.state = reason,
    }
    result
}
struct Job {
    manifest: Mutex<Manifest>,
    data: Mutex<Option<SampleSet>>,
    stop: AtomicBool,
    closed: AtomicBool,
    finished: AtomicBool,
    worker: Mutex<Option<JoinHandle<()>>>,
    dir: PathBuf,
}
struct Registry {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
}
impl Drop for Registry {
    fn drop(&mut self) {
        if let Ok(jobs) = self.jobs.get_mut() {
            for j in jobs.values() {
                j.closed.store(true, Ordering::Release);
                j.stop.store(true, Ordering::Release);
            }
            for j in jobs.values() {
                if let Some(h) = j.worker.lock().unwrap().take() {
                    let _ = h.join();
                }
            }
        }
    }
}
#[derive(Clone)]
pub struct PerfManager {
    registry: Arc<Registry>,
    root: PathBuf,
}
impl PerfManager {
    pub fn new(root: PathBuf) -> Self {
        Self {
            registry: Arc::new(Registry {
                jobs: Mutex::new(HashMap::new()),
            }),
            root,
        }
    }
    pub fn shutdown(&self) {
        let jobs: Vec<_> = self
            .registry
            .jobs
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect();
        for j in &jobs {
            j.closed.store(true, Ordering::Release);
            j.stop.store(true, Ordering::Release);
        }
        for j in &jobs {
            if let Some(h) = j.worker.lock().unwrap().take() {
                let _ = h.join();
            }
            *j.data.lock().unwrap() = None;
        }
    }
    pub fn close(&self, owner: &str) {
        for j in self.registry.jobs.lock().unwrap().values() {
            if j.manifest.lock().unwrap().owner == owner {
                j.closed.store(true, Ordering::Release);
                j.stop.store(true, Ordering::Release);
                *j.data.lock().unwrap() = None;
            }
        }
    }
    pub fn stop_owner(&self, owner: &str, profile: Option<&str>, reason: &str) {
        for j in self.registry.jobs.lock().unwrap().values() {
            let mut m = j.manifest.lock().unwrap();
            if m.owner == owner && profile.is_none_or(|p| p == m.profile_id) && busy(&m) {
                m.reasons.push(reason.chars().take(1024).collect());
                j.stop.store(true, Ordering::Release);
            }
        }
    }
    pub fn active_target(&self, target: &Target) -> bool {
        self.registry.jobs.lock().unwrap().values().any(|j| {
            let m = j.manifest.lock().unwrap();
            m.target == *target && matches!(m.state.as_str(), "recording" | "starting" | "stopping")
        })
    }
    /// Shared by the real debugger attach route and native qualification harness.
    pub fn refuse_debugger(&self, target: &Target) -> Result<(), String> {
        if self.active_target(target) {
            Err("Stop the active perf capture before attaching LLDB; this collector/debugger pair has not been qualified".into())
        } else {
            Ok(())
        }
    }
    fn directory(&self, solution: &Path) -> Result<(String, PathBuf), String> {
        let solution = solution
            .canonicalize()
            .map_err(|e| format!("Solution unavailable: {e}"))?;
        if !solution.is_file() || solution.extension().and_then(|s| s.to_str()) != Some("cln") {
            return Err("A saved .cln solution is required for capture storage".into());
        }
        let name = solution.to_string_lossy().into_owned();
        let hash = format!("{:x}", Sha256::digest(name.as_bytes()));
        Ok((name, self.root.join(hash)))
    }
    fn job(&self, owner: &str, solution: &Path, id: &str) -> Result<Arc<Job>, String> {
        let (solution, _) = self.directory(solution)?;
        let jobs = self.registry.jobs.lock().map_err(|e| e.to_string())?;
        let j = jobs
            .get(id)
            .ok_or("Capture is not loaded; reopen it from the solution capture list")?;
        {
            let m = j.manifest.lock().map_err(|e| e.to_string())?;
            if m.owner != owner || m.solution != solution {
                return Err("This capture belongs to another window or solution".into());
            }
        }
        Ok(j.clone())
    }
    pub fn prepare(
        &self,
        solution: &Path,
        target: &Target,
        options: &Options,
    ) -> Result<serde_json::Value, String> {
        self.directory(solution)?;
        options.validate()?;
        check_target(target)?;
        let t = threads(target)?;
        Ok(
            serde_json::json!({"target":target,"threadsAtStart":t,"event":"cpu-clock:u","options":options,
            "expectedSampleIntervalMs":1000.0/options.frequency as f64,"sampleIntervalBasis":"requested CPU-clock interval per on-CPU thread; wall interval can be longer","estimatedRawBytes":options.estimated_bytes(t.len()),
            "estimateBasis":"FP and 8192-byte DWARF fixture bytes/sample; 16384 extrapolated; actual output varies",
            "rawLimitBytes":RAW_CAP,"rawLimitStatus":"accepted","threadCoverage":"threads existing at capture start; later threads excluded",
            "threadObservationWarning":"100 ms polling can miss short-lived threads",
            "unwindCoverageWarning":match options.unwind {model::Unwind::Fp=>"An FP tree can be missing callers above modules built without frame pointers",model::Unwind::Dwarf{..}=>"DWARF coverage depends on unwind information and the selected captured stack size"},
            "clockDomain":"CLOCK_MONOTONIC; separate axis, no session mapping","discovery":discover()}),
        )
    }
    pub fn start(
        &self,
        owner: &str,
        solution: &Path,
        profile_id: &str,
        target: Target,
        options: Options,
    ) -> Result<String, String> {
        options.validate()?;
        check_target(&target)?;
        let (solution, base) = self.directory(solution)?;
        let perf =
            find_tool("perf").ok_or("perf is not available: executable missing from PATH")?;
        let mut version_cmd = command(&perf);
        version_cmd.arg("--version");
        let version = output(version_cmd, Duration::from_secs(3))?;
        let initial = threads(&target)?;
        let mut jobs = self.registry.jobs.lock().map_err(|e| e.to_string())?;
        if jobs.values().any(|j| {
            let m = j.manifest.lock().unwrap();
            (m.owner == owner || m.target == target) && busy(&m)
        }) {
            return Err("A capture for this window or target is already running".into());
        }
        make_room(&mut jobs)?;
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        let id = format!(
            "capture-{}-{}-{}",
            now_ms(),
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let dir = base.join(&id);
        fs::create_dir(&dir).map_err(|e| e.to_string())?;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        let mut m = Manifest {
            version: 1,
            id: id.clone(),
            source_kind: "nativeStackSamples".into(),
            generation: 1,
            label: format!("perf · PID {}", target.pid),
            solution,
            host: identity(std::process::id() as i32)?,
            attribution_valid: true,
            target,
            profile_id: profile_id.into(),
            owner: owner.into(),
            created_ms: now_ms(),
            estimated_raw_bytes: options.estimated_bytes(initial.len()),
            options,
            event: "cpu-clock:u".into(),
            clock_domain: "CLOCK_MONOTONIC".into(),
            clock_mapping: None,
            state: "starting".into(),
            reasons: vec![],
            pinned: false,
            raw_sha256: None,
            raw_bytes: 0,
            raw_limit: RAW_CAP,
            threads_at_start: initial,
            threads_gained: vec![],
            omitted_thread_observations: 0,
            thread_poll_ms: THREAD_POLL_MS,
            perf_version: version.trim().into(),
            record_argv: vec![],
            collector_identity: None,
            collector_exit: None,
            collector_signal: None,
            coverage: model::Coverage::default(),
            summary: serde_json::Value::Null,
            module_identity_ms: 0,
            decode_and_parse_ms: 0,
            parser_cpu_ms: 0,
            loss_scan_ms: 0,
            build_ids: vec![],
            jit_map: None,
            stderr: String::new(),
            omitted_stderr_bytes: 0,
        };
        let tids = m
            .threads_at_start
            .iter()
            .map(|t| t.tid.to_string())
            .collect::<Vec<_>>()
            .join(",");
        m.record_argv = vec![
            "record".into(),
            "--no-buildid-cache".into(),
            "--clockid".into(),
            "mono".into(),
            "--timestamp".into(),
            "--per-thread".into(),
            "--no-inherit".into(),
            "--user-callchains".into(),
            "-e".into(),
            "cpu-clock:u".into(),
            "-F".into(),
            m.options.frequency.to_string(),
            "--call-graph".into(),
            m.options.call_graph(),
            "-t".into(),
            tids,
            "-o".into(),
            dir.join("perf.data").to_string_lossy().into(),
        ];
        write_manifest(&dir, &m)?;
        let job = Arc::new(Job {
            manifest: Mutex::new(m),
            data: Mutex::new(None),
            stop: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            worker: Mutex::new(None),
            dir,
        });
        jobs.insert(id.clone(), job.clone());
        let j = job.clone();
        let h = thread::Builder::new()
            .name("perf-capture".into())
            .spawn(move || {
                let result = record(&j, &perf);
                if let Err(e) = result {
                    let mut m = j.manifest.lock().unwrap();
                    m.reasons.push(e);
                    m.state = if m.raw_bytes > 0 { "partial" } else { "failed" }.into();
                }
                if j.closed.load(Ordering::Acquire) {
                    *j.data.lock().unwrap() = None;
                }
                let m = j.manifest.lock().unwrap();
                let _ = write_manifest(&j.dir, &m);
                let _ = retain(&j.dir.parent().unwrap().to_path_buf(), &m.id);
                j.finished.store(true, Ordering::Release);
            })
            .map_err(|e| e.to_string())?;
        *job.worker.lock().unwrap() = Some(h);
        Ok(id)
    }
    pub fn status(&self, owner: &str, solution: &Path, id: &str) -> Result<Manifest, String> {
        let job = self.job(owner, solution, id)?;
        let mut result = job.manifest.lock().unwrap().clone();
        if !busy(&result) && !job.finished.load(Ordering::Acquire) {
            result.state = "finalizing".into();
        }
        Ok(result)
    }
    pub fn stop(&self, owner: &str, solution: &Path, id: &str) -> Result<(), String> {
        self.job(owner, solution, id)?
            .stop
            .store(true, Ordering::Release);
        Ok(())
    }
    pub fn tree(
        &self,
        owner: &str,
        solution: &Path,
        id: &str,
        query: &TreeQuery,
    ) -> Result<serde_json::Value, String> {
        let job = self.job(owner, solution, id)?;
        let data = job.data.lock().map_err(|e| e.to_string())?;
        data.as_ref()
            .ok_or("Stacks are not ready; inspect capture state and diagnostics")?
            .branch(query)
    }
    pub fn source(
        &self,
        owner: &str,
        solution: &Path,
        id: &str,
        frame_id: u32,
    ) -> Result<model::SourceLocation, String> {
        let job = self.job(owner, solution, id)?;
        let frame = {
            let data = job.data.lock().unwrap();
            let frame = data
                .as_ref()
                .and_then(|s| s.frames.get(frame_id as usize))
                .filter(|f| f.resolved)
                .ok_or("Frame has no verified source mapping")?
                .clone();
            frame
        };
        let build = job
            .manifest
            .lock()
            .unwrap()
            .build_ids
            .iter()
            .find(|b| b.module == frame.module && b.state == "matched")
            .cloned()
            .ok_or("Module build identity is not verified")?;
        let source = frame.source.ok_or("No source line in debug information")?;
        let path = PathBuf::from(&source.path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let root = solution
            .canonicalize()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("Solution has no directory")?
            .to_path_buf();
        if !path.is_file() || !path.starts_with(root) {
            return Err(
                "Debug source lies outside this solution directory; no implicit path remapping"
                    .into(),
            );
        }
        let tool = find_tool("readelf")
            .ok_or("readelf is required to verify the current module build ID")?;
        let mut c = command(&tool);
        c.args(["-n", "--"]).arg(&build.module);
        let text = output(c, Duration::from_secs(2))?;
        let actual = text
            .lines()
            .find_map(|l| l.trim().strip_prefix("Build ID:").map(str::trim));
        if actual != Some(build.captured_build_id.as_str()) {
            return Err("Module changed since parsing; source navigation refused".into());
        }
        let current_debug =
            debug_identities(&tool, Path::new(&build.module), &build.captured_build_id);
        if current_debug.iter().any(|d| d.state != "matchedCandidate")
            || build.debug_files.iter().any(|old| {
                !current_debug.iter().any(|d| {
                    d.path == old.path
                        && d.build_id == old.build_id
                        && d.state == "matchedCandidate"
                })
            })
        {
            return Err(
                "Separate debug file changed or mismatched; source navigation refused".into(),
            );
        }
        Ok(model::SourceLocation {
            path: path.to_string_lossy().into(),
            line: source.line,
        })
    }
    pub fn list(&self, solution: &Path) -> Result<Vec<Manifest>, String> {
        let (_, base) = self.directory(solution)?;
        recover_and_list(&base)
    }
    pub fn pin(&self, solution: &Path, id: &str, pinned: bool) -> Result<(), String> {
        let (_, base) = self.directory(solution)?;
        if self
            .registry
            .jobs
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|j| !j.finished.load(Ordering::Acquire))
        {
            return Err("Capture is still finalizing".into());
        }
        let dir = capture_dir(&base, id)?;
        let mut m = read_manifest(&dir)?;
        if busy(&m) {
            return Err("Pin a completed capture".into());
        }
        m.pinned = pinned;
        write_manifest(&dir, &m)?;
        for j in self.registry.jobs.lock().unwrap().values() {
            let mut live = j.manifest.lock().unwrap();
            if live.id == id && live.solution == m.solution {
                live.pinned = pinned;
            }
        }
        retain(&base, "")
    }
    pub fn reopen(&self, owner: &str, solution: &Path, id: &str) -> Result<(), String> {
        let (solution, base) = self.directory(solution)?;
        let dir = capture_dir(&base, id)?;
        let mut m = read_manifest(&dir)?;
        if m.solution != solution {
            return Err("Capture solution provenance mismatch".into());
        }
        let mut jobs = self.registry.jobs.lock().unwrap();
        if let Some(j) = jobs.get(id) {
            let existing = j.manifest.lock().unwrap();
            if busy(&existing) || !j.finished.load(Ordering::Acquire) {
                return Err("Capture is still finishing; retry reopening after it stops".into());
            }
            if !j.closed.load(Ordering::Acquire) {
                if existing.owner == owner && j.data.lock().unwrap().is_some() {
                    return Ok(());
                }
                if existing.owner != owner {
                    return Err("Capture is already loaded in another window".into());
                }
            }
            drop(existing);
            jobs.remove(id);
        }
        if busy(&m) {
            return Err(
                "Capture was interrupted or is still running; refresh the capture list".into(),
            );
        }
        let perf = find_tool("perf").ok_or("perf is required to reopen raw stack data")?;
        make_room(&mut jobs)?;
        m.owner = owner.into();
        m.state = "parsing".into();
        let job = Arc::new(Job {
            manifest: Mutex::new(m),
            data: Mutex::new(None),
            stop: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            worker: Mutex::new(None),
            dir,
        });
        jobs.insert(id.into(), job.clone());
        let j = job.clone();
        let h = thread::spawn(move || {
            if let Err(e) = decode(&j, &perf) {
                let mut m = j.manifest.lock().unwrap();
                m.reasons.push(e);
                m.state = "partial".into();
            }
            if j.closed.load(Ordering::Acquire) {
                *j.data.lock().unwrap() = None;
            }
            let _ = write_manifest(&j.dir, &j.manifest.lock().unwrap());
            j.finished.store(true, Ordering::Release);
        });
        *job.worker.lock().unwrap() = Some(h);
        Ok(())
    }
}
fn busy(m: &Manifest) -> bool {
    matches!(
        m.state.as_str(),
        "starting" | "recording" | "stopping" | "parsing"
    )
}
fn make_room(jobs: &mut HashMap<String, Arc<Job>>) -> Result<(), String> {
    if jobs.len() >= 2 {
        let id = jobs
            .iter()
            .filter(|(_, j)| {
                j.finished.load(Ordering::Acquire) && !busy(&j.manifest.lock().unwrap())
            })
            .min_by_key(|(_, j)| j.manifest.lock().unwrap().created_ms)
            .map(|(id, _)| id.clone())
            .ok_or("Two captures are already active; stop one before opening another")?;
        jobs.remove(&id);
    }
    Ok(())
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn write_manifest(dir: &Path, m: &Manifest) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(m).map_err(|e| e.to_string())?;
    let temp = dir.join("manifest.new");
    fs::write(&temp, data).map_err(|e| e.to_string())?;
    fs::rename(temp, dir.join("manifest.json")).map_err(|e| e.to_string())
}
fn capture_dir(base: &Path, id: &str) -> Result<PathBuf, String> {
    if !id.starts_with("capture-")
        || id.len() > 96
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase() || b == b'-')
    {
        return Err("Invalid capture identifier".into());
    }
    let dir = base.join(id);
    if !fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
        return Err("Capture directory is unavailable".into());
    }
    Ok(dir)
}
fn read_manifest(dir: &Path) -> Result<Manifest, String> {
    let path = dir.join("manifest.json");
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 2 * 1024 * 1024 {
        return Err("Invalid capture manifest".into());
    }
    let m: Manifest = serde_json::from_reader(File::open(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if m.version != 1 || dir.file_name().and_then(|s| s.to_str()) != Some(m.id.as_str()) {
        return Err("Unsupported or mismatched capture manifest".into());
    }
    Ok(m)
}
fn recover_and_list(base: &Path) -> Result<Vec<Manifest>, String> {
    if !base.exists() {
        return Ok(vec![]);
    }
    let mut captures = Vec::new();
    for entry in fs::read_dir(base).map_err(|e| e.to_string())?.flatten() {
        let id = entry.file_name().to_string_lossy().into_owned();
        let Ok(dir) = capture_dir(base, &id) else {
            continue;
        };
        let Ok(mut m) = read_manifest(&dir) else {
            continue;
        };
        if busy(&m) && !identity(m.host.pid).is_ok_and(|host| host == m.host) {
            m.state = "partial".into();
            m.reasons
                .push("IDE stopped before capture finalization; raw output retained".into());
            write_manifest(&dir, &m)?;
        }
        captures.push(m);
    }
    captures.sort_by_key(|m| std::cmp::Reverse(m.created_ms));
    Ok(captures)
}
fn retain(base: &Path, active: &str) -> Result<(), String> {
    let rows = recover_and_list(base)?;
    let mut unpinned = usize::from(rows.iter().any(|m| m.id == active && !m.pinned && !busy(m)));
    for m in rows {
        if m.pinned || busy(&m) || m.id == active {
            continue;
        }
        unpinned += 1;
        if unpinned > 10 {
            fs::remove_dir_all(capture_dir(base, &m.id)?).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn observe_threads(m: &mut Manifest, seen: &mut BTreeSet<(u32, u64)>, rows: Vec<ThreadIdentity>) {
    for t in rows {
        if seen.contains(&(t.tid, t.birth)) {
            continue;
        }
        if m.threads_gained.len() < 4096 {
            seen.insert((t.tid, t.birth));
            m.threads_gained.push(t);
        } else {
            m.omitted_thread_observations = m.omitted_thread_observations.saturating_add(1);
        }
    }
}

fn record(job: &Job, perf: &Path) -> Result<(), String> {
    let m = job.manifest.lock().unwrap().clone();
    check_target(&m.target)?;
    let mut c = command(perf);
    c.args(&m.record_argv)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    unsafe {
        c.pre_exec(|| {
            let limit = libc::rlimit {
                rlim_cur: RAW_CAP,
                rlim_max: RAW_CAP,
            };
            if libc::setrlimit(libc::RLIMIT_FSIZE, &limit) != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut child = spawn(&mut c).map_err(|e| format!("Cannot start perf: {e}"))?;
    job.manifest.lock().unwrap().collector_identity = identity(child.id() as i32).ok();
    let error_stream = child.stderr.take().unwrap();
    let reader = thread::spawn(move || drain(error_stream, STDERR_LIMIT));
    let started = Instant::now();
    let mut last_thread_poll = Instant::now() - Duration::from_secs(1);
    let mut seen: BTreeSet<_> = m
        .threads_at_start
        .iter()
        .map(|t| (t.tid, t.birth))
        .collect();
    let mut stopping: Option<Instant> = None;
    let mut attribution_invalid = false;
    {
        let mut current = job.manifest.lock().unwrap();
        current.state = "recording".into();
        write_manifest(&job.dir, &current)?;
    }
    let status =
        loop {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            let bytes = fs::metadata(job.dir.join("perf.data")).map_or(0, |m| m.len());
            let mut reasons = Vec::new();
            if bytes >= RAW_CAP.saturating_sub(32 * 1024 * 1024) {
                reasons.push("Raw output cap reached; collector stopped (512 MiB cap)");
            }
            if job.stop.load(Ordering::Acquire) {
                reasons.push(if job.closed.load(Ordering::Acquire) {
                    "Owning window or IDE closed"
                } else {
                    "Stopped by user"
                });
            }
            if started.elapsed() >= Duration::from_secs(m.options.duration_seconds.into()) {
                reasons.push("Timed duration completed");
            }
            if last_thread_poll.elapsed() >= Duration::from_millis(THREAD_POLL_MS) {
                if let Err(e) = check_target(&m.target) {
                    if identity(m.target.pid).is_ok_and(|t| t != m.target) {
                        attribution_invalid = true;
                    }
                    reasons.push("Target exited, changed incarnation or acquired a debugger");
                    let mut current = job.manifest.lock().unwrap();
                    if !current.reasons.contains(&e) {
                        current.reasons.push(e);
                    }
                }
                if let Ok(rows) = threads(&m.target) {
                    if rows.iter().any(|t| {
                        m.threads_at_start
                            .iter()
                            .any(|original| original.tid == t.tid && original.birth != t.birth)
                    }) {
                        attribution_invalid = true;
                        reasons.push("An included TID was reused; attribution invalidated");
                    }
                    observe_threads(&mut job.manifest.lock().unwrap(), &mut seen, rows);
                }
                last_thread_poll = Instant::now();
            }
            {
                let mut current = job.manifest.lock().unwrap();
                current.raw_bytes = bytes;
            }
            if !reasons.is_empty() && stopping.is_none() {
                let mut current = job.manifest.lock().unwrap();
                current.state = "stopping".into();
                current
                    .reasons
                    .extend(reasons.iter().map(|s| s.to_string()));
                drop(current);
                stop_owned(&mut child, libc::SIGINT);
                stopping = Some(Instant::now());
            }
            if stopping.is_some_and(|t| t.elapsed() > Duration::from_secs(5)) {
                stop_owned(&mut child, libc::SIGKILL);
                job.manifest.lock().unwrap().reasons.push(
                    "Collector did not finalize within 5 seconds; killed owned collector".into(),
                );
                break child.wait().map_err(|e| e.to_string())?;
            }
            thread::sleep(Duration::from_millis(POLL_MS));
        };
    let (stderr, total) = reader
        .join()
        .map_err(|_| "Collector diagnostic reader failed")?;
    {
        let mut current = job.manifest.lock().unwrap();
        current.collector_exit = status.code();
        current.collector_signal = status.signal();
        current.stderr = String::from_utf8_lossy(&stderr).into();
        current.omitted_stderr_bytes = total.saturating_sub(stderr.len() as u64);
        current.raw_bytes = fs::metadata(job.dir.join("perf.data")).map_or(0, |m| m.len());
        if status.signal() == Some(libc::SIGXFSZ) {
            current
                .reasons
                .push("Raw output cap reached (OS file-size limit)".into());
        }
        if !status.success() && !(stopping.is_some() && status.signal() == Some(libc::SIGINT)) {
            current
                .reasons
                .push("Collector failed or exited unexpectedly; inspect diagnostics".into());
        }
        if identity(m.target.pid).is_ok_and(|t| t != m.target) {
            attribution_invalid = true;
        }
        if attribution_invalid {
            current.attribution_valid = false;
            current.reasons.push(
                "PID reuse invalidated attribution. Raw output quarantined; trees disabled".into(),
            );
            return Err("Target incarnation changed".into());
        }
    }
    if job.manifest.lock().unwrap().raw_bytes == 0 {
        return Err("perf produced no data; inspect permissions and collector diagnostics".into());
    }
    decode(job, perf)
}

fn decode(job: &Job, perf: &Path) -> Result<(), String> {
    job.manifest.lock().unwrap().state = "parsing".into();
    if !job.manifest.lock().unwrap().attribution_valid {
        return Err("Capture attribution is invalid; raw data is quarantined".into());
    }
    let initial_decode = job.manifest.lock().unwrap().raw_sha256.is_none();
    let raw = job.dir.join("perf.data");
    let meta = fs::symlink_metadata(&raw).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > RAW_CAP {
        return Err("Raw output is invalid or exceeds the capture cap".into());
    }
    let mut hasher = Sha256::new();
    let mut file = File::open(&raw).map_err(|e| e.to_string())?;
    let mut buffer = [0_u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash = format!("{:x}", hasher.finalize());
    {
        let mut m = job.manifest.lock().unwrap();
        if m.raw_sha256.as_ref().is_some_and(|v| v != &hash) {
            return Err("Raw capture changed since finalization; refusing to mix results".into());
        }
        m.raw_sha256 = Some(hash);
    }
    let symbol_started = Instant::now();
    let mut c = command(perf);
    c.args(["buildid-list", "-i"]).arg(&raw);
    let build_output = output(c, Duration::from_secs(10))?;
    let mut builds = Vec::new();
    let readelf = find_tool("readelf");
    for line in build_output.lines().take(128) {
        let Some((id, module)) = line.trim().split_once(char::is_whitespace) else {
            continue;
        };
        let module = module.trim();
        if id.is_empty() || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        let actual = readelf
            .as_ref()
            .and_then(|r| elf_build_id(r, Path::new(module)));
        let debug_files = readelf
            .as_ref()
            .map(|r| debug_identities(r, Path::new(module), id))
            .unwrap_or_default();
        let state = match &actual {
            Some(v) if v == id => "matched",
            Some(_) => "mismatch",
            None => "unverified",
        };
        builds.push(SymbolIdentity {
            module: module.into(),
            captured_build_id: id.into(),
            current_build_id: actual,
            state: state.into(),
            debug_files,
        });
        if symbol_started.elapsed() > Duration::from_secs(15) {
            break;
        }
    }
    {
        let mut m = job.manifest.lock().unwrap();
        m.module_identity_ms = symbol_started.elapsed().as_millis() as u64;
        m.build_ids = builds.clone();
    }
    let map_before = inspect_perf_map(job.manifest.lock().unwrap().target.pid);
    let map_basis = if initial_decode {
        let mut observed = map_before.clone();
        if verify(&job.manifest.lock().unwrap().target).is_err() {
            observed.sha256 = None;
            observed.state = "Target incarnation unavailable while observing map".into();
        }
        observed
    } else {
        job.manifest
            .lock()
            .unwrap()
            .jit_map
            .clone()
            .unwrap_or(PerfMapIdentity {
                sha256: None,
                state: "No map provenance recorded in this capture".into(),
                ..map_before.clone()
            })
    };
    let parse_started = Instant::now();
    let mut c = command(perf);
    c.args([
        "script",
        "--ns",
        "--full-source-path",
        "-F",
        "comm,pid,tid,time,period,event,ip,sym,dso,srcline",
        "-i",
    ])
    .arg(&raw)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let mut child = spawn(&mut c).map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let parse = thread::spawn(move || {
        fn cpu_ns() -> u64 {
            let mut ts = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            unsafe {
                libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts);
            }
            ts.tv_sec as u64 * 1_000_000_000 + ts.tv_nsec as u64
        }
        let start = cpu_ns();
        let result = model::parse_script(BufReader::new(stdout.take(SCRIPT_LIMIT)));
        (result, cpu_ns().saturating_sub(start) / 1_000_000)
    });
    let error = thread::spawn(move || drain(stderr, STDERR_LIMIT));
    let status = wait_tool(&mut child, Duration::from_secs(60), Some(&job.closed));
    let (parsed, parser_cpu_ms) = parse.join().map_err(|_| "Stack parser thread failed")?;
    let mut set = parsed?;
    {
        let mut m = job.manifest.lock().unwrap();
        m.parser_cpu_ms = parser_cpu_ms;
        m.decode_and_parse_ms = parse_started.elapsed().as_millis() as u64;
    }
    let (err, _) = error
        .join()
        .map_err(|_| "Analysis diagnostic reader failed")?;
    if !err.is_empty() {
        set.coverage.diagnostic(&String::from_utf8_lossy(&err));
    }
    if !status.as_ref().is_ok_and(|s| s.success()) {
        set.coverage.diagnostic(&format!(
            "perf script incomplete: {:?}; {}",
            status,
            String::from_utf8_lossy(&err)
        ));
    }
    let expected = job.manifest.lock().unwrap().clone();
    let tids: BTreeSet<_> = expected.threads_at_start.iter().map(|t| t.tid).collect();
    if set
        .samples
        .iter()
        .any(|s| s.pid != expected.target.pid as u32 || !tids.contains(&s.tid))
    {
        job.manifest.lock().unwrap().attribution_valid = false;
        return Err(
            "Decoded samples did not match the declared PID/TID scope; trees quarantined".into(),
        );
    }
    let map_after = inspect_perf_map(expected.target.pid);
    let map_matches = map_basis.sha256.is_some()
        && map_basis.sha256 == map_before.sha256
        && map_before.sha256 == map_after.sha256;
    let map_frames = set.frames.iter().any(|f| f.module == map_before.path);
    // ELF names need matching build identity; perf-map names retain their distinct provenance.
    let matched: BTreeSet<_> = builds
        .iter()
        .filter(|b| {
            b.state == "matched" && b.debug_files.iter().all(|d| d.state == "matchedCandidate")
        })
        .map(|b| b.module.as_str())
        .collect();
    for f in &mut set.frames {
        if f.module == map_before.path && map_matches && f.resolved {
            f.symbol_origin = model::SymbolOrigin::PerfMap;
            f.source = None;
        } else if matched.contains(f.module.as_str()) && f.resolved {
            f.symbol_origin = model::SymbolOrigin::ElfBuildId;
        } else {
            f.resolved = false;
            f.symbol_origin = model::SymbolOrigin::Unresolved;
            f.source = None;
            f.symbol = format!("{}+address 0x{}", f.module, f.address);
        }
    }
    if map_frames && map_basis.sha256.is_some() && !map_matches {
        set.coverage
            .diagnostic("Recorded perf map is missing or changed; map names withheld");
    }
    if map_frames || map_before.sha256.is_some() {
        let mut map = map_basis;
        map.state = if map_matches && !map_frames {
            "observedNotUsedByPerf"
        } else if map_matches {
            "matched"
        } else if map_after.sha256.is_none() {
            "unavailable"
        } else {
            "unverifiedOrChanged"
        }
        .into();
        job.manifest.lock().unwrap().jit_map = Some(map);
    }
    if builds
        .iter()
        .any(|b| b.debug_files.iter().any(|d| d.state != "matchedCandidate"))
    {
        set.coverage.diagnostic("A local separate debug-file candidate has a mismatched or unverified build ID; module names and source mappings withheld");
    }
    if builds.iter().any(|b| b.state == "mismatch") {
        set.coverage
            .diagnostic("A module build ID mismatched; its symbols were withheld");
    }
    let loss_started = Instant::now();
    let mut loss_file = BufReader::new(File::open(&raw).map_err(|e| e.to_string())?);
    if let Err(e) =
        model::parse_perf_loss(&mut loss_file, meta.len(), &mut set.coverage, &job.closed)
    {
        set.coverage
            .diagnostic(&format!("Loss scan incomplete: {e}"));
    }
    let mut m = job.manifest.lock().unwrap();
    m.coverage = set.coverage.clone();
    m.summary = set.summary();
    m.loss_scan_ms = loss_started.elapsed().as_millis() as u64;
    if !err.is_empty() {
        m.reasons
            .push(String::from_utf8_lossy(&err).chars().take(2048).collect());
    }
    if m.omitted_thread_observations > 0 {
        m.reasons.push("New-thread identity retention limit reached; gained-thread count is a lower bound; omitted observations can repeat".into());
    }
    let expected_finish = m.reasons.iter().all(|r| r == "Timed duration completed");
    m.state = if !set.samples.is_empty() && !set.coverage.partial() && expected_finish {
        "complete"
    } else {
        "partial"
    }
    .into();
    if set.samples.is_empty() {
        m.reasons
            .push("No retained stack samples; inspect parser and collector diagnostics".into());
    }
    if !job.closed.load(Ordering::Acquire) {
        *job.data.lock().unwrap() = Some(set);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "craidd-perf-unit-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        path
    }
    fn manifest(id: &str, n: u64) -> Manifest {
        Manifest {
            version: 1,
            id: id.into(),
            state: "complete".into(),
            created_ms: n,
            host: identity(std::process::id() as i32).unwrap(),
            ..Default::default()
        }
    }
    #[test]
    fn retention_preserves_pins_and_ten_unpinned() {
        let base = root();
        for n in 0..13 {
            let id = format!("capture-{n}");
            let dir = base.join(&id);
            fs::create_dir(&dir).unwrap();
            let mut m = manifest(&id, n);
            m.pinned = n == 0;
            write_manifest(&dir, &m).unwrap();
        }
        retain(&base, "").unwrap();
        let rows = recover_and_list(&base).unwrap();
        assert_eq!(rows.len(), 11);
        assert!(rows.iter().any(|m| m.id == "capture-0"));
        assert!(!rows.iter().any(|m| m.id == "capture-1"));
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn retention_keeps_just_completed_older_capture() {
        let base = root();
        for n in 0..13 {
            let id = format!("capture-{n}");
            let dir = base.join(&id);
            fs::create_dir(&dir).unwrap();
            write_manifest(&dir, &manifest(&id, n)).unwrap();
        }
        retain(&base, "capture-0").unwrap();
        let rows = recover_and_list(&base).unwrap();
        assert_eq!(rows.len(), 10);
        assert!(rows.iter().any(|m| m.id == "capture-0"));
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn recovery_labels_interrupted_host() {
        let base = root();
        let dir = base.join("capture-1");
        fs::create_dir(&dir).unwrap();
        let mut m = manifest("capture-1", 1);
        m.state = "recording".into();
        m.host.birth += 1;
        write_manifest(&dir, &m).unwrap();
        let rows = recover_and_list(&base).unwrap();
        assert_eq!(rows[0].state, "partial");
        assert!(rows[0].reasons[0].contains("before capture finalization"));
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn paths_and_symlinks_cannot_escape_capture_namespace() {
        use std::os::unix::fs::symlink;
        let base = root();
        assert!(capture_dir(&base, "../capture-1").is_err());
        symlink("/tmp", base.join("capture-1")).unwrap();
        assert!(capture_dir(&base, "capture-1").is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn stale_target_is_refused_before_collector_spawn() {
        let mut target = identity(std::process::id() as i32).unwrap();
        target.birth += 1;
        assert!(check_target(&target).is_err());
    }
    #[test]
    fn new_thread_observations_are_bounded_and_omissions_explicit() {
        let mut m = Manifest::default();
        let mut seen = BTreeSet::new();
        observe_threads(
            &mut m,
            &mut seen,
            (0..4100)
                .map(|tid| ThreadIdentity {
                    tid,
                    birth: 1,
                    name: "worker".into(),
                })
                .collect(),
        );
        assert_eq!(m.threads_gained.len(), 4096);
        assert_eq!(seen.len(), 4096);
        assert_eq!(m.omitted_thread_observations, 4);
        observe_threads(
            &mut m,
            &mut seen,
            vec![ThreadIdentity {
                tid: 4099,
                birth: 1,
                name: "worker".into(),
            }],
        );
        assert_eq!(m.omitted_thread_observations, 5);
    }
    #[test]
    fn raw_hash_mismatch_prevents_reinterpretation() {
        let dir = root();
        fs::write(dir.join("perf.data"), b"changed raw bytes").unwrap();
        let mut m = manifest("capture-1", 1);
        m.attribution_valid = true;
        m.raw_sha256 = Some("old-hash".into());
        let job = Job {
            manifest: Mutex::new(m),
            data: Mutex::new(None),
            stop: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            worker: Mutex::new(None),
            dir: dir.clone(),
        };
        assert!(decode(&job, Path::new("/unused/perf"))
            .unwrap_err()
            .contains("changed since finalization"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn dropping_owned_collector_reaps_it() {
        let mut c = Command::new("/usr/bin/sleep");
        c.arg("10");
        let child = spawn(&mut c).unwrap();
        let pid = child.id();
        drop(child);
        assert!(!Path::new(&format!("/proc/{pid}")).exists());
    }
}
