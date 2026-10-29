//! JSON-RPC classification. The reader classifies every inbound body the
//! moment it is parsed; the class fixes its path (design: "Server-to-frontend
//! delivery and message classes").
use serde_json::Value;

pub(crate) const REQUEST_CANCELLED: i64 = -32800;
pub(crate) const CONTENT_MODIFIED: i64 = -32801;
pub(crate) const SERVER_CANCELLED: i64 = -32802;
pub(crate) const METHOD_NOT_FOUND: i64 = -32601;
pub(crate) const REQUEST_FAILED: i64 = -32803;

/// What an awaiting command receives. Never a hang.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Outcome {
    Result(Value),
    Error { code: i64, message: String },
    /// Cancelled, superseded, content modified, timed out or session ended.
    NoResult,
    /// `ServerCancelled` whose data asks the client to send the request
    /// again later (`retriggerRequest`, defined for diagnostic requests).
    /// No result now; the caller may re-arm, bounded.
    Retrigger,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LogSource { Log, Show, Stderr }

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub(crate) struct LogLine {
    pub source: LogSource,
    /// LSP `MessageType`: 1 error, 2 warning, 3 info, 4 log. Stderr is 4.
    pub severity: u8,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProgressKind { Begin, Report, End }

#[derive(Debug, PartialEq)]
pub(crate) enum Snapshot {
    Diagnostics { uri: String, version: Option<i64>, diagnostics: Vec<Value> },
    Progress { token: String, kind: ProgressKind, value: Value },
}

/// V2: does a server line report that file watching failed? Best-effort
/// text matching on what servers print, never on anything Craidd infers.
/// Verified against rust-analyzer 2026-09-06 at its default log level:
/// `WARN notify error: OS file watch limit reached.` Other `notify error`
/// lines (for example `No path was found.`) do not stop watching and do not match.
pub(crate) fn is_watcher_failure(line: &str) -> bool {
    let line = line.to_ascii_lowercase();
    line.contains("file watch limit") || line.contains("inotify watch limit") || line.contains("max_user_watches")
}

/// `experimental/serverStatus` (rust-analyzer), parsed by shape. Health is
/// separate from the session phase: a Ready session can report `error`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Health { pub health: String, pub quiescent: Option<bool>, pub message: Option<String> }

/// ◇ Longest server health message kept in the status record.
pub(crate) const HEALTH_MESSAGE_BYTES: usize = 2048;

#[derive(Debug, PartialEq)]
pub(crate) enum Inbound {
    /// Class R. `id` is `None` for an id we could never have issued.
    Response { id: Option<i64>, outcome: Outcome },
    /// Class Q. The id is echoed back verbatim (number or string).
    Request { id: Value, method: String, params: Value },
    /// Class S.
    Snapshot(Snapshot),
    /// Class L.
    Log(LogLine),
    /// Class T: the latest server health. `Err` is a malformed body, logged and ignored.
    Health(Result<Health, String>),
    /// A notification Stage 1 does not consume. Counted, never fatal.
    Ignored { method: String },
}

/// A body whose framing was intact but whose content is not a usable
/// JSON-RPC message. The stream is still aligned, so the session continues.
#[derive(Debug, PartialEq)]
pub(crate) struct BadBody(pub String);

pub(crate) fn classify(body: &[u8]) -> Result<Inbound, BadBody> {
    let message: Value = serde_json::from_slice(body).map_err(|e| BadBody(format!("invalid JSON: {e}")))?;
    let object = message.as_object().ok_or_else(|| BadBody("message is not an object".into()))?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err(BadBody("message is not JSON-RPC 2.0".into()));
    }
    let id = object.get("id").filter(|id| !id.is_null());
    match (object.get("method").and_then(Value::as_str), id) {
        (Some(method), Some(id)) => {
            if !(id.is_i64() || id.is_u64() || id.is_string()) { return Err(BadBody("request id is not a number or string".into())); }
            Ok(Inbound::Request { id: id.clone(), method: method.into(), params: object.get("params").cloned().unwrap_or(Value::Null) })
        }
        (Some(method), None) => notification(method, object.get("params").unwrap_or(&Value::Null)),
        (None, _) if object.contains_key("method") => Err(BadBody("method is not a string".into())),
        (None, id) => {
            let outcome = if let Some(error) = object.get("error") {
                let code = error.get("code").and_then(Value::as_i64).ok_or_else(|| BadBody("error has no integer code".into()))?;
                let retrigger = error.get("data").and_then(|d| d.get("retriggerRequest")) == Some(&Value::Bool(true));
                if code == SERVER_CANCELLED && retrigger { Outcome::Retrigger }
                else if matches!(code, REQUEST_CANCELLED | CONTENT_MODIFIED | SERVER_CANCELLED) { Outcome::NoResult }
                else { Outcome::Error { code, message: error.get("message").and_then(Value::as_str).unwrap_or("").into() } }
            } else if let Some(result) = object.get("result") {
                Outcome::Result(result.clone())
            } else {
                return Err(BadBody("response has neither result nor error".into()));
            };
            Ok(Inbound::Response { id: id.and_then(Value::as_i64), outcome })
        }
    }
}

fn notification(method: &str, params: &Value) -> Result<Inbound, BadBody> {
    match method {
        "textDocument/publishDiagnostics" => {
            let uri = params.get("uri").and_then(Value::as_str).ok_or_else(|| BadBody("diagnostics without uri".into()))?;
            let diagnostics = params.get("diagnostics").and_then(Value::as_array)
                .ok_or_else(|| BadBody("diagnostics without an array".into()))?;
            Ok(Inbound::Snapshot(Snapshot::Diagnostics {
                uri: uri.into(), version: params.get("version").and_then(Value::as_i64), diagnostics: diagnostics.clone(),
            }))
        }
        "$/progress" => {
            let token = match params.get("token") {
                Some(Value::String(token)) => format!("s:{token}"),
                Some(token) if token.is_i64() || token.is_u64() => format!("n:{token}"),
                _ => return Err(BadBody("progress without a token".into())),
            };
            let value = params.get("value").cloned().unwrap_or(Value::Null);
            let kind = match value.get("kind").and_then(Value::as_str) {
                Some("begin") => ProgressKind::Begin,
                Some("report") => ProgressKind::Report,
                Some("end") => ProgressKind::End,
                // Not work-done progress (for example partial results): not consumed.
                _ => return Ok(Inbound::Ignored { method: method.into() }),
            };
            Ok(Inbound::Snapshot(Snapshot::Progress { token, kind, value }))
        }
        "window/logMessage" | "window/showMessage" => Ok(Inbound::Log(LogLine {
            source: if method == "window/logMessage" { LogSource::Log } else { LogSource::Show },
            severity: params.get("type").and_then(Value::as_u64).filter(|t| (1..=4).contains(t)).unwrap_or(4) as u8,
            text: params.get("message").and_then(Value::as_str).unwrap_or("").into(),
        })),
        "experimental/serverStatus" => Ok(Inbound::Health(health(params))),
        _ => Ok(Inbound::Ignored { method: method.into() }),
    }
}

fn health(params: &Value) -> Result<Health, String> {
    let health = params.get("health").and_then(Value::as_str).ok_or_else(|| format!("serverStatus without health: {params}"))?;
    if !matches!(health, "ok" | "warning" | "error") { return Err(format!("serverStatus with unknown health {health:?}")); }
    let quiescent = match params.get("quiescent") { None => None, Some(Value::Bool(q)) => Some(*q), Some(other) => return Err(format!("serverStatus quiescent is not a boolean ({other})")) };
    let message = match params.get("message") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => {
            let mut end = text.len().min(HEALTH_MESSAGE_BYTES);
            while !text.is_char_boundary(end) { end -= 1; }
            Some(if end < text.len() { format!("{}…", &text[..end]) } else { text.clone() })
        }
        Some(other) => return Err(format!("serverStatus message is not a string ({other})")),
    };
    Ok(Health { health: health.into(), quiescent, message })
}

pub(crate) fn request(id: i64, method: &str, params: Value) -> String {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string()
}

pub(crate) fn notification_body(method: &str, params: Value) -> String {
    serde_json::json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

pub(crate) fn reply(id: &Value, result: Result<Value, (i64, String)>) -> String {
    match result {
        Ok(result) => serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    }.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn of(value: Value) -> Result<Inbound, BadBody> { classify(value.to_string().as_bytes()) }

    #[test]
    fn classifies_each_message_class() {
        assert_eq!(of(json!({"jsonrpc":"2.0","id":4,"result":{"a":1}})).unwrap(),
            Inbound::Response { id: Some(4), outcome: Outcome::Result(json!({"a":1})) });
        assert_eq!(of(json!({"jsonrpc":"2.0","id":4,"result":null})).unwrap(),
            Inbound::Response { id: Some(4), outcome: Outcome::Result(Value::Null) });
        assert_eq!(of(json!({"jsonrpc":"2.0","id":"x","result":1})).unwrap(),
            Inbound::Response { id: None, outcome: Outcome::Result(json!(1)) });
        for code in [REQUEST_CANCELLED, CONTENT_MODIFIED, SERVER_CANCELLED] {
            assert_eq!(of(json!({"jsonrpc":"2.0","id":1,"error":{"code":code,"message":"m"}})).unwrap(),
                Inbound::Response { id: Some(1), outcome: Outcome::NoResult });
        }
        assert!(matches!(of(json!({"jsonrpc":"2.0","id":"r1","method":"workspace/configuration","params":{}})).unwrap(),
            Inbound::Request { id: Value::String(_), .. }));
        assert_eq!(of(json!({"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"file:///a.rs","diagnostics":[]}})).unwrap(),
            Inbound::Snapshot(Snapshot::Diagnostics { uri: "file:///a.rs".into(), version: None, diagnostics: vec![] }));
        assert!(matches!(of(json!({"jsonrpc":"2.0","method":"$/progress","params":{"token":7,"value":{"kind":"end"}}})).unwrap(),
            Inbound::Snapshot(Snapshot::Progress { ref token, kind: ProgressKind::End, .. }) if token == "n:7"));
        assert!(matches!(of(json!({"jsonrpc":"2.0","method":"window/logMessage","params":{"type":1,"message":"x"}})).unwrap(),
            Inbound::Log(LogLine { severity: 1, source: LogSource::Log, .. })));
        assert!(matches!(of(json!({"jsonrpc":"2.0","method":"experimental/unknownThing","params":{}})).unwrap(), Inbound::Ignored { .. }));
        assert_eq!(of(json!({"jsonrpc":"2.0","id":2,"error":{"code":SERVER_CANCELLED,"message":"m","data":{"retriggerRequest":true}}})).unwrap(),
            Inbound::Response { id: Some(2), outcome: Outcome::Retrigger });
        assert_eq!(of(json!({"jsonrpc":"2.0","id":2,"error":{"code":SERVER_CANCELLED,"message":"m","data":{"retriggerRequest":false}}})).unwrap(),
            Inbound::Response { id: Some(2), outcome: Outcome::NoResult });
    }

    #[test]
    fn watcher_failures_are_recognised_by_text() {
        assert!(is_watcher_failure("2026-10-29T10:00:00Z  WARN notify error: OS file watch limit reached."));
        assert!(is_watcher_failure("WARN notify error: OS file watch limit reached."));
        assert!(is_watcher_failure("increase fs.inotify.max_user_watches"));
        assert!(!is_watcher_failure("WARN notify error: No path was found."));
        assert!(!is_watcher_failure("INFO did change watched files"));
    }

    #[test]
    fn server_status_is_parsed_by_shape_and_bounded() {
        let status = |params: Value| match of(json!({"jsonrpc":"2.0","method":"experimental/serverStatus","params":params})).unwrap() {
            Inbound::Health(health) => health, other => panic!("{other:?}"),
        };
        assert_eq!(status(json!({"health":"error","quiescent":true,"message":"Failed to load workspaces."})).unwrap(),
            Health { health: "error".into(), quiescent: Some(true), message: Some("Failed to load workspaces.".into()) });
        assert_eq!(status(json!({"health":"ok","quiescent":false})).unwrap().message, None);
        for bad in [json!({}), json!({"health":"panic"}), json!({"health":"ok","quiescent":"no"}), json!({"health":"ok","message":3}), json!(null)] {
            assert!(status(bad.clone()).is_err(), "{bad}");
        }
        let long = status(json!({"health":"warning","message":"é".repeat(HEALTH_MESSAGE_BYTES)})).unwrap().message.unwrap();
        assert!(long.len() <= HEALTH_MESSAGE_BYTES + "…".len() && long.ends_with('…'));
    }

    #[test]
    fn unusable_bodies_are_bad_bodies_not_framing_errors() {
        for body in ["{", "[]", r#"{"id":1,"result":1}"#, r#"{"jsonrpc":"2.0","id":1}"#,
            r#"{"jsonrpc":"2.0","method":7}"#, r#"{"jsonrpc":"2.0","id":1,"error":{"message":"no code"}}"#,
            r#"{"jsonrpc":"2.0","method":"$/progress","params":{"value":{"kind":"end"}}}"#] {
            assert!(classify(body.as_bytes()).is_err(), "{body}");
        }
    }
}
