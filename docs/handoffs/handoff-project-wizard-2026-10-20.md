# Create Project Wizard: implementation handoff

**Roadmap track:** IDE project creation; separate from the Phase 3.x debugger acceptance gates.

**Status:** First implementation, 20 October 2026. Basic/framework scaffolds are implemented; native interop templates remain planned.

## Purpose and agreed scope

Craidd Studio is a Linux polyglot IDE that delegates to installed tools. Its new
project flow now separates creation from opening an existing folder. The user
approved a searchable language/template browser, project configuration, and a
file/configuration review before creation. This first pass covers basic and
framework templates; native/LDI templates follow separately.

Available templates:

- Rust: Empty Project, Console Application, Tauri v2 + React/TypeScript.
- C#: Empty Project, Console Application, ASP.NET Core Web API.
- C++: Empty Project, Console Application using CMake/C++17.

Rust + C/C++, Tauri + native libraries, C# + native console/API libraries, and
ASP.NET + Blade GUI are visible as **Planned**. They cannot be created. Blade's
framework/hosting model still needs definition. Visibility is not LDI support.

## Implemented behavior

The startup button opens the wizard before choosing a folder. Existing solution
New Project entry points use the same wizard. The destination is `parent/name`:
its parent may contain files, but the destination must be absent or empty,
including hidden files. File and symlink destinations are refused.

The Rust backend generates a read-only preview and recomputes it on creation.
A plan token rejects changed solution metadata between review and creation.
Writes use exclusive file creation. Failed attempts remove only files and
folders reserved by that attempt, without recursive deletion of user data.

All scaffolds are local. Creation runs no commands and downloads nothing.
Tauri includes an explicit npm installation configuration; npm/Cargo restores
happen later, visibly, through ordinary tool actions. SDK/Node versions and
Tauri system libraries are not certified by the PATH presence check.

Empty Project creates only `.craidd` and, for standalone projects, `.cln`.
Executable templates optionally save Power configurations, including action
slots and Debug/Release profiles for Rust/.NET. CMake's first configuration is
Debug and uses existing ordered preparation to configure/build before running.
Tauri Debug targets Rust and uses existing Vite server preparation; JavaScript
frontend debugging is not provided.

Generated markers and solution files use the **current implemented schema**:
`[solution].projects`, `[[config]]`, profiles, action slots, and order references.
This does not migrate the target project model. Generation is a one-shot
creation exception to the existing-manifest read-only rule in
[tool discovery](../philosophies/ide_editor/tool-discovery/philosophy-tool-discovery.md).

Adding a project preserves existing solution comments, unknown tables, project
entries, configurations and defaults. The review includes the updated solution
text. Reloading that same solution preserves editor buffers and active tab.
Creating a separate solution from an open editor opens another window.

## Evidence and remaining gates

- Frontend production build passes. Existing chunk-size/dynamic-import warnings remain.
- Frontend suite: 87 tests pass with `node --test --test-isolation=none tests/*.test.mjs`.
- Focused frontend regression: `npm run test:project-wizard` covers filtering,
  name validation, and preservation of unsaved buffers during solution reload.
- Rust suite: 151 pass, 5 ignored (including the opt-in fixture generator).
  The existing HTTP readiness test needs permission to bind a local socket.
- Backend tests create/reload all eight available templates, check saved action
  references/build-order expansion, refuse planned/traversal/symlink/nonempty
  destinations, recheck after preview, and preserve existing solution metadata.
- Generated Rust and C++ consoles build and print their greetings.
- Generated Tauri frontend production build and backend `cargo check --offline` pass.
- Browser inspection covers the language/template browser, disabled Planned
  creation, API configuration fields, name validation, and browser-only error state.
- C# compilation/runtime acceptance is **blocked on this host**: SDK 10.0.113
  requires Microsoft.NETCore.App 10.0.13; the installed runtime is 10.0.12.
  No SDK/runtime installation was changed.
- Native desktop Create → open → Build/Run/Debug acceptance remains **not tested**.
  Passing scaffold tests does not establish desktop/debugger acceptance.

## UI polish follow-up

The user requested recognizable language images and a final UI/UX polish pass.
The wizard now uses local Rust, C#, C++, React and .NET SVG assets from Devicon,
plus the existing Tauri logo. Source commit, hashes and the MIT notice are kept
in `public/language-icons/`. The monochrome Rust mark adapts to the IDE theme.

Template scrolling is independent of the language sidebar and detail panel on
desktop; narrow windows use a stacked layout. Typography, logo scale, selection
markers, form spacing and focus states were refined. Search selects a matching
result and disables Next when no results remain, with a Clear search action.
Available templates support double-click to configure. The configuration form
supports Enter to review and has an explicitly labelled location field.

The production build and all 87 frontend tests pass after the changes. Browser
inspection covered the desktop and 600px layouts, search selection/empty states,
double-click navigation and keyboard submission. This follow-up does not change
the creation backend or remove the desktop/runtime acceptance gaps above.

## Next session

Wire native interop scaffolds only after reviewing their build/install/debug
contracts. Keep plain interop examples separate from claims of LDI acceptance.
Do not replace the saved configuration engine with a wizard-specific scheduler.

Suggested opening prompt: "Read AGENT.md and its required documents, then
this handoff. Qualify the Create Project wizard in the desktop app, preserving
unsaved work. Review native/LDI template scope before implementing it."

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
