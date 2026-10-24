# Metric editor: renewed release gates

**Status:** Automated release and desktop gates PASS within the method below; human/public-release acceptance remains open. Local branch `codex/profiling-profiler-ui`; no push or merge. The [approved design](../design-metric-inspection-editor.md) and [quality checkpoint](metric-editor-quality-results.md) remain separate from this measurement record.

## Build, machine and workload

Machine `sk27`, AMD Ryzen 9 9950X3D (32 logical CPUs), 63,297,788 KiB system RAM, Linux `7.2.11-arch1-1`. The ordinary desktop uses its existing Wayland session with the app's X11 backend; Xvfb uses a 1600×1050 display. Measurements run serially in a foreground 1600×1050 IDE window with a warm file cache. One welcome window and one solution window are included in the imported-data baseline.

Release executable SHA-256: `a7f1f63f40e79624608214833e4f0e210c48ef9a0d2d9c39ff88d9baf0a24b09`. Every final metric run and the separate Mono release smoke test records this same hash. The review copy is read-only at `/tmp/craidd-profiler-review-a7f1f63f40e7/craidd-studio`; it matches the qualified bytes. The build log, per-run executable paths, process identities, viewports, GC output and query/render observations are in [the evidence directory](../../../../workspaces/profiling-metrics/release-editor-2026-10-24/).

The deterministic fixture has **1,000,000 rows × one time column + 20 numeric metrics + one short text column**, 153,890,865 bytes. SHA-256 `2816464b330512f766376e1fa3f9a1e557357a65571ce1809ac3145cbc5c4864`. Regenerate with [generate.py](../../../../workspaces/profiling-metrics/generate.py); the large generated CSV is not committed. Four metric series are visible by default; all 22 columns are retained. The original axis remains ordinal until explicitly interpreted.

## Gates

| Gate | Result | Actual evidence and limits |
|---|---|---|
| Parsing / first view | PASS | Ordinary 1.30 s; Xvfb 1.43 s, including graph and two animation frames; progress shown on both. Target <15 s. |
| Incremental import memory | PASS | Ordinary 2.26×; Xvfb 2.21× file size, including initial summaries. Target <3×. Baselines below. |
| Loaded-file interactions | PASS | Twenty observations of each operation on each display; all p95 <100 ms. Table below. No ≥100 ms observations in either final run. |
| UI during import | PASS within probe | Focus and two-frame probe while parsing: 8 ms ordinary / 30 ms Xvfb. Maximum observed 16 ms timer gap during import/initial summaries: 31 / 48 ms. Scripted evidence, not hardware-input latency. |
| Desktop behaviour | PASS | Both displays: explicit time interpretation, bulk companion units, named-key joined row, independent brush/zoom, exact hover, virtual rows, draft preview/cancel, keyboard viewport/dock controls, source switching and responsive layouts at 1920×1080, 1280×800 and 900×800. |
| Wheel / chart selection / tooltip | PASS | Compressed vertical wheel cancels the browser default; horizontal wheel remains available. Brush no longer selects document text. Tooltip content and bounds fit the viewport; screenshots inspected. |
| Owning-window close / recovery | PASS | Closed during parsing at 31,416,837 / 33,943,223 bytes. Cancelled worker and storage-release trace after 3 / 3 ms; reader FD closed, native RSS and process-tree RSS fell, surviving IDE imported/inspected another CSV, producer size unchanged. |
| Symbol resolution | PASS within separate scope | [GR-003 native/settings/reopen and Xvfb evidence](gr-003-results.md); [GR-004 release naming/provenance evidence](gr-004-results.md). These are separate profiler gates, not properties of CSV parsing. GR-003's full native matrix was not repeated in this release run. |
| Native 125% / 150% scaling | NOT TESTED | Raw CSS zoom clipped the fixed viewport shell and is not a valid scaling PASS. The existing native zoom API is denied by the app ACL; no permission was added. Manual display-scale testing remains required. |
| Chooser / screen reader / human usability | NOT TESTED | Path controls drive automated import. Use the [12-step human checklist](gr-001-m1-human-acceptance.md); visual screenshots and timings do not sign off public-release usability. |

## Interaction distributions

Milliseconds, **p50 / p95 / max**, nearest-rank quantiles, n=20 per cell. Measured from scripted application event through the changed UI and two animation frames. Graph/row queries, overlapping page/summary/hover queries, timer gaps and GC logs are retained separately. Query measures include native queuing and IPC; frame waits include rendering/scheduling and do not isolate paint cost.

| Operation | Ordinary | Xvfb |
|---|---|---|
| Zoom in | 39 / 56 / 59 | 47 / 59 / 66 |
| Pan right | 30 / 43 / 44 | 32 / 47 / 47 |
| Pan left | 35 / 49 / 55 | 31 / 47 / 49 |
| Zoom out | 38 / 50 / 53 | 48 / 62 / 65 |
| Series toggle | 30 / 42 / 42 | 31 / 37 / 38 |
| Row inspection | 19 / 31 / 34 | 26 / 33 / 36 |

## Baseline memory remains a separate open issue

The [existing whole-IDE baseline issue](../../../bugs/20-10-2026-profiler-pre-import-memory-baseline.md) remains OPEN and was not fixed in M1. Values below are **MiB RSS / PSS**. RSS double-counts shared pages; PSS is reported separately. Sampling is approximately every 50 ms and can miss brief peaks.

| Display | Two-window baseline | Import peak | Incremental RSS / file |
|---|---|---|---|
| Ordinary | 1139.9 / 494.8 | 1471.2 / 822.5 | 2.26× |
| Xvfb | 1184.9 / 533.6 | 1508.5 / 855.3 | 2.21× |

The ordinary one-window baseline is 719.6 MiB RSS. In the ordinary two-window baseline, the native host accounts for 262.5 MiB; the second Craidd-named helper 38.8 MiB; WebKit's network process 68.8 MiB; and its two web processes 355.3 and 414.4 MiB. Full per-PID RSS/PSS identities are recorded on every run; these measurements do not diagnose the broader baseline's cause.

## Diagnosis and corrections

The first release run failed: pan/zoom/toggle p95 was 180–217 ms. Its graph measures were commonly 4–8 ms, while most delay fell in UI updates/frame waits. The captured JSC log's largest reported GC pause was 3.27 ms; buffered stderr timestamps do not establish exact causal attribution. The default line view rendered thousands of extra extrema elements alongside the path which already preserves original first/min/max/last vertices. Removing that duplicate rendering retained extrema and gap semantics. Native wheel handling now uses a cancellable listener, with horizontal and shifted scrolling left to the browser. Query markers now cover graph, row, page, summary and hover, including overlap.

A real pointer-drag reproduction selected SVG axis text and darkened the chart. Clearing only native document selection restored contrast without changing the profiler range. The scoped selection guard and regression now prevent this. The measured tooltip is positioned against the viewport so shorter chart regions do not clip it.

The original slow-run JSON, selection before/after screenshots and clipped CSS-zoom experiment remain beside final evidence. Initial ordinary render-callback and Xvfb hover automation attempts timed out; the harness now explicitly foregrounds the owned window and delivers pointer movement from outside the chart. No product cause was inferred from those timeouts. The final runs pass without the diagnostic selection-clearing probe.

M2 and M3 remain approved but waiting. Normal .NET map naming remains a known FAIL and live PID-reuse qualification remains accepted BLOCKED in their earlier records; neither is relabelled by these checks.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
