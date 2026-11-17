//! Explicit, bounded, read-only symbol discovery and capture-private serving.
use crate::perf_capture::{command, output, SymbolIdentity};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::{
        fs::symlink,
        fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    },
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
const ENTRIES: usize = 10_000;
const FILE_BYTES: u64 = 512 * 1024 * 1024;
static SETTINGS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport {
    pub entries: usize,
    pub elf_files: usize,
    pub elapsed_ms: u64,
    pub incomplete: bool,
    pub diagnostics: Vec<String>,
}
impl IndexReport {
    fn note(&mut self, s: String) {
        self.incomplete = true;
        if self.diagnostics.len() < 32 {
            self.diagnostics.push(s.chars().take(1024).collect());
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    pub path: String,
    pub canonical: String,
    pub size: u64,
    pub device: u64,
    pub inode: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Served {
    pub module: String,
    pub build_id: String,
    pub module_file: Fingerprint,
    pub debug_file: Fingerprint,
    pub cache_debug: String,
    pub cache_elf: String,
    pub state: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub locations: Vec<String>,
    #[serde(default)]
    pub withheld_modules: BTreeMap<String, String>,
    pub index: IndexReport,
    pub served: Vec<Served>,
    pub sealed: bool,
    pub private_cache: String,
}
impl Report {
    pub fn pending(locations: Vec<String>) -> Self {
        Self {
            locations,
            ..Self::default()
        }
    }
}
pub fn locations(solution: &Path) -> Result<Vec<String>, String> {
    let meta = fs::metadata(solution).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 4 * 1024 * 1024 {
        return Err("Solution settings exceed 4 MiB".into());
    }
    let text = fs::read_to_string(solution).map_err(|e| e.to_string())?;
    let doc: toml::Value = text.parse().map_err(|e| format!("Invalid solution: {e}"))?;
    let Some(value) = doc
        .get("profiling")
        .and_then(|p| p.get("debug_symbol_locations"))
    else {
        return Ok(vec![]);
    };
    let values = value
        .as_array()
        .ok_or("profiling.debug_symbol_locations must be a list")?;
    let result = values
        .iter()
        .map(|v| {
            v.as_str()
                .map(String::from)
                .ok_or("Symbol location must be text".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    validate_locations(&result)?;
    Ok(result)
}
fn validate_locations(paths: &[String]) -> Result<(), String> {
    if paths.len() > 16
        || paths
            .iter()
            .any(|p| p.trim().is_empty() || p.len() > 4096 || p.contains('\0'))
    {
        return Err(
            "Choose at most 16 nonempty symbol file/folder paths, each at most 4096 bytes".into(),
        );
    }
    let distinct: BTreeSet<_> = paths.iter().collect();
    if distinct.len() != paths.len() {
        return Err("Duplicate symbol locations".into());
    }
    Ok(())
}
pub fn save_locations(
    solution: &Path,
    paths: Vec<String>,
    expected: Vec<String>,
) -> Result<Vec<String>, String> {
    validate_locations(&paths)?;
    let _guard = SETTINGS_LOCK.lock().map_err(|e| e.to_string())?;
    if locations(solution)? != expected {
        return Err("Symbol settings changed on disk; reload before saving".into());
    }
    let before = fs::read_to_string(solution).map_err(|e| e.to_string())?;
    let mut doc: toml_edit::Document = before
        .parse()
        .map_err(|e| format!("Invalid solution: {e}"))?;
    if doc
        .get("profiling")
        .is_some_and(|v| !v.is_none() && !v.is_table())
    {
        return Err("profiling must be a table".into());
    }
    if doc.get("profiling").is_none_or(|v| v.is_none()) {
        doc["profiling"] = toml_edit::Item::Table(toml_edit::Table::new());
    }
    let mut list = toml_edit::Array::new();
    for p in &paths {
        list.push(p.as_str());
    }
    doc["profiling"]["debug_symbol_locations"] = toml_edit::value(list);
    if fs::read_to_string(solution).map_err(|e| e.to_string())? != before {
        return Err("Solution changed while saving; reload before retrying".into());
    }
    let canonical = solution.canonicalize().map_err(|e| e.to_string())?;
    let writable = OpenOptions::new()
        .write(true)
        .open(&canonical)
        .map_err(|e| e.to_string())?;
    let mode = writable.metadata().map_err(|e| e.to_string())?.mode() & 0o777;
    let temporary = canonical.with_file_name(format!(
        ".{}.symbols-{}-{}.tmp",
        canonical.file_name().unwrap().to_string_lossy(),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let save = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(doc.to_string().as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        if fs::read_to_string(&canonical).map_err(|e| e.to_string())? != before {
            return Err("Solution changed while saving; reload before retrying".into());
        }
        fs::rename(&temporary, &canonical).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if save.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    save?;
    Ok(paths)
}
// File fingerprints cover the exact named path and the opened regular file.
pub fn fingerprint(
    path: &Path,
    deadline: Instant,
    cancel: &AtomicBool,
) -> Result<Fingerprint, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&canonical)
        .map_err(|e| e.to_string())?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    if !before.is_file() || before.len() > FILE_BYTES {
        return Err("Symbol file is not regular or exceeds 512 MiB".into());
    }
    let mut digest = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        if Instant::now() >= deadline || cancel.load(Ordering::Acquire) {
            return Err("Symbol verification cancelled or exceeded its deadline".into());
        }
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        if bytes > FILE_BYTES {
            return Err("Symbol file grew beyond its limit".into());
        }
        digest.update(&buffer[..n]);
    }
    let after = file.metadata().map_err(|e| e.to_string())?;
    let named = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if before.dev() != named.dev()
        || before.ino() != named.ino()
        || before.len() != after.len()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.mtime() != after.mtime()
        || path.canonicalize().ok().as_deref() != Some(canonical.as_path())
    {
        return Err("Symbol file changed while fingerprinting".into());
    }
    Ok(Fingerprint {
        path: path.to_string_lossy().into(),
        canonical: canonical.to_string_lossy().into(),
        size: bytes,
        device: before.dev(),
        inode: before.ino(),
        sha256: format!("{:x}", digest.finalize()),
    })
}
pub fn recheck(served: &Served, cancel: &AtomicBool) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    for old in [&served.module_file, &served.debug_file] {
        if fingerprint(Path::new(&old.path), deadline, cancel)? != *old {
            return Err(format!(
                "Served symbol bytes or identity changed: {}",
                old.path
            ));
        }
    }
    Ok(())
}
fn build_id(tool: &Path, path: &Path, deadline: Instant) -> Option<String> {
    let left = deadline.checked_duration_since(Instant::now())?;
    let mut c = command(tool);
    c.args(["-n", "--"]).arg(path);
    output(c, left.min(Duration::from_secs(2)))
        .ok()?
        .lines()
        .find_map(|s| {
            s.trim()
                .strip_prefix("Build ID:")
                .map(|id| id.trim().to_owned())
        })
}
fn link_name(tool: &Path, path: &Path) -> Option<String> {
    let mut c = command(tool);
    c.args(["--string-dump=.gnu_debuglink", "--"]).arg(path);
    let text = output(c, Duration::from_secs(2)).ok()?;
    text.lines().find_map(|s| {
        let (offset, name) = s.trim().split_once(']')?;
        let name = name.trim();
        (offset.trim_start_matches('[').trim() == "0"
            && !name.is_empty()
            && !name.contains('/')
            && name != "."
            && name != "..")
            .then(|| name.into())
    })
}
struct Candidate {
    path: PathBuf,
    id: Option<String>,
}
fn index(
    tool: &Path,
    solution: &Path,
    report: &mut Report,
    wanted: &BTreeSet<String>,
    names: &BTreeSet<String>,
    cancel: &AtomicBool,
) -> Vec<Candidate> {
    let start = Instant::now();
    let deadline = start + Duration::from_secs(5);
    let mut pending: Vec<_> = report
        .locations
        .iter()
        .rev()
        .map(|p| {
            let path = PathBuf::from(p);
            (
                if path.is_absolute() {
                    path
                } else {
                    solution.parent().unwrap().join(path)
                },
                0,
                true,
            )
        })
        .collect();
    let mut result = Vec::new();
    while let Some((path, depth, explicit)) = pending.pop() {
        if Instant::now() >= deadline || cancel.load(Ordering::Acquire) {
            report
                .index
                .note("Index cut short at the 10,000-entry / 5 s / cancellation bound".into());
            break;
        }
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                report.index.note(format!("{}: {e}", path.display()));
                continue;
            }
        };
        if meta.file_type().is_symlink() && !explicit {
            continue;
        }
        let meta = if explicit {
            match fs::metadata(&path) {
                Ok(m) => m,
                Err(e) => {
                    report.index.note(format!("{}: {e}", path.display()));
                    continue;
                }
            }
        } else {
            meta
        };
        if meta.is_dir() {
            if depth > 2 {
                report
                    .index
                    .note(format!("Depth limit: {}", path.display()));
                continue;
            }
            match fs::read_dir(&path) {
                Ok(entries) => {
                    for entry in entries {
                        if report.index.entries >= ENTRIES || Instant::now() >= deadline {
                            report
                                .index
                                .note("Index enumeration cut short at its entry/time bound".into());
                            break;
                        }
                        report.index.entries += 1;
                        match entry {
                            Ok(entry) => pending.push((entry.path(), depth + 1, false)),
                            Err(e) => report.index.note(e.to_string()),
                        }
                    }
                }
                Err(e) => report.index.note(format!("{}: {e}", path.display())),
            };
            continue;
        }
        if explicit {
            report.index.entries += 1;
        }
        if !meta.is_file() || meta.len() > FILE_BYTES {
            continue;
        }
        let mut magic = [0u8; 4];
        let elf = File::open(&path)
            .and_then(|mut f| f.read_exact(&mut magic))
            .is_ok()
            && magic == *b"\x7fELF";
        let id = if elf {
            report.index.elf_files += 1;
            build_id(tool, &path, deadline)
        } else {
            None
        };
        if path
            .file_name()
            .is_some_and(|n| names.contains(n.to_string_lossy().as_ref()))
            || id.as_ref().is_some_and(|id| wanted.contains(id))
        {
            result.push(Candidate { path, id });
        }
    }
    report.index.elapsed_ms = start.elapsed().as_millis() as u64;
    result
}
fn install(
    perf: &Path,
    cache: &Path,
    served: &mut Served,
    deadline: Instant,
) -> Result<(), String> {
    let mut c = command(perf);
    c.arg("--buildid-dir")
        .arg(cache)
        .args(["buildid-cache", "-a"])
        .arg(&served.module_file.canonical);
    let left = deadline
        .checked_duration_since(Instant::now())
        .ok_or("Symbol cache deadline reached")?;
    output(c, left.min(Duration::from_secs(3)))?;
    let relative = Path::new(&served.module_file.canonical)
        .strip_prefix("/")
        .map_err(|_| "Module path is not absolute")?;
    let folder = cache.join(relative).join(&served.build_id);
    if !folder.join("elf").is_file() {
        return Err("Installed perf build-ID cache layout is not qualified".into());
    }
    let elf = folder.join("elf");
    fs::remove_file(&elf).map_err(|e| e.to_string())?;
    symlink(&served.module_file.canonical, &elf).map_err(|e| e.to_string())?;
    served.cache_elf = elf.to_string_lossy().into();
    let link = folder.join("debug");
    if fs::symlink_metadata(&link).is_ok() {
        fs::remove_file(&link).map_err(|e| e.to_string())?;
    }
    symlink(&served.debug_file.canonical, &link).map_err(|e| e.to_string())?;
    served.cache_debug = link.to_string_lossy().into();
    Ok(())
}
pub fn prepare(
    perf: &Path,
    tool: &Path,
    dir: &Path,
    solution: &Path,
    builds: &[SymbolIdentity],
    mut report: Report,
    cancel: &AtomicBool,
) -> Report {
    let deadline = Instant::now() + Duration::from_secs(15);
    let cache = dir.join("symbol-cache");
    report.private_cache = cache.to_string_lossy().into();
    let cache_result = (|| -> Result<(), String> {
        if let Ok(meta) = fs::symlink_metadata(&cache) {
            if meta.file_type().is_symlink() {
                fs::remove_file(&cache).map_err(|e| e.to_string())?;
            } else if meta.is_dir() {
                fs::remove_dir_all(&cache).map_err(|e| e.to_string())?;
            } else {
                return Err("Unexpected capture symbol cache entry".into());
            }
        }
        fs::create_dir(&cache).map_err(|e| e.to_string())?;
        fs::set_permissions(&cache, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = cache_result {
        report.index.note(e.clone());
        for build in builds {
            report
                .withheld_modules
                .insert(build.module.clone(), e.clone());
        }
        for served in &mut report.served {
            served.state = "withheld: cache unavailable".into();
        }
        report.sealed = true;
        return report;
    }
    if report.sealed {
        for served in &mut report.served {
            served.state = match recheck(served, cancel)
                .and_then(|_| install(perf, &cache, served, deadline))
            {
                Ok(()) => "served".into(),
                Err(e) => format!("withheld: {e}"),
            };
        }
        return report;
    }
    let names_by_module: HashMap<_, _> = builds
        .iter()
        .map(|b| {
            (
                b.module.clone(),
                link_name(tool, Path::new(&b.module)).unwrap_or_else(|| {
                    format!(
                        "{}.debug",
                        Path::new(&b.module)
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    )
                }),
            )
        })
        .collect();
    let wanted = builds.iter().map(|b| b.captured_build_id.clone()).collect();
    let mut names: BTreeSet<String> = names_by_module.values().cloned().collect();
    for b in builds {
        names.insert(format!("{}.debug", b.captured_build_id));
        if b.captured_build_id.len() > 2 {
            names.insert(format!("{}.debug", &b.captured_build_id[2..]));
        }
    }
    let found = index(tool, solution, &mut report, &wanted, &names, cancel);
    let mut admitted = 0u64;
    for build in builds {
        if Instant::now() >= deadline {
            report
                .index
                .note("Symbol serving cut short at 15 s total deadline".into());
            break;
        }
        let external: Vec<_> = found
            .iter()
            .filter(|c| {
                c.id.as_deref() == Some(&build.captured_build_id)
                    || c.path.file_name().is_some_and(|n| {
                        n == names_by_module[&build.module].as_str()
                            || n == format!("{}.debug", build.captured_build_id).as_str()
                    })
            })
            .collect();
        // Relevant named conflicts conservatively withhold the whole module.
        if build.state != "matched"
            || build
                .debug_files
                .iter()
                .any(|d| d.state != "matchedCandidate")
            || external
                .iter()
                .any(|c| c.id.as_deref() != Some(&build.captured_build_id))
        {
            if !external.is_empty() {
                let bad = external
                    .iter()
                    .find(|c| c.id.as_deref() != Some(&build.captured_build_id))
                    .unwrap();
                report.withheld_modules.insert(
                    build.module.clone(),
                    format!(
                        "Candidate {} has build ID {:?}; expected {}",
                        bad.path.display(),
                        bad.id,
                        build.captured_build_id
                    ),
                );
                report.index.note(format!(
                    "Module {}: relevant debug candidate has a mismatched/unverified build ID",
                    build.module
                ));
            }
            continue;
        }
        let selected = external
            .first()
            .map(|c| c.path.clone())
            .or_else(|| build.debug_files.first().map(|d| PathBuf::from(&d.path)));
        let Some(path) = selected else {
            continue;
        };
        let result = (|| -> Result<Served, String> {
            let module_file = fingerprint(Path::new(&build.module), deadline, cancel)?;
            let debug_file = fingerprint(&path, deadline, cancel)?;
            if admitted
                .saturating_add(module_file.size)
                .saturating_add(debug_file.size)
                > FILE_BYTES
            {
                return Err("Capture symbol cache admission exceeds 512 MiB".into());
            }
            let mut served = Served {
                module: build.module.clone(),
                build_id: build.captured_build_id.clone(),
                module_file,
                debug_file,
                cache_debug: String::new(),
                cache_elf: String::new(),
                state: "served".into(),
            };
            install(perf, &cache, &mut served, deadline)?;
            recheck(&served, cancel)?;
            admitted += served.module_file.size + served.debug_file.size;
            Ok(served)
        })();
        match result {
            Ok(served) => report.served.push(served),
            Err(e) => {
                report
                    .withheld_modules
                    .insert(build.module.clone(), e.clone());
                report.index.note(format!("Module {}: {e}", build.module));
            }
        }
    }
    report.sealed = true;
    report
}
/// Validate served bytes and links again after decode and before source navigation.
pub fn verify_report(report: &mut Report, cancel: &AtomicBool) {
    let cache = PathBuf::from(&report.private_cache);
    for served in &mut report.served {
        if served.state != "served" {
            continue;
        }
        if served.build_id.len() < 3
            || served.build_id.len() > 128
            || !served.build_id.bytes().all(|b| b.is_ascii_hexdigit())
        {
            served.state = "withheld: invalid build ID".into();
            continue;
        }
        if let Err(e) = recheck(served, cancel).and_then(|_| {
            let actual = fs::read_link(&served.cache_debug).map_err(|e| e.to_string())?;
            if actual != PathBuf::from(&served.debug_file.canonical) {
                return Err("Private debug cache link changed".into());
            }
            if fs::read_link(&served.cache_elf).map_err(|e| e.to_string())?
                != PathBuf::from(&served.module_file.canonical)
            {
                return Err("Private module cache link changed".into());
            }
            if !cache.is_absolute()
                || !Path::new(&served.cache_elf).starts_with(&cache)
                || !Path::new(&served.cache_debug).starts_with(&cache)
            {
                return Err("Invalid private cache path".into());
            }
            let binding = cache
                .join(".build-id")
                .join(&served.build_id[..2])
                .join(&served.build_id[2..]);
            if binding.canonicalize().map_err(|e| e.to_string())?
                != Path::new(&served.cache_elf)
                    .parent()
                    .unwrap()
                    .canonicalize()
                    .map_err(|e| e.to_string())?
            {
                return Err("Private build-ID binding changed".into());
            }

            Ok(())
        }) {
            served.state = format!("withheld: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "perf-symbol-unit-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn settings_preserve_comments_and_refuse_stale_or_unbounded_lists() {
        let dir = root();
        let solution = dir.join("test.cln");
        fs::write(
            &solution,
            "# keep\n[solution]\nname='Keep this'\n[other]\nx=12 # still here\n",
        )
        .unwrap();
        assert!(locations(&solution).unwrap().is_empty());
        let paths = vec!["../symbols".into(), "/elsewhere/renamed.debug".into()];
        save_locations(&solution, paths.clone(), vec![]).unwrap();
        assert_eq!(locations(&solution).unwrap(), paths);
        let text = fs::read_to_string(&solution).unwrap();
        assert!(text.contains("# keep") && text.contains("# still here"));
        assert!(save_locations(&solution, vec![], vec![]).is_err());
        assert_eq!(fs::read_to_string(&solution).unwrap(), text);
        assert!(save_locations(&solution, vec!["dup".into(); 17], paths).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn fingerprint_detects_same_build_bytes_and_path_replacement() {
        let dir = root();
        let path = dir.join("symbols.debug");
        fs::write(&path, b"original bytes").unwrap();
        let cancel = AtomicBool::new(false);
        let first = fingerprint(&path, Instant::now() + Duration::from_secs(1), &cancel).unwrap();
        assert_eq!(
            first,
            fingerprint(&path, Instant::now() + Duration::from_secs(1), &cancel).unwrap()
        );
        fs::write(&path, b"changed! bytes").unwrap();
        assert_ne!(
            first,
            fingerprint(&path, Instant::now() + Duration::from_secs(1), &cancel).unwrap()
        );
        let moved = dir.join("moved");
        fs::rename(&path, &moved).unwrap();
        assert!(fingerprint(&path, Instant::now() + Duration::from_secs(1), &cancel).is_err());
        assert!(fingerprint(&moved, Instant::now(), &cancel).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn index_accounts_enumeration_and_never_descends_symlink_directories() {
        let dir = root();
        let files = dir.join("files");
        fs::create_dir(&files).unwrap();
        for i in 0..10010 {
            fs::write(files.join(format!("file{i}")), b"text").unwrap();
        }
        symlink(&dir, files.join("cycle")).unwrap();
        let solution = dir.join("test.cln");
        let mut report = Report::pending(vec![files.to_string_lossy().into()]);
        let cancel = AtomicBool::new(false);
        let start = Instant::now();
        let found = index(
            Path::new("/not-used-readelf"),
            &solution,
            &mut report,
            &BTreeSet::new(),
            &BTreeSet::new(),
            &cancel,
        );
        assert!(found.is_empty());
        assert_eq!(report.index.entries, 10000);
        assert!(report.index.incomplete);
        assert!(start.elapsed() < Duration::from_secs(6));
        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod private_cache_tests {
    use super::*;
    #[test]
    fn altered_cache_links_are_withheld_without_touching_producer_files() {
        let dir = std::env::temp_dir().join(format!(
            "perf-cache-links-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let module = dir.join("module");
        let debug = dir.join("debug");
        let decoy = dir.join("decoy");
        fs::write(&module, b"module").unwrap();
        fs::write(&debug, b"debug").unwrap();
        fs::write(&decoy, b"decoy").unwrap();
        let cache = dir.join("symbol-cache");
        let folder = cache.join("module/aabb");
        fs::create_dir_all(&folder).unwrap();
        fs::create_dir_all(cache.join(".build-id/aa")).unwrap();
        symlink(&folder, cache.join(".build-id/aa/bb")).unwrap();
        symlink(&module, folder.join("elf")).unwrap();
        symlink(&debug, folder.join("debug")).unwrap();
        let cancel = AtomicBool::new(false);
        let deadline = Instant::now() + Duration::from_secs(2);
        let served = Served {
            module: module.to_string_lossy().into(),
            build_id: "aabb".into(),
            module_file: fingerprint(&module, deadline, &cancel).unwrap(),
            debug_file: fingerprint(&debug, deadline, &cancel).unwrap(),
            cache_debug: folder.join("debug").to_string_lossy().into(),
            cache_elf: folder.join("elf").to_string_lossy().into(),
            state: "served".into(),
        };
        let mut valid = Report {
            served: vec![served.clone()],
            private_cache: cache.to_string_lossy().into(),
            ..Report::default()
        };
        verify_report(&mut valid, &cancel);
        assert_eq!(valid.served[0].state, "served");
        for path in [
            folder.join("debug"),
            folder.join("elf"),
            cache.join(".build-id/aa/bb"),
        ] {
            let original = fs::read_link(&path).unwrap();
            fs::remove_file(&path).unwrap();
            symlink(&decoy, &path).unwrap();
            let mut changed = Report {
                served: vec![served.clone()],
                private_cache: cache.to_string_lossy().into(),
                ..Report::default()
            };
            verify_report(&mut changed, &cancel);
            assert!(changed.served[0].state.starts_with("withheld:"));
            fs::remove_file(&path).unwrap();
            symlink(original, &path).unwrap();
        }
        assert_eq!(fs::read(&module).unwrap(), b"module");
        assert_eq!(fs::read(&debug).unwrap(), b"debug");
        fs::remove_dir_all(dir).unwrap();
    }
}
