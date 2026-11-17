# Unity, attach and profiling design collection

**Roadmap track:** Phase 3.x attach/LDI and Phase 3.5 profiling proposals.
**Status:** Design navigation and qualification boundaries, 17 October 2026.

## Reading order

1. [Unity native plugin workflow](feats/design-unity-native-plugin.md) —
   Unity owns execution; Craidd attaches to the real Editor/player process.
2. [Attach to process](../feats/debugging/design-attach-to-process.md) —
   Run menu entry, adapter qualification, foreign ownership and safe Detach.
3. [Gold capture](../feats/profiling/design-gold-capture.md) — one optional
   solo per context, explicit pairs, automatic arming and grouped results.
4. [Attached profiling](../feats/profiling/design-attach-profiling.md) —
   whole-process sampling checkpoint, collectors and Gold CPU/memory gates.
5. [Unity managed C# qualification](feats/record-unity-managed-csharp-qualification.md)
   and [its integration proposal](feats/design-unity-managed-csharp-attach.md) —
   DotRush `monodbg` protocol evidence for a Mono player and batch Editor; an
   experimental Craidd Editor route; player route pending upstream.
6. [Value vs state](../philosophies/debugging/ldi-debugging/philosophy-value-vs-state.md)
   and [managed LDI](../feats/ldi-debugging/design-ldi-debugging.md) — held
   origin, supported copied inputs, separate reproduction and release.

## Implementation boundary

The [experimental implementation record](../feats/profiling/implementation-attach-gold.md) describes native attach routing, process gauges, prepared C++ Gold hooks and grouped Profiler results. The [tracked Unity fixture](../../workspaces/unity/README.md) provides a real C#↔C++ bridge and development player tests. Unity C# adapter protocol qualification now exists for DotRush `monodbg` 2026.10 against a Unity 6000.5.10f1 Mono development player and a disposable batch Editor across two Play runs. Craidd has an experimental Editor route (`unity-mono`) that has not yet passed desktop UI acceptance. Players wait for an upstream DotRush endpoint change; IL2CPP and Unity LDI remain open.

Native attach, C# attach, exact Gold capture and Play lifecycle have separate
acceptance gates. A PID sample or instrumented native reproduction is not
proof of all four. Unity documents C# debugging on Mono and IL2CPP; Craidd
adapter support still needs evidence for the selected version and backend.

The native plugin is a loaded module in Unity's process. Its ordinary source
project can be opened without creating a special Unity project type. LDI's
native driver, if supported, is a distinct owned process with a distinct heap.

## Continuing this branch

The [repair report](../bugs/16-10-2026/unity-profiling-final-report.md) records
real Tauri/disposable Unity acceptance, fixes and remaining limits. The
[UI/UX harness checklist](../uiux/unity-profiling-harness-checklist.md) retains
unproved clauses as open. The [initial findings](../bugs/16-10-2026/unity-profiling-uiux-report.md)
and [Opus review handoff](../handoffs/handoff-unity-profiling-uiux-2026-10-16.md)
are historical; the user subsequently supplied the independent review.

The [shared-scope contract](../feats/profiling/design-profiler-scopes.md) and
[Phase 2 implementation report](../bugs/17-10-2026/profiler-scopes-report.md)
continue this work with fixed Gold/Solo windows, independent snapshot history
and explicit native memory semantics. Their automated checks do not change the
separate human manual acceptance record.

## Generic profiling revisions

The [profiling revisions collection](../feats/profiling/revisions/README.md)
records two proposals arising from this work that apply to any compatible program:

- [GR-001: Metric CSV import and live follow](../feats/profiling/revisions/gr-001-metric-csv-import.md)
  — finished/live file sets, window semantics, clock mapping and comparisons.
- [GR-002: External PID sampling with perf](../feats/profiling/revisions/gr-002-external-pid-sampling-perf.md)
  — the PID sampling checkpoint, large-symbol/JIT handling and safe collector lifecycle.

Both retain reviewed baseline `8bac01e`. The
[accepted decisions](../feats/profiling/revisions/implementation-decisions.md)
stage delivery: [GR-001 M1](../feats/profiling/revisions/gr-001-m1-results.md)
passes automated release gates and awaits [human acceptance](../feats/profiling/revisions/gr-001-m1-human-acceptance.md);
native [perf qualification](../feats/profiling/revisions/perf-qualification-results.md)
now records the installed timed checkpoint. In-IDE timed perf has priority next;
M2 then M3 wait. These later application features are not delivered.

## Next acceptance run

Use the [detailed Unity UI/UX checklist](../uiux/unity-profiling-manual-acceptance-checklist.md)
for the joint human/automated review of sidebar and Profiling editor modes,
Gold windows, snapshots, native memory, workers, breakpoint composition and
failure/load behaviour. It carries the known open issues and keeps managed/LDI
qualification gated. The [language extension plan](../uiux/profiling-language-extension-plan.md)
then scopes the proposed `feat/profiling` work without creating the branch or
claiming that missing language providers exist.

[The design handoff](../handoffs/handoff-unity-profiling-2026-10-14.md) records
the agreed UX, open provider decisions and the first implementation proof.
HTML references are visual studies; they do not override these contracts or
establish runtime support.

---

*Last updated: Phase 3.x / 3.5, 20 October 2026 (managed C# qualification and profiling). Author(s): ShinkuKira21.*
*This document is a record.*
