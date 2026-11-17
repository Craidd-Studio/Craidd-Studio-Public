//! Experimental launch-only prebuilt adapter. Attach never mutates target environments.
use crate::perf_capture::Target;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::Path,
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        LazyLock, Mutex,
    },
};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperIdentity {
    pub version: String,
    pub sha256: String,
    pub path: String,
    pub target: String,
    pub startup_coverage_incomplete: bool,
    pub activation_basis: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProvenance {
    pub root: Target,
    pub owner: String,
    pub helper: HelperIdentity,
}
static NEXT_HELPER: AtomicU64 = AtomicU64::new(1);
static LAUNCHES: LazyLock<Mutex<VecDeque<LaunchProvenance>>> =
    LazyLock::new(|| Mutex::new(VecDeque::new()));
#[cfg(all(
    target_os = "linux",
    target_arch = "x86_64",
    target_env = "gnu",
    target_pointer_width = "64"
))]
fn artifact() -> Result<(&'static [u8], serde_json::Value), String> {
    let version =
        unsafe { std::ffi::CStr::from_ptr(libc::gnu_get_libc_version()) }.to_string_lossy();
    let parts: Vec<u32> = version.split('.').filter_map(|v| v.parse().ok()).collect();
    if parts.first().copied().unwrap_or(0) < 2
        || (parts.first() == Some(&2) && parts.get(1).copied().unwrap_or(0) < 34)
    {
        return Err("Experimental Mono helper requires glibc 2.34 or later".into());
    }
    let bytes = include_bytes!("../native/mono-map/linux-x86_64-gnu/libcraidd_mono_map.so");
    let manifest: serde_json::Value = serde_json::from_str(include_str!(
        "../native/mono-map/linux-x86_64-gnu/manifest.json"
    ))
    .map_err(|e| e.to_string())?;
    if manifest["sha256"].as_str() != Some(format!("{:x}", Sha256::digest(bytes)).as_str()) {
        return Err("Bundled Mono helper hash mismatch".into());
    }
    Ok((bytes, manifest))
}
#[cfg(not(all(
    target_os = "linux",
    target_arch = "x86_64",
    target_env = "gnu",
    target_pointer_width = "64"
)))]
fn artifact() -> Result<(&'static [u8], serde_json::Value), String> {
    Err("Experimental Mono helper is qualified only for Linux x86_64 GNU".into())
}
pub fn capability() -> serde_json::Value {
    match artifact() {
        Ok((_, manifest)) => {
            serde_json::json!({"available":true,"experimental":true,"manifest":manifest,"scope":"Launch only; dynamic dlsym(mono_jit_init_version). Startup coverage incomplete. No source or caller-unwind verification."})
        }
        Err(reason) => serde_json::json!({"available":false,"experimental":true,"reason":reason}),
    }
}
pub fn materialize(cache: &Path) -> Result<HelperIdentity, String> {
    let (bytes, manifest) = artifact()?;
    let hash = manifest["sha256"].as_str().ok_or("Missing helper hash")?;
    let version = manifest["version"]
        .as_str()
        .ok_or("Missing helper version")?;
    let dir = cache.join("profiling/mono-helper").join(hash);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let meta = fs::symlink_metadata(&dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } {
        return Err("Mono helper cache is not a current-user directory".into());
    }
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let path = dir.join("libcraidd_mono_map.so");
    if path
        .to_string_lossy()
        .chars()
        .any(|c| c.is_whitespace() || c == ':')
    {
        return Err("Mono helper cache path contains a preload separator (space/colon); choose a supported cache location or disable the option".into());
    }
    if fs::symlink_metadata(&path).is_err() {
        let temporary = dir.join(format!(
            ".new-{}-{}",
            std::process::id(),
            NEXT_HELPER.fetch_add(1, Ordering::Relaxed)
        ));
        let publish = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o500)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            file.write_all(bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            match fs::hard_link(&temporary, &path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        })();
        let _ = fs::remove_file(&temporary);
        publish?;
    }
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file()
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.len() != bytes.len() as u64
        || meta.mode() & 0o777 != 0o500
    {
        return Err("Mono helper cache identity/permissions changed; launch refused".into());
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    std::io::copy(&mut file, &mut digest).map_err(|e| e.to_string())?;
    if format!("{:x}", digest.finalize()) != hash {
        return Err("Mono helper cache bytes changed; launch refused".into());
    }
    Ok(HelperIdentity{version:version.into(),sha256:hash.into(),path:path.to_string_lossy().into(),target:"linux-x86_64-gnu".into(),startup_coverage_incomplete:true,activation_basis:"Requested for this launched process family; activation/map fingerprint observed separately. Map names are not verified source or inclusive time.".into()})
}
/// Returns provenance only when opted in; modifies this Command, never global env.
pub fn apply(
    command: &mut Command,
    env: &BTreeMap<String, String>,
    cache: &Path,
    enabled: bool,
) -> Result<Option<HelperIdentity>, String> {
    if !enabled {
        return Ok(None);
    }
    let helper = materialize(cache)?;
    let old = env
        .get("LD_PRELOAD")
        .cloned()
        .or_else(|| std::env::var("LD_PRELOAD").ok())
        .unwrap_or_default();
    if old.len() > 32768 {
        return Err("Existing preload list exceeds the helper's 32 KiB bound".into());
    }
    let value = if old
        .split(|c: char| c.is_whitespace() || c == ':')
        .any(|p| p == helper.path)
    {
        old
    } else if old.is_empty() {
        helper.path.clone()
    } else {
        format!("{} {old}", helper.path)
    };
    command.env("LD_PRELOAD", value);
    Ok(Some(helper))
}
pub fn register(root: Target, owner: String, helper: HelperIdentity) {
    let mut rows = LAUNCHES.lock().unwrap();
    rows.push_back(LaunchProvenance {
        root,
        owner,
        helper,
    });
    while rows.len() > 128 {
        rows.pop_front();
    }
}
fn process(pid: i32) -> Option<(Target, i32)> {
    let text = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let tail: Vec<_> = text.rsplit_once(')')?.1.split_whitespace().collect();
    Some((
        Target {
            pid,
            birth: tail.get(19)?.parse().ok()?,
        },
        tail.get(1)?.parse().ok()?,
    ))
}
pub fn provenance(target: &Target) -> Option<LaunchProvenance> {
    let rows = LAUNCHES.lock().ok()?.clone();
    let mut current = target.clone();
    for _ in 0..64 {
        let (observed, parent) = process(current.pid)?;
        if observed != current {
            return None;
        }
        if let Some(row) = rows.iter().rev().find(|r| r.root == current) {
            if process(target.pid)?.0 != *target || process(row.root.pid)?.0 != row.root {
                return None;
            }
            return Some(row.clone());
        }
        if parent <= 1 {
            return None;
        }
        current = process(parent)?.0;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "mono-helper-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn prebuilt_is_verified_and_preload_is_command_local() {
        if !capability()["available"].as_bool().unwrap() {
            return;
        }
        let root = root();
        let before = std::env::var_os("LD_PRELOAD");
        let mut command = Command::new("true");
        let env = BTreeMap::from([("LD_PRELOAD".into(), "/existing/a.so:/existing/b.so".into())]);
        let helper = apply(&mut command, &env, &root, true).unwrap().unwrap();
        let preload = command
            .get_envs()
            .find(|(k, _)| *k == "LD_PRELOAD")
            .unwrap()
            .1
            .unwrap()
            .to_string_lossy();
        assert!(
            preload.starts_with(&helper.path) && preload.ends_with("/existing/a.so:/existing/b.so")
        );
        assert_eq!(std::env::var_os("LD_PRELOAD"), before);
        let mut other = Command::new("true");
        assert!(apply(&mut other, &env, &root, false).unwrap().is_none());
        assert!(other.get_envs().next().is_none());
        assert_eq!(fs::metadata(&helper.path).unwrap().mode() & 0o777, 0o500);
        fs::set_permissions(&helper.path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&helper.path, b"tampered").unwrap();
        assert!(materialize(&root).is_err());
        assert_eq!(fs::read(&helper.path).unwrap(), b"tampered");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn provenance_refuses_reused_incarnation() {
        let target = crate::perf_capture::identity(std::process::id() as i32).unwrap();
        let helper = HelperIdentity {
            version: "test".into(),
            sha256: "test".into(),
            path: "test".into(),
            target: "test".into(),
            startup_coverage_incomplete: true,
            activation_basis: "test".into(),
        };
        register(target.clone(), "test-owner".into(), helper);
        assert!(provenance(&target).is_some());
        let stale = Target {
            birth: target.birth + 1,
            ..target
        };
        assert!(provenance(&stale).is_none());
    }
}
