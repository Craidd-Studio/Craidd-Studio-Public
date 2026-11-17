# Solutions and Projects

## The solution-first model

A `.cln` solution groups projects and their configurations. A `.craidd` marker
identifies a project's language and root, with optional configuration and
membership facets. Ecosystem manifests such as `Cargo.toml`, `package.json`,
`*.csproj` and `CMakeLists.txt` remain the source of build/dependency facts.

The target project model and the current serialized format differ in places.
Use the UI for ordinary configuration; consult [the model contract](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/craidd-cln-model.md)
before hand-editing metadata or implementing a migration.

## Create a new project

Choose **Create Project Wizard** on Getting Started. Pick an available template,
configure its name/location, review the file preview and create it. Entries
marked **Planned** are visible proposals and cannot be created yet.

Available templates include Rust Empty/Console and Tauri v2 + React;
C# Empty/Console and ASP.NET Core Web API; and C++ Empty/Console. Scaffolding a
framework does not install its dependencies or prove its full debugger journey.

From an open solution, the existing **Project → Add → New Blank Project…**
entry opens the project-creation flow. Review whether to add to the current
solution and which Power configurations will be written.

## Declare existing code

1. Open its containing folder.
2. Find the intended project folder in **File Discovery**.
3. Right-click and choose **Make This a Project…**.
4. Review the suggested language and confirm the declaration.

File Discovery shows disk contents; Solution Explorer shows the declared project
view. A file absent from a language-filtered project tree may still exist on disk.
Declaring a language does not enable an unimplemented language-server integration.

## Configure and launch

Use the toolbar configuration selector to review inferred configurations and
add explicit Build/Run/Debug entries. Review the selected project and command
before launching. A template's generated manifests become user-owned files;
project creation is not permission to regenerate an existing application's code.

Next: [Linked Windows](Linked-Windows) or [Debugging and LDI](Debugging-and-LDI).

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
