//! Scripted fake language server for the session tests.
//!
//! It re-executes this unit-test binary with a filter that runs only
//! `fake_lsp_server_entry`. libtest's own stdout goes to /dev/null and the
//! protocol stream is fd 3 (the session's stdout pipe), so the session
//! talks to a real process through the production spawn path.
//!
//! The script is a comma-separated list of flags in `CRAIDD_FAKE_LSP`.
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

struct Fake { out: File, flags: Vec<String> }

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
        json!({"capabilities": caps, "serverInfo": {"name": "fake-lsp", "version": "0.0"}})
    }

    fn on_initialized(&mut self) {
        if self.has("stderr") { for n in 0..5 { eprintln!("fake stderr line {n}"); } }
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
        if self.has("stall_reads") { loop { std::thread::sleep(Duration::from_secs(60)); } }
    }
}

#[test]
#[ignore]
fn fake_lsp_server_entry() {
    let Ok(script) = std::env::var("CRAIDD_FAKE_LSP") else { return; };
    let flags: Vec<String> = script.split(',').filter(|f| !f.is_empty()).map(String::from).collect();
    if flags.iter().any(|f| f == "ignore_term") { unsafe { libc::signal(libc::SIGTERM, libc::SIG_IGN); } }
    let mut fake = Fake { out: unsafe { File::from_raw_fd(3) }, flags };
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
                if fake.has("init_error") { fake.send(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"nope"}})); continue; }
                let caps = fake.capabilities();
                fake.reply(&id, caps);
            }
            (Some("initialized"), None) => fake.on_initialized(),
            (Some("shutdown"), Some(id)) => if !fake.has("ignore_shutdown") { fake.reply(&id, Value::Null); },
            (Some("exit"), None) => if !fake.has("ignore_exit") { std::process::exit(0); },
            (Some("test/echo"), Some(id)) => { let params = message["params"].clone(); fake.reply(&id, params); }
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
                replies.push(message.clone());
                if replies.len() == 6 { fake.log(format!("replies {}", Value::Array(replies.clone()))); }
            }
            _ => {}
        }
    }
    std::process::exit(0);
}
