# Metric CSV M1 fixture

The runner compiles the production `src-tauri/src/metric_csv.rs` directly. Its
tests exercise real parsing, declared joins, interpretation and disk snapshots;
it is not a second parser or a mocked native acceptance result.

Generate the accepted workload at a fresh path:

```sh
python3 workspaces/profiling-metrics/generate.py /tmp/craidd-metrics-million.csv
cargo test --offline --manifest-path workspaces/profiling-metrics/Cargo.toml
cargo run --release --offline --manifest-path workspaces/profiling-metrics/Cargo.toml -- /tmp/craidd-metrics-million.csv
```

The CSV contains 1,000,000 data rows: elapsed seconds, 20 numeric metrics and
one short `phase-N` text column. The generator does not overwrite an existing
file. Cache state must be reported; generating the file warms the filesystem
cache. The standalone runner reports backend timings and retained capacity,
not UI latency or whole-IDE memory. Measure fresh-process peak RSS separately.

The real desktop test uses a disposable solution and scratch HOME/config/cache,
restarts Craidd and deletes only its own CSV fixtures before reopening their
snapshot. It also checks live UI progress, event-to-render timings, process-tree
RSS, declared joins, errors and cancellation. It never controls a producer.

```sh
npm run test:ui:build
CRAIDD_METRIC_MILLION=/tmp/craidd-metrics-million.csv npm run test:ui:metrics
```

Set `CRAIDD_UI_APP` to an explicitly built embedded binary if it is outside the
default target directory. The test needs a real display, tauri-driver and local
WebDriver socket access. A skipped or blocked desktop test is not a PASS.

The small [main](fixtures/run.csv) and [companion](fixtures/run-sections.csv)
files support the [12-step human checklist](../../docs/feats/profiling/revisions/gr-001-m1-human-acceptance.md).
They intentionally include bad records; do not repair them for acceptance.

The release acceptance runner measures each of six operations 20 times, using
nearest-rank p50/p95/max and a p95 <100 ms gate. Run ordinary desktop and Xvfb
**serially**, after builds and competing benchmark workloads finish:

```sh
CRAIDD_UI_APP=/tmp/craidd-gr001-target/release/craidd-studio CRAIDD_METRIC_DISPLAY=ordinary-desktop CRAIDD_METRIC_MILLION=/tmp/craidd-metrics-million.csv npm run test:ui:metric-release
xvfb-run -a -s '-screen 0 1920x1080x24 -nolisten tcp' dbus-run-session -- env GDK_BACKEND=x11 XDG_SESSION_TYPE=x11 CRAIDD_UI_APP=/tmp/craidd-gr001-target/release/craidd-studio CRAIDD_METRIC_DISPLAY=xvfb CRAIDD_METRIC_MILLION=/tmp/craidd-metrics-million.csv npm run test:ui:metric-release
```

The runner enables `JSC_logGC=1` (Basic, verified against installed JSC options)
and opt-in `CRAIDD_METRIC_TRACE=1`; neither changes a system policy or producer.
It records query/render phases, timer gaps and GC stderr arrival timestamps.
GC logs can be buffered, so proximity is not causal proof. It records pre-import
RSS/PSS and process composition separately from incremental RSS on every run.
The owning-window recovery uses Craidd's Window Manager Close command, verifies
cancelled reader/storage release, FD closure and RSS return, then imports again
in a fresh visible IDE window. W3C browser-context Close Window is not treated
as native-window lifecycle evidence.

Full evidence and caveats are in the
[M1 results](../../docs/feats/profiling/revisions/gr-001-m1-results.md).

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
