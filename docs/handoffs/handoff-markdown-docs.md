# Handoff: Markdown / Docs

**Status:** Initial implementation in source, 20 October 2026. No commit or
native desktop acceptance is implied by this record.

Craidd is a Linux polyglot IDE whose documents carry the design. This change
adds repository documentation browsing/editing without new project declarations
or changes to the debugger roadmap.

## Locked scope

The user requested implementation of the earlier Markdown / Docs proposal and
selected source-preserving block editing within Preview. Rich text editing can
be expanded later if needed. Bold/Italic shortcuts and full Source control are
part of this first slice. A follow-up replaces the full view bar with a compact
`</>`/eye control beside the breadcrumb and handles formatting shortcuts for
rendered text selections, block fields and Source. The browser reproduction and
source-preserving selection limits are recorded in the implementation record. Docs provides browse/edit plus reveal; creation,
rename and deletion remain with File Discovery.

Read the [implementation record](../feats/editor/docs-viewer/implementation-markdown-docs.md)
for behavior, source preservation, rendering/asset policy, scan limits and
acceptance boundaries. The [original design](../feats/editor/docs-viewer/design-markdown-projects.md)
retains broader alternatives. Governing references remain [AGENT.md](../../AGENT.md),
[working protocol](../working-protocol.md), [roadmap](../roadmaps/Roadmap-v0.0.4A.md)
and [project model](../craidd-cln-model.md).

## Implementation map

- `DocumentView` wraps the existing `CodeView`, keeping Monaco mounted when
  Preview is displayed. Preview range edits use its model and undo stack.
- `MarkdownPreview` renders a full document, retaining reference definitions;
  an in-place block field updates the existing tab on every keystroke. Helpers
  apply offsets and formatting without round-trip serialization.
- `DocsBrowser` scans through shared `read_dir_children`, cancels stale work,
  prunes/filter/pins by real path and reveals files through the existing tree.
- `openWorkspaceFile` shares the existing hidden-window dirty-owner guard with
  FileTree, Docs and relative links. Save/conflict/close operations stay shared.
- Scoped Rust commands validate local document targets and load bounded raster
  image bytes without enabling broader asset access or weakening CSP.

## Evidence and next step

The implementation record distinguishes automated checks and the headless
browser's mocked IPC from native desktop evidence. The latter remains open.
Launch the actual IDE with:

```sh
npm run tauri dev
```

Select Docs, open a real document, edit a block, use Ctrl+B/Ctrl+I, switch to
Source, save, undo/redo, and exercise dirty close/external-change conflict.
Verify local images, relative links, unreadable directories and the incomplete
scan state. Test linked-window ownership and side-group edits on the native
runtime. Packaged/offline CSP and external opener behavior are separate gates.

Useful repeatable checks:

```sh
npm run test:docs
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib commands::fs::discovery_tests
```

The browser harness at `tests/fixtures/markdown-docs/` is test-only. Its runner
and environment options are documented in the implementation record.

## Remaining work and opening prompt

HTML/PDF viewers, opt-in `+++` fences, direct task toggling, docs-as-project,
full rich text editing and document-management actions in Docs are deferred.
A source/model mismatch refuses a Preview edit; do not normalize documents to
hide it. Existing unrelated documentation-navigation issues were not repaired.

Next-session prompt: “Read the Markdown / Docs implementation record and
handoff, then qualify the feature in the running Tauri app. Preserve the shared
source/undo/save contract. Report native evidence separately from browser mocks
and address reproduced failures before expanding to richer visual editing.”

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
