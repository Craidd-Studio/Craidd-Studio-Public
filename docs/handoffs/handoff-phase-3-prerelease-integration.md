# Prerelease integration: Phase 3, 3.x and 3.5

**Date:** 17 November 2026.
**Branch:** `codex/prerelease-integration`.
**Status:** Internal integration candidate. Not approved for public distribution,
not merged into `master`, and not pushed. Human acceptance remains open.

Craidd Studio is a Linux polyglot IDE which discovers and delegates to external
tools. This candidate brings the existing editor, debugger, profiling and
project-creation work together for a single-binary qualification round.

## Source inventory

| Source | Included work |
| --- | --- |
| `master` / `feat/intellisense-ws` at `d13d07c` | Rust LSP Stage 1 and the buffer-identity repair, human findings and checkpoint |
| `codex/profiling-profiler-ui` at `48e9c4d` | Native/Unity/Gold profiling, Profiler editor tab, CSV metrics, timed perf, analysis UI, symbols and experimental Mono mapping |
| `feat/unity/feat/csv-profiling` at `84794af` | Additional LDI declared-origin behavior, branding and Linux application identity |
| Preserved profiler working copy based on `48e9c4d` | Metric-row/table usability corrections and existing evidence, copied without changing the original |
| Wizard snapshot `b8fb239` | Template catalog, review/create flow and native project scaffolding |
| `uiux/ui-harness` at `280b1d8` | Debugger hover, measured menu placement, title handling and desktop tests |
| `verify/lsp-1c-step7-results` at `b1358bd` | Symlink/vendor routing, canonical holder and alias handling, plus its historical verification record |
| Audit snapshot `5e46f98` | Release quality gates and historical evidence |

The named `feat/create-project` branch does not contain the recovered wizard.
The profiler UI and CSV/Unity branches diverged; both histories are retained.
The earlier CSV/perf fixes are already included through these source histories,
including M1 fix `3059ea1` carried as `ad656c7`.

Twenty modified/untracked files from the profiler worktree were preserved with
SHA-256 hashes, integrated as `0a37717`, and checked against the unchanged
original worktree. The local backup and manifest are under
`/tmp/craidd-prerelease-profiler-preservation/`; the committed candidate retains
the files and portable evidence. No original worktree was reset or cleaned.

## Integration resolutions and safety repair

- File-only LSP/model routing excludes the typed Profiler workspace tab.
- Read-only navigation, Save/Save As refusals and backend write protection are
  retained. Monaco changes continue to route by the changed model's identity;
  captured-tab `onChange` routing was not restored.
- Both LSP and profiling managers/commands are registered. Toolchain scan keeps
  language-server identity checks and DotRush discovery.
- Gold actions retain their behavior while using measured menu placement.
- The newer desktop harness keeps private ports/profiles and owned-process
  cleanup; the older global-process-count exit assertion was not restored.
- Automatic reload before Run now refuses dirty/read-only files and checks that
  the tab is unchanged across the asynchronous read. Edits arriving during that
  read survive; launch pauses with a message if unsaved text remains. Explicit
  user-requested reload retains its separate discard behavior.

The reload race is covered by a new regression. It is a source-backed defect,
not a claim that every reported disk/editor/diagnostics issue has been resolved.
A combined regression also checks read-only source, dirty project text and a
Profiler workspace coexisting without write-through or lost identity.

## Current checks

- Production frontend build: PASS, existing chunk/import warnings retained.
- Node regressions: all 37 test files PASS.
- Rust library: 341 PASS, 13 ignored, one FAIL in
  `ldi_pair_requires_selected_managed_debug_and_library_build_slots` because
  the host lacks the required installed debugger (`netcoredbg`). This failure
  also occurred on the IntelliSense baseline. It is not a C# debugger pass.
- Native cleanup, embedded build and desktop checks: being qualified; record
  exact outcomes below rather than inheriting passes from source branches.

Temporary detailed logs use `/tmp/craidd-prerelease-*.log`. Historical reports
keep their original dates, binaries, failures and scopes. Their PASS rows do
not qualify this combined candidate.

## Release gates still open

Human buffer-safety/navigation re-check; dirty buffer and external disk conflict
behavior; LSP freshness/linked-window acceptance; metric orientation retry and
million-row performance; sustained Unity source-loss/rollover/replay; last-
solution Getting Started behavior; native chooser/scaling/accessibility;
clean-machine packaged startup; and the full supported-language journey.
Unity managed attach and Mono symbol naming retain their experimental limits.

Do not reinterpret a clean merge or short smoke as public release acceptance.
Use [release quality gates](../uiux/public-release-quality-gates.md) and the
[current IntelliSense checkpoint](../feats/editor/intellisense/checkpoint-phase-3-stage-1-2026-11-17.md).

## Next session

Read this handoff, AGENT.md, the working protocol and the current roadmap.
Continue on `codex/prerelease-integration`, preserving the original feature
worktrees. Inspect the validation record below and reproduce any failed case
on the exact candidate binary before fixing it. Do not edit or restart the
user's separate IntelliSense dev session. Keep automated, human and public
release acceptance distinct. Do not push, publish or advance master until the
candidate has passed the agreed gates and the user has reviewed it.

*Last updated: Phase 3 / 3.x / 3.5 prerelease integration, 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
