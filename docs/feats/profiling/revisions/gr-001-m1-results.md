# GR-001 M1 implementation and evidence

**Roadmap track:** Phase 3.5 profiling.
**Status:** M1 automated acceptance PASS; human acceptance NOT TESTED, 20 October 2026. Local feature-branch commit authorized; push/merge wait for human acceptance.
**Baseline:** `8bac01edf9bf1f0a0b84b55441b5638bc1233a29` plus the M1 feature-branch changes. No M2/M3 work started.

The [accepted decisions](implementation-decisions.md) and
[source contract](../design-profile-source-contract.md) were written before code.
This report distinguishes implemented behaviour, automated desktop evidence and
human acceptance. The full GR-001 revision is not delivered.

## Delivered M1

- Finished-file sets, selected explicitly per import, in the existing Profiler's
  **Imported metrics** editor-tab source view, never the sidebar. Standard
  Process/Gold profiling remains available in both hosts. Imports work without a target process and have
  separate labelled axes. Existing Process / Gold capture remains independent.
- Native streaming UTF-8/comma CSV parsing, cancellable byte progress and bounded
  queries. Numeric columns have inferred/editable units and explicit meaning
  (unknown by default). Row spacing never declares window duration.
- Ordinal, elapsed, epoch and explicitly zoned ISO-8601 axes. Numeric s/ms/us time
  units convert only the axis, preserving raw inspected cell values. Unknown
  duration remains unknown. Declared window statistics use bands; graph reduction
  shows bucket minima/maxima without averaging percentiles or stacking columns.
- Original-row inspection, physical CSV line numbers, integrity counts and bounded
  diagnostic examples; exact top 20 values over the selected row range.
- Companion joins use named keys with exact or numeric-tolerance matching.
  Tolerance requires identical declared key units. Missing/duplicate matches stay
  unjoined/ambiguous. Files never join by row position.
- New `.crmetrics` artifacts store versioned immutable row copies, interpretation,
  join rules, coverage, SHA-256/size/mtime/path and source/generation provenance.
  Reopening needs no producer files. Sliced copies preserve original ordinal
  coordinates, even when copied again. Saves never overwrite an existing path.
- Window-scoped storage, explicit limits/errors and cleanup on window destruction.
  No import operation launches, stops, signals, locks or writes a producer.

Implementation: [parser/storage](../../../../src-tauri/src/metric_csv.rs),
[native ownership/API](../../../../src-tauri/src/commands/metrics.rs),
[import view](../../../../src/components/panels/MetricImportPanel.tsx) and
[bounded frontend state](../../../../src/store/metricStore.ts).

## Machine and builds

AMD Ryzen 9 9950X3D 16-Core Processor; Linux
7.2.11-arch1-1, x86-64; MemTotal:       63297788 kB.
Rust `rustc 1.99.1 (58cf8f9c3 2026-10-13) (Arch Linux rust 1:1.99.1-1)`, Cargo `cargo 1.99.1 (5f94df478 2026-08-27) (Arch Linux rust 1:1.99.1-1)`, Node `v24.21.0`,
npm `11.19.0`. Initial desktop evidence used an embedded **debug** build;
final native acceptance also used an embedded **release** build (optimized,
`tauri/custom-protocol`). The standalone parser benchmark is a separate
optimized release executable. No installer/package qualification is claimed.

Final release GUI jobs ran serially on a private Xvfb X11 display with native
GTK/WebKit. This avoids competing desktop pointer input; it does not establish
human GNOME/Wayland behaviour or hardware-display latency. The desktop test opens
a disposable solution window beside the initial shell; RSS covers both plus
their descendants. Earlier debug evidence used the ordinary desktop display.
Build and display changes are recorded; the difference is not attributed solely
to optimization.

Exact source/binary hashes, metadata, machine and measurements are in the
[compact evidence JSON](../../../../workspaces/profiling-metrics/evidence-2026-10-20.json).
The deterministic [fixture/runner](../../../../workspaces/profiling-metrics/README.md)
and [real desktop test](../../../../tests/ui/metric-import.test.mjs) are checked in.
Generated CSVs, binaries and complete logs remain local, not Git payloads.

## Gate results

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Parsing and integrity | PASS | 14 production-parser/storage tests, including documented human fixtures; malformed fields/quotes, multiline rejection, empty cells, missing fields, UTF-8 attributes, exact finite numeric values, SHA-256, clock units and invalid clocks |
| Source ownership / API | PASS | Owner isolation, duplicate/file-set limits, unit conflict, cleanup and original bytes unchanged; included in native suite |
| Snapshot reopening | PASS | Real app restarted; both producer CSVs deleted; data, original units and declared joins reopened; interpretation mutation refused |
| First visible million-row view | PASS | Review release: ordinary 1.357 s / Xvfb 1.454 s; progress observed; earlier release 1.313 s and debug 9.679 s retained |
| Loaded interactions | PASS | Accepted release p95 gate: 20 observations × six operations × two displays; ordinary p95 31–33 ms, Xvfb 30–31 ms; no ≥100 ms outliers |
| UI responsiveness during load | PASS, scoped | Release 16 ms JS heartbeat: 101 callbacks, maximum gap 25 ms; earlier debug 518 / 26 ms; not every desktop condition |
| Whole-IDE baseline | Separate OPEN issue | [Measured native/WebKit/window composition](../../../bugs/20-10-2026-profiler-pre-import-memory-baseline.md); prior absolute gate superseded by accepted incremental gate |
| Parser-only peak memory | PASS | Fresh optimized process peak RSS 185.79 MB, 1.21× file |
| Incremental import peak RSS <3× file | PASS | Accepted gate: ordinary 296.45 MB / 1.93×; Xvfb 287.47 MB / 1.87×. Baselines reported separately; earlier release 319.87 MB / 2.08× also passes |
| Recovery | PASS, scoped | Prior failure cases plus owner-close during real million-row load on both displays: cancelled reader, released storage/RSS/FDs, removed source, surviving IDE renders a fresh import |
| Existing Profiler regression | PASS | 28 profiling + 5 workspace tests; real native workspace/capture/snapshot/editor regression passed on final release (4.83 s) |
| Native regressions | PASS | 184 passed, 6 existing ignored; socket-dependent cases required ordinary desktop/local-socket access outside the sandbox |
| Editor-only CSV / standard both-host UX | PASS, scoped | Native release layouts, keyboard entry, code/source navigation, retained range/series/row, snapshot scope and error retry; [usability record](gr-001-m1-uiux.md) |
| Symbol resolution | NOT TESTED / not an M1 capability | CSV import supplies program values; see separate perf qualification |
| Human desktop acceptance | NOT TESTED | No human acceptance inferred from harness runs or screenshots |

The user accepted the incremental-memory and release-p95 gate revisions. M1's
automated gates now pass; the earlier debug 199 ms event is retained historically
and does not gate release acceptance. [Human acceptance](gr-001-m1-human-acceptance.md)
remains NOT TESTED. Do not push/merge until that review. No M2/M3 or in-IDE perf
implementation has started.

## Release review: distributions and recovery

The same lifecycle-trace release binary (hash in evidence) ran serially on the
ordinary GNOME/Wayland desktop and private Xvfb/X11. Six operations were each
measured 20 times per display. p50/p95 use nearest rank (10th/19th sorted value
for N=20), max is the observed maximum. Every p95 is <100 ms.

| Operation | Ordinary p50 / p95 / max ms | Xvfb p50 / p95 / max ms |
| --- | ---: | ---: |
| Zoom in | 32 / 32 / 33 | 31 / 31 / 31 |
| Pan right | 32 / 32 / 32 | 30 / 31 / 31 |
| Pan left | 32 / 32 / 32 | 30 / 31 / 31 |
| Zoom out | 32 / 33 / 34 | 30 / 31 / 31 |
| Series toggle | 32 / 33 / 33 | 30 / 31 / 34 |
| Row inspection | 23 / 31 / 31 | 21 / 30 / 30 |

All 240 observations and query/render phases are retained in
[ordinary evidence](../../../../workspaces/profiling-metrics/release-ordinary-2026-10-20.json)
and [Xvfb evidence](../../../../workspaces/profiling-metrics/release-xvfb-2026-10-20.json).
No observation reached 100 ms. Basic JSC GC logs, stderr-arrival timestamps,
native query measures, UI-mutation/two-RAF phases and timer gaps were collected
before any proposed response to an outlier. WebKit's Performance API does not
expose GC entries here; stderr buffering prevents exact causal GC attribution.
No performance fix was made in response to the historical debug outlier.

Each run reports its own baseline and per-process RSS/PSS. Ordinary baseline:
1234.90 MB RSS; peak 1531.36 MB; incremental 296.45 MB (1.93× file).
Xvfb baseline: 1293.17 MB; peak 1580.65 MB; incremental 287.47 MB (1.87×).
These use sampled summed RSS; shared pages may be counted twice and brief peaks
may be missed. See the separate baseline issue for PSS and process composition.

The [native owner-close evidence](../../../../workspaces/profiling-metrics/owner-close-recovery-2026-10-20.json)
closes the application's actual Window Manager owner while still loading the
same million-row file. Cancellation → reader-finished state `cancelled` →
storage-released is observed, not inferred from a vanished control. The opt-in
`CRAIDD_METRIC_TRACE` records metadata only and emits storage release after the
owned dataset is dropped. Native parser allocations, producer FD closure,
source removal and a new visible import in the surviving IDE are checked.

| Close recovery | Ordinary | Xvfb |
| --- | ---: | ---: |
| Cancellation/storage release after close request | 3 ms | 5 ms |
| Native RSS during → after | 358.57 → 277.31 MB | 399.11 → 297.65 MB |

A preliminary W3C Close Window attempt only closed a WebKit browsing context;
it produced no native owner-close event and was rejected as lifecycle evidence.
The final checks use the native application command. An early assertion expected
a different owner-isolation error string; it was corrected to the actual
`Metric source unavailable in this window`, without changing product behaviour.
The test uses direct owner-scoped IPC to begin the close race; the new import
that proves IDE usability is driven through the visible editor workflow.

## Earlier initial-acceptance measurements (historical)

## Accepted million-row fixture and measurements

Exactly 1,000,000 data rows × (1 time + 20 numeric + 1 short text column),
153,890,865 bytes. SHA-256:
`2816464b330512f766376e1fa3f9a1e557357a65571ce1809ac3145cbc5c4864`.
File generation warms the filesystem cache; no cold-cache claim is made.

Optimized standalone parsing: 1.108 s; 245
progress callbacks; 185.73 MB retained vector capacity;
185.79 MB peak RSS measured by a fresh Python parent's child
resource usage. Three bounded graph queries: 2.730 ms, 1.337 ms, 0.651 ms.
Row lookup: 0.00191 ms; exact top-20 lookup:
1.617 ms. These are backend timings, not UI results.

| Visible desktop operation | Event → two animation frames | Final release run |
| --- | --- | --- |
| Zoom in | 25 ms | PASS |
| Pan right | 31 ms | PASS |
| Pan left | 31 ms | PASS |
| Zoom out | 30 ms | PASS |
| Series toggle | 23 ms | PASS |
| Row inspection | 21 ms | PASS |

The UI check first closes the path-entry disclosure and scrolls the graph fully
into view. Each pan/zoom/series query is followed by scrolling the new plot into
view and two animation frames. Row inspection brings the inspector into view.
Times exclude WebDriver transport and measure scripted application events, not
physical input-to-display hardware latency or a p95 distribution.

Six further release series switches measured 22–31 ms. Client Performance
measures recorded graph round trips (including native queuing/IPC) of 2–4 ms;
row lookup rounded to 0 ms at this webview's timer precision, not literal zero
latency. The source retains only the latest measure per query kind; the harness
records a bounded observation list.

The prior debug run measured 9.679 s first view and 20–40 ms operations, with
32–33 ms repeated series switches and 5–8 ms graph round trips. An earlier debug
run had one 199 ms series switch and 98 ms zoom-out; a subsequent diagnostic run
had 25–42 ms operations. Its cause was not established. No speculative rendering
rewrite was made; the earlier evidence remains historical; the accepted release-p95 gate above now governs.
The compact evidence retains those runs alongside final release results.

Final release process-tree RSS was sampled 23 times at approximately 50 ms
intervals. Baseline 1274.72 MB; peak 1594.59 MB; increase 319.87 MB.
The earlier debug run had 132 samples: baseline 1252.44 MB; peak 1519.35 MB;
increase 266.91 MB. Summed RSS can double-count shared pages; this is not PSS or
a complete graphics-memory account. Sampling can miss shorter peaks. Backend
retained import storage is independently 185.73 MB. Neither historical run met the former absolute target; the user explicitly
replaced that M1 gate with incremental import RSS.

**Memory target review, now accepted:** incremental import peak RSS <3× file
size, with a separately reported baseline. Earlier total-RSS measurements remain
in evidence; their former threshold is not the current M1 gate. Whole-IDE
baseline diagnosis is the separate open issue and was not fixed in M1.

## Limits and remaining work

M1 deliberately has no live follow or generation transitions (M2), session
mapping/comparison (M3), project defaults or sidecar loading. Original GR-001
threshold/summary enhancements outside M1 are not claimed here. The source view
selects one numeric series at a time; panning/zooming selects retained row ranges
on that file's declared axis. It never selects process/Gold ranges without a map.

Limits are explicit: 2 source sets/window, 8 files/set, 1 GiB/set and snapshot,
512 MiB retained/set, 2,000,000 rows/file, 128 columns, 1 MiB/physical line;
20 diagnostic examples and top 20 displayed values. Finished imports reject an
exceeded resource limit instead of silently evicting data. Memory figures above
are measurements; limits do not substitute for peak-memory evidence.

The first nonempty value selects numeric/text storage; no automatic storage-kind
rewrite occurs later. Numeric storage is finite binary64. Unsafe integer values
beyond 2^53−1 in an established numeric column are rejected with diagnostics;
if such a value establishes a text column, its original text is preserved.
Ordinary decimal values have binary64 precision, not arbitrary decimal precision.
Nonmonotonic/missing time values refuse a time interpretation; ordinal remains
available. Single-line records only; quoted multiline records are consumed as
one unsupported record, never fed back as shifted rows. A finished CSV may end
without a newline; that record is retained and counted. M2's deferred-partial-line
rule is not implemented by treating finished-file EOF as live follow.

Interpretation/joins persist in snapshots. A bounded set of 16 per-file view
descriptors retains series, range, inspected-row index, settings and scroll
within the owning window; source/code navigation re-queries bounded native data.
Removing a source removes those descriptors. Transient controls are not promised
across IDE restart; explicit immutable snapshots provide the restart workflow.
Existing Process/Gold inspection state retains its established behaviour.
Native import source identities/data survive source-view switching within the
window. No cross-window sharing or source-interpretation project persistence is
claimed. Parser tests include producer removal during a read. Native window close during
a million-row load is now exercised on both displays as detailed above. Human
review remains separate from that automated proof.

## Reproduction and local artifacts

The [fixture guide](../../../../workspaces/profiling-metrics/README.md) includes
the 20-per-operation release runner and both-display commands; the
[human checklist](gr-001-m1-human-acceptance.md) has 12 steps. New compact JSON
evidence is checked in beside the earlier measurement record.

```sh
cargo test --offline --manifest-path workspaces/profiling-metrics/Cargo.toml --target-dir /tmp/craidd-metric-fixture-target
cargo test --offline --manifest-path src-tauri/Cargo.toml --target-dir /tmp/craidd-gr001-tests --lib
node tests/profiling.test.mjs
node tests/profilerWorkspace.test.mjs
npm run build
cargo build --release --offline --manifest-path src-tauri/Cargo.toml --target-dir /tmp/craidd-gr001-target --features tauri/custom-protocol
xvfb-run -a -s '-screen 0 1920x1080x24 -nolisten tcp' dbus-run-session -- env GDK_BACKEND=x11 XDG_SESSION_TYPE=x11 CRAIDD_UI_APP=/tmp/craidd-gr001-target/release/craidd-studio CRAIDD_TEST_METRICS=1 CRAIDD_METRIC_MILLION=/tmp/craidd-gr001-million.csv node tests/ui/metric-import.test.mjs
# Run separately, not concurrently with the measurement above:
xvfb-run -a -s '-screen 0 1920x1080x24 -nolisten tcp' dbus-run-session -- env GDK_BACKEND=x11 XDG_SESSION_TYPE=x11 CRAIDD_UI_APP=/tmp/craidd-gr001-target/release/craidd-studio CRAIDD_TEST_METRICS=1 node tests/ui/metric-ux.test.mjs
```

Generate the CSV first with the fixture README's command and a fresh path.
Native socket tests and tauri-driver need desktop/local socket access; five
native cases initially failed in the restricted sandbox and passed on the
permitted desktop rerun. No system policy was changed. Existing ignored native
cases remain ignored.

Latest desktop screenshots and full records:
`/home/skira24/.codex/worktrees/9b33/Craidd-Studio/test-results/ui/2026-10-20T21-48-15-689Z/metric-snapshot-reopen` and its sibling `metric-import/`.
Consolidated logs: `test-results/metrics/2026-10-20-m1/` (ignored).
These are local artifacts, not durable shared links; compact checked-in evidence
preserves the measurements if temporary binaries/CSVs are removed. Work is retained on local feature branch `codex/profiling-metric-csv-m1`;
no push or merge is authorized before human acceptance. Use `git log -1 --oneline`
for the local checkpoint hash.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
