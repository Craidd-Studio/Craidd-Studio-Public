//! Selected-target rendezvous; the provider can start before the IDE.
use super::processes::{self, ProcessIdentity};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
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
pub(super) fn directory() -> Result<PathBuf, String> {
    let base = PathBuf::from(format!("/run/user/{}", unsafe { libc::geteuid() }));
    let m = fs::symlink_metadata(&base)
        .map_err(|e| format!("Unity-first profiling needs your user runtime directory: {e}"))?;
    if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
        return Err("User runtime directory is not private".into());
    }
    let dir = base.join("craidd-profiling");
    private_directory(&dir)?;
    Ok(dir)
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
        if socket.contains('\n') || session.contains('\n') {
            return Err("Invalid discovery route".into());
        }
        let path = dir.join(format!("{}-{}.endpoint", target.pid, target.birth));
        if path.try_exists().map_err(|e| e.to_string())? {
            let existing = read(&path)?;
            if owner(&existing).is_some_and(|owner| processes::verify(&owner).is_ok()) {
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
}
