# Why metric CSV inspection belongs in the public release

**Roadmap track:** Phase 3.5 profiling.
**Status:** Release-scope recommendation, 20 October 2026. M1 automated acceptance passes; human release acceptance remains open.

## Recommendation

Include **finished-file metric CSV inspection (GR-001 M1)** in the intended
public release, subject to its review and acceptance gates. The user's current
project needs it, and the capability is generic: any program can supply its own
metrics without a Craidd-specific runtime or instrumentation library.

That is a scope recommendation, not a claim that today's implementation is
release-ready. The [M1 results](gr-001-m1-results.md) now pass the accepted
incremental-memory, release-p95 and native recovery gates. Human acceptance is
still unrun. The earlier total-memory target was replaced explicitly; its IDE
baseline remains a [separate open issue](../../../bugs/20-10-2026-profiler-pre-import-memory-baseline.md).
The separate [perf qualification](perf-qualification-results.md) cannot sign off
CSV usability or be inferred from CSV acceptance.

## The user problem it solves

A server, simulation or test harness may already record loop budgets, window
percentiles and section costs. Opening those values in the Profiler lets the
user find a suspicious window, inspect its actual row and companion records,
and preserve the evidence for another session. It provides a useful starting
point even when stack sampling or prepared Gold instrumentation is unavailable.

Craidd contributes context, inspection and provenance. It does not measure those
numbers again, validate them independently or infer a cause from correlation.
CSV window statistics remain separate from process observations and stack
samples. Clock alignment and comparison require their later explicit contracts.

The first public slice is deliberately bounded: finished local files, labelled
numeric series, row attributes, integrity reporting, declared companion joins,
largest-value navigation and portable immutable snapshots. It is not a general
spreadsheet editor or a promise to support every CSV/log dialect.

## Why retain CSV inspection state?

Suppose a user selects a column, narrows to a slow window and inspects row 842.
They open its source code, then return to analysis. Losing that column, range
and row makes the workflow frustrating and risks examining a different record.
Retaining them is ordinary interface continuity, like keeping an editor's cursor
and scroll position. It does not introduce another collector or derived metric.

The retained state is a small, bounded descriptor: source/file identity, selected
series, row range, inspected-row index, settings visibility and scroll position.
The view re-queries bounded native results when needed. It does not copy a million
rows into frontend state. Removing a source removes its saved view descriptors.

There are two distinct lifetimes:

| Lifetime | Public behaviour |
| --- | --- |
| Navigate within the owning IDE window | Preserve range, series and inspected row when switching source/code tabs or returning to the Profiling editor tab |
| Close/restart the IDE | Reopen an explicitly saved `.crmetrics` artifact without needing the original CSV; do not silently resume file reads or promise restoration of every transient UI control |

Ordinary CSV interpretation changes never mutate an existing snapshot. Project
defaults and implicit cross-session import restoration are later decisions.

## Where it belongs in the interface

Imported metric analysis belongs **only in the Profiling editor tab**. Its tables,
diagnostics and comparisons need working space. The standard process/Gold
Profiler stays available in both sidebar and editor modes. A sidebar action may
open metric analysis in the editor; the sidebar never becomes a CSV inspector.
Returning to code restores standard sidebar profiling without losing the CSV
inspection prepared in the editor.

## What must be true before calling it release-ready

- The finished-file workflow is understandable with real project CSVs, including
  partial/invalid input, missing files, empty cells and unjoined companions.
- Keyboard navigation, error correction, source/code navigation and snapshot
  save/reopen work in the actual desktop app; the producing program/files remain
  untouched.
- Snapshot scope, units, unknown window duration, clock domain and coverage are
  clear. Rendered reductions never masquerade as run-wide percentiles or totals.
- Performance results identify machine/build/workload and retain failures. The
  accepted incremental-memory and release-p95 gates pass; automated evidence
  does not substitute for human usability acceptance.

Live follow (M2), session clock mapping/comparison (M3), sidecars, project defaults
and later perf capabilities remain separately reviewed work. They are not hidden
prerequisites for a useful, honestly labelled finished-file release slice.

See the [accepted decisions](implementation-decisions.md),
[source contract](../design-profile-source-contract.md) and
[public-release usability review](gr-001-m1-uiux.md) for implementation boundaries.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
