//! Linux process gauges and opt-in non-stopping native source events.
//! No process signals, debugger requests, or heap/cycle inference occur here.
use super::processes::{self, ProcessCounters, ProcessIdentity};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader},
    os::unix::{
        fs::PermissionsExt,
        io::AsRawFd,
        net::{UnixListener, UnixStream},
    },
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

pub fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
fn monotonic_ns() -> u64 {
    let mut t: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut t) };
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub at_ms: f64,
    #[serde(flatten)]
    pub counters: ProcessCounters,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: String,
    pub marker: String,
    pub name: String,
    pub solo: bool,
    pub thread: u64,
    pub batch: u64,
    pub start_ms: f64,
    pub end_ms: Option<f64>,
    pub cpu_ms: Option<f64>,
    pub status: String,
    pub allocated_bytes: u64,
    pub freed_bytes: u64,
    pub live_bytes: u64,
    pub allocation_count: u64,
    #[serde(skip)]
    cpu_start: u64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceEvent {
    pub kind: String,
    #[serde(default)]
    pub marker: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub invocation: u64,
    #[serde(default)]
    pub thread: u64,
    #[serde(default)]
    pub wall_ns: u64,
    #[serde(default)]
    pub cpu_ns: u64,
    #[serde(default)]
    pub address: u64,
    #[serde(default)]
    pub bytes: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pause {
    pub start_ms: f64,
    pub end_ms: Option<f64>,
    pub all_threads: bool,
    pub thread: Option<i64>,
    pub reason: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub target: ProcessIdentity,
    pub name: String,
    pub active: bool,
    pub reason: String,
    pub batch: u64,
    pub provider: bool,
    pub pauses: Vec<Pause>,
    pub samples: Vec<Sample>,
    pub captures: Vec<Capture>,
    pub dropped: u64,
    #[serde(skip)]
    start: Option<Instant>,
    #[serde(skip)]
    origin: Option<u64>,
    #[serde(skip)]
    solo: Option<String>,
    #[serde(skip)]
    allocations: HashMap<u64, (u64, Vec<String>)>,
    #[serde(skip)]
    blocked: HashSet<String>,
}
impl Profile {
    fn new(target: ProcessIdentity, name: String) -> Self {
        Self {
            id: format!("{}-{}-{}", target.pid, target.birth, stamp()),
            target,
            name,
            active: true,
            reason: String::new(),
            batch: 1,
            provider: false,
            pauses: vec![],
            samples: vec![],
            captures: vec![],
            dropped: 0,
            start: Some(Instant::now()),
            origin: Some(monotonic_ns()),
            solo: None,
            allocations: HashMap::new(),
            blocked: HashSet::new(),
        }
    }
    fn at(&self) -> f64 {
        self.start.map_or(0., |s| s.elapsed().as_secs_f64() * 1000.)
    }
    fn close(&mut self, reason: &str) {
        let at = self.at();
        self.active = false;
        self.reason = reason.into();
        for pause in &mut self.pauses {
            if pause.end_ms.is_none() {
                pause.end_ms = Some(at);
            }
        }
        for c in &mut self.captures {
            if c.end_ms.is_none() {
                c.end_ms = Some(at);
                c.status = if c.id.starts_with("solo:") {
                    "Session ended"
                } else {
                    "Incomplete: session ended"
                }
                .into();
            }
        }
    }
    fn event(&mut self, e: SourceEvent) {
        if !self.active {
            return;
        }
        if self.blocked.contains(&e.marker) {
            return;
        }
        self.provider = true;
        // Both endpoints use the same host CLOCK_MONOTONIC. Never infer wall/CPU equivalence.
        let origin = *self.origin.get_or_insert_with(|| {
            e.wall_ns
                .saturating_sub((self.start.unwrap().elapsed().as_secs_f64() * 1e9) as u64)
        });
        if e.wall_ns < origin {
            self.dropped += 1;
            return;
        }
        let at = e.wall_ns.saturating_sub(origin) as f64 / 1e6;
        let key = format!("{}:{}:{}", e.marker, e.thread, e.invocation);
        match e.kind.as_str() {
            "begin" | "solo" => {
                if e.marker.len() > 128 || e.name.len() > 256 || e.marker.is_empty() {
                    self.dropped += 1;
                    return;
                }
                if e.kind == "solo" && self.solo.is_some() {
                    if self.solo.as_ref() != Some(&e.marker) {
                        self.dropped += 1;
                    }
                    return;
                }
                if self.captures.len() >= 2000 {
                    self.dropped += 1;
                    return;
                }
                if e.kind == "begin" && self.captures.iter().any(|c| c.id == key) {
                    self.dropped += 1;
                    return;
                }
                let id = if e.kind == "solo" {
                    self.solo = Some(e.marker.clone());
                    format!("solo:{}:{}", e.marker, self.batch)
                } else {
                    key
                };
                self.captures.push(Capture {
                    id,
                    marker: e.marker,
                    name: e.name,
                    solo: e.kind == "solo",
                    thread: e.thread,
                    batch: self.batch,
                    start_ms: at,
                    end_ms: None,
                    cpu_ms: None,
                    status: "Recording".into(),
                    allocated_bytes: 0,
                    freed_bytes: 0,
                    live_bytes: 0,
                    allocation_count: 0,
                    cpu_start: e.cpu_ns,
                });
            }
            "end" | "unwind" => {
                if let Some(c) = self
                    .captures
                    .iter_mut()
                    .find(|c| c.id == key && c.end_ms.is_none())
                {
                    if e.wall_ns < origin || at < c.start_ms || e.cpu_ns < c.cpu_start {
                        c.status = "Invalid provider clock".into();
                        c.end_ms = Some(at.max(c.start_ms));
                        self.dropped += 1;
                    } else {
                        c.end_ms = Some(at);
                        c.cpu_ms = Some((e.cpu_ns - c.cpu_start) as f64 / 1e6);
                        c.status = if e.kind == "end" {
                            "Complete"
                        } else {
                            "Incomplete: scope exited"
                        }
                        .into();
                    }
                } else {
                    self.dropped += 1;
                }
            }
            "alloc" => {
                if e.address == 0 || e.bytes == 0 {
                    return;
                }
                if self.allocations.len() >= 20000 || self.allocations.contains_key(&e.address) {
                    self.dropped += 1;
                    return;
                }
                let owners = self
                    .captures
                    .iter_mut()
                    .filter(|c| {
                        c.end_ms.is_none() && (c.thread == e.thread || c.id.starts_with("solo:"))
                    })
                    .map(|c| {
                        c.allocated_bytes = c.allocated_bytes.saturating_add(e.bytes);
                        c.live_bytes = c.live_bytes.saturating_add(e.bytes);
                        c.allocation_count += 1;
                        c.id.clone()
                    })
                    .collect();
                self.allocations.insert(e.address, (e.bytes, owners));
            }
            "free" => {
                if let Some((bytes, owners)) = self.allocations.remove(&e.address) {
                    for c in &mut self.captures {
                        if owners.contains(&c.id) {
                            c.freed_bytes = c.freed_bytes.saturating_add(bytes);
                            c.live_bytes = c.live_bytes.saturating_sub(bytes);
                        }
                    }
                }
            }
            "play-end" => self.close("Verified instrumented Unity Play end"),
            "hello" => {}
            _ => {
                self.dropped += 1;
            }
        }
    }
    fn again(&mut self) {
        self.batch += 1;
        let at = self.at();
        if let Some(marker) = self
            .solo
            .clone()
            .filter(|marker| !self.blocked.contains(marker))
        {
            if let Some(c) = self
                .captures
                .iter_mut()
                .find(|c| c.id.starts_with("solo:") && c.end_ms.is_none())
            {
                c.end_ms = Some(at);
                c.status = "Batch boundary".into();
            }
            if self.captures.len() < 2000 {
                self.captures.push(Capture {
                    id: format!("solo:{}:{}", marker, self.batch),
                    marker,
                    name: "Solo continuation".into(),
                    solo: true,
                    thread: 0,
                    batch: self.batch,
                    start_ms: at,
                    end_ms: None,
                    cpu_ms: None,
                    status: "Recording".into(),
                    allocated_bytes: 0,
                    freed_bytes: 0,
                    live_bytes: 0,
                    allocation_count: 0,
                    cpu_start: 0,
                });
            }
        }
    }
}
#[derive(Default)]
pub struct ProfileManager {
    pub profiles: Arc<Mutex<HashMap<String, Profile>>>,
    socket: Mutex<Option<PathBuf>>,
}
impl Drop for ProfileManager {
    fn drop(&mut self) {
        if let Ok(path) = self.socket.get_mut() {
            if let Some(path) = path {
                let _ = fs::remove_file(path);
            }
        }
    }
}
fn publish(app: &AppHandle, label: &str, p: &Profile) {
    let _ = app.emit_to(label, "craidd:profile", p);
}
fn peer(stream: &UnixStream) -> Result<ProcessIdentity, String> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    if unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut cred as *mut _ as *mut _,
            &mut len,
        )
    } != 0
        || cred.uid != unsafe { libc::geteuid() }
    {
        return Err("Untrusted profiling peer".into());
    }
    processes::identity(cred.pid)
}
pub fn ensure_bridge(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<ProfileManager>();
    let mut slot = state.socket.lock().map_err(|e| e.to_string())?;
    if let Some(p) = slot.as_ref() {
        return Ok(p.to_string_lossy().into());
    }
    let path = std::env::temp_dir().join(format!(
        "craidd-profile-{}-{}.sock",
        std::process::id(),
        stamp()
    ));
    let listener = UnixListener::bind(&path).map_err(|e| e.to_string())?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    let profiles = state.profiles.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let target = match peer(&stream) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let profiles = profiles.clone();
            // Local peers can be chatty; at most one connection per process incarnation.
            let mut active = CONNECTIONS.lock().unwrap();
            if active.contains(&target) || active.len() >= 64 {
                continue;
            }
            active.push(target.clone());
            drop(active);
            thread::spawn(move || {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut reader = BufReader::new(stream);
                loop {
                    let mut line = String::new();
                    use std::io::Read;
                    let result = reader.by_ref().take(4097).read_line(&mut line);
                    match result {
                        Ok(0) => break,
                        Ok(_) if line.len() <= 4096 => {}
                        Err(ref e)
                            if line.is_empty()
                                && [
                                    std::io::ErrorKind::WouldBlock,
                                    std::io::ErrorKind::TimedOut,
                                ]
                                .contains(&e.kind()) =>
                        {
                            if processes::verify(&target).is_err() {
                                break;
                            }
                            continue;
                        }
                        _ => break,
                    };
                    if processes::verify(&target).is_err() {
                        break;
                    }
                    if let Ok(event) = serde_json::from_str::<SourceEvent>(&line) {
                        if let Ok(mut all) = profiles.lock() {
                            for (_, p) in all
                                .iter_mut()
                                .filter(|(_, p)| p.target == target && p.active)
                            {
                                p.event(event.clone());
                            }
                        }
                    }
                }
                if let Ok(mut all) = profiles.lock() {
                    for p in all.values_mut().filter(|p| p.target == target && p.active) {
                        p.dropped += 1;
                        p.provider = false;
                        let at = p.at();
                        for c in &mut p.captures {
                            if c.end_ms.is_none() {
                                c.end_ms = Some(at);
                                c.status = "Incomplete: provider disconnected".into();
                            }
                        }
                    }
                }
                CONNECTIONS.lock().unwrap().retain(|p| p != &target);
            });
        }
    });
    *slot = Some(path.clone());
    Ok(path.to_string_lossy().into())
}
static CONNECTIONS: Mutex<Vec<ProcessIdentity>> = Mutex::new(vec![]);
#[tauri::command]
pub fn profiling_bridge(app: AppHandle) -> Result<String, String> {
    ensure_bridge(&app)
}
pub fn start(app: &AppHandle, label: &str, target: ProcessIdentity) -> Result<String, String> {
    let info = processes::info(target.pid)?;
    if info.identity != target || info.uid != unsafe { libc::geteuid() } {
        return Err("Process identity changed or wrong owner".into());
    }
    processes::counters(&target)?;
    // Process gauges remain useful if the optional source socket is unavailable.
    let _ = ensure_bridge(app);
    let state = app.state::<ProfileManager>();
    let mut all = state.profiles.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = all.get(label) {
        if existing.active {
            if existing.target == target {
                return Ok(existing.id.clone());
            }
            return Err("Stop the current profiling session first".into());
        }
    }
    if all
        .iter()
        .any(|(owner, p)| owner != label && p.active && p.target == target)
    {
        return Err(
            "This process is already profiled in another Craidd window; view that owner".into(),
        );
    }
    let p = Profile::new(target.clone(), info.name);
    let id = p.id.clone();
    let result_id = id.clone();
    publish(app, label, &p);
    all.insert(label.into(), p);
    drop(all);
    let profiles = state.profiles.clone();
    let app = app.clone();
    let label = label.to_owned();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250));
        let Ok(mut all) = profiles.lock() else { break };
        let Some(p) = all.get_mut(&label) else { break };
        if p.id != id || !p.active {
            break;
        }
        match processes::counters(&target) {
            Ok(counters) => {
                let at_ms = p.at();
                if p.samples.len() >= 2400 {
                    p.samples.remove(0);
                    p.dropped += 1;
                }
                p.samples.push(Sample { at_ms, counters });
            }
            Err(_) => p.close("Target exited or became inaccessible"),
        };
        publish(&app, &label, p);
    });
    Ok(result_id)
}
#[tauri::command]
pub fn start_profiling(
    app: AppHandle,
    w: tauri::WebviewWindow,
    target: ProcessIdentity,
) -> Result<String, String> {
    start(&app, w.label(), target)
}
pub fn invalidate_marker(app: &AppHandle, id: &str) {
    if let Ok(mut all) = app.state::<ProfileManager>().profiles.lock() {
        for (label, p) in all.iter_mut().filter(|(_, p)| p.active) {
            p.blocked.insert(id.into());
            let at = p.at();
            for c in p
                .captures
                .iter_mut()
                .filter(|c| c.marker == id && c.end_ms.is_none())
            {
                c.end_ms = Some(at);
                c.status = "Incomplete: marker edited".into();
            }
            p.reason="Gold intent changed; affected compiled markers stay unarmed until rebuild/restart and a new profiling session".into();
            publish(app, label, p);
        }
    }
}
pub fn stop_session(app: &AppHandle, label: &str, id: &str, reason: &str) {
    if let Ok(mut all) = app.state::<ProfileManager>().profiles.lock() {
        if let Some(p) = all.get_mut(label).filter(|p| p.active && p.id == id) {
            p.close(reason);
            publish(app, label, p);
        }
    }
}
pub fn stop(app: &AppHandle, label: &str, reason: &str) {
    if let Ok(mut all) = app.state::<ProfileManager>().profiles.lock() {
        if let Some(p) = all.get_mut(label).filter(|p| p.active) {
            p.close(reason);
            publish(app, label, p);
        }
    }
}
pub fn debug_pause(app: &AppHandle, label: &str, body: &serde_json::Value, stopped: bool) {
    if let Ok(mut all) = app.state::<ProfileManager>().profiles.lock() {
        if let Some(p) = all.get_mut(label).filter(|p| p.active) {
            let at = p.at();
            if stopped {
                if p.pauses.len() < 2000 {
                    p.pauses.push(Pause {
                        start_ms: at,
                        end_ms: None,
                        all_threads: body["allThreadsStopped"] == true,
                        thread: body["threadId"].as_i64(),
                        reason: body["reason"].as_str().unwrap_or("debugger stop").into(),
                    });
                }
            } else {
                let all_continued = body["allThreadsContinued"] == true;
                let tid = body["threadId"].as_i64();
                for pause in p.pauses.iter_mut().filter(|s| s.end_ms.is_none()) {
                    if all_continued || (!pause.all_threads && pause.thread == tid) {
                        pause.end_ms = Some(at);
                    }
                }
            }
            publish(app, label, p);
        }
    }
}
#[tauri::command]
pub fn stop_profiling(app: AppHandle, w: tauri::WebviewWindow) {
    stop(&app, w.label(), "Profiling stopped; target left running");
}
#[tauri::command]
pub fn profile_record_again(app: AppHandle, w: tauri::WebviewWindow) -> Result<(), String> {
    let state = app.state::<ProfileManager>();
    let mut all = state.profiles.lock().map_err(|e| e.to_string())?;
    let p = all.get_mut(w.label()).ok_or("No profiling session")?;
    if !p.active {
        return Err("Session ended; select a target again".into());
    }
    p.again();
    publish(&app, w.label(), p);
    Ok(())
}
#[tauri::command]
pub fn get_profile(app: AppHandle, w: tauri::WebviewWindow) -> Option<Profile> {
    app.state::<ProfileManager>()
        .profiles
        .lock()
        .ok()?
        .get(w.label())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn e(kind: &str, inv: u64, thread: u64, wall: u64) -> SourceEvent {
        SourceEvent {
            kind: kind.into(),
            marker: "work".into(),
            name: "Work".into(),
            invocation: inv,
            thread,
            wall_ns: wall,
            cpu_ns: wall / 2,
            address: 0,
            bytes: 0,
        }
    }
    fn p() -> Profile {
        let mut p = Profile::new(ProcessIdentity { pid: 3, birth: 4 }, "test".into());
        p.origin = Some(0);
        p
    }
    #[test]
    fn recursive_threads_and_late_end_keep_batch() {
        let mut p = p();
        p.event(e("begin", 1, 1, 100));
        p.event(e("begin", 2, 1, 110));
        p.event(e("begin", 1, 2, 120));
        p.again();
        p.event(e("end", 2, 1, 140));
        assert_eq!(p.captures[1].batch, 1);
        assert!(p.captures[0].end_ms.is_none());
        assert!(p.captures[2].end_ms.is_none());
        assert_eq!(p.captures[1].status, "Complete");
        assert!(p.captures.iter().all(|capture| !capture.solo));
    }
    #[test]
    fn one_solo_and_snapshot_are_immutable() {
        let mut p = p();
        p.event(e("solo", 1, 1, 100));
        p.event(e("solo", 2, 2, 101));
        assert_eq!(p.captures.len(), 1);
        let snapshot = p.clone();
        p.again();
        assert_eq!(snapshot.captures.len(), 1);
        assert!(snapshot.captures[0].end_ms.is_none());
        assert_eq!(p.captures.len(), 2);
        assert_eq!(p.captures[1].batch, 2);
        // The UI must recognize Solo after a batch boundary without parsing IDs.
        assert!(p.captures.iter().all(|capture| capture.solo));
        let wire = serde_json::to_value(&p).unwrap();
        assert_eq!(wire["captures"][0]["solo"], true);
        assert_eq!(wire["captures"][1]["solo"], true);
    }
    #[test]
    fn allocation_cohort_survives_end_and_ignores_older_free() {
        let mut p = p();
        let mut a = e("alloc", 0, 1, 1);
        a.address = 1;
        a.bytes = 99;
        p.event(a.clone());
        p.event(e("begin", 1, 1, 100));
        a.address = 2;
        a.bytes = 32;
        p.event(a);
        p.event(e("end", 1, 1, 150));
        let mut f = e("free", 0, 2, 200);
        f.address = 1;
        p.event(f.clone());
        assert_eq!(p.captures[0].live_bytes, 32);
        f.address = 2;
        p.event(f);
        assert_eq!(p.captures[0].live_bytes, 0);
        assert_eq!(p.captures[0].freed_bytes, 32);
    }
    #[test]
    fn unwind_is_incomplete() {
        let mut p = p();
        p.event(e("begin", 1, 1, 100));
        p.event(e("unwind", 1, 1, 200));
        assert!(p.captures[0].status.contains("Incomplete"));
        assert!(p.captures[0].cpu_ms.is_some());
    }
    #[test]
    fn real_native_source_events_authenticate_pair_threads_and_free_after_end() {
        use std::process::Command;
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_owned();
        let dir = std::env::temp_dir().join(format!("craidd-profile-test-{}", stamp()));
        fs::create_dir(&dir).unwrap();
        let binary = dir.join("target");
        assert!(Command::new("c++")
            .args(["-std=c++17", "-g", "-O0", "-pthread"])
            .arg("-I")
            .arg(root.join("support/profiling"))
            .arg(root.join("tests/fixtures/attach-profiling/profile_target.cpp"))
            .arg("-o")
            .arg(&binary)
            .status()
            .unwrap()
            .success());
        let path = dir.join("events.sock");
        let listener = UnixListener::bind(&path).unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut p = Profile::new(
            ProcessIdentity { pid: 0, birth: 0 },
            "Native fixture".into(),
        );
        let mut child = Command::new(binary)
            .env("CRAIDD_PROFILE_SOCKET", &path)
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(e) => {
                    let _ = child.kill();
                    panic!("Source provider did not connect: {e}");
                }
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let target = peer(&stream).unwrap();
        assert_eq!(target.pid, child.id() as i32);
        p.target = target;
        for line in BufReader::new(stream).lines() {
            let e: SourceEvent = serde_json::from_str(&line.unwrap()).unwrap();
            p.event(e);
        }
        assert!(child.wait().unwrap().success());
        assert_eq!(
            p.captures
                .iter()
                .filter(|c| c.marker == "recursive")
                .count(),
            5
        );
        assert!(p
            .captures
            .iter()
            .filter(|c| c.marker == "recursive")
            .all(|c| c.status == "Complete" && c.cpu_ms.is_some()));
        assert_eq!(p.captures.iter().filter(|c| c.marker == "solo").count(), 1);
        assert!(p
            .captures
            .iter()
            .any(|c| c.marker == "early" && c.status.starts_with("Incomplete")));
        let memory = p.captures.iter().find(|c| c.marker == "memory").unwrap();
        assert_eq!(memory.allocated_bytes, 64);
        assert_eq!(memory.freed_bytes, 64);
        assert_eq!(memory.live_bytes, 0);
        let tids = p
            .captures
            .iter()
            .map(|c| c.thread)
            .collect::<std::collections::HashSet<_>>();
        assert!(tids.len() >= 3);
        assert_eq!(p.dropped, 0);
        fs::remove_dir_all(dir).unwrap();
    }
}
