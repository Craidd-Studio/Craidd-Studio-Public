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

    #[test]
    fn project_refs_carry_the_resolved_folder() {
        let mut nested = project("api", "services/api/api.craidd", "rust");
        nested.root = "crate".into();
        let s = solution(vec![nested]);
        assert_eq!(project_ref(&s, &s.projects[0]).folder, Path::new("/ws/services/api/crate"));
    }
}
