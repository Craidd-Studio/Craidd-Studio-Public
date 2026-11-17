# Phase 3 checkpoint: IntelliSense Stage 1

**Date:** 17 November 2026.
**Branch:** `feat/intellisense-ws`, implementation and independent record through `f22844e`.
**Phase:** Phase 3, language intelligence through external language servers.
**Stage:** Rust Stage 1; Stage 1b diagnostics/lifecycle and Stage 1c providers
implemented as an experiment, with human acceptance still incomplete.

## Current behavior and evidence

The branch contains the external rust-analyzer client, document synchronization,
diagnostics, hover, symbols, definition, references and completion, plus read-only
external-source navigation. This is a Rust slice, not multi-language qualification.

Critical buffer-identity repair `e6927b4` routes model changes by the changed
model's identity, protects read-only models and References previews, refuses
Save As for read-only tabs, and protects LSP-served files from backend writes.
Independent record `f22844e` reports the original reproduction clean in six runs,
plus typing/undo, split-editor, restart/rebind and edit/save variants. The
References Enter-navigation variant was inconclusive. These are automated
observations pending user review, not human sign-off.

The [results record](results-lsp-stage-1.md) is authoritative for automated
observations. Earlier summaries and the preserved 16 November human findings
are historical snapshots; they do not supersede the repair re-check.

## Human acceptance and next work

The [human checklist](human-checklist.md) records scoped passes only for 5.2,
5.3, 6.1 and C.2. Repeat C.3 and the critical navigation/reference/edit/undo/save
sequence on the repaired build before resuming C.4. Do not mark Stage 1 complete.

Remaining concerns include dirty buffers during Run, external-change reload and
diagnostic freshness, save-time recount and cross-window totals, plus untested
linked-window launch/park/restore and completion/read-only lifecycle cases.
Closing the last solution should show Getting Started; that is a recorded Alpha
UX requirement, not an implemented fix. Library-source customization remains a
future proposal.

Preserved context:

- [Human findings and screenshots](human-findings-2026-11-16.md).
- [Original repair handoff](claude-handoff-human-checklist-2026-11-16.md).
- [Last-solution UX requirement](../../../uiux/design-public-release-sweep.md#public-release-alpha-closing-the-last-solution).
- [Future library-source customization](../../../future/future-library-source-customisation.md).

## Integration qualification

Checked in the isolated local lane `/tmp/craidd-intellisense-merge-20261117`,
starting at local `master` `4626729` and fast-forwarded to `f22844e`. Source
code is unchanged by this documentation checkpoint. Refreshed `origin/master`
remains `5556289`, also an ancestor. No conflict resolution is needed.

- `npm run build`: passed (existing bundle-size/dynamic-import warnings).
- `node --test tests/*.test.mjs`: all 28 test files passed.
- Existing headless Monaco `run.sh buffer` probe: all seven reported checks
  passed, including forced read-only-model edits, tab switching and undo.
- `cargo test --offline --lib`: 258 passed, 10 ignored, one failed:
  `ldi_pair_requires_selected_managed_debug_and_library_build_slots`.
  It reports that the host needs an installed debugger; `netcoredbg` is absent.
  This is the same environmental failure recorded in the prior re-check.
  The test's `linked_windows.rs` is unchanged from local `master`.
- `git diff --check`: passed.

Logs are `/tmp/craidd-intellisense-{build,node,rust,buffer}.log` (temporary local
artifacts). No fresh native desktop acceptance run was performed. The browser
probe exercises real Monaco, not the whole Tauri application. Local integration
preserves an experimental checkpoint; it does not establish Stage 1 acceptance
or public release readiness. No push is part of this checkpoint.

*Last updated: Phase 3, Stage 1 checkpoint, 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
