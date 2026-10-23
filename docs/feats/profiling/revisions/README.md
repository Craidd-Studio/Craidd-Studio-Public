# Generic profiling revisions

**Roadmap track:** Phase 3.5 profiling.
**Status:** Staged revisions, 23 October 2026. GR-001 M1 is source-implemented
with [automated acceptance](gr-001-m1-results.md) passing and human acceptance
still open. M2 then M3 remain approved but wait behind GR-002 timed capture.
GR-002 has [installed native timed evidence](perf-qualification-results.md);
its [timed slice](perf-timed-delivery-proposal.md) is approved, with [backend work](perf-timed-backend-results.md) separate from the pending UI design. [Many-thread retention](gr-002-many-thread-retention.md) supports the decision to exclude flight recording from this release. The [backend follow-up decisions](perf-backend-follow-up-decisions.md) record the accepted cap and next gates.

The [backend follow-up results](perf-backend-follow-up-results.md) report matched overhead, Mono/.NET naming, real debugger refusal, substituted files and the blocked live-reuse gate.

The [23 October scale/diagnostic record](perf-scale-and-dotnet-diagnostic-results.md) records the one W^X-off .NET diagnostic, 200,000-function native symbol scale, decoder memory and existing-IPC UI-thread independence. The normal .NET naming gate stays FAIL; UI delivery remains on hold.

The [candidate metric-inspection editor design](../design-metric-inspection-editor.md) preserves the user-supplied reference image, editor host, honest metric semantics and public-release acceptance gates; it is not UI implementation approval.
**Craidd baseline reviewed:** `feat/unity/debug-a-to-p` at `8bac01e`.

The [23 October M1 program-import fixes](gr-001-m1-program-import-fixes.md) cover
unit/statistic suggestions, bulk column interpretation and worst-row location
keys. They have separate automated and ordinary-desktop evidence; the layout
redesign and human public-release acceptance remain outside that checkpoint.

The [accepted implementation decisions](implementation-decisions.md) resolve
the defaults and stage delivery behind separate M1/M2/M3 reviews. Read the
[common source contract](../design-profile-source-contract.md) before coding.
[M1 human acceptance](gr-001-m1-human-acceptance.md) remains required before push/merge.
Original proposal questions below are historical where the addendum resolves them.

[Why metric CSV inspection belongs in the public release](why-metric-csv-inspection.md)
explains the recommended M1 scope, retained inspection state, editor-only
presentation and the distinction between useful scope and release acceptance.

These revisions arose during Unity work but apply to profiling any compatible
program. They extend the [attached-profiling design](../design-attach-profiling.md)
and the existing Profiler; they do not establish new collector support or
runtime acceptance.

| Revision | Proposal | Decisions still open |
| --- | --- | --- |
| [GR-001](gr-001-metric-csv-import.md) | Finished-file M1, followed by live generations (M2) and mapping/comparison (M3) after separate reviews | Automated M1 gates pass; human acceptance open; baseline-memory issue separate; project defaults and sidecars deferred |
| [GR-002](gr-002-external-pid-sampling-perf.md) | Native timed qualification first; later large native/JIT workloads | Timed backend implemented/qualified on the installed version; UI and desktop acceptance pending; cap accepted; flight recording excluded from this release; Mono map names pass / .NET map names fail; live reuse accepted BLOCKED; 200k-symbol fixture passes within its recorded scope |

Each revision includes its requirements, implementation seams, fixtures and
automated, desktop and failure/recovery acceptance. Resolve remaining open
questions before implementing the affected behaviour. Proposed perf modes and
runtime integration require qualification; none is established by this index.

GR-001 works standalone. GR-002 delivers the attached-profiling design's PID
sampling checkpoint; its timeline can also link to GR-001 once that source and
an explicit clock mapping exist. Neither proposal requires both revisions to
ship together.

Use the [scope contract](../design-profiler-scopes.md) for inspection and
snapshots and the [workspace modes contract](../design-profiler-workspace-modes.md)
for the existing sidebar/editor presentation. The
[implementation record](../implementation-attach-gold.md) describes the current
capabilities separately from these proposals.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
