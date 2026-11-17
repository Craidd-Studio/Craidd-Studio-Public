# HA-METRIC-001: CSV source transition render crash

**Status:** Human Round 1 FAIL. Render fix qualified on both displays; performance gate FAIL; human retry NOT TESTED. This is not public-release sign-off.

The human acceptance recording showed a sections CSV chart followed by the IDE's render error: `undefined is not an object (evaluating 'n.columns')`. The human reported opening the other CSV by mistake. Opening another file is a supported action; the crash is a product defect, not a failure by the tester. Do not advance to Round 2 on this result.

## Diagnosis and reproduction

On the frozen release binary SHA-256 `a7f1f63f40e79624608214833e4f0e210c48ef9a0d2d9c39ff88d9baf0a24b09`, import a five-column sections CSV, wait for its chart, then import a two-column main CSV. The desktop harness reproduced the exact error before any product changes. Both fixtures are generated directly in `tests/ui/metric-source-transition.test.mjs`.

The import store selects the new identity before its metadata arrives. The metric panel retained charts from the preceding source until a layout effect cleared them. Rendering occurs before that effect; chart grouping dereferenced the absent group's columns. The same local-state lifetime also risked mixing old summaries, ranges and inspected rows with another source or interpretation.

The panel now mounts a distinct workbench for each selected source, file group and interpretation revision. Bounded view preferences still restore from the existing source-specific view cache. Graphs, summaries, rows and pending callbacks belong to their workbench instance and cannot render against a replacement schema.

The prior automated desktop and performance passes did not cover sequential import after a chart had loaded. They do not override this human failure.

## Evidence and gates

Machine: `sk27`, Linux `7.2.11-arch1-1`. Original human session: `/tmp/craidd-acceptance-r1c-20261024`. Its silent owned-window video, screenshot, observations and explicit FAIL remain local. The source CSV hash was unchanged at teardown. The controller now also stops and records FAIL if it observes this render boundary.

| Gate | Result | Scope |
| --- | --- | --- |
| Old release reproduction | PASS | Exact error after second import, before source edits |
| Fixed embedded debug regression | PASS | Second import, different schemas, switch back, remove loaded source |
| Wider desktop workflow | PASS | Release: interpretation, named-key companion inspection, hover, brush, virtual rows, responsive widths; native zoom remains NOT TESTED |
| Fixed release regression | PASS | Ordinary desktop and Xvfb: second import, different schemas, previous inspection isolation, switch back, source removal |
| Million-row release interaction distributions | FAIL | Foreground ordinary zoom-out p95 102 ms; Xvfb pan-left p95 137 ms. Target remains <100 ms |
| Million-row load and incremental memory | PASS | Progress observed, first view <15 s, incremental RSS <3×; baselines reported separately in every JSON |
| Close during million-row load | PASS | Ordinary/Xvfb: cancellation and storage release 4/5 ms after close, reader closed, surviving IDE imports another file |
| Presentation / row-key / workspace checks | PASS | Three automated test files |
| Human Round 1 | FAIL | Original result preserved |
| Human Round 1 retry | NOT TESTED | Fresh qualified binary required |

The first wider-workflow attempt encountered a stale WebDriver element while an interpretation update replaced its workbench. It did not encounter a render crash. The harness now waits for the companion's applied revision before attempting its next click; this attempt is retained separately from the completed retry.

## Release performance finding (still open)

Frozen release SHA-256 `61aa03ffed8e6b4111ae2aa9b3fd2107ee424c830bb4715e764b603800ce78f0`; source base `0193e84` plus the isolated-workbench fix, with the exact source-file hash in `build.json`. Evidence and the two small reproduction CSVs are in `workspaces/profiling-metrics/acceptance-crash-2026-10-24/`. No product changes were made after the slow measurement to chase the timing gate.

The initial ordinary run failed all operations at p95 161–197 ms. The unchanged old release under the same desktop conditions also failed at p95 175–213 ms. Initial records show most delay after the UI mutation, waiting for frame callbacks; this is not proof of the underlying compositor or focus cause. GC pause logging and native-query intervals are retained. The foreground probe added to the harness records eight frame callbacks and focus at each operation's start/end; it does not replace the original measurements or change the product.

Controlled foreground results (20 observations per operation; p50 / p95 / max, milliseconds):

| Operation | Ordinary desktop | Xvfb 1600×1050 |
| --- | --- | --- |
| Zoom in | 69 / 87 / 91 | 53 / 90 / 105 |
| Pan right | 66 / 76 / 80 | 42 / 78 / 180 |
| Pan left | 65 / 89 / 93 | 34 / 137 / 191 |
| Zoom out | 70 / 102 / 109 | 49 / 80 / 120 |
| Series toggle | 65 / 74 / 77 | 32 / 48 / 55 |
| Row inspection | 59 / 67 / 70 | 27 / 41 / 45 |

Ordinary: first view 1.446 s; incremental RSS 2.260× file size; whole-IDE baseline 1103.0 MiB RSS, reported separately.

Xvfb: first view 1.551 s; incremental RSS 2.323× file size; whole-IDE baseline 1143.8 MiB RSS, reported separately.

The foreground ordinary outliers were zoom-out rounds 3 (102 ms), 7 (109 ms) and 19 (100 ms). Their UI mutations took 35–39 ms and subsequent two-frame waits 65–70 ms; graph/page queries overlapped, and summaries were sometimes still running. These observations do not establish a cause. Xvfb outliers and their query/render/GC context are likewise retained. Further diagnosis is needed before the performance gate can close; do not repeatedly rerun until a passing distribution hides these failures.

The first release test attempt was rejected before measurement because the frozen path lacked the harness's `/release/` guard. An identical hash was copied into a release subdirectory. The strengthened source-transition test also initially tried to inspect a row in the compact layout; its setup now opens the visible analysis workspace. These setup failures are separate from the product crash and measured performance failures.

Raw video is not committed or published. No push or merge is authorized.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
