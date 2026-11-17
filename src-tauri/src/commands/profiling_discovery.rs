//! Selected-target rendezvous; the provider can start before the IDE.
use super::processes::{self, ProcessIdentity};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::{
        ffi::OsStrExt,
        fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt},
        io::AsRawFd,
    },
    path::PathBuf,
};

#[derive(Clone)]
pub(super) struct Registration {
    path: PathBuf,
    body: String,
}

fn private_directory(path: &std::path::Path) -> Result<(), String> {
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.to_string()),
    }
    let m = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
        return Err("Profiling discovery directory must be private and owned by your user".into());
    }
    Ok(())
}
fn hash(value: &[u8]) -> u64 {
    value.iter().fold(0xcbf29ce484222325_u64, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    })
}
fn directory_for(
    home: &std::path::Path,
    runtime: Option<&std::path::Path>,
    scope: Option<&str>,
) -> Result<PathBuf, String> {
    if !home.is_absolute() {
        return Err("Profiling requires an absolute HOME".into());
    }
    let base = if let Some(runtime) = runtime {
        if !runtime.is_absolute() {
            return Err("XDG_RUNTIME_DIR must be absolute".into());
        }
        runtime.to_owned()
    } else {
        let fallback = home.join(".cache/craidd-studio");
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&fallback)
            .map_err(|e| e.to_string())?;
        fallback
    };
    let m = fs::symlink_metadata(&base).map_err(|e| e.to_string())?;
    if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
        return Err("Profiling runtime directory must be private and owned by your user".into());
    }
    let root = base.join("craidd-profiling");
    private_directory(&root)?;
    let canonical_home = fs::canonicalize(home).unwrap_or_else(|_| home.to_owned());
    let namespace = match scope {
        Some(scope) if !scope.is_empty() => format!("n{:016x}", hash(scope.as_bytes())),
        _ => format!("h{:016x}", hash(canonical_home.as_os_str().as_bytes())),
    };
    let dir = root.join(namespace);
    private_directory(&dir)?;
    Ok(dir)
}
pub(super) fn directory() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Profiling requires HOME")?;
    let runtime = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from);
    let scope = std::env::var("CRAIDD_PROFILE_NAMESPACE").ok();
    let dir = directory_for(&home, runtime.as_deref(), scope.as_deref())?;
    let _lock = lock(&dir)?;
    cleanup(&dir);
    Ok(dir)
}
fn lock(dir: &std::path::Path) -> Result<File, String> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(dir.join(".lock"))
        .map_err(|e| e.to_string())?;
    let m = file.metadata().map_err(|e| e.to_string())?;
    if !m.is_file() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
        return Err("Invalid profiling discovery lock".into());
    }
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(file)
}
fn remove_socket(dir: &std::path::Path, path: &std::path::Path, owner: &ProcessIdentity) {
    if path.parent() != Some(dir)
        || path.file_name().and_then(|n| n.to_str())
            != Some(format!("host-{}-{}.sock", owner.pid, owner.birth).as_str())
    {
        return;
    }
    if let Ok(m) = fs::symlink_metadata(path) {
        if m.file_type().is_socket() && m.uid() == unsafe { libc::geteuid() } {
            let _ = fs::remove_file(path);
        }
    }
}
fn owner_alive(owner: &ProcessIdentity) -> bool {
    processes::verify(owner).is_ok() && processes::counters(owner).is_ok()
}
fn cleanup(dir: &std::path::Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|n| n.to_str()) == Some("endpoint") {
            if let Ok(body) = read(&path) {
                if let Some(owner) = owner(&body).filter(|owner| !owner_alive(owner)) {
                    if let Some(socket) = body.lines().nth(1) {
                        remove_socket(dir, std::path::Path::new(socket), &owner);
                    }
                    let _ = fs::remove_file(path);
                }
            }
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if let Some(numbers) = name
                .strip_prefix("host-")
                .and_then(|n| n.strip_suffix(".sock"))
            {
                if let Some((pid, birth)) = numbers.split_once('-') {
                    if let (Ok(pid), Ok(birth)) = (pid.parse(), birth.parse()) {
                        let owner = ProcessIdentity { pid, birth };
                        if !owner_alive(&owner) {
                            remove_socket(dir, &path, &owner);
                        }
                    }
                }
            }
        }
    }
}

fn read(path: &std::path::Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|e| e.to_string())?;
    let m = file.metadata().map_err(|e| e.to_string())?;
    if !m.is_file()
        || m.uid() != unsafe { libc::geteuid() }
        || m.mode() & 0o077 != 0
        || m.len() > 1024
    {
        return Err("Invalid profiling discovery route".into());
    }
    let mut body = String::new();
    file.read_to_string(&mut body).map_err(|e| e.to_string())?;
    Ok(body)
}
fn owner(body: &str) -> Option<ProcessIdentity> {
    let lines: Vec<_> = body.lines().collect();
    if lines.len() != 5 || lines[0] != "CRAIDD_PROFILE_V1" {
        return None;
    }
    Some(ProcessIdentity {
        pid: lines[2].parse().ok()?,
        birth: lines[3].parse().ok()?,
    })
}
impl Registration {
    pub(super) fn publish(
        target: &ProcessIdentity,
        socket: &str,
        session: &str,
    ) -> Result<Self, String> {
        Self::publish_in(directory()?, target, socket, session)
    }
    fn publish_in(
        dir: PathBuf,
        target: &ProcessIdentity,
        socket: &str,
        session: &str,
    ) -> Result<Self, String> {
        private_directory(&dir)?;
        let _lock = lock(&dir)?;
        if socket.contains('\n') || session.contains('\n') {
            return Err("Invalid discovery route".into());
        }
        let path = dir.join(format!("{}-{}.endpoint", target.pid, target.birth));
        if path.try_exists().map_err(|e| e.to_string())? {
            let existing = read(&path)?;
            if owner(&existing).is_some_and(|owner| owner_alive(&owner)) {
                return Err("This process is already selected by a Craidd profiling owner".into());
            }
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        let owner = processes::identity(std::process::id() as i32)?;
        let body = format!(
            "CRAIDD_PROFILE_V1\n{socket}\n{}\n{}\n{session}\n",
            owner.pid, owner.birth
        );
        let tmp = dir.join(format!(
            ".route-{}-{}",
            owner.pid,
            super::profiling::stamp()
        ));
        let result = (|| {
            let mut f = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&tmp)
                .map_err(|e| e.to_string())?;
            f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
            // Atomic claim without replacing a concurrent owner's registration.
            fs::hard_link(&tmp, &path).map_err(|e| format!("Cannot claim profiling target: {e}"))
        })();
        let _ = fs::remove_file(tmp);
        result?;
        Ok(Self { path, body })
    }
    pub(super) fn release(&self) {
        let Some(dir) = self.path.parent() else {
            return;
        };
        let Ok(_lock) = lock(dir) else { return };
        if read(&self.path).ok().as_ref() == Some(&self.body) {
            let _ = fs::remove_file(&self.path);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registration_is_private_exclusive_and_releases_only_its_own_route() {
        let dir =
            std::env::temp_dir().join(format!("craidd-route-{}", super::super::profiling::stamp()));
        let target = processes::identity(std::process::id() as i32).unwrap();
        let a = Registration::publish_in(dir.clone(), &target, "/tmp/socket", "session-a").unwrap();
        assert_eq!(fs::metadata(&a.path).unwrap().mode() & 0o777, 0o600);
        assert!(Registration::publish_in(dir.clone(), &target, "/tmp/other", "session-b").is_err());
        let path = a.path.clone();
        a.release();
        assert!(!path.exists());
        let b = Registration::publish_in(dir.clone(), &target, "/tmp/other", "session-b").unwrap();
        a.release();
        assert!(path.exists());
        b.release();
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn stale_owner_is_replaced_but_symlinked_routes_are_not_followed() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "craidd-route-stale-{}",
            super::super::profiling::stamp()
        ));
        private_directory(&dir).unwrap();
        let target = processes::identity(std::process::id() as i32).unwrap();
        let path = dir.join(format!("{}-{}.endpoint", target.pid, target.birth));
        fs::write(
            &path,
            "CRAIDD_PROFILE_V1\n/tmp/old.sock\n2147483647\n1\nold\n",
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let fresh =
            Registration::publish_in(dir.clone(), &target, "/tmp/fresh.sock", "fresh").unwrap();
        fresh.release();
        let other = dir.join("untouched");
        fs::write(&other, "preserve").unwrap();
        std::os::unix::fs::symlink(&other, &path).unwrap();
        assert!(
            Registration::publish_in(dir.clone(), &target, "/tmp/fresh.sock", "fresh").is_err()
        );
        assert_eq!(fs::read_to_string(other).unwrap(), "preserve");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn refuses_symlinked_discovery_directory() {
        let dir = std::env::temp_dir().join(format!(
            "craidd-route-link-{}",
            super::super::profiling::stamp()
        ));
        std::os::unix::fs::symlink(std::env::temp_dir(), &dir).unwrap();
        assert!(private_directory(&dir).is_err());
        fs::remove_file(dir).unwrap();
    }
    #[test]
    fn namespaces_follow_home_xdg_and_explicit_disposable_scope() {
        let root =
            std::env::temp_dir().join(format!("craidd-scope-{}", super::super::profiling::stamp()));
        private_directory(&root).unwrap();
        fs::create_dir(root.join("home-a")).unwrap();
        fs::create_dir(root.join("home-b")).unwrap();
        let a = directory_for(&root.join("home-a"), Some(&root), None).unwrap();
        let b = directory_for(&root.join("home-b"), Some(&root), None).unwrap();
        assert_ne!(a, b);
        let shared = directory_for(&root.join("home-a"), Some(&root), Some("disposable")).unwrap();
        assert_eq!(
            shared,
            directory_for(&root.join("home-b"), Some(&root), Some("disposable")).unwrap()
        );
        assert_ne!(shared, a);
        assert!(directory_for(&root, Some(std::path::Path::new("relative")), None).is_err());
        assert!(directory_for(&root.join("home-a"), None, None)
            .unwrap()
            .starts_with(root.join("home-a/.cache/craidd-studio")));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn crash_cleanup_removes_dead_owned_artifacts_and_preserves_live_and_external_files() {
        use std::os::unix::{fs::PermissionsExt, net::UnixListener};
        let dir =
            std::env::temp_dir().join(format!("craidd-crash-{}", super::super::profiling::stamp()));
        private_directory(&dir).unwrap();
        let dead = ProcessIdentity {
            pid: 2147483647,
            birth: 1,
        };
        let socket = dir.join(format!("host-{}-{}.sock", dead.pid, dead.birth));
        let _listener = UnixListener::bind(&socket).unwrap();
        let route = dir.join("target.endpoint");
        fs::write(
            &route,
            format!(
                "CRAIDD_PROFILE_V1\n{}\n{}\n{}\nstale\n",
                socket.display(),
                dead.pid,
                dead.birth
            ),
        )
        .unwrap();
        fs::set_permissions(&route, fs::Permissions::from_mode(0o600)).unwrap();
        let target = processes::identity(std::process::id() as i32).unwrap();
        let live =
            Registration::publish_in(dir.clone(), &target, "/external/untouched.sock", "live")
                .unwrap();
        let external = dir.join("unknown-file");
        fs::write(&external, "preserve").unwrap();
        let _lock = lock(&dir).unwrap();
        cleanup(&dir);
        assert!(!route.exists() && !socket.exists());
        assert!(live.path.exists());
        assert_eq!(fs::read_to_string(external).unwrap(), "preserve");
        drop(_lock);
        live.release();
        fs::remove_dir_all(dir).unwrap();
    }
}
