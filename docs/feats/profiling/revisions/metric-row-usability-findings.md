# HA-METRIC-003: confusing row scope and panel interaction

**Status:** Human orientation FAIL. Correct CSV import observed; focused usability fixes qualified on desktop and Xvfb; human retry NOT TESTED. Acceptance remains paused.

The user imported `server-metrics.csv` successfully, then reported confusion and supplied a table screenshot. The recording shows zooming/panning, toggling a series, resizing the Output panel, and examining rows. The data was not corrupt: the current view contained original rows 13,751–16,250, which is 2,500 rows. The row lookup's initial `1` was a destination field, not the current table position. The interface failed to make those distinctions easy to understand.

## Evidence and diagnosis

Frozen binary SHA-256: `61aa03ffed8e6b4111ae2aa9b3fd2107ee424c830bb4715e764b603800ce78f0`. Machine `sk27`, Linux `7.2.11-arch1-1`. Local human recording: `/tmp/craidd-acceptance-r1-start-20261024/round-01.mkv`. Review used timestamped extracted frames and source inspection, not a claim of continuous live observation.

- Around 45–48 seconds: the chart uses original row ordinals, and the viewed slice changes. The row dock is initially hidden by the compact-height layout.
- Around 54–58 seconds: the Output panel is resized, the row dock becomes visible, and browser text selection appears across the inspector and row table.
- The user screenshot independently shows clipped original row identities, a count of 2,500, a different on-screen range, and a lookup still displaying `1`.
- The first column was 72 px wide. The original row button measured 57.5 px, exceeding the cell's content width after padding. The automated regression reproduces that clipping.
- The footer used the fully visible row count while a further partially visible row was rendered. That made its final row disagree with what could be seen.
- The shared divider did not cancel the native pointer default. The first automated drag did not recreate the visible text selection; it did confirm the uncancelled gesture. The video remains the evidence of the user's actual selection problem.

The video captures the original 1600×1000 owned-window region. Later window growth extends beyond that region. Do not infer product clipping from the video's right edge. Resize recording coverage is PARTIAL until the recorder can segment/restart at changed window dimensions while keeping capture restricted to the owned window.

## Focused corrections

1. Reserve 112 px for the original row identity, retaining the `Row N` identity.
2. Label **In view: original rows A–B (count)** separately from **On screen: C–D**. Count a partially visible final row in the on-screen span.
3. Start the original-row lookup empty with a row-number prompt, and disable inspection until a destination is entered. Keep its draft separate from current inspected-row state in the bounded view cache. Clicking/inspecting a row fills its original identity.
4. Cancel native selection on divider pointer-down and mark the handle nonselectable. Apply this to the shared Output divider and the metric row divider. Keep ordinary cell text copyable.

These changes do not change parsing, ranking, companion joining or the meaning of existing snapshots. No clock is silently assigned. A more discoverable time-axis suggestion is **proposed**, not implemented by this fix. The video also shows the row dock appearing when shrinking Output makes the analysis area cross the compact-height threshold. Making the Rows-tab/inline-table transition clearer is another **proposed** follow-up; this fix does not redesign that responsive behaviour.

## Gates

| Gate | Result | Scope |
| --- | --- | --- |
| Human import | PASS | Correct source and plotted data observed; source hash unchanged at teardown |
| Human orientation | FAIL | User reported confusion; no next acceptance round started |
| Human window closure | NOT TESTED | Assistant stopped the round on the confusion report |
| Original-release regression | PASS | Reproduces clipped identity, unclear range text, initial lookup `1`, and omitted partial final row; uncancelled divider default recorded |
| Fixed debug regression | PASS | Complete identities, explicit range, included partial last row, empty lookup, cancelled divider default and original-row inspection; existing source/companion workflow also passes |
| Fixed release regression | PASS | Ordinary desktop and Xvfb: complete identity, accurate scope/partial row, empty lookup, cancelled divider gesture, original-row inspection, and prior source-transition regression |
| Existing release workflow | PASS | Ordinary desktop: companion/interpretation, hover, brush, virtual scrolling, responsive widths; native scaling remains NOT TESTED |
| Human retry of these corrections | NOT TESTED | Requires a fresh, explicitly started session |
| Million-row performance | FAIL / open | Previous measured gate remains failed; these corrections do not close it |

The first fixed-build assertion incorrectly required thousands separators from a different runtime locale. The harness now compares numeric ranges without assuming a separator; original measurements remain preserved. This was a test assertion issue, not a second product failure.

Frozen corrected release SHA-256: `a90753fc3efca8e0d47125dd45cc1f578336c01bc8fbb5d52b3c24e3aca9369c`. Source base `67e1c76` plus these focused corrections; exact source hashes, regression JSON and screenshots are in `workspaces/profiling-metrics/row-usability-2026-10-24/`. The previous performance distributions remain failed evidence on their recorded build; this correction does not claim a new million-row performance PASS.

## Start-signal finding

HA-INSTRUCTIONS-002: the preceding retry was **NOT TESTED**. The user was waiting for an all-clear when the assistant misread readiness as completion and stopped recording. The replacement session received an explicit **All clear—start now**, with recording already verified. Keep this instruction problem separate from HA-METRIC-001 (render crash) and HA-METRIC-003 (row usability).

Raw human video stays local and is not published or committed. Local commits only; no push or merge.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
