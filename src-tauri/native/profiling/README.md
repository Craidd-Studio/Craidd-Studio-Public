# Native Gold profiling provider

`craidd_gold.hpp` is Craidd's C++ source-instrumentation helper for prepared
Gold profiling builds. It emits authenticated local process/range/allocation
and Unity Play-state events to the selected collector. It is product source,
not generated output or an external debugger bundled with the app.

The Rust Gold preparation code embeds this header with `include_str!` and
writes it beside a prepared source copy. The native and disposable Unity
fixtures compile against the same header. Keep those paths in sync when
moving it. This directory moved from `support/profiling/` on 17 November 2026;
the header bytes were preserved.

Native Unity collection does not provide managed-heap/GC or GPU measurements.
The provider uses bounded nonblocking delivery; inspect the collector's loss
and completeness indicators. See the [profiling design](../../../docs/feats/profiling/design-profile-markers.md)
and [qualification record](../../../docs/handoffs/handoff-phase-3-prerelease-integration.md).
