//! Provider request kinds (Stage 1c, decisions 40 and 41).
//!
//! One typed kind per LSP request; the frontend cannot ask a session for a
//! method the capability table did not validate, and there is no generic
//! "send any method" command. Timeouts and per-kind pending shares are ◇
//! initial values, set from G3 and G4 results; none is a budget.

use std::time::Duration;

use super::caps::NegotiatedCaps;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderKind { Hover, Definition, References, DocumentSymbol }

impl ProviderKind {
    pub(crate) fn method(self) -> &'static str {
        match self {
            ProviderKind::Hover => "textDocument/hover",
            ProviderKind::Definition => "textDocument/definition",
            ProviderKind::References => "textDocument/references",
            ProviderKind::DocumentSymbol => "textDocument/documentSymbol",
        }
    }

    /// Whether the validated capabilities allow asking for this kind.
    pub(crate) fn enabled(self, caps: &NegotiatedCaps) -> bool {
        caps.sync_unusable.is_none() && match self {
            ProviderKind::Hover => caps.hover,
            ProviderKind::Definition => caps.definition,
            ProviderKind::References => caps.references,
            ProviderKind::DocumentSymbol => caps.document_symbol,
        }
    }

    /// ◇ A timeout is "no result" and cancels the request.
    pub(crate) fn timeout(self) -> Duration {
        Duration::from_secs(match self {
            ProviderKind::Hover => 5,
            ProviderKind::Definition | ProviderKind::DocumentSymbol => 10,
            ProviderKind::References => 30,
        })
    }

    /// ◇ Most requests of this kind in flight across documents of one session,
    /// so references cannot starve the quick kinds of pending-table room.
    pub(crate) fn share(self) -> usize {
        match self {
            ProviderKind::References => 2,
            _ => 6,
        }
    }
}

// ---- Unowned navigation targets (Stage 1c step 5, decisions 49-51) ----

/// ◇ Largest file a navigation target may be read as (text only).
pub(crate) const TARGET_MAX_BYTES: u64 = 4 * 1024 * 1024;
/// ◇ Most distinct returned paths remembered per session.
pub(crate) const RETURNED_MAX: usize = 20_000;

/// `file:///a%20b` to `/a b`; `None` for anything that is not an absolute `file://` path.
pub(crate) fn uri_path(uri: &str) -> Option<std::path::PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    if !rest.starts_with('/') { return None; }
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = rest.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else { out.push(bytes[i]); i += 1; }
    }
    Some(std::path::PathBuf::from(String::from_utf8(out).ok()?))
}

/// Every `uri` / `targetUri` string in a definition or references reply (bounded).
pub(crate) fn returned_uris(value: &serde_json::Value) -> Vec<String> {
    fn walk(value: &serde_json::Value, depth: usize, out: &mut Vec<String>) {
        if depth > 4 || out.len() >= 1000 { return; }
        match value {
            serde_json::Value::Array(items) => items.iter().for_each(|v| walk(v, depth + 1, out)),
            serde_json::Value::Object(map) => {
                for key in ["uri", "targetUri"] {
                    if let Some(serde_json::Value::String(s)) = map.get(key) { out.push(s.clone()); }
                }
            }
            _ => {}
        }
    }
    let mut out = vec![];
    walk(value, 0, &mut out);
    out
}

/// The text of a path the session returned. Refuses anything else, oversize files and non-text;
/// it never writes. The returned path is the canonical one.
pub(crate) fn read_returned(path: &std::path::Path, returned: &std::collections::HashSet<std::path::PathBuf>) -> Result<(String, String), String> {
    let canonical = std::fs::canonicalize(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    if !returned.contains(&canonical) { return Err(format!("{} was not returned by this language server", path.display())); }
    let meta = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if !meta.is_file() { return Err(format!("{} is not a regular file", canonical.display())); }
    if meta.len() > TARGET_MAX_BYTES { return Err(format!("{} is larger than {} MiB", canonical.display(), TARGET_MAX_BYTES / (1024 * 1024))); }
    let bytes = std::fs::read(&canonical).map_err(|e| e.to_string())?;
    if bytes.contains(&0) { return Err(format!("{} is not a text file", canonical.display())); }
    let text = String::from_utf8(bytes).map_err(|_| format!("{} is not valid UTF-8 text", canonical.display()))?;
    Ok((canonical.display().to_string(), text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    fn dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("craidd-target-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn returned_of(paths: &[&std::path::Path]) -> HashSet<std::path::PathBuf> { paths.iter().map(|p| std::fs::canonicalize(p).unwrap()).collect() }

    #[test]
    fn uris_decode_and_foreign_ones_are_refused() {
        assert_eq!(uri_path("file:///a%20b/%CE%BB.rs"), Some("/a b/λ.rs".into()));
        assert_eq!(uri_path("file://localhost/x.rs"), Some("/x.rs".into()));
        for bad in ["http://x/a", "file://host/a", "file:relative", "file:///%zz", "file:///%ff", ""] { assert_eq!(uri_path(bad), None, "{bad}"); }
    }

    #[test]
    fn returned_uris_find_locations_and_location_links() {
        let value = json!([{"uri": "file:///a.rs", "range": {}}, {"targetUri": "file:///b.rs"}, {"nested": {"uri": "file:///ignored.rs"}}, 5]);
        assert_eq!(returned_uris(&value), vec!["file:///a.rs", "file:///b.rs"]);
        assert_eq!(returned_uris(&json!({"uri": "file:///one.rs"})), vec!["file:///one.rs"]);
        assert!(returned_uris(&json!(null)).is_empty());
    }

    #[test]
    fn only_a_returned_path_is_read_and_the_file_is_never_modified() {
        let d = dir("read");
        let (ok, other) = (d.join("ok.rs"), d.join("other.rs"));
        std::fs::write(&ok, "fn ok() {}\n").unwrap();
        std::fs::write(&other, "secret").unwrap();
        let before = std::fs::read(&ok).unwrap();
        let returned = returned_of(&[&ok]);
        let (path, text) = read_returned(&ok, &returned).unwrap();
        assert_eq!(text, "fn ok() {}\n");
        assert_eq!(path, std::fs::canonicalize(&ok).unwrap().display().to_string());
        assert!(read_returned(&other, &returned).unwrap_err().contains("not returned"), "a path the server did not return is refused");
        assert!(read_returned(&d.join("missing.rs"), &returned).is_err());
        assert_eq!(std::fs::read(&ok).unwrap(), before, "reading never writes");
        assert_eq!(std::fs::read(&other).unwrap(), b"secret");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_symlink_resolves_to_its_canonical_path_before_the_returned_check() {
        let d = dir("link");
        let (real, link) = (d.join("real.rs"), d.join("link.rs"));
        std::fs::write(&real, "x").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let returned = returned_of(&[&real]);
        assert!(read_returned(&link, &returned).is_ok(), "the link points at a returned canonical path");
        assert!(read_returned(&link, &HashSet::new()).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn oversize_binary_invalid_utf8_and_directories_are_refused() {
        let d = dir("bad");
        let big = d.join("big.rs");
        std::fs::write(&big, vec![b'a'; TARGET_MAX_BYTES as usize + 1]).unwrap();
        let nul = d.join("nul.bin");
        std::fs::write(&nul, b"ab\0cd").unwrap();
        let bad = d.join("bad.rs");
        std::fs::write(&bad, [0xff, 0xfe, b'a']).unwrap();
        let returned = returned_of(&[&big, &nul, &bad, &d]);
        assert!(read_returned(&big, &returned).unwrap_err().contains("larger"));
        assert!(read_returned(&nul, &returned).unwrap_err().contains("not a text file"));
        assert!(read_returned(&bad, &returned).unwrap_err().contains("UTF-8"));
        assert!(read_returned(&d, &returned).unwrap_err().contains("regular file"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn nothing_under_the_toolchain_or_cargo_home_is_ever_written_by_this_module() {
        // read_returned only calls canonicalize, metadata and read; assert that by construction.
        let source = include_str!("providers.rs");
        let body = &source[source.find("pub(crate) fn read_returned").unwrap()..source.find("#[cfg(test)]").unwrap()];
        for forbidden in ["fs::write", "fs::remove", "fs::create", "OpenOptions", "set_permissions", "fs::rename", "fs::copy"] {
            assert!(!body.contains(forbidden), "{forbidden} must not appear in the read path");
        }
    }
}
