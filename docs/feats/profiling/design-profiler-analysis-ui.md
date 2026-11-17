# Profiler analysis interface

**Roadmap track:** Phase 3.5 profiling.
**Status:** Implementation authorized 23 October 2026; desktop and human acceptance remain separate gates.
**Scope:** GR-002 timed capture first, followed by the GR-001 M1 inspection layout. No flight recorder, live CSV follow or automatic clock alignment.

The supplied [metric inspection candidate](design-metric-inspection-editor.md) establishes the chart-first direction. Use Craidd's existing Profiling editor and visual language. Imported metrics remain editor-only. Process/Gold and perf are available in both normal profiling hosts; the sidebar offers an editor action when more space is needed.

## Timed CPU capture

A compact target header leads to the existing Attach to Process dialog and its Profile only action. Capture setup shows event, requested frequency and approximate per-thread CPU interval, duration, explicit FP/DWARF and DWARF stack size. Review the backend's estimated output and coverage warnings before starting. Stop acts on perf only. Poll capture status independently of the results view, preserve partial output and show collection versus decoding states.

The analysis surface has a capture history, top-down/bottom-up call tree and a details inspector. Expand branches with bounded native queries. Thread filtering includes TID, a name filter groups identically named workers, and a module filter retains complete calling context. An explicit elapsed range uses the capture's own clock. Event shares and sampled weights are labelled; unresolved module/address frames and map-resolved names remain visible. Source navigation uses the backend's validated source location. Capture metadata exposes loss reports separately, omitted samples, gained threads, raw bytes, limits, symbol identity diagnostics and reasons for partial completion. Pinning and raw reopening use existing cache ownership and retention.

The initial event is cpu-clock:u, 99 Hz default or 999 Hz, 10 s default up to 120 s. Raw cap 512 MiB with 32 MiB finalisation reserve. Only threads existing at capture start are included; 100 ms observation may miss short-lived additions. FP can miss callers above modules without frame pointers. Clocks stay separate. LLDB coexistence remains refused. Normal .NET perf-map naming is a known limitation; no runtime workaround is added.

## Imported metrics

Move setup into Column meanings / Import issues / File details views. Place source and searchable column selection beside the chart; compatible units share a labelled scale, mixed units have separate tracks. Extrema reduction stays explicit. Use original row inspection, bounded row pages and an explicit ranked column. Preserve editable interpretation, suggested units/meanings, bulk edits, named-key companion joins and immutable snapshot reopening. Chart selection resolves to an original row, never a display bucket. Range controls provide a keyboard alternative to pointer selection. No percentile averaging, inferred window durations or positional joins.

## Verification

Record automated, real desktop, responsive layout, capture/Stop survival, immutable snapshot and human usability independently. Check keyboard controls, narrow editor layouts, stable asynchronous selection and stale query rejection. Preserve existing uncommitted M1 evidence documents. Public release requires human acceptance; attractive screenshots alone do not establish readiness.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
