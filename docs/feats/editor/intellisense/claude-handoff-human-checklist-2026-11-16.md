# Claude handoff: critical editor buffer replacement

> Checkpoint, 17 November 2026: the original findings below predate repair
> `e6927b4`. Its independent re-check is recorded in `f22844e` in the
> [results record](results-lsp-stage-1.md#re-check-of-the-buffer-identity-repair-fixlsp-buffer-identity-at-e6927b4-2026-11-16-harness-observed-pending-user-review).
> The reproduction no longer occurred in the automated runs; human re-check
> and Stage 1 acceptance remain open. See the
> [Phase 3 checkpoint](checkpoint-phase-3-stage-1-2026-11-17.md) for current status.

Status: human checklist blocked. Branch: feat/intellisense-ws.
Read AGENT.md and the repository working protocol first. Preserve existing
uncommitted docs and any live unsaved user buffers. No fixes were applied by
Codex; this handoff records human evidence, not an automated reproduction.

## Required reading

- [Checklist with scoped results](human-checklist.md).
- [Human findings, especially section 11 and final recovery](human-findings-2026-11-16.md).
- [Future library-source proposal](../../../future/future-library-source-customisation.md).
- [Last-solution UX requirement](../../../uiux/design-public-release-sweep.md#public-release-alpha-closing-the-last-solution).

## Priority 1: prevent cross-document replacement/data loss

During external HashMap navigation, References viewing and editing, the user's
main.rs buffer became the HashMap/map.rs implementation. main.rs was dirty;
map.rs had a lock and dirty dot and produced a save-conflict dialog with an
Overwrite action. The user reports repetition around Shift+F12. Exact action
ordering is not established. Ctrl+Z restored main.rs; final screenshot shows
fixture contents recovered with no dirty dot. Actual disk overwrite is unproven.

Reproduce in disposable fixture copies with distinct document contents. Preserve
the supplied evidence before changing anything. Inspect Monaco model URI, active
file identity, callback lifetime, controlled values and options across navigation,
References preview edits and tab switches. CodeView.tsx currently binds Editor
path/value to active.fileId/active.content, while its onChange callback routes
text to a captured activeFileId. This is a lead, not a proven root cause.
Inspect SideEditor, LSP navigation, model lifecycle, store update and save paths
and backend read-only enforcement too. Check delayed responses and stale source
identities; do not assume making the preview read-only fully fixes the corruption.

Implement a focused fix once the failure is understood. Add meaningful regression
coverage proving distinct buffers cannot cross-contaminate, external source
cannot become writable/saveable during navigation, and delayed changes cannot
write through an old file identity. Exercise Shift+F12, F12, preview edits, tab
switches and undo; verify no shared SDK/package files were modified.

The user agreed References previews should reject typing and offer
“Read-only preview · Open editable source”, opening/focusing project source at
the selected location. External read-only source must explain its restriction
without promising an editable version. Coordinate this UX change with the
identity fix rather than using it as the only protection.

## Remaining issues and agreed policy

External disk changes sometimes left diagnostics stale until main.rs was
activated; dirty buffer/reload behaviour remains unresolved. User reports Run
silently replacing an older dirty buffer with disk. Preserve buffers and respect
the agreed policy in findings section 7: dirty buffer + unchanged disk → save
then build; clean matching buffer → build disk; externally changed disk → do
not save older buffer, build disk with notice and explicitly identify disk-based
diagnostics; dirty + external changes → explicit conflict handling, no overwrite.

Older LIVE · RUSTC errors survived unsaved corrections and cleared on save. Do
not misreport this as proven rust-analyzer text-sync failure. Investigate result
freshness/source labelling, save-time recount and cross-window counts. Separate
paste indentation, Documentation Browser and library-copy proposals from the
critical repair. Last-solution exit should reveal one Getting Started window;
Exit Application should still quit.

## Acceptance and test conduct

Only 5.2, 5.3, 6.1 and C.2 are checked, each with caveats. C.3's initial read-only
success was reopened. Remaining items are partial, failed or untested. Do not
close stage gates or mark the full checklist complete. After repair, provide
precise human retest steps for corruption/read-only safety before resuming C.4.

Do not use the previous window-sharing capture method: user established that
it interfered with input. Do not edit the watched checkout during an active
human round; docs edits previously triggered Tauri rebuilds and a false crash
report. Use disposable automated runs and /tmp notes during live tests. Do not
restart/kill a live session or overwrite user buffers without coordination.

*Last updated: Phase 3 / Public Release Alpha human testing, 16 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
