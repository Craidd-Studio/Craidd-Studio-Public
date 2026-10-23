# Phase 3.5: Profiler analysis UI and proposed symbol follow-ups

Craidd Studio is a Linux polyglot IDE. Profiling collectors, native stack samples and imported measurements have distinct payloads and explicit coverage; sharing a Profiler does not align clocks or prove root causes.

## Current local state

`codex/profiling-profiler-ui` starts at perf `464e407` and includes M1 `3059ea1` as cherry-pick `ad656c7`. The new UI implements timed perf controls/trees and chart-first M1 inspection. Nothing is pushed or merged. M1 and perf original branch refs remain unchanged. Pre-existing dirty `gr-001-m1-results.md` and `gr-001-m1-uiux.md` are preserved byte-for-byte and excluded from the UI commit.

Read [UI implementation/gates](../feats/profiling/revisions/profiler-analysis-ui-results.md), [interface design](../feats/profiling/design-profiler-analysis-ui.md), [metric reference](../feats/profiling/design-metric-inspection-editor.md) and [source contract](../feats/profiling/design-profile-source-contract.md). The UI is available in the embedded debug build under `src-tauri/target/debug/craidd-studio`; do not mistake it for a release build or the user's previously launched binary.

Native/parser and real desktop checks are separate. Actual desktop controls capture DWARF 99 Hz on the 200,000-symbol fixture, stop safely, navigate verified source, filter/expand both trees, pin and reopen. FP 999 Hz owning-window close preserves the target and partial raw data. M1 tests exercise unit suggestions/bulk edits, ranking keys, declared companions, chart/original-row linkage and immutable reopening. The initial null-summary crash is fixed and covered. Row table IPC has bounded, flagged text previews; inspecting a row retains complete original cells.

Human acceptance, native chooser/screen-reader/scaled-desktop checks and million-row release-build latency/memory on this layout remain open. The mini chart overview, dock resizing and descriptive selection cards remain proposed. Keep the separate whole-IDE baseline issue outside M1/UI fixes.

## Follow-ups, in priority order

1. Human UI review using the [M1 checklist](../feats/profiling/revisions/gr-001-m1-human-acceptance.md) and [perf checklist](../feats/profiling/revisions/gr-002-perf-ui-human-acceptance.md). Then qualify release interactions/memory and requested accessibility/display scales before public-release acceptance. Do not silently inherit old layout performance results.
2. GR-003 [source review/qualification](../feats/profiling/revisions/gr-003-gr-004-qualification.md) and [proposed delivery](../feats/profiling/revisions/gr-003-symbol-locations.md). Actual fixture-only private-cache resolution works for unrelated and renamed debug files, rejects a decoy and leaves ~/.debug unchanged. Production settings, served-file hash contract, reopen/source checks and retention integration are still proposed. Suggested scope is per-solution explicit locations first, without engine path heuristics or a user-wide list.
3. GR-004 [proposal](../feats/profiling/revisions/gr-004-embedded-mono-maps.md). The test-only embedded Mono helper writes a secure map, survives a missing export with one diagnostic, and gives 0%→100% raw-leaf known-method naming. Full-stack decode omits the known JIT leaf in both modes: FAIL. Qualify leaf preservation and coverage semantics before launch integration. No helper is shipped, no runtime workaround was built and no attach environment changed. Proposed packaging is reviewed prebuilt architectures, with an explicit experimental run-configuration option; these decisions await review.

M2/M3 remain approved in order but wait behind timed perf. Flight recording stays excluded; .NET ordinary map naming remains FAIL and live PID reuse remains the accepted environmental BLOCKED gate. No further W^X-off diagnostic is authorized by the earlier one-off request.

## Reproduction

Build with `npm run test:ui:build`. The opt-in desktop test is `CRAIDD_TEST_PROFILER_ANALYSIS=1 CRAIDD_PERF_UI_BUILD=/tmp/craidd-perf-20261023-large-build node --test tests/ui/profiler-analysis.test.mjs`; use an existing large-symbol fixture build or generate one with its owned qualification script. The convenience entry is `CRAIDD_PERF_UI_BUILD=/tmp/craidd-perf-20261023-large-build npm run test:ui:profiler-analysis`. Without a fixture build only the metric branch runs, and perf gates remain NOT TESTED. Historical metric UX/import/release harnesses still encode the earlier layout; their selectors need updating before reuse on this UI. The release-performance gate is explicitly open. Ordinary display uses GDK_BACKEND=x11 on this Wayland host; Xvfb is a separate run. The harness isolates HOME/cache and never controls the user's IDE instance. Never launch the fixture under the driver's owned process group; target survival is an acceptance observation.

GR-003/004 fixture runners and bounded JSON live in `workspaces/profiling-symbol-locations` and `workspaces/profiling-embedded-mono`. Their raw/build outputs stay in the recorded /tmp paths. Each runner uses only the current user and disables debuginfod; no sysctl, capability or privileged perf changes. The Mono helper is qualification code only and needs hardening before a release proposal can become implementation.

Next opening prompt: “Read this handoff and its UI/GR-003/004 gate records. Verify local branch, dirty-doc hashes and binary provenance. Address the user's human UI feedback or qualify the remaining release gates. Keep GR-003/004 delivery decisions visibly proposed until reviewed; local commits only, no push/merge.”

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
