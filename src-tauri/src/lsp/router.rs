//! file → owning project → declared language → adapter. A pure function of
//! (file, solution model, language tables, adapters); it spawns nothing.
use std::path::Path;

use crate::ownership::{owning_project, project_folder, resolve_rel, Facet, LanguageFiles, Ownership, TreeProbe};
use crate::types::{CraiddProject, CraiddSolution};
use super::adapter::{LanguageAdapter, ProjectRef};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NotRouted {
    NoOwner,
    Ambiguous(Vec<String>),
    /// Owned through the project's config facet, not its language.
    ConfigFacet,
    NoLanguage,
    NoAdapter(String),
    /// A member of the project that this language's server is not given
    /// (a manifest, or an explicitly included non-source file).
    NotADocument,
}

pub(crate) enum Route<'a> {
    Routed { project: &'a CraiddProject, adapter: &'a dyn LanguageAdapter },
    NotRouted(NotRouted),
}

/// How a file presented to the attach step is routed (Stage 1c step 7, decision 52, Option B with Option A's fallback).
pub(crate) enum AttachRoute<'a> {
    /// The file as presented: ownership and routing exactly as `route` decides them.
    Plain(Route<'a>),
    /// The presented path is unowned only because a symlink is in it, and its canonical path is an owned, routed file:
    /// the tab is an alias of that file (decision 12). Registration is by the canonical path.
    Alias { canonical: std::path::PathBuf, project: &'a CraiddProject, adapter: &'a dyn LanguageAdapter },
    /// Unowned because of a symlink, and the canonical path is not a project-owned file either: say so, instead of nothing.
    SymlinkUnowned,
}

pub(crate) const SYMLINK_REASON: &str = "opened through a symlink; open the real path for language features";

/// Only the attach step canonicalises, and only after `route` has said "no owner": ownership.rs (symlinks are never
/// members) and the identity rules are untouched. `canonicalize` is injected so tests can script it.
pub(crate) fn route_attach<'a>(file: &Path, solution: &'a CraiddSolution, languages: &dyn Fn(&str) -> Option<LanguageFiles>,
    probe: &dyn TreeProbe, adapters: &'a [Box<dyn LanguageAdapter>], canonicalize: &dyn Fn(&Path) -> Option<std::path::PathBuf>) -> AttachRoute<'a> {
    let presented = route(file, solution, languages, probe, adapters);
    if !matches!(presented, Route::NotRouted(NotRouted::NoOwner)) { return AttachRoute::Plain(presented); }
    let Some(canonical) = canonicalize(file).filter(|c| c.as_path() != file) else { return AttachRoute::Plain(presented); };
    match route(&canonical, solution, languages, probe, adapters) {
        Route::Routed { project, adapter } => AttachRoute::Alias { canonical, project, adapter },
        Route::NotRouted(_) => AttachRoute::SymlinkUnowned,
    }
}

pub(crate) fn project_ref(solution: &CraiddSolution, project: &CraiddProject) -> ProjectRef {
    ProjectRef {
        id: project.id.clone(), name: project.name.clone(),
        language: project.language.clone().unwrap_or_default(),
        folder: project_folder(&resolve_rel(Path::new("/"), &solution.root), project),
    }
}

pub(crate) fn route<'a>(file: &Path, solution: &'a CraiddSolution, languages: &dyn Fn(&str) -> Option<LanguageFiles>,
    probe: &dyn TreeProbe, adapters: &'a [Box<dyn LanguageAdapter>]) -> Route<'a> {
    let (project, facet) = match owning_project(solution, file, languages, probe) {
        Ownership::Owned { project, facet } => (project, facet),
        Ownership::NotOwned => return Route::NotRouted(NotRouted::NoOwner),
        Ownership::Ambiguous(found) => return Route::NotRouted(NotRouted::Ambiguous(found.iter().map(|p| p.name.clone()).collect())),
    };
    if facet == Facet::Config { return Route::NotRouted(NotRouted::ConfigFacet); }
    let Some(language) = project.language.as_deref() else { return Route::NotRouted(NotRouted::NoLanguage); };
    let Some(adapter) = adapters.iter().find(|adapter| adapter.language() == language) else {
        return Route::NotRouted(NotRouted::NoAdapter(language.into()));
    };
    let name = file.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !adapter.document_extensions().iter().any(|ext| name.ends_with(&format!(".{ext}"))) {
        return Route::NotRouted(NotRouted::NotADocument);
    }
    Route::Routed { project, adapter: adapter.as_ref() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ownership::tests::{languages, project, solution, Scripted};
    use crate::lsp::adapter::{ResolveNote, ServerContext};

    struct Fake(&'static str, &'static [&'static str]);
    impl LanguageAdapter for Fake {
        fn language(&self) -> &'static str { self.0 }
        fn document_extensions(&self) -> &'static [&'static str] { self.1 }
        fn resolve(&self, _: &ProjectRef) -> Result<ServerContext, ResolveNote> { Err(ResolveNote("unused".into())) }
        fn configuration_section(&self) -> &'static str { "unused" }
    }

    fn outcome(file: &str, s: &CraiddSolution, adapters: &[Box<dyn LanguageAdapter>]) -> Result<String, NotRouted> {
        match route(Path::new(file), s, &languages, &Scripted::default(), adapters) {
            Route::Routed { project, adapter } => Ok(format!("{}:{}", project.name, adapter.language())),
            Route::NotRouted(reason) => Err(reason),
        }
    }

    #[test]
    fn routes_by_declared_language_never_by_extension() {
        let mut app = project("app", "app/app.craidd", "rust");
        app.config_enabled = true;
        let s = solution(vec![app, project("cfg", "tools/tools.craidd", "config"), project("web", "web/web.craidd", "typescript")]);
        let adapters: Vec<Box<dyn LanguageAdapter>> = vec![Box::new(Fake("rust", &["rs"]))];
        assert_eq!(outcome("/ws/app/src/main.rs", &s, &adapters), Ok("app:rust".into()));
        assert_eq!(outcome("/ws/tools/gen.rs", &s, &adapters), Err(NotRouted::NoOwner));
        assert_eq!(outcome("/ws/elsewhere/x.rs", &s, &adapters), Err(NotRouted::NoOwner));
        assert_eq!(outcome("/ws/app/Cargo.toml", &s, &adapters), Err(NotRouted::NotADocument));
        assert_eq!(outcome("/ws/app/settings.json", &s, &adapters), Err(NotRouted::ConfigFacet));
        assert_eq!(outcome("/ws/web/main.ts", &s, &adapters), Err(NotRouted::NoAdapter("typescript".into())));
    }

    fn attach(file: &str, s: &CraiddSolution, probe: &Scripted, adapters: &[Box<dyn LanguageAdapter>], links: &[(&str, &str)]) -> String {
        let canonicalize = |p: &Path| {
            let text = p.to_string_lossy().into_owned();
            links.iter().find_map(|(from, to)| text.strip_prefix(from).map(|rest| std::path::PathBuf::from(format!("{to}{rest}")))).or(Some(p.to_path_buf()))
        };
        match route_attach(Path::new(file), s, &languages, probe, adapters, &canonicalize) {
            AttachRoute::Plain(Route::Routed { project, .. }) => format!("plain:{}", project.name),
            AttachRoute::Plain(Route::NotRouted(reason)) => format!("plain-not-routed:{reason:?}"),
            AttachRoute::Alias { canonical, project, .. } => format!("alias:{}:{}", project.name, canonical.display()),
            AttachRoute::SymlinkUnowned => "symlink-unowned".into(),
        }
    }

    /// Step 7, cases (a)-(d): the routing half. The symlinked path stays unowned for ownership; only the attach step
    /// looks at the canonical path.
    #[test]
    fn symlinked_vendor_cases_a_to_d_route_by_the_canonical_path_only_at_attach() {
        let s = solution(vec![project("app", "app/app.craidd", "rust")]);
        let adapters: Vec<Box<dyn LanguageAdapter>> = vec![Box::new(Fake("rust", &["rs"]))];
        let probe = Scripted { links: std::collections::HashSet::from([
            std::path::PathBuf::from("/ws/app/linked"), std::path::PathBuf::from("/ws/app/vendored")]), ..Default::default() };
        let links = [("/ws/app/linked", "/ws/app/real_mods"), ("/ws/app/vendored", "/registry/dep")];
        // (a) a vendored copy that is a real directory: owned, nothing special.
        assert_eq!(attach("/ws/app/third/dep/x.rs", &s, &probe, &adapters, &links), "plain:app");
        // (b) a symlink to the registry copy, which is outside every project: the reason, not nothing.
        assert_eq!(attach("/ws/app/vendored/x.rs", &s, &probe, &adapters, &links), "symlink-unowned");
        //     and the registry path itself is a plain unowned file (navigation opens it read-only, step 5).
        assert_eq!(attach("/registry/dep/x.rs", &s, &probe, &adapters, &links), "plain-not-routed:NoOwner");
        // A symlink whose target is an owned file of the project: an alias of that file (Option B).
        assert_eq!(attach("/ws/app/linked/deep.rs", &s, &probe, &adapters, &links), "alias:app:/ws/app/real_mods/deep.rs");
        // (c)/(d) the other spelling is the owned file itself, which routes as before.
        assert_eq!(attach("/ws/app/real_mods/deep.rs", &s, &probe, &adapters, &links), "plain:app");
        // Other not-routed reasons are not rewritten, and a path with no symlink in it stays plain.
        assert_eq!(attach("/ws/app/Cargo.toml", &s, &probe, &adapters, &links), "plain-not-routed:NotADocument");
        assert_eq!(attach("/ws/elsewhere/x.rs", &s, &probe, &adapters, &links), "plain-not-routed:NoOwner");
    }

    /// The same cases against the real filesystem: real symlinks, real canonicalisation, the production probe.
    #[test]
    fn symlinked_vendor_cases_on_a_real_filesystem() {
        let base = std::env::temp_dir().join(format!("craidd-step7-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (ws, app, registry) = (base.join("ws"), base.join("ws/app"), base.join("registry/dep"));
        for dir in [app.join("real_mods"), app.join("third/dep"), registry.clone()] { std::fs::create_dir_all(dir).unwrap(); }
        for file in [app.join("real_mods/deep.rs"), app.join("third/dep/x.rs"), registry.join("y.rs")] { std::fs::write(file, "fn f() {}\n").unwrap(); }
        std::os::unix::fs::symlink(app.join("real_mods"), app.join("linked")).unwrap();
        std::os::unix::fs::symlink(&registry, app.join("vendored")).unwrap();
        let mut s = solution(vec![project("app", "app/app.craidd", "rust")]);
        s.root = ws.to_string_lossy().into_owned();
        let adapters: Vec<Box<dyn LanguageAdapter>> = vec![Box::new(Fake("rust", &["rs"]))];
        let canonicalize = |p: &Path| std::fs::canonicalize(p).ok();
        let kind = |file: &Path| match route_attach(file, &s, &languages, &crate::ownership::DiskProbe, &adapters, &canonicalize) {
            AttachRoute::Plain(Route::Routed { .. }) => "plain".to_string(),
            AttachRoute::Plain(Route::NotRouted(reason)) => format!("not-routed:{reason:?}"),
            AttachRoute::Alias { canonical, .. } => format!("alias:{}", canonical.strip_prefix(&base).unwrap().display()),
            AttachRoute::SymlinkUnowned => "symlink-unowned".to_string(),
        };
        assert_eq!(kind(&app.join("third/dep/x.rs")), "plain", "(a) a vendored real directory");
        assert_eq!(kind(&app.join("vendored/y.rs")), "symlink-unowned", "(b) a symlink to the registry copy");
        assert_eq!(kind(&registry.join("y.rs")), "not-routed:NoOwner", "the registry path itself is unowned");
        assert_eq!(kind(&app.join("linked/deep.rs")), "alias:ws/app/real_mods/deep.rs", "a symlink into the project: an alias of the owned file");
        assert_eq!(kind(&app.join("real_mods/deep.rs")), "plain", "(c) the owned spelling");
        let _ = std::fs::remove_dir_all(&base);
    }

    /// The architect's condition: no change to ownership membership or canonical identity. `route` still calls a
    /// symlinked path unowned, and the membership rule's two symlink checks are still in ownership.rs.
    #[test]
    fn ownership_and_identity_rules_are_unchanged_by_step_7() {
        let s = solution(vec![project("app", "app/app.craidd", "rust")]);
        let adapters: Vec<Box<dyn LanguageAdapter>> = vec![Box::new(Fake("rust", &["rs"]))];
        let probe = Scripted { links: std::collections::HashSet::from([std::path::PathBuf::from("/ws/app/linked")]), ..Default::default() };
        assert!(matches!(route(Path::new("/ws/app/linked/deep.rs"), &s, &languages, &probe, &adapters), Route::NotRouted(NotRouted::NoOwner)));
        let ownership = include_str!("../ownership.rs");
        assert!(ownership.contains("|| probe.is_symlink(&path) { return None; }"), "a symlinked folder is still never a member");
        assert!(ownership.contains("|| probe.is_symlink(file) { return None; }"), "a symlinked file is still never a member");
        let router = include_str!("router.rs");
        let production = &router[..router.find("#[cfg(test)]").unwrap()];
        assert!(production.matches("canonicalize").count() >= 3 && !production.contains("fs::canonicalize"),
            "the router never touches the filesystem: canonicalisation is injected by the attach step");
    }

    #[test]
    fn project_refs_carry_the_resolved_folder() {
        let mut nested = project("api", "services/api/api.craidd", "rust");
        nested.root = "crate".into();
        let s = solution(vec![nested]);
        assert_eq!(project_ref(&s, &s.projects[0]).folder, Path::new("/ws/services/api/crate"));
    }
}
