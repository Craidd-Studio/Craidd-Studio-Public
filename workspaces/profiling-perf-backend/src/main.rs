//! No-UI harness: the production parser and capture manager, without a Tauri event loop.
#[allow(dead_code)]
#[path = "../../../src-tauri/src/perf_capture.rs"]
mod perf_capture;
#[allow(dead_code)]
#[path = "../../../src-tauri/src/perf_model.rs"]
mod perf_model;
#[allow(dead_code)]
#[path = "../../../src-tauri/src/perf_symbols.rs"]
mod perf_symbols;
mod process_supervisor {
    pub fn spawn(c: &mut std::process::Command) -> std::io::Result<std::process::Child> {
        c.spawn()
    }
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("serve") => serve(&args[2]),
        Some("discover") => println!("{}", perf_capture::discover()),
        Some("exercise") => exercise(&args[2], &args[3], &args[4], &args[5]),
        Some("reconcile") => {
            let leaves = perf_model::parse_script(std::io::BufReader::new(
                std::fs::File::open(&args[2]).unwrap(),
            ))
            .unwrap();
            let chains = perf_model::parse_chains(std::io::BufReader::new(
                std::fs::File::open(&args[3]).unwrap(),
            ))
            .unwrap();
            let leaf_count = leaves.samples.len();
            let leaf_weight: u64 = leaves.samples.iter().map(|s| s.period).sum();
            let set = perf_model::reconcile(leaves, chains).unwrap();
            println!(
                "{}",
                serde_json::json!({"summary":set.summary(),"leafCount":leaf_count,"leafWeight":leaf_weight,"selfCount":set.samples.len(),"selfWeight":set.samples.iter().map(|s|s.period).sum::<u64>(),"literalIpCount":set.samples.iter().filter(|s|!s.leaf_ip.is_empty()).count()})
            );
        }
        Some("parse") => {
            let set = perf_model::parse_script(std::io::BufReader::new(
                std::fs::File::open(&args[2]).unwrap(),
            ))
            .unwrap();
            let q = perf_model::TreeQuery {
                direction: perf_model::Direction::BottomUp,
                path: vec![],
                limit: 20,
                tid: None,
                thread_name: None,
                module: None,
                start_ns: None,
                end_ns: None,
            };
            println!(
                "{}",
                serde_json::json!({"summary":set.summary(),"bottomUp":set.branch(&q).unwrap()})
            );
        }
        Some("capture") => {
            let pid = args[2].parse().unwrap();
            let target = perf_capture::identity(pid).unwrap();
            let options = perf_model::Options {
                frequency: args[4].parse().unwrap(),
                duration_seconds: args[5].parse().unwrap(),
                unwind: match args[6].as_str() {
                    "fp" => perf_model::Unwind::Fp,
                    "8192" => perf_model::Unwind::Dwarf { stack_bytes: 8192 },
                    "16384" => perf_model::Unwind::Dwarf { stack_bytes: 16384 },
                    _ => panic!("unwind: fp | 8192 | 16384"),
                },
            };
            let root = std::path::PathBuf::from(&args[3]);
            let solution = root.join("fixture.cln");
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(&solution, "[solution]\nname = 'perf-backend-fixture'\n").unwrap();
            let manager = perf_capture::PerfManager::new(root.join("cache"));
            let id = manager
                .start("harness", &solution, "profile-fixture", target, options)
                .unwrap();
            loop {
                let status = manager.status("harness", &solution, &id).unwrap();
                if ["complete", "partial", "failed"].contains(&status.state.as_str()) {
                    let q = perf_model::TreeQuery {
                        direction: perf_model::Direction::BottomUp,
                        path: vec![],
                        limit: 20,
                        tid: None,
                        thread_name: None,
                        module: None,
                        start_ns: None,
                        end_ns: None,
                    };
                    println!(
                        "{}",
                        serde_json::json!({"capture":status,"bottomUp":manager.tree("harness",&solution,&id,&q).ok()})
                    );
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
        _ => panic!("Usage: parse SCRIPT | capture PID OUTPUT_DIR HZ SECONDS fp|8192|16384"),
    }
}

fn serve(root: &str) {
    use std::{
        io::{BufRead, Write},
        path::PathBuf,
    };
    let root = PathBuf::from(root);
    std::fs::create_dir_all(&root).unwrap();
    let solution = root.join("fixture.cln");
    if !solution.exists() {
        std::fs::write(&solution, "[solution]\nname='backend-probe'\n").unwrap();
    }
    let manager = perf_capture::PerfManager::new(root.join("cache"));
    for line in std::io::stdin().lock().lines() {
        let request: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
        if request["action"] == "quit" {
            break;
        }
        let result = (|| -> Result<serde_json::Value, String> {
            let id = request["id"].as_str().unwrap_or_default();
            match request["action"].as_str().unwrap_or_default() {
                "symbolSettings" => {
                    perf_symbols::locations(&solution).map(|paths| serde_json::json!(paths))
                }
                "saveSymbolSettings" => perf_symbols::save_locations(
                    &solution,
                    serde_json::from_value(request["paths"].clone()).map_err(|e| e.to_string())?,
                    serde_json::from_value(request["expected"].clone())
                        .map_err(|e| e.to_string())?,
                )
                .map(|paths| serde_json::json!(paths)),
                "start" => {
                    let target = perf_capture::identity(
                        request["pid"].as_i64().ok_or("Missing PID")? as i32,
                    )?;
                    let options = serde_json::from_value(request["options"].clone())
                        .map_err(|e| e.to_string())?;
                    manager
                        .start("probe", &solution, "probe-profile", target, options)
                        .map(|id| serde_json::json!({"id":id}))
                }
                "status" => serde_json::to_value(manager.status("probe", &solution, id)?)
                    .map_err(|e| e.to_string()),
                "stop" => manager
                    .stop("probe", &solution, id)
                    .map(|_| serde_json::Value::Null),
                "reopen" => manager
                    .reopen("probe", &solution, id)
                    .map(|_| serde_json::Value::Null),
                "tree" => {
                    let query = serde_json::from_value(request["query"].clone())
                        .map_err(|e| e.to_string())?;
                    manager.tree("probe", &solution, id, &query)
                }
                "source" => serde_json::to_value(manager.source(
                    "probe",
                    &solution,
                    id,
                    request["frameId"].as_u64().ok_or("Missing frameId")? as u32,
                )?)
                .map_err(|e| e.to_string()),
                "refuseDebugger" => {
                    let target = perf_capture::identity(
                        request["pid"].as_i64().ok_or("Missing PID")? as i32,
                    )?;
                    manager
                        .refuse_debugger(&target)
                        .map(|_| serde_json::Value::Null)
                }
                _ => Err("Unknown probe action".into()),
            }
        })();
        match result {
            Ok(value) => println!("{}", serde_json::json!({"ok":true,"value":value})),
            Err(error) => println!("{}", serde_json::json!({"ok":false,"error":error})),
        }
        std::io::stdout().flush().unwrap();
    }
}

fn exercise(fixture: &str, library: &str, solution: &str, output: &str) {
    use std::{
        io::{BufRead, Write},
        path::Path,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    fn wait(m: &perf_capture::PerfManager, solution: &Path, id: &str) -> perf_capture::Manifest {
        let start = Instant::now();
        loop {
            let status = m.status("harness", solution, id).unwrap();
            if ["complete", "partial", "failed"].contains(&status.state.as_str()) {
                return status;
            }
            assert!(
                start.elapsed() < Duration::from_secs(90),
                "capture did not finish"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    struct Fixture(std::process::Child);
    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Some(input) = self.0.stdin.as_mut() {
                let _ = input.write_all(b"stop\n");
            }
            let _ = self.0.wait();
        }
    }
    let output = Path::new(output);
    std::fs::create_dir_all(output).unwrap();
    let solution = Path::new(solution);
    if !solution.exists() {
        std::fs::write(solution, "[solution]\nname = 'backend-fixture'\n").unwrap();
    }
    let mut target = Fixture(
        Command::new(fixture)
            .args([library, "2"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let stdout = target.0.stdout.take().unwrap();
    let mut reader = std::io::BufReader::new(stdout);
    loop {
        let mut line = String::new();
        assert!(
            reader.read_line(&mut line).unwrap() > 0,
            "fixture exited before READY"
        );
        if line.trim() == "READY" {
            break;
        }
    }
    let _target_output = std::thread::spawn(move || {
        for line in reader.lines() {
            if line.is_err() {
                break;
            }
        }
    });
    std::thread::sleep(Duration::from_millis(100));
    let identity = perf_capture::identity(target.0.id() as i32).unwrap();
    let manager = perf_capture::PerfManager::new(output.join("cache"));
    let mut results = Vec::new();
    let q = perf_model::TreeQuery {
        direction: perf_model::Direction::BottomUp,
        path: vec![],
        limit: 200,
        tid: None,
        thread_name: None,
        module: None,
        start_ns: None,
        end_ns: None,
    };
    for unwind in [
        perf_model::Unwind::Fp,
        perf_model::Unwind::Dwarf { stack_bytes: 8192 },
        perf_model::Unwind::Dwarf { stack_bytes: 16384 },
    ] {
        let options = perf_model::Options {
            frequency: 99,
            duration_seconds: 2,
            unwind,
        };
        let prepared = manager.prepare(solution, &identity, &options).unwrap();
        let id = manager
            .start(
                "harness",
                solution,
                "fixture-profile",
                identity.clone(),
                options,
            )
            .unwrap();
        let capture = wait(&manager, solution, &id);
        let bottom = manager.tree("harness", solution, &id, &q).unwrap();
        let mut top = q.clone();
        top.direction = perf_model::Direction::TopDown;
        let top = manager.tree("harness", solution, &id, &top).unwrap();
        let mut navigation = Vec::new();
        for node in bottom["children"].as_array().unwrap() {
            if let Some(frame) = node["frameId"].as_u64() {
                if let Ok(source) = manager.source("harness", solution, &id, frame as u32) {
                    navigation.push(source);
                }
            }
        }
        let denied = manager.status("foreign-window", solution, &id).is_err();
        manager.pin(solution, &id, true).unwrap();
        let alive = target.0.try_wait().unwrap().is_none()
            && perf_capture::identity(identity.pid).unwrap() == identity;
        results.push(serde_json::json!({"case":"timed","prepared":prepared,"capture":capture,"bottomUp":bottom,"topDown":top,"sourceMappings":navigation,"foreignWindowRefused":denied,"targetSurvived":alive}));
    }
    for action in [
        "stop",
        "close",
        "collectorCrash",
        "shutdown",
        "positiveLoss",
        "targetExit",
    ] {
        let id = manager
            .start(
                "harness",
                solution,
                "fixture-profile",
                identity.clone(),
                perf_model::Options {
                    duration_seconds: if action == "positiveLoss" { 2 } else { 30 },
                    frequency: if action == "positiveLoss" { 999 } else { 99 },
                    unwind: if action == "positiveLoss" {
                        perf_model::Unwind::Dwarf { stack_bytes: 8192 }
                    } else {
                        perf_model::Unwind::Fp
                    },
                },
            )
            .unwrap();
        std::thread::sleep(Duration::from_millis(500));
        match action {
            "stop" => manager.stop("harness", solution, &id).unwrap(),
            "close" => manager.close("harness"),
            "shutdown" => manager.shutdown(),
            "collectorCrash" => {
                // The test injects a fault only into this capture's owned perf process.
                let collector = manager
                    .status("harness", solution, &id)
                    .unwrap()
                    .collector_identity
                    .unwrap();
                let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, collector.pid, 0) };
                assert!(fd >= 0);
                assert_eq!(perf_capture::identity(collector.pid).unwrap(), collector);
                assert_eq!(
                    unsafe {
                        libc::syscall(
                            libc::SYS_pidfd_send_signal,
                            fd,
                            libc::SIGKILL,
                            std::ptr::null::<libc::siginfo_t>(),
                            0,
                        )
                    },
                    0
                );
                unsafe {
                    libc::close(fd as i32);
                }
            }
            "positiveLoss" => {
                let collector = manager
                    .status("harness", solution, &id)
                    .unwrap()
                    .collector_identity
                    .unwrap();
                let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, collector.pid, 0) };
                assert!(fd >= 0);
                assert_eq!(perf_capture::identity(collector.pid).unwrap(), collector);
                assert_eq!(
                    unsafe {
                        libc::syscall(
                            libc::SYS_pidfd_send_signal,
                            fd,
                            libc::SIGSTOP,
                            std::ptr::null::<libc::siginfo_t>(),
                            0,
                        )
                    },
                    0
                );
                std::thread::sleep(Duration::from_millis(600));
                assert_eq!(
                    unsafe {
                        libc::syscall(
                            libc::SYS_pidfd_send_signal,
                            fd,
                            libc::SIGCONT,
                            std::ptr::null::<libc::siginfo_t>(),
                            0,
                        )
                    },
                    0
                );
                unsafe {
                    libc::close(fd as i32);
                }
            }
            "targetExit" => {
                target
                    .0
                    .stdin
                    .as_mut()
                    .unwrap()
                    .write_all(b"stop\n")
                    .unwrap();
                target.0.wait().unwrap();
            }
            _ => unreachable!(),
        }
        let capture = wait(&manager, solution, &id);
        let closed_reopened = if action == "close" {
            manager.reopen("replacement-window", solution, &id).unwrap();
            let began = Instant::now();
            loop {
                let state = manager.status("replacement-window", solution, &id).unwrap();
                if ["complete", "partial", "failed"].contains(&state.state.as_str()) {
                    break;
                }
                assert!(began.elapsed() < Duration::from_secs(30));
                std::thread::sleep(Duration::from_millis(20));
            }
            assert!(manager
                .tree("replacement-window", solution, &id, &q)
                .is_ok());
            true
        } else {
            false
        };
        let alive = target.0.try_wait().unwrap().is_none();
        results.push(serde_json::json!({"case":action,"capture":capture,"targetAliveAfterAction":alive,"closedReopenedInNewWindow":closed_reopened,"treeAvailable":manager.tree("harness",solution,&id,&q).is_ok()}));
    }
    let self_target = perf_capture::identity(std::process::id() as i32).unwrap();
    let late = manager
        .start(
            "harness",
            solution,
            "late-thread-fixture",
            self_target,
            perf_model::Options {
                duration_seconds: 1,
                ..Default::default()
            },
        )
        .unwrap();
    std::thread::sleep(Duration::from_millis(200));
    let late_worker = std::thread::Builder::new()
        .name("coverage-gained".into())
        .spawn(|| {
            let t = Instant::now();
            while t.elapsed() < Duration::from_millis(300) {
                std::hint::spin_loop();
            }
        })
        .unwrap();
    late_worker.join().unwrap();
    let late_capture = wait(&manager, solution, &late);
    assert!(late_capture
        .threads_gained
        .iter()
        .any(|t| t.name == "coverage-gained"));
    results.push(serde_json::json!({"case":"lateThreads","capture":late_capture}));
    // Independent manager proves reopening from raw data, not retained in-memory stacks.
    let reopen = perf_capture::PerfManager::new(output.join("cache"));
    let first = results[0]["capture"]["id"].as_str().unwrap();
    reopen.reopen("harness", solution, first).unwrap();
    let reopened = wait(&reopen, solution, first);
    let mut stale = identity;
    stale.birth += 1;
    let stale_rejected = manager
        .start(
            "harness",
            solution,
            "fixture-profile",
            stale,
            Default::default(),
        )
        .is_err();
    let report = serde_json::json!({"discovery":perf_capture::discover(),"cases":results,"reopened":reopened,"staleIdentityRefused":stale_rejected,"note":"No UI; collector faults injected only by this harness; fixture shutdown via stdin"});
    std::fs::write(
        output.join("results.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    println!("{}", output.join("results.json").display());
}
