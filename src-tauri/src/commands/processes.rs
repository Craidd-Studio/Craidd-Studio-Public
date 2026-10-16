//! Read-only Linux target discovery and process-incarnation checks. Never owns or signals targets.
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashSet},
    fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessIdentity {
    pub pid: i32,
    pub birth: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    #[serde(flatten)]
    pub identity: ProcessIdentity,
    pub name: String,
    pub executable: String,
    pub cwd: String,
    pub uid: u32,
    pub adapter_hint: String,
    pub unity_project: Option<String>,
    /// Verified Unity Editor managed-debugger port, when it is listening.
    pub unity_managed_port: Option<u16>,
}

/// A Unity Editor's Mono soft-debugger agent, verified for one PID incarnation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnityManagedEndpoint {
    pub port: u16,
    pub project: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessCounters {
    pub cpu_ms: f64,
    pub resident_bytes: u64,
    pub virtual_bytes: u64,
    pub thread_count: u64,
    pub state: String,
}

#[derive(Debug)]
struct Stat {
    birth: u64,
    cpu_ticks: u64,
    resident_pages: u64,
    virtual_bytes: u64,
    threads: u64,
    state: String,
}

fn parse_stat(text: &str) -> Result<Stat, String> {
    // comm may contain spaces and closing parentheses. Fields begin after the LAST ')'.
    let (_, tail) = text.rsplit_once(')').ok_or("Invalid process stat")?;
    let f: Vec<_> = tail.split_whitespace().collect();
    let number = |n: usize| {
        f.get(n)
            .ok_or("Truncated process stat")?
            .parse::<u64>()
            .map_err(|_| "Invalid process counter")
    };
    Ok(Stat {
        birth: number(19)?,
        cpu_ticks: number(11)?.saturating_add(number(12)?),
        resident_pages: number(21).unwrap_or(0),
        virtual_bytes: number(20)?,
        threads: number(17)?,
        state: f.first().ok_or("Missing process state")?.to_string(),
    })
}

pub fn identity(pid: i32) -> Result<ProcessIdentity, String> {
    if pid <= 1 {
        return Err("Select a user process with PID greater than 1".into());
    }
    let stat = parse_stat(
        &fs::read_to_string(format!("/proc/{pid}/stat"))
            .map_err(|e| format!("Cannot read process {pid}: {e}"))?,
    )?;
    Ok(ProcessIdentity {
        pid,
        birth: stat.birth,
    })
}

pub fn verify(target: &ProcessIdentity) -> Result<(), String> {
    if identity(target.pid)? != *target {
        return Err("Target exited or its PID was reused; select the process again".into());
    }
    Ok(())
}

fn link(pid: i32, name: &str) -> String {
    fs::read_link(format!("/proc/{pid}/{name}"))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

// A running Editor is matched through its executable, project argument and
// the project's own Unity version declaration, never through C# extensions.
pub fn unity_project(pid: i32) -> Option<String> {
    let executable = PathBuf::from(link(pid, "exe"));
    let args = fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let args: Vec<_> = args
        .split(|b| *b == 0)
        .map(|v| String::from_utf8_lossy(v).into_owned())
        .collect();
    declared_unity_project(&executable, &args, PathBuf::from(link(pid, "cwd")))
}
fn declared_unity_project(
    executable: &std::path::Path,
    args: &[String],
    cwd: PathBuf,
) -> Option<String> {
    // Hub may rename the actual executable. Match its installed Unity entry
    // point by identity, rather than assuming /proc/<pid>/exe ends in Unity.
    // Canonical paths still differ for Hub's hard-linked executable names.
    let entry = fs::metadata(executable.parent()?.join("Unity")).ok()?;
    let binary = fs::metadata(executable).ok()?;
    if (entry.dev(), entry.ino()) != (binary.dev(), binary.ino()) {
        return None;
    }
    // Import helpers run the same binary in the same project as the Editor.
    // Their explicit role must not create ambiguous Editor matches.
    if args
        .windows(2)
        .any(|a| a[0].eq_ignore_ascii_case("-name") && a[1].starts_with("AssetImportWorker"))
    {
        return None;
    }
    let root = args
        .windows(2)
        .find(|a| a[0].eq_ignore_ascii_case("-projectPath"))
        .map(|a| PathBuf::from(&a[1]))
        .unwrap_or(cwd);
    let root = fs::canonicalize(root).ok()?;
    let version = fs::read_to_string(root.join("ProjectSettings/ProjectVersion.txt")).ok()?;
    version
        .lines()
        .any(|s| s.starts_with("m_EditorVersion:"))
        .then(|| root.to_string_lossy().into_owned())
}

/// TCP LISTEN ports whose sockets this PID holds. Read from /proc only:
/// no connection is made and no other process's sockets are reported.
pub fn listening_ports(pid: i32) -> Vec<u16> {
    let inodes: HashSet<String> = fs::read_dir(format!("/proc/{pid}/fd"))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|fd| fs::read_link(fd.path()).ok())
                .filter_map(|target| {
                    let target = target.to_string_lossy().into_owned();
                    Some(target.strip_prefix("socket:[")?.strip_suffix(']')?.to_owned())
                })
                .collect()
        })
        .unwrap_or_default();
    let mut ports: Vec<u16> = ["tcp", "tcp6"]
        .iter()
        .filter_map(|table| fs::read_to_string(format!("/proc/{pid}/net/{table}")).ok())
        .flat_map(|text| parse_listen_ports(&text, &inodes))
        .collect();
    ports.sort_unstable();
    ports.dedup();
    ports
}

fn parse_listen_ports(table: &str, inodes: &HashSet<String>) -> Vec<u16> {
    table
        .lines()
        .skip(1)
        .filter_map(|row| {
            let cols: Vec<_> = row.split_whitespace().collect();
            // 0A is TCP_LISTEN; column 9 is the socket inode.
            if cols.get(3) != Some(&"0A") || !inodes.contains(*cols.get(9)?) {
                return None;
            }
            u16::from_str_radix(cols.get(1)?.rsplit_once(':')?.1, 16).ok()
        })
        .collect()
}

// Unity's Editor agent listens on 127.0.0.1:56000 + PID % 1000. The project's
// Library/EditorInstance.json, written by that Editor, must name the same PID.
fn editor_debug_port(pid: i32) -> u16 {
    56000 + (pid % 1000) as u16
}

fn editor_instance_pid(text: &str) -> Option<i32> {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()?
        .get("process_id")?
        .as_i64()
        .and_then(|pid| i32::try_from(pid).ok())
}

fn select_editor_endpoint(
    pid: i32,
    project: &str,
    instance: Option<&str>,
    listening: &[u16],
) -> Result<UnityManagedEndpoint, String> {
    let declared = instance.and_then(editor_instance_pid).ok_or_else(|| {
        format!("{project}/Library/EditorInstance.json is missing or unreadable; open the project in this Unity Editor")
    })?;
    if declared != pid {
        return Err(format!(
            "Library/EditorInstance.json names Unity PID {declared}, not {pid}; refusing an ambiguous managed endpoint"
        ));
    }
    let port = editor_debug_port(pid);
    if !listening.contains(&port) {
        return Err(format!(
            "Unity Editor PID {pid} is not listening for a managed debugger on port {port}. Enable Code Optimization: Debug (and Editor Attaching) in Unity"
        ));
    }
    Ok(UnityManagedEndpoint {
        port,
        project: project.into(),
    })
}

/// Verified Editor endpoint for a selected incarnation. The port must be held
/// by that PID, so a colliding or foreign listener is never chosen.
pub fn unity_editor_endpoint(target: &ProcessIdentity) -> Result<UnityManagedEndpoint, String> {
    verify(target)?;
    let project = unity_project(target.pid).ok_or("Select the Unity Editor process for this project")?;
    let instance = fs::read_to_string(Path::new(&project).join("Library/EditorInstance.json")).ok();
    let endpoint = select_editor_endpoint(
        target.pid,
        &project,
        instance.as_deref(),
        &listening_ports(target.pid),
    )?;
    verify(target)?;
    Ok(endpoint)
}

pub fn info(pid: i32) -> Result<ProcessInfo, String> {
    let target = identity(pid)?;
    let status = fs::read_to_string(format!("/proc/{pid}/status")).map_err(|e| e.to_string())?;
    let uid = status
        .lines()
        .find_map(|s| {
            s.strip_prefix("Uid:")
                .and_then(|s| s.split_whitespace().next())
                .and_then(|s| s.parse().ok())
        })
        .ok_or("Process UID unavailable")?;
    let maps = fs::read_to_string(format!("/proc/{pid}/maps")).unwrap_or_default();
    let unity_project = unity_project(pid);
    let unity_managed_port = unity_project
        .as_ref()
        .and_then(|_| unity_editor_endpoint(&target).ok())
        .map(|endpoint| endpoint.port);
    let adapter_hint = if unity_managed_port.is_some() {
        "Unity Editor · C# (DotRush Mono) / native C++ / profiling"
    } else if unity_project.is_some() {
        "Unity Editor · native C++ / profiling"
    } else if maps.contains("libcoreclr.so") {
        "netcoredbg · CoreCLR"
    } else if maps.contains("libmono") {
        "Mono/Unity · native LLDB; managed unqualified"
    } else {
        "LLDB-DAP · native candidate"
    };
    let result = ProcessInfo {
        identity: target.clone(),
        uid,
        name: if unity_project.is_some() {
            "Unity Editor".into()
        } else {
            fs::read_to_string(format!("/proc/{pid}/comm"))
                .unwrap_or_default()
                .trim()
                .to_owned()
        },
        executable: link(pid, "exe"),
        cwd: link(pid, "cwd"),
        adapter_hint: adapter_hint.into(),
        unity_project,
        unity_managed_port,
    };
    verify(&target)?;
    Ok(result)
}

#[tauri::command]
pub fn list_attach_processes() -> Result<Vec<ProcessInfo>, String> {
    let uid = unsafe { libc::geteuid() };
    let mut entries: Vec<_> = fs::read_dir("/proc")
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|p| p.file_name().to_str()?.parse::<i32>().ok())
        .filter(|pid| *pid != std::process::id() as i32)
        .filter_map(|pid| info(pid).ok())
        .filter(|p| p.uid == uid && !p.executable.is_empty())
        .collect();
    entries.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.identity.pid.cmp(&b.identity.pid))
    });
    Ok(entries)
}

pub fn counters(target: &ProcessIdentity) -> Result<ProcessCounters, String> {
    let stat = parse_stat(
        &fs::read_to_string(format!("/proc/{}/stat", target.pid)).map_err(|e| e.to_string())?,
    )?;
    if matches!(stat.state.as_str(), "Z" | "X") {
        return Err("Target process has exited".into());
    }
    if stat.birth != target.birth {
        return Err("Target process incarnation changed".into());
    }
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    let pages = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if ticks <= 0 || pages <= 0 {
        return Err("Linux counter units unavailable".into());
    }
    Ok(ProcessCounters {
        cpu_ms: stat.cpu_ticks as f64 * 1000.0 / ticks as f64,
        resident_bytes: stat.resident_pages.saturating_mul(pages as u64),
        virtual_bytes: stat.virtual_bytes,
        thread_count: stat.threads,
        state: stat.state,
    })
}

#[tauri::command]
pub fn process_modules(target: ProcessIdentity) -> Result<Vec<String>, String> {
    verify(&target)?;
    let maps =
        fs::read_to_string(format!("/proc/{}/maps", target.pid)).map_err(|e| e.to_string())?;
    let result = maps
        .lines()
        .filter_map(|line| {
            let p = line
                .split_whitespace()
                .skip(5)
                .collect::<Vec<_>>()
                .join(" ");
            p.starts_with('/').then_some(p)
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    verify(&target)?;
    Ok(result)
}

#[tauri::command]
pub fn attach_adapter_choices() -> Vec<serde_json::Value> {
    [
        ("lldb", "LLDB-DAP · native", "cpp"),
        ("coreclr", "netcoredbg · CoreCLR", "csharp"),
    ]
    .iter()
    .map(|(id, name, lang)| {
        serde_json::json!({"id":id,"name":name,
            "available":super::debug::adapter_available_for_language(lang)})
    })
    .chain(std::iter::once(serde_json::json!({"id":"unity-mono",
        "name":"Unity C# · DotRush Mono (Editor)",
        "available":super::debug::unity_mono_adapter_available()})))
    .collect()
}

pub fn executable(target: &ProcessIdentity) -> Result<PathBuf, String> {
    verify(target)?;
    fs::read_link(format!("/proc/{}/exe", target.pid))
        .map_err(|e| format!("Target executable unavailable: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stat_handles_names_with_parentheses() {
        let text =
            "432 (worker (odd) name)) S 1 2 3 4 5 6 7 8 9 10 12 8 13 14 15 16 4 18 12345 4096 3";
        let s = parse_stat(text).unwrap();
        assert_eq!(s.birth, 12345);
        assert_eq!(s.cpu_ticks, 20);
        assert_eq!(s.resident_pages, 3);
        assert_eq!(s.threads, 4);
    }
    #[test]
    fn unity_project_accepts_hub_renamed_binary_and_requires_project_declaration() {
        let dir = std::env::temp_dir().join(format!(
            "craidd-unity-detect-{}",
            super::super::profiling::stamp()
        ));
        fs::create_dir_all(dir.join("Editor")).unwrap();
        fs::create_dir_all(dir.join("Project/ProjectSettings")).unwrap();
        let executable = dir.join("Editor/unityhub-unity-editor-6000.5.10f1");
        fs::write(&executable, b"fixture").unwrap();
        std::os::unix::fs::symlink(&executable, dir.join("Editor/Unity")).unwrap();
        let root = dir.join("Project");
        let args = vec![
            "Unity".into(),
            "-projectPath".into(),
            root.to_string_lossy().into_owned(),
        ];
        assert!(declared_unity_project(&executable, &args, dir.clone()).is_none());
        fs::write(
            root.join("ProjectSettings/ProjectVersion.txt"),
            "m_EditorVersion: 6000.5.10f1\n",
        )
        .unwrap();
        assert_eq!(
            declared_unity_project(&executable, &args, dir.clone()),
            Some(root.to_string_lossy().into_owned())
        );
        let other = dir.join("Editor/other");
        fs::write(&other, b"fixture").unwrap();
        assert!(declared_unity_project(&other, &args, dir.clone()).is_none());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn unity_project_accepts_hub_hardlinks_but_excludes_import_workers() {
        let dir = std::env::temp_dir().join(format!(
            "craidd-unity-hardlink-{}",
            super::super::profiling::stamp()
        ));
        fs::create_dir_all(dir.join("Editor")).unwrap();
        fs::create_dir_all(dir.join("Project/ProjectSettings")).unwrap();
        let executable = dir.join("Editor/unityhub-unity-editor-6000.5.10f1");
        fs::write(&executable, b"fixture").unwrap();
        fs::hard_link(&executable, dir.join("Editor/Unity")).unwrap();
        let root = dir.join("Project");
        fs::write(
            root.join("ProjectSettings/ProjectVersion.txt"),
            "m_EditorVersion: 6000.5.10f1\n",
        )
        .unwrap();
        let mut args = vec![
            "Unity".into(),
            "-projectpath".into(),
            root.to_string_lossy().into_owned(),
        ];
        let expected = Some(root.to_string_lossy().into_owned());
        assert_eq!(
            declared_unity_project(&executable, &args, dir.clone()),
            expected
        );
        // Batch-mode Editor tests are valid targets; only the declared worker
        // role is excluded from Editor auto-selection and Play rearming.
        args.push("-batchMode".into());
        assert_eq!(
            declared_unity_project(&executable, &args, dir.clone()),
            expected
        );
        args.extend(["-name".into(), "AssetImportWorkerHW1".into()]);
        assert!(declared_unity_project(&executable, &args, dir.clone()).is_none());
        args.pop();
        args.push("AssetImportWorkerHW2".into());
        assert!(declared_unity_project(&executable, &args, dir.clone()).is_none());
        let other = dir.join("Editor/other");
        fs::write(&other, b"fixture").unwrap();
        assert!(declared_unity_project(&other, &args[..3], dir.clone()).is_none());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    #[ignore = "requires CRAIDD_TEST_UNITY_EDITOR_PID, CRAIDD_TEST_UNITY_PROJECT and CRAIDD_TEST_UNITY_WORKER_PIDS for a running Editor"]
    fn running_unity_editor_discovery() {
        let pid = std::env::var("CRAIDD_TEST_UNITY_EDITOR_PID")
            .unwrap()
            .parse()
            .unwrap();
        let project = fs::canonicalize(std::env::var("CRAIDD_TEST_UNITY_PROJECT").unwrap())
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let editor = info(pid).unwrap();
        assert_eq!(editor.unity_project.as_deref(), Some(project.as_str()));
        assert_eq!(editor.name, "Unity Editor");
        let targets = list_attach_processes().unwrap();
        assert!(targets
            .iter()
            .any(|p| p.identity == editor.identity && p.unity_project == editor.unity_project));
        for worker in std::env::var("CRAIDD_TEST_UNITY_WORKER_PIDS")
            .unwrap()
            .split(',')
        {
            assert!(info(worker.parse().unwrap())
                .unwrap()
                .unity_project
                .is_none());
        }
    }
    #[test]
    fn listen_ports_require_this_processes_socket_inode() {
        let table = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:DDD7 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1 0 100 0 0 10 0
   1: 0100007F:DDD8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 222 1 0 100 0 0 10 0
   2: 0100007F:DDD9 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 333 1 0 100 0 0 10 0";
        let ours: HashSet<String> = ["111".into(), "333".into()].into();
        // 222 belongs to another process; 333 is connected, not listening.
        assert_eq!(parse_listen_ports(table, &ours), vec![0xDDD7]);
    }
    #[test]
    fn editor_endpoint_requires_matching_instance_and_owned_port() {
        let instance = r#"{ "process_id" : 317471, "version" : "6000.5.10f1" }"#;
        assert_eq!(
            select_editor_endpoint(317471, "/p", Some(instance), &[34999, 56471]),
            Ok(UnityManagedEndpoint {
                port: 56471,
                project: "/p".into()
            })
        );
        assert!(select_editor_endpoint(317471, "/p", None, &[56471]).is_err());
        assert!(select_editor_endpoint(317471, "/p", Some("not json"), &[56471]).is_err());
        // Another Editor wrote the project file: never fall back to a guess.
        let other = r#"{"process_id":168668}"#;
        assert!(select_editor_endpoint(317471, "/p", Some(other), &[56471])
            .unwrap_err()
            .contains("168668"));
        // The formula's port held by some other process is not ours.
        assert!(select_editor_endpoint(317471, "/p", Some(instance), &[56668]).is_err());
    }
    #[test]
    #[ignore = "requires CRAIDD_TEST_UNITY_EDITOR_PID for a running Editor with Debug code optimization"]
    fn running_unity_editor_managed_endpoint() {
        let pid = std::env::var("CRAIDD_TEST_UNITY_EDITOR_PID")
            .unwrap()
            .parse()
            .unwrap();
        let endpoint = unity_editor_endpoint(&identity(pid).unwrap()).unwrap();
        assert_eq!(endpoint.port, editor_debug_port(pid));
        assert_eq!(info(pid).unwrap().unity_managed_port, Some(endpoint.port));
    }
    #[test]
    fn real_process_identity_and_counters() {
        let target = identity(std::process::id() as i32).unwrap();
        verify(&target).unwrap();
        assert!(counters(&target).unwrap().resident_bytes > 0);
        assert!(verify(&ProcessIdentity {
            birth: target.birth + 1,
            ..target
        })
        .is_err());
    }
}
