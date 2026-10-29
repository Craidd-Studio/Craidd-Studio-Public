//! Scripted fake language server for the session tests.
//!
//! It re-executes this unit-test binary with a filter that runs only
//! `fake_lsp_server_entry`. libtest's own stdout goes to /dev/null and the
//! protocol stream is fd 3 (the session's stdout pipe), so the session
//! talks to a real process through the production spawn path.
//!
//! The script is a comma-separated list of flags in `CRAIDD_FAKE_LSP`.
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Write};
use std::os::fd::FromRawFd;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use super::framing::{encode, read_frame, FrameLimits};

pub(crate) fn command(script: &str) -> (PathBuf, Vec<String>, Vec<(String, String)>) {
    let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
    (PathBuf::from("/bin/sh"), vec![
        "-c".into(),
        "exec \"$0\" --exact lsp::fake_server::fake_lsp_server_entry --ignored --test-threads=1 --nocapture 3>&1 1>/dev/null".into(),
        exe,
    ], vec![("CRAIDD_FAKE_LSP".into(), script.into())])
}

struct Fake { out: File, flags: Vec<String>, docs: HashMap<String, String>, pulls: u64, saves: u64, stalled: bool, reloads: u64 }

/// Apply one LSP content change with UTF-16 positions, as a real server would.
fn apply(text: &mut String, change: &Value) {
    let Some(range) = change.get("range") else { *text = change["text"].as_str().unwrap().into(); return; };
    let offset = |position: &Value| {
        let (line, character) = (position["line"].as_u64().unwrap() as usize, position["character"].as_u64().unwrap() as usize);
        let start = text.split_inclusive('\n').take(line).map(str::len).sum::<usize>();
        let mut units = 0;
        let mut at = start;
        for c in text[start..].chars() {
            if units >= character || c == '\n' { break; }
            units += c.len_utf16();
            at += c.len_utf8();
        }
        at
    };
    let (from, to) = (offset(&range["start"]), offset(&range["end"]));
    text.replace_range(from..to, change["text"].as_str().unwrap());
}

impl Fake {
    fn has(&self, flag: &str) -> bool { self.flags.iter().any(|f| f == flag) }
    fn value(&self, key: &str) -> Option<&str> { self.flags.iter().find_map(|f| f.strip_prefix(&format!("{key}="))) }
    fn send(&mut self, message: Value) { let _ = self.out.write_all(&encode(&message.to_string())); let _ = self.out.flush(); }
    fn raw(&mut self, bytes: &[u8]) { let _ = self.out.write_all(bytes); let _ = self.out.flush(); }
    fn reply(&mut self, id: &Value, result: Value) { self.send(json!({"jsonrpc":"2.0","id":id,"result":result})); }
    fn log(&mut self, text: String) { self.send(json!({"jsonrpc":"2.0","method":"window/logMessage","params":{"type":3,"message":text}})); }

    fn capabilities(&self) -> Value {
        let mut caps = json!({
            "textDocumentSync": {"openClose": true, "change": 2, "save": {}},
            "completionProvider": {"triggerCharacters": [":", ".", "'"], "resolveProvider": true},
            "hoverProvider": true, "definitionProvider": true, "referencesProvider": true, "documentSymbolProvider": true,
        });
        if self.value("encoding").is_some() { caps["positionEncoding"] = json!(self.value("encoding")); }
        if self.has("pull") { caps["diagnosticProvider"] = json!({"identifier": "fake", "interFileDependencies": true, "workspaceDiagnostics": false}); }
        json!({"capabilities": caps, "serverInfo": {"name": "fake-lsp", "version": "0.0"}})
    }

    fn on_initialized(&mut self) {
        if self.has("stderr") { for n in 0..5 { eprintln!("fake stderr line {n}"); } }
        if self.has("watch_limit") {
            eprintln!("2026-10-29T10:00:00.000Z  WARN notify error: No path was found.");
            eprintln!("2026-10-29T10:00:01.000Z  WARN notify error: OS file watch limit reached.");
        }
        if self.has("child") {
            use std::os::unix::process::CommandExt;
            let mut sleeper = std::process::Command::new("sleep");
            sleeper.arg("300");
            // A descendant in its own session, like a detached helper process.
            unsafe { sleeper.pre_exec(|| { libc::setsid(); Ok(()) }); }
            let pid = sleeper.spawn().unwrap().id();
            self.log(format!("child {pid}"));
        }
        if self.has("asks") {
            self.send(json!({"jsonrpc":"2.0","id":1001,"method":"window/workDoneProgress/create","params":{"token":"t"}}));
            self.send(json!({"jsonrpc":"2.0","id":"c1","method":"workspace/configuration","params":{"items":[{"section":"rust-analyzer.cargo"},{"section":"missing"},{}]}}));
            self.send(json!({"jsonrpc":"2.0","id":1002,"method":"workspace/workspaceFolders"}));
            self.send(json!({"jsonrpc":"2.0","id":1003,"method":"client/registerCapability","params":{"registrations":[]}}));
            self.send(json!({"jsonrpc":"2.0","id":1004,"method":"window/showMessageRequest","params":{"type":2,"message":"pick one","actions":[{"title":"A"}]}}));
            self.send(json!({"jsonrpc":"2.0","id":1005,"method":"custom/unknown"}));
        }
        if let Some(count) = self.value("flood").and_then(|n| n.parse::<usize>().ok()) {
            for n in 0..count {
                self.send(json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics",
                    "params":{"uri": format!("file:///f{}.rs", n % 3), "diagnostics":[{"message": format!("d{n}")}]}}));
                let kind = match n % 4 { 0 => "begin", 3 => "end", _ => "report" };
                self.send(json!({"jsonrpc":"2.0","method":"$/progress","params":{"token": n / 4, "value":{"kind": kind, "title": "indexing"}}}));
                self.send(json!({"jsonrpc":"2.0","method":"window/logMessage","params":{"type":4,"message":format!("log {n}")}}));
            }
            // A clearing set last: it must survive coalescing.
            self.send(json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///f0.rs","diagnostics":[]}}));
            self.log("flood done".into());
        }
        if self.has("ask_stalled") {
            // F3: no type, no actions, a string id, while nobody consumes deliveries.
            self.send(json!({"jsonrpc":"2.0","id":"s-1","method":"window/showMessageRequest","params":{"message":"while stalled"}}));
        }
        if let Some(count) = self.value("refresh").and_then(|n| n.parse::<usize>().ok()) {
            for n in 0..count { self.send(json!({"jsonrpc":"2.0","id":format!("r{n}"),"method":"workspace/diagnostic/refresh"})); }
        }
        if self.has("loading") {
            // V24: the workspace is still loading; an early pull answers an empty full report.
            self.send(json!({"jsonrpc":"2.0","method":"experimental/serverStatus","params":{"health":"ok","quiescent":false}}));
        }
        if self.has("serverstatus") {
            self.send(json!({"jsonrpc":"2.0","method":"experimental/serverStatus","params":{"health":"warning","quiescent":false,"message":"Failed spawning proc-macro server"}}));
            self.send(json!({"jsonrpc":"2.0","method":"experimental/serverStatus","params":{"health":"panic"}}));
            self.send(json!({"jsonrpc":"2.0","method":"experimental/serverStatus","params":{"health":"error","quiescent":true,"message":"x".repeat(5000)}}));
            self.log("status sent".into());
        }
        if self.has("stall_reads") { loop { std::thread::sleep(Duration::from_secs(60)); } }
    }
}

#[test]
#[ignore]
fn fake_lsp_server_entry() {
    let Ok(script) = std::env::var("CRAIDD_FAKE_LSP") else { return; };
    let flags: Vec<String> = script.split(',').filter(|f| !f.is_empty()).map(String::from).collect();
    if flags.iter().any(|f| f == "ignore_term") { unsafe { libc::signal(libc::SIGTERM, libc::SIG_IGN); } }
    let mut fake = Fake { out: unsafe { File::from_raw_fd(3) }, flags, docs: HashMap::new(), pulls: 0, saves: 0, stalled: false, reloads: 0 };
    let mut input = BufReader::new(std::io::stdin());
    let mut replies = vec![];
    let limits = FrameLimits { max_body: 1 << 26, max_header_line: Some(8192) };
    while let Ok(Some(body)) = read_frame(&mut input, limits) {
        let message: Value = serde_json::from_slice(&body).unwrap();
        let id = message.get("id").cloned();
        let method = message.get("method").and_then(Value::as_str).map(String::from);
        match (method.as_deref(), id) {
            (Some("initialize"), Some(id)) => {
                if fake.has("silent_init") { continue; }
                if fake.has("early_ask") {
                    // Before the initialize reply, with no type and no actions, and a string id.
                    fake.send(json!({"jsonrpc":"2.0","id":"early","method":"window/showMessageRequest","params":{"message":"early"}}));
                }
                if fake.has("init_error") { fake.send(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"nope"}})); continue; }
                let caps = fake.capabilities();
                fake.reply(&id, caps);
            }
            (Some("initialized"), None) => fake.on_initialized(),
            (Some("shutdown"), Some(id)) => if !fake.has("ignore_shutdown") { fake.reply(&id, Value::Null); },
            (Some("exit"), None) => if !fake.has("ignore_exit") { std::process::exit(0); },
            (Some("test/echo"), Some(id)) => { let params = message["params"].clone(); fake.reply(&id, params); }
            (Some("test/quiesce_error"), _) => fake.send(json!({"jsonrpc":"2.0","method":"experimental/serverStatus","params":{"health":"error","quiescent":true,"message":"Failed to load workspaces."}})),
            (Some("test/quiesce"), _) => fake.send(json!({"jsonrpc":"2.0","method":"experimental/serverStatus","params":{"health":"ok","quiescent":true}})),
            (Some("rust-analyzer/reloadWorkspace"), Some(id)) => {
                fake.reloads += 1;
                let n = fake.reloads;
                fake.log(format!("reload {n}"));
                std::thread::sleep(Duration::from_millis(300));
                fake.reply(&id, Value::Null);
            }
            (Some("textDocument/didOpen"), None) => {
                let doc = &message["params"]["textDocument"];
                fake.docs.insert(doc["uri"].as_str().unwrap().into(), doc["text"].as_str().unwrap().into());
                if let Some(ms) = fake.value("stall_after_open").and_then(|n| n.parse::<u64>().ok()).filter(|_| !fake.stalled) {
                    fake.stalled = true;
                    std::thread::sleep(Duration::from_millis(ms));
                }
            }
            (Some("textDocument/didChange"), None) => {
                let uri = message["params"]["textDocument"]["uri"].as_str().unwrap().to_string();
                let text = fake.docs.get_mut(&uri).expect("didChange for an unopened document");
                for change in message["params"]["contentChanges"].as_array().unwrap() { apply(text, change); }
                if fake.has("push_stale") {
                    let version = message["params"]["textDocument"]["version"].as_i64().unwrap() - 1;
                    fake.send(json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":uri,"version":version,"diagnostics":[{"message":"stale"}]}}));
                    fake.log("pushed stale".into());
                }
            }
            (Some("textDocument/didClose"), None) => { fake.docs.remove(message["params"]["textDocument"]["uri"].as_str().unwrap()); }
            (Some("textDocument/didSave"), None) => fake.saves += 1,
            (Some("test/text"), Some(id)) => {
                let text = fake.docs.get(message["params"]["uri"].as_str().unwrap()).cloned();
                let (saves, pulls) = (fake.saves, fake.pulls);
                fake.reply(&id, json!({"text": text, "saves": saves, "pulls": pulls}));
            }
            (Some("textDocument/diagnostic"), Some(id)) => {
                fake.pulls += 1;
                if fake.has("retrigger") {
                    fake.send(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32802,"message":"not ready","data":{"retriggerRequest":true}}}));
                    continue;
                }
                let params = &message["params"];
                assert_eq!(params["identifier"], "fake", "the identifier is echoed");
                let text = fake.docs.get(params["textDocument"]["uri"].as_str().unwrap()).cloned().unwrap_or_default();
                let result_id = format!("len{}", text.len());
                if params.get("previousResultId").and_then(Value::as_str) == Some(result_id.as_str()) {
                    fake.reply(&id, json!({"kind": "unchanged", "resultId": result_id}));
                } else {
                    let items: Vec<Value> = text.lines().filter(|l| l.contains("bad")).map(|l| json!({"message": l, "range": {"start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1}}})).collect();
                    fake.reply(&id, json!({"kind": "full", "resultId": result_id, "items": items}));
                }
            }
            (Some("test/late"), Some(id)) => { std::thread::sleep(Duration::from_millis(300)); fake.reply(&id, json!("late")); }
            (Some("test/never"), Some(_)) => {}
            (Some("test/crash"), _) => std::process::exit(3),
            (Some("test/segv"), _) => unsafe {
                // Rust's runtime handles SIGSEGV itself; restore the default and skip the core dump.
                let none = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
                libc::setrlimit(libc::RLIMIT_CORE, &none);
                libc::signal(libc::SIGSEGV, libc::SIG_DFL);
                libc::raise(libc::SIGSEGV);
            },
            (Some("test/bad_framing"), _) => fake.raw(b"Content-Length: nope\r\n\r\n"),
            (Some("test/bad_body"), _) => fake.raw(&encode("not json")),
            (Some("test/panic_body"), _) => fake.raw(&encode(r#"{"jsonrpc":"2.0","id":"x","result":1}"#)),
            (None, Some(_)) => {
                fake.log(format!("reply {message}"));
                replies.push(message.clone());
                if replies.len() == 6 { fake.log(format!("replies {}", Value::Array(replies.clone()))); }
            }
            _ => {}
        }
    }
    std::process::exit(0);
}
