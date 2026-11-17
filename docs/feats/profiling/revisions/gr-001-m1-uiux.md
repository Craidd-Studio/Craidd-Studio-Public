# GR-001 M1 public-release usability review

**Roadmap track:** Phase 3.5 profiling.
**Status:** Human usability acceptance FAIL, 21 October 2026. Earlier scoped automated checks remain valid within their recorded boundaries.

The user requested public-release UI/UX quality before sign-off. This pass
follows the existing [workspace contract](../design-profiler-workspace-modes.md)
and [public-release sweep](../../../uiux/design-public-release-sweep.md), without
commissioning M2/M3 or redesigning the surrounding IDE.

## Human review, 21 October 2026

The user reports that the imported view is confusing and visually unsuitable
for public release, supported by five screenshots from the copied test files.
This is failed human usability acceptance, not a regression in measured parser
correctness or latency. The existing automated checks proved their scoped
conditions; they did not establish readable analysis or discoverable workflows.

Observed problems: import/path forms dominate the working area; the timeline
and row inspection are pushed below the fold; values are separated from their
labels across excessive width; chart marks are tiny and lack a useful y-axis;
manual row-number entry substitutes for direct chart/table selection; provenance
and parser terminology interrupt the analysis workflow. Initial series selection
also chooses the elapsed column as a plotted metric. The helper opening the
path disclosure made the first-use experience worse, but closing it does not
resolve the structural problems.

Required direction for the next review: a chart-first Profiling editor workspace,
compact source/series navigation, legible axes and marks, linked chart/table/row
inspection, and focused settings/issues views. Explicit clocks, unknown window
durations, declared joins and immutable snapshots must remain honest. This is a
proposed M1 usability correction; no replacement UI has yet been implemented.
Do not push/merge or describe the current UI as public-release ready.

## Audit findings and scoped changes

- The user subsequently chose **editor-only imported analysis**. Keep standard
  process/Gold profiling in both hosts. The sidebar opens imported analysis in
  the existing Profiling editor tab and never renders its CSV controls.
- Import pan/series/row inspection resets when changing source/host. Retain a
  bounded per-file view descriptor; requery bounded data on remount.
- Technical integrity/provenance text competes with the primary analysis view.
  Give source identity, coverage, graph and row details a clear hierarchy; keep
  detailed provenance and file-path entry available through disclosures.
- Chart identity and axis semantics need accessible labels, and its intended
  height is overridden by a later shared rule. Fix the scoped rule; do not imply
  pointer interaction where none exists.
- Saved-range scope and declared join definitions must be visible before save
  and on snapshot reopening. Empty text cells must read as empty.
- Clear stale operation errors when retrying. Reject a unit edit that would
  invalidate an existing toleranced join, leaving prior interpretation intact.
- Check standard sidebar widths 288/360/420 px and imported editor views at
  supported window sizes. Contain wide schema tables; avoid horizontal overflow
  in primary controls and inspected values. Verify code-tab navigation restores
  standard sidebar profiling while retaining imported editor inspection.
- Check keyboard activation, focus visibility, fractional numeric input, empty,
  loading, partial, cancelled and failed states in the real webview.

The native pass also exposed a shared resize defect: a pointer move after release
(`buttons=0`) was still treated as a drag, moving a requested 420 px sidebar to
318 px. It reproduced on a private display. The handle now tracks the captured
primary pointer and ends dragging on release, lost capture, cancellation or a
move without the primary button. Three production-handler regression tests pass.

## Evidence lanes

Record native automated desktop results separately from human acceptance. Keep
the million-row latency/memory gates from [M1 results](gr-001-m1-results.md)
visible; cosmetic polish does not close them. Native OS file chooser interaction,
screen-reader review and human usability acceptance need their own evidence.

| Gate | Result | Evidence |
| --- | --- | --- |
| Standard sidebar / imported editor boundary and overflow | PASS, scoped | Native release: sidebar 288/360/420 px contains standard profiling only; imported editor at 900/1280/1600 px window widths, no primary overflow, 150 px chart |
| Keyboard entry and retained inspection | PASS, scoped | Native Enter opens editor imports and inspects a row; source/code navigation preserves selected series, range and row |
| Error recovery and unit-conflict transaction | PASS, scoped | Missing-file retry; fractional join tolerance; incompatible unit rejected without revision change; corrected edit clears the panel alert |
| Native OS file chooser / screen reader / human review | NOT TESTED | No human acceptance inferred |

The initial scoped embedded release UX run passed in 5.10 seconds on the machine/build
recorded in [M1 results](gr-001-m1-results.md). Native GTK/WebKit ran serially on
a private Xvfb X11 display; it is not a human GNOME/Wayland or hardware-display
latency qualification. Screenshots and records are local under
`test-results/ui/2026-10-20T21-48-01-315Z/metric-ux/`.

Earlier exploratory runs included interfering concurrent GUI jobs and stale
embedded builds; they are not acceptance evidence. The final test also scopes
alerts to the metric panel: Monaco creates empty accessibility alert nodes after
opening source, which initially caused a false test failure. Backend revision
alone is not the rendered retry condition. No product error was hidden to make
that assertion pass.

The later [release review](gr-001-m1-results.md#release-review-distributions-and-recovery)
also passes 20 observations per operation on ordinary desktop and Xvfb, plus
native owner-close recovery on both. The [12-step human checklist](gr-001-m1-human-acceptance.md)
remains unrun; native OS picker and human judgement are still separate gates.

---

*Last updated: 21 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
