//! Linux process gauges and opt-in non-stopping native source events.
//! No process signals, debugger requests, or heap/cycle inference occur here.
use super::processes::{self, ProcessCounters, ProcessIdentity};
use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::io::{BufRead, BufReader};
use std::{
    collections::{HashMap, HashSet},
    fs,
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
    #[serde(default)]
    pub sequence: u64,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub playing: Option<bool>,
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
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCounters {
    pub aged_samples: u64,
    pub evicted_captures: u64,
    pub rejected_events: u64,
    pub disconnects: u64,
    pub source_gaps: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub target: ProcessIdentity,
    pub name: String,
    pub active: bool,
    pub unity_editor: bool,
    pub waiting_for_play: bool,
    pub play_generation: Option<u64>,
    pub reason: String,
    pub batch: u64,
    pub provider: bool,
    pub pauses: Vec<Pause>,
    pub samples: Vec<Sample>,
    pub captures: Vec<Capture>,
    pub dropped: u64,
    pub counters: ProfileCounters,
    #[serde(skip)]
    discovery: Option<super::profiling_discovery::Registration>,
    #[serde(skip)]
    start: Option<Instant>,
    #[serde(skip)]
    origin: Option<u64>,
    #[serde(skip)]
    solo: Option<String>,
    #[serde(skip)]
    next_segment: u64,
    #[serde(skip)]
    last_sequence: Option<u64>,
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
            unity_editor: false,
            waiting_for_play: false,
            play_generation: None,
            discovery: None,
            reason: String::new(),
            batch: 1,
            provider: false,
            pauses: vec![],
            samples: vec![],
            captures: vec![],
            dropped: 0,
            counters: ProfileCounters::default(),
            start: Some(Instant::now()),
            origin: Some(monotonic_ns()),
            solo: None,
            next_segment: 0,
            last_sequence: None,
            allocations: HashMap::new(),
            blocked: HashSet::new(),
        }
    }
    fn view(&self) -> Self {
        // Only public presentation data is copied; allocator ownership and
        // discovery registrations stay with the collector, not every UI tick.
        Self {
            id: self.id.clone(),
            target: self.target.clone(),
            name: self.name.clone(),
            active: self.active,
            unity_editor: self.unity_editor,
            waiting_for_play: self.waiting_for_play,
            play_generation: self.play_generation,
            reason: self.reason.clone(),
            batch: self.batch,
            provider: self.provider,
            pauses: self.pauses.clone(),
            samples: self.samples.clone(),
            captures: self.captures.clone(),
            dropped: self.dropped,
            counters: self.counters.clone(),
            discovery: None,
            start: None,
            origin: None,
            solo: None,
            next_segment: 0,
            last_sequence: None,
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
        self.waiting_for_play = false;
        if let Some(route) = self.discovery.take() {
            route.release();
        }
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
    fn reject(&mut self) {
        self.counters.rejected_events += 1;
        self.dropped += 1; // compatibility: source rejection only, never history aging
    }
    fn sample(&mut self, counters: ProcessCounters) {
        if self.samples.len() >= 2400 {
            self.samples.remove(0);
            self.counters.aged_samples += 1;
        }
        self.samples.push(Sample {
            at_ms: self.at(),
            counters,
        });
    }
    fn reserve_capture(&mut self, marker: &str, solo: bool) -> bool {
        // Keep a bounded recent history per marker. Hot per-frame markers
        // cannot displace a rare allocation benchmark, Solo, or a live cohort.
        const HITS_PER_MARKER: usize = 128;
        let eligible = |c: &Capture| !c.solo && c.end_ms.is_some() && c.live_bytes == 0;
        let same_marker = self
            .captures
            .iter()
            .filter(|c| !c.solo && c.marker == marker)
            .count();
        let mut victim = if !solo && same_marker >= HITS_PER_MARKER {
            self.captures
                .iter()
                .position(|c| c.marker == marker && eligible(c))
        } else {
            None
        };
        if victim.is_none() && self.captures.len() >= 2000 {
            let mut counts = HashMap::<&str, usize>::new();
            for c in &self.captures {
                if !c.solo {
                    *counts.entry(&c.marker).or_default() += 1;
                }
            }
            let largest = self
                .captures
                .iter()
                .filter(|c| eligible(c))
                .map(|c| counts[c.marker.as_str()])
                .max();
            victim = largest.and_then(|n| {
                self.captures
                    .iter()
                    .position(|c| eligible(c) && counts[c.marker.as_str()] == n)
            });
            if victim.is_none() {
                return false;
            }
        }
        if let Some(index) = victim {
            self.captures.remove(index);
            self.counters.evicted_captures += 1;
        }
        true
    }
    fn source_disconnected(&mut self) {
        self.counters.disconnects += 1;
        self.provider = false;
        self.solo = None;
        let at = self.at();
        for c in self.captures.iter_mut().filter(|c| c.end_ms.is_none()) {
            c.end_ms = Some(at);
            c.status = "Incomplete: provider disconnected".into();
        }
    }
    fn finish_play(&mut self, at: f64) {
        for c in self.captures.iter_mut().filter(|c| c.end_ms.is_none()) {
            c.end_ms = Some(at);
            c.status = if c.solo {
                "Unity Play ended"
            } else {
                "Incomplete: Unity Play ended"
            }
            .into();
        }
        self.solo = None;
        self.waiting_for_play = true;
        self.reason = "Unity Play ended; armed for the next Play session".into();
    }
    fn event(&mut self, e: SourceEvent) {
        if !self.active {
            return;
        }
        if self.blocked.contains(&e.marker) {
            return;
        }
        self.provider = true;
        if e.sequence > 0 {
            if let Some(previous) = self.last_sequence {
                if e.sequence <= previous {
                    self.reject();
                    return;
                }
                let missing = e.sequence - previous - 1;
                if missing > 0 {
                    self.counters.source_gaps += missing;
                    self.dropped += missing;
                    self.solo = None;
                    let at = self.at();
                    for c in self.captures.iter_mut().filter(|c| c.end_ms.is_none()) {
                        c.end_ms = Some(at);
                        c.status = "Incomplete: source events missing".into();
                    }
                }
            }
            self.last_sequence = Some(e.sequence);
        }
        // Both endpoints use the same host CLOCK_MONOTONIC. Never infer wall/CPU equivalence.
        let origin = *self.origin.get_or_insert_with(|| {
            e.wall_ns
                .saturating_sub((self.start.unwrap().elapsed().as_secs_f64() * 1e9) as u64)
        });
        if e.wall_ns < origin {
            self.reject();
            return;
        }
        let at = e.wall_ns.saturating_sub(origin) as f64 / 1e6;
        if self.unity_editor {
            if let Some(playing) = e.playing {
                if self.play_generation.is_some_and(|old| e.generation < old) {
                    self.reject();
                    return;
                }
                if self.play_generation != Some(e.generation) {
                    let had_play = self.play_generation.is_some_and(|old| old > 0)
                        || !self.captures.is_empty();
                    self.finish_play(at);
                    self.play_generation = Some(e.generation);
                    if playing && had_play {
                        self.batch += 1;
                    }
                }
                if playing {
                    self.waiting_for_play = false;
                    if self.reason.starts_with("Unity Play ended") {
                        self.reason.clear();
                    }
                } else {
                    if !self.waiting_for_play {
                        self.finish_play(at);
                    }
                    // Late frees still belong to their original retained cohorts.
                    if e.kind != "free" && e.kind != "state" {
                        return;
                    }
                }
            }
        }
        let key = format!("{}:{}:{}", e.marker, e.thread, e.invocation);
        if self.unity_editor
            && e.playing.is_none()
            && self.waiting_for_play
            && matches!(e.kind.as_str(), "begin" | "solo")
        {
            self.waiting_for_play = false;
            if !self.captures.is_empty() {
                self.batch += 1;
            }
            self.reason.clear();
        }
        match e.kind.as_str() {
            "begin" | "solo" => {
                if e.marker.len() > 128 || e.name.len() > 256 || e.marker.is_empty() {
                    self.reject();
                    return;
                }
                if e.kind == "solo" && self.solo.is_some() {
                    if self.solo.as_ref() != Some(&e.marker) {
                        self.reject();
                    }
                    return;
                }
                if e.kind == "begin" && self.captures.iter().any(|c| c.id == key) {
                    self.reject();
                    return;
                }
                if !self.reserve_capture(&e.marker, e.kind == "solo") {
                    self.reject();
                    self.reason = "Capture storage full of pinned Solo segments or live cohorts; start a new profiling session".into();
                    return;
                }
                let id = if e.kind == "solo" {
                    self.solo = Some(e.marker.clone());
                    self.next_segment += 1;
                    format!("solo:{}:{}:{}", e.marker, self.batch, self.next_segment)
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
                        self.reject();
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
                    self.reject();
                }
            }
            "alloc" => {
                if e.address == 0 || e.bytes == 0 {
                    return;
                }
                if self.allocations.len() >= 20000 || self.allocations.contains_key(&e.address) {
                    self.reject();
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
            "play-end" if self.unity_editor => self.finish_play(at),
            "play-end" => self.close("Verified instrumented Unity player end"),
            "hello" | "state" => {}
            _ => {
                self.reject();
            }
        }
    }
    fn again(&mut self) -> bool {
        if let Some(marker) = self
            .solo
            .clone()
            .filter(|marker| !self.blocked.contains(marker))
        {
            // Reserve before closing the current segment: an all-pinned
            // capacity limit must not silently disarm the active recording.
            if !self.reserve_capture(&marker, true) {
                return false;
            }
        }
        self.batch += 1;
        let at = self.at();
        if let Some(marker) = self
            .solo
            .clone()
            .filter(|marker| !self.blocked.contains(marker))
        {
            let name = self
                .captures
                .iter()
                .find(|c| c.solo && c.marker == marker)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| "Solo".into());
            if let Some(c) = self
                .captures
                .iter_mut()
                .find(|c| c.id.starts_with("solo:") && c.end_ms.is_none())
            {
                c.end_ms = Some(at);
                c.status = "Batch boundary".into();
            }
            if self.reserve_capture(&marker, true) {
                self.next_segment += 1;
                self.captures.push(Capture {
                    id: format!("solo:{}:{}:{}", marker, self.batch, self.next_segment),
                    marker,
                    name,
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
        true
    }
}
#[derive(Default)]
pub struct ProfileManager {
    pub profiles: Arc<Mutex<HashMap<String, Profile>>>,
    socket: Mutex<Option<PathBuf>>,
}
impl ProfileManager {
    pub fn shutdown(&self) {
        if let Ok(mut profiles) = self.profiles.lock() {
            for p in profiles.values_mut() {
                p.close("Profiler host closed");
            }
        }
        if let Ok(mut socket) = self.socket.lock() {
            if let Some(path) = socket.take() {
                let _ = fs::remove_file(path);
            }
        }
    }
}
impl Drop for ProfileManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<ProfileManager>() {
        state.shutdown();
    }
}

fn publish(app: &AppHandle, label: &str, p: &Profile) {
    let _ = app.emit_to(label, "craidd:profile", p);
}
fn change_profile(app: &AppHandle, label: &str, action: impl FnOnce(&mut Profile)) {
    let view = {
        let state = app.state::<ProfileManager>();
        let Ok(mut all) = state.profiles.lock() else {
            return;
        };
        let Some(p) = all.get_mut(label).filter(|p| p.active) else {
            return;
        };
        action(p);
        p.view()
    };
    publish(app, label, &view);
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
    let owner = processes::identity(std::process::id() as i32)?;
    let path = super::profiling_discovery::directory()?
        .join(format!("host-{}-{}.sock", owner.pid, owner.birth));
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
                use std::io::Read;
                let mut stream = stream;
                let mut buffer = [0_u8; 16384];
                let mut pending = Vec::with_capacity(20480);
                let mut verified_at = Instant::now();
                loop {
                    let count = match stream.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(ref e)
                            if matches!(
                                e.kind(),
                                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                            ) =>
                        {
                            if processes::verify(&target).is_err() {
                                break;
                            }
                            verified_at = Instant::now();
                            continue;
                        }
                        Err(_) => break,
                    };
                    // The authenticated socket has a fixed peer. Check its
                    // process incarnation at a bounded cadence, not per event.
                    if verified_at.elapsed() >= Duration::from_millis(250) {
                        if processes::verify(&target).is_err() {
                            break;
                        }
                        verified_at = Instant::now();
                    }
                    pending.extend_from_slice(&buffer[..count]);
                    let Some(last) = pending.iter().rposition(|b| *b == b'\n') else {
                        if pending.len() > 4096 {
                            break;
                        }
                        continue;
                    };
                    let mut events = Vec::new();
                    let mut rejected = 0;
                    let mut oversized = false;
                    for line in pending[..last].split(|b| *b == b'\n') {
                        if line.len() > 4096 {
                            oversized = true;
                            break;
                        }
                        match serde_json::from_slice::<SourceEvent>(line) {
                            Ok(event) => events.push(event),
                            Err(_) => rejected += 1,
                        }
                    }
                    pending.drain(..=last);
                    if oversized || pending.len() > 4096 {
                        break;
                    }
                    if let Ok(mut all) = profiles.lock() {
                        for p in all.values_mut().filter(|p| p.target == target && p.active) {
                            for _ in 0..rejected {
                                p.reject();
                            }
                            for event in &events {
                                p.event(event.clone());
                            }
                        }
                    }
                }
                if let Ok(mut all) = profiles.lock() {
                    for p in all.values_mut().filter(|p| p.target == target && p.active) {
                        p.source_disconnected();
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
    let bridge = ensure_bridge(app);
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
    let mut p = Profile::new(target.clone(), info.name);
    p.unity_editor = info.unity_project.is_some();
    p.waiting_for_play = p.unity_editor;
    if let Ok(socket) = bridge {
        match super::profiling_discovery::Registration::publish(&target, &socket, &p.id) {
            Ok(route) => p.discovery = Some(route),
            Err(error) => p.reason = format!("Source discovery unavailable: {error}"),
        }
    } else if let Err(error) = bridge {
        p.reason = format!("Source discovery unavailable: {error}");
    }
    let id = p.id.clone();
    let result_id = id.clone();
    let view = p.view();
    all.insert(label.into(), p);
    drop(all);
    publish(app, label, &view);
    let profiles = state.profiles.clone();
    let app = app.clone();
    let label = label.to_owned();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250));
        let counters = processes::counters(&target);
        let view = {
            let Ok(mut all) = profiles.lock() else { break };
            let Some(p) = all.get_mut(&label) else { break };
            if p.id != id || !p.active {
                break;
            }
            match counters {
                Ok(counters) => p.sample(counters),
                Err(_) => p.close("Target exited or became inaccessible"),
            }
            p.view()
        };
        publish(&app, &label, &view);
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
    let views = {
        let state = app.state::<ProfileManager>();
        let Ok(mut all) = state.profiles.lock() else {
            return;
        };
        all.iter_mut().filter(|(_, p)| p.active).map(|(label, p)| {
            p.blocked.insert(id.into());
            let at = p.at();
            for c in p.captures.iter_mut().filter(|c| c.marker == id && c.end_ms.is_none()) {
                c.end_ms = Some(at);
                c.status = "Incomplete: marker edited".into();
            }
            p.reason = "Gold intent changed; affected compiled markers stay unarmed until rebuild/restart and a new profiling session".into();
            (label.clone(), p.view())
        }).collect::<Vec<_>>()
    };
    for (label, view) in views {
        publish(app, &label, &view);
    }
}
pub fn stop_session(app: &AppHandle, label: &str, id: &str, reason: &str) {
    change_profile(app, label, |p| {
        if p.id == id {
            p.close(reason);
        }
    });
}
pub fn stop(app: &AppHandle, label: &str, reason: &str) {
    change_profile(app, label, |p| p.close(reason));
}
pub fn debug_pause(app: &AppHandle, label: &str, body: &serde_json::Value, stopped: bool) {
    change_profile(app, label, |p| {
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
    });
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
    if p.waiting_for_play {
        return Err("Unity is ready; press Play to begin the next recording".into());
    }
    if !p.again() {
        return Err("Capture storage is full of pinned Solo segments/live cohorts; the current recording continues. Start a new profiling session to create more segments.".into());
    }
    let view = p.view();
    drop(all);
    publish(&app, w.label(), &view);
    Ok(())
}
#[tauri::command]
pub fn get_profile(app: AppHandle, w: tauri::WebviewWindow) -> Option<Profile> {
    app.state::<ProfileManager>()
        .profiles
        .lock()
        .ok()?
        .get(w.label())
        .map(Profile::view)
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
            sequence: 0,
            generation: 0,
            playing: None,
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
        assert_eq!(p.captures[1].name, "Work");
        // The UI must recognize Solo after a batch boundary without parsing IDs.
        assert!(p.captures.iter().all(|capture| capture.solo));
        let wire = serde_json::to_value(&p).unwrap();
        assert_eq!(wire["captures"][0]["solo"], true);
        assert_eq!(wire["captures"][1]["solo"], true);
    }
    #[test]
    fn reconnect_reopens_solo_and_accounts_for_new_native_allocations() {
        let mut p = p();
        p.event(e("solo", 0, 1, 100));
        p.source_disconnected();
        assert!(!p.provider && p.solo.is_none());
        p.event(e("solo", 0, 1, 200));
        let mut alloc = e("alloc", 0, 1, 210);
        alloc.address = 123;
        alloc.bytes = 1048576;
        p.event(alloc);
        let open = p
            .captures
            .iter()
            .find(|c| c.solo && c.end_ms.is_none())
            .unwrap();
        assert!(p.provider);
        assert_ne!(p.captures[0].id, open.id);
        assert_eq!(open.live_bytes, 1048576);
        assert_eq!(p.captures.iter().filter(|c| c.end_ms.is_none()).count(), 1);
    }
    #[test]
    fn hot_marker_history_pins_solo_and_live_cohorts_until_late_free() {
        let mut p = p();
        p.event(e("solo", 0, 1, 100));
        let mut begin = e("begin", 1, 1, 110);
        begin.marker = "allocation".into();
        p.event(begin.clone());
        let mut alloc = e("alloc", 0, 1, 120);
        alloc.address = 123;
        alloc.bytes = 1048576;
        p.event(alloc);
        let mut end = begin;
        end.kind = "end".into();
        end.wall_ns = 130;
        p.event(end);
        p.source_disconnected();
        p.event(e("solo", 0, 1, 200));
        for i in 0..5000 {
            p.event(e("begin", i + 2, 1, 300 + i * 2));
            p.event(e("end", i + 2, 1, 301 + i * 2));
        }
        assert_eq!(
            p.captures
                .iter()
                .filter(|c| !c.solo && c.marker == "work")
                .count(),
            128
        );
        assert_eq!(p.captures.iter().filter(|c| c.solo).count(), 2);
        assert_eq!(
            p.captures
                .iter()
                .find(|c| c.marker == "allocation")
                .unwrap()
                .live_bytes,
            1048576
        );
        let mut free = e("free", 0, 2, 20000);
        free.address = 123;
        p.event(free);
        let old_solo = &p.captures[0];
        assert_eq!((old_solo.live_bytes, old_solo.freed_bytes), (0, 1048576));
        let cohort = p
            .captures
            .iter()
            .find(|c| c.marker == "allocation")
            .unwrap();
        assert_eq!((cohort.live_bytes, cohort.freed_bytes), (0, 1048576));
        assert!(p.captures.iter().any(|c| c.solo && c.end_ms.is_none()));
        assert_eq!(p.counters.evicted_captures, 5000 - 128);
        assert_eq!(p.counters.disconnects, 1);
        assert_eq!(p.counters.rejected_events, 0);
        assert_eq!(p.dropped, 0);
    }
    #[test]
    fn process_sample_aging_is_not_a_source_error() {
        let mut p = p();
        for _ in 0..3000 {
            p.sample(ProcessCounters {
                cpu_ms: 1.,
                resident_bytes: 100,
                virtual_bytes: 200,
                thread_count: 1,
                state: "R".into(),
            });
        }
        assert_eq!(p.samples.len(), 2400);
        assert_eq!(p.counters.aged_samples, 600);
        assert_eq!(p.counters.evicted_captures, 0);
        assert_eq!(p.counters.rejected_events, 0);
        assert_eq!(p.dropped, 0);
    }
    #[test]
    fn play_generation_recovers_a_lost_end_and_idle_heartbeat_finishes_play() {
        let mut p = p();
        p.unity_editor = true;
        p.waiting_for_play = true;
        let mut state = e("state", 0, 1, 100);
        state.generation = 1;
        state.playing = Some(true);
        p.event(state.clone());
        let mut solo = state.clone();
        solo.kind = "solo".into();
        p.event(solo.clone());
        // No Play-end event is delivered. A later generation closes the old
        // recording before the first marker from the new Play can be recorded.
        solo.generation = 2;
        solo.wall_ns = 200;
        p.event(solo);
        assert_eq!(p.batch, 2);
        assert_eq!(p.captures.iter().filter(|c| c.end_ms.is_none()).count(), 1);
        assert_eq!(p.captures[0].status, "Unity Play ended");
        state.generation = 2;
        state.wall_ns = 300;
        state.playing = Some(false);
        p.event(state.clone());
        p.event(state);
        assert!(p.waiting_for_play && p.active && p.solo.is_none());
        assert!(p.captures.iter().all(|c| c.end_ms.is_some()));
        assert_eq!(p.batch, 2);
    }
    #[test]
    fn play_heartbeat_preserves_an_existing_marker_warning() {
        let mut p = p();
        p.unity_editor = true;
        p.play_generation = Some(1);
        p.reason = "Gold intent changed; rebuild the prepared marker".into();
        let mut state = e("state", 0, 1, 100);
        state.marker.clear();
        state.generation = 1;
        state.playing = Some(true);
        p.event(state);
        assert!(p.reason.starts_with("Gold intent changed"));
    }
    #[test]
    fn missing_sequence_reopens_solo_without_discarding_owned_cohorts() {
        let mut p = p();
        let mut solo = e("solo", 0, 1, 100);
        solo.sequence = 20;
        p.event(solo.clone());
        solo.sequence = 22;
        solo.wall_ns = 200;
        p.event(solo);
        assert_eq!(p.counters.source_gaps, 1);
        assert_eq!(p.counters.disconnects, 0);
        assert_eq!(p.counters.rejected_events, 0);
        assert_eq!(p.captures.len(), 2);
        assert_eq!(p.captures[0].status, "Incomplete: source events missing");
        assert!(p.captures[1].end_ms.is_none());
        let snapshot = p.view();
        assert!(snapshot.allocations.is_empty() && snapshot.discovery.is_none());
        assert_eq!(snapshot.counters.source_gaps, 1);
    }
    #[test]
    fn explicit_host_shutdown_unlinks_socket_and_never_signals_a_foreign_target() {
        let dir = std::env::temp_dir().join(format!("craidd-shutdown-{}", stamp()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("socket");
        let listener = UnixListener::bind(&path).unwrap();
        let manager = ProfileManager::default();
        *manager.socket.lock().unwrap() = Some(path.clone());
        let target = processes::identity(std::process::id() as i32).unwrap();
        manager.profiles.lock().unwrap().insert(
            "test".into(),
            Profile::new(target.clone(), "foreign".into()),
        );
        manager.shutdown();
        manager.shutdown();
        assert!(!path.exists());
        assert!(!manager.profiles.lock().unwrap()["test"].active);
        processes::verify(&target).unwrap();
        drop(listener);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn global_history_bound_preserves_pins_and_rare_markers() {
        let mut p = p();
        p.event(e("solo", 0, 1, 100));
        let mut alloc = e("alloc", 0, 1, 110);
        alloc.address = 123;
        alloc.bytes = 1048576;
        p.event(alloc);
        for i in 0..2500 {
            let mut begin = e("begin", i + 1, 1, 120 + i * 2);
            begin.marker = format!("marker-{i}");
            let mut end = begin.clone();
            end.kind = "end".into();
            end.wall_ns += 1;
            p.event(begin);
            p.event(end);
        }
        assert_eq!(p.captures.len(), 2000);
        assert!(p.captures[0].solo && p.captures[0].live_bytes == 1048576);
        assert_eq!(p.counters.rejected_events, 0);
        assert_eq!(p.counters.evicted_captures, 501);
        let mut free = e("free", 0, 2, 6000);
        free.address = 123;
        p.event(free);
        assert_eq!(p.captures[0].live_bytes, 0);
        assert_eq!(p.captures[0].freed_bytes, 1048576);
    }
    #[test]
    fn record_again_at_an_all_pinned_limit_keeps_the_current_recording() {
        let mut p = p();
        p.event(e("solo", 0, 1, 100));
        for _ in 1..2000 {
            p.again();
        }
        let batch = p.batch;
        let id = p.captures.last().unwrap().id.clone();
        p.again();
        assert_eq!(p.batch, batch);
        assert!(p.captures.iter().any(|c| c.id == id && c.end_ms.is_none()));
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
    fn editor_play_end_retains_selection_and_rearms_in_a_new_batch() {
        let mut p = p();
        p.unity_editor = true;
        p.waiting_for_play = true;
        p.event(e("solo", 0, 1, 100));
        p.event(e("begin", 1, 1, 110));
        p.event(e("play-end", 0, 1, 130));
        assert!(p.active && p.waiting_for_play);
        assert!(p.captures.iter().all(|c| c.end_ms.is_some()));
        assert!(p.captures[1].status.starts_with("Incomplete"));
        p.event(e("solo", 0, 1, 200));
        assert!(p.active && !p.waiting_for_play);
        assert_eq!(p.batch, 2);
        assert_eq!(p.captures[2].batch, 2);
        assert!(p.captures[2].solo);
        p.close("User stopped profiling");
        p.event(e("solo", 0, 1, 300));
        assert!(!p.active);
        assert_eq!(p.captures.len(), 3);
    }
    #[test]
    fn bounded_history_does_not_prevent_another_play_or_record_again() {
        let mut p = p();
        p.unity_editor = true;
        p.waiting_for_play = true;
        p.event(e("solo", 0, 1, 100));
        for i in 0..2100 {
            p.event(e("begin", i + 1, 1, 101 + i * 2));
            p.event(e("end", i + 1, 1, 102 + i * 2));
        }
        assert!(p.captures.len() <= 2000);
        assert!(p.counters.evicted_captures > 0);
        assert_eq!(p.dropped, 0);
        p.event(e("play-end", 0, 1, 5000));
        p.event(e("solo", 0, 1, 6000));
        assert!(p.captures.len() <= 2000);
        assert!(p.captures.last().unwrap().solo);
        assert_eq!(p.captures.last().unwrap().batch, 2);
        p.again();
        assert_eq!(p.captures.last().unwrap().batch, 3);
    }
    #[test]
    fn native_target_started_before_ide_discovers_its_selected_owner_without_socket_env() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_owned();
        let dir = std::env::temp_dir().join(format!("craidd-late-test-{}", stamp()));
        fs::create_dir(&dir).unwrap();
        let binary = dir.join("target");
        assert!(Command::new("c++")
            .args(["-std=c++17", "-pthread"])
            .arg("-I")
            .arg(root.join("support/profiling"))
            .arg(root.join("tests/fixtures/attach-profiling/late_profile_target.cpp"))
            .arg("-o")
            .arg(&binary)
            .status()
            .unwrap()
            .success());
        let mut child = Command::new(binary)
            .env_remove("CRAIDD_PROFILE_SOCKET")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut ready = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        assert_eq!(ready.trim(), "READY");
        let target = processes::identity(child.id() as i32).unwrap();
        // Bind and advertise only AFTER the target is already running.
        let path = dir.join("events.sock");
        let listener = UnixListener::bind(&path).unwrap();
        listener.set_nonblocking(true).unwrap();
        let route = super::super::profiling_discovery::Registration::publish(
            &target,
            path.to_str().unwrap(),
            "late-test",
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let stream = loop {
            match listener.accept() {
                Ok((s, _)) => break s,
                Err(_) => {
                    assert!(Instant::now() < deadline, "Late target never connected");
                    thread::sleep(Duration::from_millis(20));
                }
            }
        };
        assert_eq!(peer(&stream).unwrap(), target);
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut reader = BufReader::new(stream);
        loop {
            let mut text = String::new();
            assert!(reader.read_line(&mut text).unwrap() > 0);
            let event: SourceEvent = serde_json::from_str(&text).unwrap();
            if event.kind == "solo" {
                break;
            }
        }
        route.release();
        child.stdin.take().unwrap().write_all(b"stop\n").unwrap();
        assert!(child.wait().unwrap().success());
        fs::remove_dir_all(dir).unwrap();
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
