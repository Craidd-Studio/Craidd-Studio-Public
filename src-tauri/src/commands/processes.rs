//! Read-only Linux target discovery and process-incarnation checks. Never owns or signals targets.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, os::unix::fs::MetadataExt, path::PathBuf};

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
    let adapter_hint = if unity_project.is_some() {
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
