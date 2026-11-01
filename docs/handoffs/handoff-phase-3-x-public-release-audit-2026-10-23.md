# Public-release audit handoff

**Roadmap track:** Phase 3.x / 3.5 and the wider Linux IDE gate.
**Status:** Audit/refinement checkpoint, 23 October 2026. Release sign-off remains open.

Craidd Studio is a Linux polyglot IDE that discovers and delegates to external
tools. The user requested a broader performance/UI/UX release assessment across
profiling, debugging, project creation and other workflows. The project wizard
was one example, not the whole scope.

## Start here

1. [Readiness assessment](../releases/public-release-readiness-2026-10-23.md):
   source inventory, fresh results, failed/unrun gates and priorities.
2. [Quality gates](../uiux/public-release-quality-gates.md): source, automated
   desktop and human lanes; first-use, profiling, recovery and package tasks.
3. [Metric inspection refinement](../feats/profiling/design-metric-inspection-editor.md):
   the user-supplied concept and corrected interaction/statistical/layout rules.
4. [Portable evidence](../releases/evidence/2026-10-23/README.md): hashes,
   commands, measurements, retained failures and selected screenshots.

The visual concept passes as a direction. It does not pass implementation,
keyboard/accessibility, real-data interpretation or human release acceptance.
Keep imported analysis in the existing Profiling editor and retain the IDE
shell. Do not adopt the image's extra outer rail or invalid percentile-summary
labels. Standard Gold/process profiling keeps its existing hosts.

## Source ownership

This audit starts at `8bac01e` in the `f6d4` checkout. CSV M1 is separately at
`3059ea1`; timed perf at `464e407`. They are not one integrated candidate. The
actual template wizard is dirty/untracked work in `d667`, based on `ac78384`;
the named `feat/create-project` ref does not contain it. Temporary snapshots
were tested without editing those original worktrees. Their preserved hashes
are in the evidence. Do not overwrite the two dirty CSV result/UIUX documents.

The only tracked code repair is the Markdown browser fixture's typed file-tab
identity and active tab. Both existing browser regressions pass afterward.
Production profiler/debugger UI was not redesigned or repaired by this audit.
No commit, push, merge, package publication or new human acceptance occurred.

## Findings to carry forward

- Core frontend/backend checks pass within each tested source snapshot.
  The copied wizard additionally passes native Rust Create/review/open/Run,
  breakpoint/Continue/completion. Other language/framework paths retain their
  stated toolchain and desktop gaps.
- The baseline full desktop harness initially passes 8/12. Hover and Explorer
  edge placement fail; source confirms missing debugger hover registration and
  raw cursor-coordinate menu placement. Targeted quiet Unity repeats pass, but
  the standalone 633.267-second sustained run fails with 155 source gaps at
  rollover (2,400 retained samples, one aged). Its later snapshot/replay tail
  is not reached. Keep the full counter record;
  do not equate rolling eviction with missing events or erase failures with a
  later passing short run.
- CSV's optimized release/Xvfb checks pass, including million-row handling,
  per-operation p95, snapshots, cancellation and owner-window recovery. Its
  older human usability FAIL remains. Whole-IDE memory is separate from the
  passing incremental-memory gate.
- Timed-perf backend/native/IPC qualification is scoped evidence. Its actual
  capture/tree UI, accessibility and human gates remain open; normal .NET map
  naming remains failed. Flight recording and CSV M2/M3 are outside this slice.
- External LSP and the roadmap's complete first-user language journey,
  integrated-candidate/package tests and ordinary-display/human checks remain
  release work. The assessment deliberately assigns no completion percentage.

## Next concrete work

Use the assessment's ordered table. First establish the intended integrated
candidate and review bounded hover/menu repairs plus the detailed metric
interaction/responsive states. Diagnose source gaps using send-result/errno,
sequence/time/rate and collector-drain evidence before changing transport or
buffers. Preserve producer responsiveness and explicit loss reporting.

Run the exact failing regressions after a repair, then the candidate harness.
Run real latency/overhead measurements serially after builds. Build the embedded
binary after Cargo tests and freeze its hash/path before UI execution. Do not
replace a running test binary with another branch's build. Native DAP fixture
tools expect their own Cargo target path; the audit's target override initially
broke that assumption and the corrected-environment repeat passed.

Suggested opening prompt: “Read AGENT.md and its required documents, then the
23 October public-release assessment and this handoff. Preserve the separate
feature worktrees and dirty files. Review the smallest source-backed fixes for
missing debugger hover and edge-menu placement, and the next metric inspection
UI slice. Keep source, desktop and human acceptance separate.”

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
