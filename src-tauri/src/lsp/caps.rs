//! Capability negotiation. Craidd advertises only what it implements; the
//! `initialize` result is untrusted input, validated once into an immutable
//! `NegotiatedCaps`. An invalid shape disables that feature with a note;
//! only a field essential to correctness fails the handshake.
use serde::Serialize;
use serde_json::{json, Map, Value};

/// Client capabilities for Stage 1 (design: "Client capabilities").
/// `lazy_additional_edits` stays false until lazy resolution is verified
/// safe (V10); eager mode (F2) is then the default.
pub(crate) fn client_capabilities(lazy_additional_edits: bool) -> Value {
    let mut resolve = vec!["documentation", "detail"];
    if lazy_additional_edits { resolve.push("additionalTextEdits"); }
    json!({
        "general": {
            "positionEncodings": ["utf-16"],
            "staleRequestSupport": { "cancel": true, "retryOnContentModified": [] },
        },
        "textDocument": {
            "synchronization": { "dynamicRegistration": false, "didSave": true, "willSave": false, "willSaveWaitUntil": false },
            "completion": {
                "dynamicRegistration": false,
                "contextSupport": true,
                "completionItem": {
                    "snippetSupport": true,
                    "documentationFormat": ["markdown", "plaintext"],
                    "resolveSupport": { "properties": resolve },
                    "insertReplaceSupport": true,
                },
            },
            "hover": { "dynamicRegistration": false, "contentFormat": ["markdown", "plaintext"] },
            "definition": { "dynamicRegistration": false, "linkSupport": false },
            "references": { "dynamicRegistration": false },
            "documentSymbol": { "dynamicRegistration": false, "hierarchicalDocumentSymbolSupport": true },
            "publishDiagnostics": { "relatedInformation": true, "versionSupport": true, "tagSupport": { "valueSet": [1, 2] } },
        },
        "window": { "workDoneProgress": true },
        "workspace": { "workspaceFolders": true, "configuration": true },
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SyncKind { None, Full, Incremental }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SaveMode { None, Plain, IncludeText }

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Completion { pub trigger_characters: Vec<String>, pub resolve: bool }

/// The validated, immutable result. Also the frontend summary: booleans
/// and the trigger-character list, never the raw result.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NegotiatedCaps {
    pub sync: SyncKind,
    /// `Some(reason)` when document synchronisation is unusable: documents
    /// are not opened and document-dependent providers stay disabled.
    pub sync_unusable: Option<String>,
    pub save: SaveMode,
    pub completion: Option<Completion>,
    pub hover: bool,
    pub definition: bool,
    pub references: bool,
    pub document_symbol: bool,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub notes: Vec<String>,
}

impl NegotiatedCaps {
    /// One line for Output when the session becomes Ready.
    pub(crate) fn summary_line(&self) -> String {
        let on = |flag: bool| if flag { "on" } else { "off" };
        let completion = match &self.completion {
            None => "off".to_string(),
            Some(c) => format!("on (resolve {}, {} trigger characters)", on(c.resolve), c.trigger_characters.len()),
        };
        format!("sync {:?}{}, save {:?}, completion {completion}, hover {}, definition {}, references {}, symbols {}",
            self.sync, self.sync_unusable.as_ref().map(|r| format!(" (unusable: {r})")).unwrap_or_default(),
            self.save, on(self.hover), on(self.definition), on(self.references), on(self.document_symbol))
    }
}

fn provider(caps: &Map<String, Value>, key: &str, notes: &mut Vec<String>) -> bool {
    match caps.get(key) {
        None | Some(Value::Bool(false)) => false,
        Some(Value::Bool(true)) | Some(Value::Object(_)) => true,
        Some(other) => { notes.push(format!("{key} has an invalid shape ({other}); disabled")); false }
    }
}

/// Validate an `initialize` result. `Err` fails the handshake.
pub(crate) fn validate(result: &Value) -> Result<NegotiatedCaps, String> {
    let caps = result.get("capabilities").and_then(Value::as_object)
        .ok_or("initialize result has no capabilities object")?;
    match caps.get("positionEncoding") {
        None => {}
        Some(Value::String(encoding)) if encoding == "utf-16" => {}
        Some(other) => return Err(format!("server chose position encoding {other}; Craidd offered only utf-16")),
    }
    let mut notes = vec![];
    let (sync, _open_close, change_ok, save) = match caps.get("textDocumentSync") {
        None => (SyncKind::None, false, Err("server declares no document synchronisation".to_string()), SaveMode::None),
        Some(Value::Number(n)) => match n.as_u64() {
            Some(0) => (SyncKind::None, true, Ok(()), SaveMode::None),
            Some(1) => (SyncKind::Full, true, Ok(()), SaveMode::None),
            Some(2) => (SyncKind::Incremental, true, Ok(()), SaveMode::None),
            _ => (SyncKind::None, false, Err(format!("unknown textDocumentSync kind {n}")), SaveMode::None),
        },
        Some(Value::Object(object)) => {
            let save = match object.get("save") {
                None | Some(Value::Bool(false)) => SaveMode::None,
                Some(Value::Bool(true)) => SaveMode::Plain,
                Some(Value::Object(save)) => match save.get("includeText") {
                    Some(Value::Bool(true)) => SaveMode::IncludeText,
                    None | Some(Value::Bool(false)) => SaveMode::Plain,
                    Some(other) => { notes.push(format!("save.includeText is invalid ({other}); didSave disabled")); SaveMode::None }
                },
                Some(other) => { notes.push(format!("textDocumentSync.save is invalid ({other}); didSave disabled")); SaveMode::None }
            };
            let open_close = object.get("openClose") == Some(&Value::Bool(true));
            match object.get("change").and_then(Value::as_u64) {
                None => (SyncKind::None, open_close, Err("textDocumentSync has no valid change kind".to_string()), save),
                Some(change) if change > 2 => (SyncKind::None, open_close, Err(format!("unknown change kind {change}")), save),
                Some(change) if change > 0 && !open_close =>
                    (SyncKind::None, false, Err("change is set but openClose is not true".to_string()), save),
                Some(change) => ([SyncKind::None, SyncKind::Full, SyncKind::Incremental][change as usize], open_close, Ok(()), save),
            }
        }
        Some(other) => (SyncKind::None, false, Err(format!("textDocumentSync has an invalid shape ({other})")), SaveMode::None),
    };
    let sync_unusable = change_ok.err();
    let completion = match caps.get("completionProvider") {
        None => None,
        Some(Value::Object(options)) => {
            let trigger_characters = match options.get("triggerCharacters") {
                None => vec![],
                Some(Value::Array(items)) => {
                    let valid: Vec<String> = items.iter().filter_map(Value::as_str).filter(|c| !c.is_empty()).map(String::from).collect();
                    if valid.len() != items.len() { notes.push(format!("{} invalid trigger characters dropped", items.len() - valid.len())); }
                    valid
                }
                Some(other) => { notes.push(format!("triggerCharacters is invalid ({other}); none used")); vec![] }
            };
            let resolve = options.get("resolveProvider") == Some(&Value::Bool(true));
            if !matches!(options.get("resolveProvider"), None | Some(Value::Bool(_))) {
                notes.push("resolveProvider is not a boolean; resolve disabled".into());
            }
            Some(Completion { trigger_characters, resolve })
        }
        Some(other) => { notes.push(format!("completionProvider has an invalid shape ({other}); disabled")); None }
    };
    let hover = provider(caps, "hoverProvider", &mut notes);
    let definition = provider(caps, "definitionProvider", &mut notes);
    let references = provider(caps, "referencesProvider", &mut notes);
    let document_symbol = provider(caps, "documentSymbolProvider", &mut notes);
    if caps.contains_key("diagnosticProvider") { notes.push("pull diagnostics offered; not used in Stage 1".into()); }
    let info = result.get("serverInfo");
    let server_name = info.and_then(|i| i.get("name")).and_then(Value::as_str).map(String::from);
    let server_version = info.and_then(|i| i.get("version")).and_then(Value::as_str).map(String::from);
    let documents = sync_unusable.is_none();
    Ok(NegotiatedCaps {
        sync, sync_unusable, save: if documents { save } else { SaveMode::None },
        completion: completion.filter(|_| documents),
        hover: hover && documents, definition: definition && documents,
        references: references && documents, document_symbol: document_symbol && documents,
        server_name, server_version, notes,
    })
}

/// Apply a `completionItem/resolve` response. Only the lazily declared
/// properties are taken; the spec says the rest must not change, so any
/// attempt is ignored and reported. The item's opaque `data` is kept.
pub(crate) fn merge_resolved(original: &Value, resolved: &Value, lazy_additional_edits: bool) -> (Value, Vec<String>) {
    let mut merged = original.clone();
    let mut ignored = vec![];
    let (Some(target), Some(source)) = (merged.as_object_mut(), resolved.as_object()) else {
        return (original.clone(), vec!["resolve response is not an object".into()]);
    };
    for (key, value) in source {
        let lazy = matches!(key.as_str(), "documentation" | "detail") || (lazy_additional_edits && key == "additionalTextEdits");
        if lazy { target.insert(key.clone(), value.clone()); }
        else if key != "data" && original.get(key) != Some(value) { ignored.push(key.clone()); }
    }
    (merged, ignored)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(capabilities: Value) -> Result<NegotiatedCaps, String> { validate(&json!({ "capabilities": capabilities })) }
    fn ok(capabilities: Value) -> NegotiatedCaps { with(capabilities).unwrap() }
    const INCREMENTAL: fn() -> Value = || json!({"openClose": true, "change": 2});

    #[test]
    fn position_encoding_other_than_utf16_fails_the_handshake() {
        assert!(with(json!({"positionEncoding": "utf-16", "textDocumentSync": 2})).is_ok());
        assert!(with(json!({"textDocumentSync": 2})).is_ok(), "absent is the protocol default");
        assert!(with(json!({"positionEncoding": "utf-8"})).is_err());
        assert!(with(json!({"positionEncoding": 16})).is_err());
        assert!(validate(&json!({})).is_err());
        assert!(validate(&json!({"capabilities": 1})).is_err());
    }

    #[test]
    fn sync_as_number_and_object_and_unusable_shapes() {
        assert_eq!(ok(json!({"textDocumentSync": 1})).sync, SyncKind::Full);
        assert_eq!(ok(json!({"textDocumentSync": 2})).sync, SyncKind::Incremental);
        assert_eq!(ok(json!({"textDocumentSync": 0})).sync_unusable, None);
        let incremental = ok(json!({"textDocumentSync": INCREMENTAL(), "hoverProvider": true}));
        assert_eq!((incremental.sync, incremental.save, incremental.hover), (SyncKind::Incremental, SaveMode::None, true));
        for unusable in [json!(7), json!("full"), json!({"openClose": true}), json!({"change": 2}),
            json!({"openClose": false, "change": 1}), json!({"openClose": true, "change": 9})] {
            let caps = ok(json!({"textDocumentSync": unusable, "hoverProvider": true, "completionProvider": {}}));
            assert!(caps.sync_unusable.is_some(), "{unusable}");
            assert!(!caps.hover && caps.completion.is_none(), "document providers are disabled: {unusable}");
        }
        assert!(ok(json!({})).sync_unusable.is_some());
    }

    #[test]
    fn save_shapes() {
        let save = |value: Value| ok(json!({"textDocumentSync": {"openClose": true, "change": 2, "save": value}})).save;
        assert_eq!(save(json!(false)), SaveMode::None);
        assert_eq!(save(json!(true)), SaveMode::Plain);
        assert_eq!(save(json!({})), SaveMode::Plain);
        assert_eq!(save(json!({"includeText": false})), SaveMode::Plain);
        assert_eq!(save(json!({"includeText": true})), SaveMode::IncludeText);
        assert_eq!(save(json!({"includeText": "yes"})), SaveMode::None);
        assert_eq!(save(json!(3)), SaveMode::None);
    }

    #[test]
    fn completion_trigger_characters_and_resolve_gating() {
        let completion = |value: Value| ok(json!({"textDocumentSync": 2, "completionProvider": value})).completion;
        assert_eq!(completion(json!({"triggerCharacters": [".", "", 3, ":"]})).unwrap().trigger_characters, vec![".", ":"]);
        assert_eq!(completion(json!({"triggerCharacters": "."})).unwrap().trigger_characters, Vec::<String>::new());
        assert!(completion(json!({"resolveProvider": true})).unwrap().resolve);
        for never in [json!({}), json!({"resolveProvider": false}), json!({"resolveProvider": "true"}), json!({"resolveProvider": 1})] {
            assert!(!completion(never.clone()).unwrap().resolve, "{never}");
        }
        assert_eq!(completion(json!(true)), None);
        assert_eq!(ok(json!({"textDocumentSync": 2})).completion, None);
    }

    #[test]
    fn provider_shapes_and_ignored_fields() {
        let caps = ok(json!({"textDocumentSync": 2, "hoverProvider": {"workDoneProgress": true}, "definitionProvider": true,
            "referencesProvider": false, "documentSymbolProvider": "yes", "diagnosticProvider": {}, "unknownThing": 1}));
        assert!(caps.hover && caps.definition && !caps.references && !caps.document_symbol);
        assert!(caps.notes.iter().any(|n| n.contains("documentSymbolProvider")));
        assert!(caps.notes.iter().any(|n| n.contains("pull diagnostics")));
        let named = validate(&json!({"capabilities": {"textDocumentSync": 2}, "serverInfo": {"name": "rust-analyzer", "version": "1.2"}})).unwrap();
        assert_eq!((named.server_name.as_deref(), named.server_version.as_deref()), (Some("rust-analyzer"), Some("1.2")));
    }

    #[test]
    fn resolve_applies_only_lazy_properties_and_keeps_data() {
        let item = json!({"label": "HashMap", "textEdit": {"newText": "HashMap"}, "data": {"opaque": 1}});
        let resolved = json!({"label": "Other", "textEdit": {"newText": "X"}, "detail": "struct", "documentation": "d",
            "additionalTextEdits": [{"newText": "use x;"}], "data": {"opaque": 2}});
        let (merged, ignored) = merge_resolved(&item, &resolved, false);
        assert_eq!(merged["label"], "HashMap");
        assert_eq!(merged["textEdit"]["newText"], "HashMap");
        assert_eq!(merged["detail"], "struct");
        assert_eq!(merged["data"], json!({"opaque": 1}));
        assert!(merged.get("additionalTextEdits").is_none(), "not declared lazy");
        assert_eq!(ignored, vec!["additionalTextEdits", "label", "textEdit"]);
        let (merged, _) = merge_resolved(&item, &resolved, true);
        assert_eq!(merged["additionalTextEdits"][0]["newText"], "use x;");
    }

    #[test]
    fn advertises_utf16_only_and_no_dynamic_registration_or_watchers() {
        let caps = client_capabilities(false);
        assert_eq!(caps["general"]["positionEncodings"], json!(["utf-16"]));
        assert!(caps["workspace"].get("didChangeWatchedFiles").is_none());
        assert!(caps["workspace"].get("applyEdit").is_none());
        assert_eq!(caps["textDocument"]["completion"]["completionItem"]["resolveSupport"]["properties"], json!(["documentation", "detail"]));
        assert_eq!(client_capabilities(true)["textDocument"]["completion"]["completionItem"]["resolveSupport"]["properties"][2], "additionalTextEdits");
    }
}
