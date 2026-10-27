//! The single file → owning project resolver.
//!
//! It answers with the Explorer's own membership rules (shared with
//! `commands::fs::filter_tree` through `membership_override` and
//! `file_matches`), applied to one path instead of a whole tree: dot names,
//! symlinks and ignored folders are never members; a folder holding a
//! `.craidd` marker is a nested-project boundary unless an explicit
//! include says otherwise; explicit includes and excludes win.
//!
//! Language file tables are supplied by the caller (the frontend's
//! `languageMeta`), so this module holds no second copy of them.
use std::path::{Component, Path, PathBuf};

use crate::commands::fs::{file_matches, membership_override};
use crate::commands::IGNORE_DIRS;
use crate::types::{CraiddProject, CraiddSolution};

#[derive(Clone, Debug, Default)]
pub(crate) struct LanguageFiles {
    /// Primary plus interop extensions, as `projectExtensions` returns them.
    pub extensions: Vec<String>,
    pub well_known: Vec<String>,
}

/// Filesystem facts the rules need. Production reads the disk; tests script it.
pub(crate) trait TreeProbe {
    fn has_craidd_marker(&self, dir: &Path) -> bool;
    fn is_symlink(&self, path: &Path) -> bool;
}

// Constructed by the Stage 1b router command; tests use it already.
#[allow(dead_code)]
pub(crate) struct DiskProbe;
impl TreeProbe for DiskProbe {
    fn has_craidd_marker(&self, dir: &Path) -> bool {
        std::fs::read_dir(dir).map(|entries| entries.flatten().any(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Matches what the Explorer can see: no dot names, no symlinks.
            !name.starts_with('.') && name.ends_with(".craidd")
                && entry.file_type().is_ok_and(|kind| kind.is_file())
        })).unwrap_or(false)
    }
    fn is_symlink(&self, path: &Path) -> bool {
        std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Facet { Main, Config }

#[derive(Debug)]
pub(crate) enum Ownership<'a> {
    Owned { project: &'a CraiddProject, facet: Facet },
    NotOwned,
    /// More than one project claims the file equally. Nothing is guessed.
    Ambiguous(Vec<&'a CraiddProject>),
}

/// Lexical join and normalisation, like the frontend's `resolveRelPath`.
pub(crate) fn resolve_rel(base: &Path, relative: &str) -> PathBuf {
    let joined = if relative.starts_with('/') { PathBuf::from(relative) } else { base.join(relative) };
    let mut out = PathBuf::from("/");
    for component in joined.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::ParentDir => { out.pop(); }
            Component::RootDir | Component::CurDir | Component::Prefix(_) => {}
        }
    }
    out
}

/// The project's main folder: the `.craidd` file's folder plus `root`,
/// exactly as `projectFolderAbs` in `solutionStore.ts` computes it.
pub(crate) fn project_folder(solution_root: &Path, project: &CraiddProject) -> PathBuf {
    let marker = resolve_rel(solution_root, &project.path);
    let folder = marker.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("/"));
    let root = project.root.trim_matches('/');
    if root.is_empty() || root == "." { folder } else { resolve_rel(&folder, root) }
}

fn config_folder(solution_root: &Path, project: &CraiddProject) -> PathBuf {
    let base = project_folder(solution_root, project);
    match project.config_directory.as_deref() {
        None | Some(".") => base,
        Some(directory) => {
            let resolved = resolve_rel(&base, directory);
            if resolved.starts_with(solution_root) { resolved } else { base }
        }
    }
}

struct Membership { explicit: bool }

/// Whether `file` is in the tree rooted at `root`, under the Explorer's rules.
fn membership(file: &Path, root: &Path, files: &LanguageFiles, includes: &[String], excludes: &[String],
    probe: &dyn TreeProbe) -> Option<Membership> {
    let relative = file.strip_prefix(root).ok()?;
    let parts: Vec<String> = relative.components().map(|part| match part {
        Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
        _ => None,
    }).collect::<Option<_>>()?;
    let (name, folders) = parts.split_last()?;
    let mut inherited = None;
    let mut path = root.to_path_buf();
    for (depth, folder) in folders.iter().enumerate() {
        path.push(folder);
        if folder.starts_with('.') || IGNORE_DIRS.contains(&folder.as_str()) || probe.is_symlink(&path) { return None; }
        let key = parts[..=depth].join("/");
        inherited = membership_override(&key, probe.has_craidd_marker(&path), includes, excludes, inherited);
    }
    if name.starts_with('.') || name.ends_with(".craidd") || probe.is_symlink(file) { return None; }
    let forced = membership_override(&parts.join("/"), false, includes, excludes, inherited);
    let member = forced.unwrap_or_else(|| file_matches(name, &files.extensions, &files.well_known));
    member.then_some(Membership { explicit: forced == Some(true) })
}

/// Resolve the project that owns `file` (absolute, lexically normalised).
/// Precedence: an explicit include beats default membership; then the
/// deepest folder; the main facet beats the config facet of one project.
/// A remaining tie is `Ambiguous`, never a silent pick.
pub(crate) fn owning_project<'a>(solution: &'a CraiddSolution, file: &Path,
    languages: &dyn Fn(&str) -> Option<LanguageFiles>, probe: &dyn TreeProbe) -> Ownership<'a> {
    let solution_root = resolve_rel(Path::new("/"), &solution.root);
    let file = resolve_rel(Path::new("/"), &file.to_string_lossy());
    let mut best: Vec<(&CraiddProject, Facet, bool, usize)> = vec![];
    for project in solution.projects.iter().filter(|project| !project.missing) {
        let mut claims = vec![];
        if let Some(language) = project.language.as_deref().filter(|language| *language != "config") {
            let root = project_folder(&solution_root, project);
            let files = languages(language).unwrap_or_default();
            if let Some(found) = membership(&file, &root, &files, &project.main_include, &project.main_exclude, probe) {
                claims.push((Facet::Main, found.explicit, root.components().count()));
            }
        }
        if project.config_enabled {
            let root = config_folder(&solution_root, project);
            let files = LanguageFiles { extensions: languages("config").unwrap_or_default().extensions, well_known: vec![] };
            if let Some(found) = membership(&file, &root, &files, &project.config_include, &project.config_exclude, probe) {
                claims.push((Facet::Config, found.explicit, root.components().count()));
            }
        }
        // One project, two facets: main wins.
        if let Some((facet, explicit, depth)) = claims.into_iter().min_by_key(|claim| claim.0 != Facet::Main) {
            best.push((project, facet, explicit, depth));
        }
    }
    let rank = |claim: &(&CraiddProject, Facet, bool, usize)| (claim.2, claim.3, claim.1 == Facet::Main);
    let Some(top) = best.iter().map(rank).max() else { return Ownership::NotOwned; };
    let winners: Vec<_> = best.iter().filter(|claim| rank(claim) == top).collect();
    match winners.as_slice() {
        [(project, facet, ..)] => Ownership::Owned { project, facet: *facet },
        many => Ownership::Ambiguous(many.iter().map(|claim| claim.0).collect()),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::HashSet;

    pub(crate) fn project(name: &str, path: &str, language: &str) -> CraiddProject {
        serde_json::from_value(serde_json::json!({
            "id": name, "name": name, "language": language, "root": ".", "path": path,
            "folder": Path::new(path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        })).unwrap()
    }
    pub(crate) fn solution(projects: Vec<CraiddProject>) -> CraiddSolution {
        serde_json::from_value(serde_json::json!({ "name": "s", "root": "/ws", "projects": [] }))
            .map(|mut solution: CraiddSolution| { solution.projects = projects; solution }).unwrap()
    }
    pub(crate) fn languages(language: &str) -> Option<LanguageFiles> {
        let (extensions, well_known): (&[&str], &[&str]) = match language {
            "rust" => (&["rs"], &["Cargo.toml", "Cargo.lock"]),
            "typescript" => (&["ts", "tsx", "mts", "cts", "d.ts", "js", "jsx", "mjs", "cjs"], &["tsconfig.json"]),
            "config" => (&["json", "toml", "yaml", "yml", "ini", "conf"], &[]),
            _ => return None,
        };
        Some(LanguageFiles { extensions: extensions.iter().map(|e| e.to_string()).collect(),
            well_known: well_known.iter().map(|e| e.to_string()).collect() })
    }

    #[derive(Default)]
    pub(crate) struct Scripted { pub markers: HashSet<PathBuf>, pub links: HashSet<PathBuf> }
    impl TreeProbe for Scripted {
        fn has_craidd_marker(&self, dir: &Path) -> bool { self.markers.contains(dir) }
        fn is_symlink(&self, path: &Path) -> bool { self.links.contains(path) }
    }

    fn owner<'a>(solution: &'a CraiddSolution, file: &str, probe: &Scripted) -> Option<(&'a str, Facet)> {
        match owning_project(solution, Path::new(file), &languages, probe) {
            Ownership::Owned { project, facet } => Some((project.name.as_str(), facet)),
            Ownership::NotOwned => None,
            Ownership::Ambiguous(found) => panic!("ambiguous: {:?}", found.iter().map(|p| &p.name).collect::<Vec<_>>()),
        }
    }

    #[test]
    fn language_comes_from_the_project_not_the_extension() {
        let config = project("cfg", "tools/tools.craidd", "config");
        let s = solution(vec![project("app", "app/app.craidd", "rust"), config]);
        let probe = Scripted::default();
        assert_eq!(owner(&s, "/ws/app/src/main.rs", &probe), Some(("app", Facet::Main)));
        assert_eq!(owner(&s, "/ws/app/Cargo.toml", &probe), Some(("app", Facet::Main)));
        // A .rs file in a Config project, or outside every project, has no owner.
        assert_eq!(owner(&s, "/ws/tools/gen.rs", &probe), None);
        assert_eq!(owner(&s, "/ws/loose.rs", &probe), None);
        assert_eq!(owner(&s, "/ws/app/notes.txt", &probe), None);
    }

    #[test]
    fn explorer_exclusions_apply_to_single_paths() {
        let s = solution(vec![project("app", "app/app.craidd", "rust")]);
        let probe = Scripted { links: HashSet::from([PathBuf::from("/ws/app/linked")]), ..Default::default() };
        for hidden in ["/ws/app/.hidden/x.rs", "/ws/app/target/debug/x.rs", "/ws/app/node_modules/x.rs",
            "/ws/app/linked/x.rs", "/ws/app/.x.rs", "/ws/app/app.craidd"] {
            assert_eq!(owner(&s, hidden, &probe), None, "{hidden}");
        }
        assert_eq!(owner(&s, "/ws/app/src/../src/lib.rs", &probe), Some(("app", Facet::Main)));
    }

    #[test]
    fn nested_projects_are_boundaries_unless_explicitly_included() {
        let mut outer = project("outer", "outer.craidd", "rust");
        let inner = project("inner", "crates/inner/inner.craidd", "rust");
        let probe = Scripted { markers: HashSet::from([PathBuf::from("/ws/crates/inner")]), ..Default::default() };
        let s = solution(vec![outer.clone(), inner.clone()]);
        assert_eq!(owner(&s, "/ws/crates/inner/src/lib.rs", &probe), Some(("inner", Facet::Main)));
        assert_eq!(owner(&s, "/ws/src/main.rs", &probe), Some(("outer", Facet::Main)));
        // An explicit include crosses the boundary and wins over depth.
        outer.main_include = vec!["crates/inner/src/lib.rs".into()];
        let s = solution(vec![outer, inner]);
        assert_eq!(owner(&s, "/ws/crates/inner/src/lib.rs", &probe), Some(("outer", Facet::Main)));
        assert_eq!(owner(&s, "/ws/crates/inner/src/other.rs", &probe), Some(("inner", Facet::Main)));
    }

    #[test]
    fn explicit_excludes_remove_files_and_folders() {
        let mut app = project("app", "app/app.craidd", "rust");
        app.main_exclude = vec!["generated".into(), "src/skip.rs".into()];
        app.main_include = vec!["generated/keep.rs".into()];
        let s = solution(vec![app]);
        let probe = Scripted::default();
        assert_eq!(owner(&s, "/ws/app/generated/x.rs", &probe), None);
        assert_eq!(owner(&s, "/ws/app/generated/keep.rs", &probe), Some(("app", Facet::Main)));
        assert_eq!(owner(&s, "/ws/app/src/skip.rs", &probe), None);
    }

    #[test]
    fn config_facet_is_ownership_but_main_wins_and_ties_are_reported() {
        let mut app = project("app", "app/app.craidd", "rust");
        app.config_enabled = true;
        let s = solution(vec![app]);
        let probe = Scripted::default();
        assert_eq!(owner(&s, "/ws/app/settings.json", &probe), Some(("app", Facet::Config)));
        assert_eq!(owner(&s, "/ws/app/Cargo.toml", &probe), Some(("app", Facet::Main)));
        // Two projects in one folder claiming the same file are not guessed between.
        let s = solution(vec![project("a", "x/x.craidd", "typescript"), project("b", "x/x.ts.craidd", "typescript")]);
        assert!(matches!(owning_project(&s, Path::new("/ws/x/a.ts"), &languages, &probe), Ownership::Ambiguous(found) if found.len() == 2));
        // Two languages in one folder: the extension decides membership, not routing.
        let s = solution(vec![project("r", "x/x.craidd", "rust"), project("t", "x/x.typescript.craidd", "typescript")]);
        assert_eq!(owner(&s, "/ws/x/main.rs", &probe), Some(("r", Facet::Main)));
        assert_eq!(owner(&s, "/ws/x/main.ts", &probe), Some(("t", Facet::Main)));
    }

    #[test]
    fn single_path_answers_match_the_explorer_tree_on_disk() {
        use crate::commands::fs::read_dir_tree_filtered;
        let root = std::env::temp_dir().join(format!("craidd-owner-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        for dir in ["src/nested", "crates/inner/src", "target/debug", ".hidden", "docs"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        for file in ["app.craidd", "Cargo.toml", "src/main.rs", "src/nested/deep.rs", "src/readme.txt",
            "crates/inner/inner.craidd", "crates/inner/src/lib.rs", "target/debug/build.rs", ".hidden/x.rs",
            "docs/keep.md", "src/skip.rs"] {
            std::fs::write(root.join(file), "").unwrap();
        }
        std::os::unix::fs::symlink(root.join("src"), root.join("src-link")).unwrap();
        let includes = vec!["docs/keep.md".to_string(), "crates/inner/src/lib.rs".to_string()];
        let excludes = vec!["src/skip.rs".to_string()];
        let rust = languages("rust").unwrap();
        let tree = read_dir_tree_filtered(root.to_string_lossy().into_owned(), rust.extensions.clone(),
            rust.well_known.clone(), Some(true), Some(false), Some(includes.clone()), Some(excludes.clone())).unwrap();
        fn files(node: &crate::types::FileNode, out: &mut HashSet<String>) {
            if node.kind == "file" { out.insert(node.path.clone()); }
            for child in node.children.iter().flatten() { files(child, out); }
        }
        let mut shown = HashSet::new();
        files(&tree, &mut shown);
        let mut candidates = vec![];
        fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if entry.file_type().unwrap().is_dir() { walk(&path, out) } else { out.push(path) }
            }
        }
        walk(&root, &mut candidates);
        candidates.push(root.join("src-link/main.rs"));
        for file in candidates {
            let relative = file.strip_prefix(&root).unwrap().to_string_lossy().into_owned();
            let member = membership(&file, &root, &rust, &includes, &excludes, &DiskProbe).is_some();
            assert_eq!(member, shown.contains(&relative), "{relative}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
