# Generic profiling revisions

**Roadmap track:** Phase 3.5 profiling.
**Status:** Staged revisions, 20 October 2026. GR-001 M1 is source-implemented
with [automated acceptance](gr-001-m1-results.md) passing and human acceptance
still open. M2 then M3 remain approved but wait behind GR-002 timed capture.
GR-002 has [installed native timed evidence](perf-qualification-results.md);
its [timed slice](perf-timed-delivery-proposal.md) is approved, with [backend work](perf-timed-backend-results.md) separate from the pending UI design. [Many-thread retention](gr-002-many-thread-retention.md) supports a separate flight-recorder decision.
**Craidd baseline reviewed:** `feat/unity/debug-a-to-p` at `8bac01e`.

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
| [GR-002](gr-002-external-pid-sampling-perf.md) | Native timed qualification first; later large native/JIT workloads | Timed backend implemented/qualified on the installed version; UI and desktop acceptance pending; raw cap and flight recording remain proposed; JIT and symbol scale deferred |

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

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
