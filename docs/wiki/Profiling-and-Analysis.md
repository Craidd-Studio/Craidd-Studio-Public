# Profiling and Analysis

The Profiler is available in the right-side host and as an expanded **Profiling**
editor tab. Opening that tab gives the data more room while retaining normal IDE
navigation. Closing the tab changes presentation; explicitly stop a collector
when you want collection to end.

## Process / Gold

Choose an eligible running target through **Attach…** / **Profile only**.
Process gauges describe the process, while prepared Gold ranges describe their
instrumented observations. Attaching alone does not create arbitrary source-line
instrumentation or managed heap/GC/GPU data.

Gold Start/End/Solo markers, recording scopes and manual snapshots have separate
roles. Scopes select retained recording context; snapshots preserve an observation.
Inspect the selected identity before comparing live data with historical captures.
Late frees, retention bounds and incomplete coverage must remain visible.

The C++ provider header is product source at
[src-tauri/native/profiling](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/src-tauri/native/profiling/README.md).
Prepared-source support has explicit statement-anchor/input limits; use the
tracked fixtures and design before instrumenting another application.

## Imported CSV metrics

Use **Imported metrics** in the Profiling editor. Open finished CSV files, inspect
integrity, choose useful series and review suggested units/column meanings.
A retained row ordinal is not automatically a time axis. Mixed units and missing
window durations must stay explicit; companion data needs a declared join.

Use chart/table selection for original rows, the **Table** view in shorter windows,
and snapshots for immutable reopening. Do not average per-window percentiles
and describe the result as a run-level percentile. Live CSV follow and cross-session
alignment/comparison are later work.

## Timed CPU sampling

**CPU sampling** uses installed Linux `perf` for bounded captures. Review target,
frequency, duration, unwinding, output estimate and coverage warnings before
starting. Inspect top-down/bottom-up calls, threads/modules and the capture's own
elapsed clock. Retain unresolved symbols and PARTIAL reasons when coverage is
incomplete. Symbol resolution and Mono naming retain their documented limits.

The system must permit profiling that target; Craidd does not change kernel
policy. Stopping profiling must not terminate a foreign application.

One sustained native Unity rollover/replay run passed with zero reported loss;
historical intermittent loss and wider qualification remain recorded. Small
fixture/desktop passes do not establish million-row performance or human usability.
See [the analysis contract](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/feats/profiling/design-profiler-analysis-ui.md)
and [Release Status and Roadmap](Release-Status-and-Roadmap).

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
