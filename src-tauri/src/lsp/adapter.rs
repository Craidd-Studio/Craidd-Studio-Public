//! Per-language adapters turn a project into a `ServerContext`, and a
//! context into a `ServerIdentity`. Many projects may share one server;
//! which project owns a file is decided elsewhere (`crate::ownership`).
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::session::LaunchSpec;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProjectRef { pub id: String, pub name: String, pub language: String, pub folder: PathBuf }

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ToolRef { pub path: PathBuf, pub version: String }

#[derive(Clone, Debug)]
pub(crate) struct ServerContext {
    pub implementation: ToolRef,
    pub args: Vec<String>,
    /// Server root; may be wider than the project (a Cargo workspace).
    pub root: PathBuf,
    pub projects: Vec<ProjectRef>,
    pub init_options: Value,
    pub env: Vec<(String, String)>,
    pub lsp_language_id: &'static str,
    /// Client `experimental` capabilities this adapter's server understands.
    pub experimental: Value,
    /// A request asking the server to reload its workspace, if it has one.
    pub reload_method: Option<&'static str>,
    /// Manifests whose change should trigger that reload.
    pub manifests: Vec<PathBuf>,
    /// Non-fatal notes, for example a fallback root.
    pub notes: Vec<String>,
}

/// Non-fatal: the file opens, it just has no intelligence, and the reason
/// is shown in the language-server status.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResolveNote(pub String);

pub(crate) trait LanguageAdapter: Send + Sync {
    fn language(&self) -> &'static str;
    /// Which documents of this language's projects the server is given.
    /// Membership comes from the project; this only keeps manifests such
    /// as `Cargo.toml` and explicitly included non-source files out.
    fn document_extensions(&self) -> &'static [&'static str];
    fn resolve(&self, project: &ProjectRef) -> Result<ServerContext, ResolveNote>;
    /// The `workspace/configuration` section the server asks for.
    fn configuration_section(&self) -> &'static str;
}

/// `( implementation id, resolved root, configuration identity )`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ServerIdentity {
    pub program: PathBuf,
    pub version: String,
    pub root: PathBuf,
    pub configuration: u64,
}

/// Stable across runs: FNV-1a over canonical JSON (serde_json maps are
/// sorted) and the sorted environment overrides.
pub(crate) fn configuration_identity(init_options: &Value, env: &[(String, String)]) -> u64 {
    let mut env = env.to_vec();
    env.sort();
    let text = format!("{init_options}\u{0}{env:?}");
    text.bytes().fold(0xcbf29ce484222325, |hash, byte| (hash ^ byte as u64).wrapping_mul(0x100000001b3))
}

pub(crate) fn file_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    for byte in path.to_string_lossy().bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => uri.push(byte as char),
            _ => uri.push_str(&format!("%{byte:02X}")),
        }
    }
    uri
}

impl ServerContext {
    pub(crate) fn identity(&self) -> ServerIdentity {
        ServerIdentity {
            program: self.implementation.path.clone(),
            version: self.implementation.version.clone(),
            root: self.root.clone(),
            configuration: configuration_identity(&self.init_options, &self.env),
        }
    }

    /// `section` answers `workspace/configuration` (for rust-analyzer, "rust-analyzer").
    pub(crate) fn launch_spec(&self, section: &str) -> LaunchSpec {
        LaunchSpec {
            program: self.implementation.path.clone(),
            args: self.args.clone(),
            cwd: self.root.clone(),
            env: self.env.clone(),
            root_uri: file_uri(&self.root),
            workspace_name: self.root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            configuration: serde_json::json!({ section: self.init_options }),
            init_options: self.init_options.clone(),
            lazy_additional_edits: false,
            experimental: self.experimental.clone(),
            reload_method: self.reload_method.map(String::from),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn context(path: &str, version: &str, root: &str, options: Value) -> ServerContext {
        ServerContext { implementation: ToolRef { path: path.into(), version: version.into() }, args: vec![], root: root.into(),
            projects: vec![], init_options: options, env: vec![], lsp_language_id: "rust", experimental: Value::Null, reload_method: None, manifests: vec![], notes: vec![] }
    }

    #[test]
    fn identity_changes_with_binary_version_root_or_configuration() {
        let base = context("/bin/ra", "1", "/ws", json!({"a": 1, "b": 2}));
        assert_eq!(base.identity(), context("/bin/ra", "1", "/ws", json!({"b": 2, "a": 1})).identity(), "key order is irrelevant");
        assert_ne!(base.identity(), context("/other/ra", "1", "/ws", json!({"a": 1, "b": 2})).identity());
        assert_ne!(base.identity(), context("/bin/ra", "2", "/ws", json!({"a": 1, "b": 2})).identity());
        assert_ne!(base.identity(), context("/bin/ra", "1", "/ws/x", json!({"a": 1, "b": 2})).identity());
        assert_ne!(base.identity(), context("/bin/ra", "1", "/ws", json!({"a": 1, "b": 3})).identity());
        let mut env = base.clone();
        env.env = vec![("RA_LOG".into(), "info".into())];
        assert_ne!(base.identity(), env.identity());
    }

    #[test]
    fn file_uris_percent_encode_non_safe_bytes() {
        assert_eq!(file_uri(Path::new("/home/a b/λ.rs")), "file:///home/a%20b/%CE%BB.rs");
    }
}
