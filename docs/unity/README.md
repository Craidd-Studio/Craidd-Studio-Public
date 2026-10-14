# Unity, attach and profiling design collection

**Roadmap track:** Phase 3.x attach/LDI and Phase 3.5 profiling proposals.
**Status:** Design navigation and qualification boundaries, 14 October 2026.

## Reading order

1. [Unity native plugin workflow](feats/design-unity-native-plugin.md) —
   Unity owns execution; Craidd attaches to the real Editor/player process.
2. [Attach to process](../feats/debugging/design-attach-to-process.md) —
   Run menu entry, adapter qualification, foreign ownership and safe Detach.
3. [Gold capture](../feats/profiling/design-gold-capture.md) — one optional
   solo per context, explicit pairs, automatic arming and grouped results.
4. [Attached profiling](../feats/profiling/design-attach-profiling.md) —
   whole-process sampling checkpoint, collectors and Gold CPU/memory gates.
5. [Value vs state](../philosophies/debugging/ldi-debugging/philosophy-value-vs-state.md)
   and [managed LDI](../feats/ldi-debugging/design-ldi-debugging.md) — held
   origin, supported copied inputs, separate reproduction and release.

## Implementation boundary

The existing Profiler panel is layout only. This collection does not deliver
Unity attach, a profiling bridge, Gold event instrumentation, CPU/memory
collectors, a Unity C# adapter or Unity-specific LDI qualification.

Native attach, C# attach, exact Gold capture and Play lifecycle have separate
acceptance gates. A PID sample or instrumented native reproduction is not
proof of all four. Unity documents C# debugging on Mono and IL2CPP; Craidd
adapter support still needs evidence for the selected version and backend.

The native plugin is a loaded module in Unity's process. Its ordinary source
project can be opened without creating a special Unity project type. LDI's
native driver, if supported, is a distinct owned process with a distinct heap.

## Continuing this branch

[The design handoff](../handoffs/handoff-unity-profiling-2026-10-14.md) records
the agreed UX, open provider decisions and the first implementation proof.
HTML references are visual studies; they do not override these contracts or
establish runtime support.

---

*Last updated: Phase 3.x / 3.5, 14 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
