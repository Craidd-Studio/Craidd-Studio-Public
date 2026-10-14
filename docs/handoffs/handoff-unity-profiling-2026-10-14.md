# Handoff: Unity attach and Gold profiling design

**Roadmap track:** Phase 3.x attach/LDI; Phase 3.5 profiling.
**Status:** Design checkpoint, 14 October 2026. No runtime changes in this work.
**Continuation branch:** `feat/unity/profiling-a-to-p`.

Craidd is a Linux polyglot IDE. It composes externally discovered tools and
linked process contexts; it does not claim ownership of Unity's execution.

## Agreed design

- Attach lives primarily under Run → Attach to Process. Connected status is
  contextual; foreign targets detach by default and are never reaped as owned.
- Debug automatically arms qualified Gold capture intent. Gold source markers
  record; ordinary red stops and blue native/LDI markers retain separate roles.
- One optional explicit solo per process capture context opens on its first
  eligible hit. All other ranges are explicit pairs. Orphans remain incomplete.
- Pairs have dynamic invocation identity, their own collapsible group and
  repeated-hit records. Nested/parallel activity is not artificially serialized.
- Profiler is beside Debugger on the right. CPU and memory with contributing
  thread inspection are the public target; GPU has a planned capability surface.
- Snapshot preserves an immutable as-of view. Record again preserves a batch
  and opens another without restarting the target; late events keep ownership.
- Unity is the real consumer process. Instrumentation must match the loaded
  plugin; automatic Play-end closure requires verified lifecycle events.
- Managed LDI holds A while an owned B reproduces copied supported inputs.
  Unity attach/frame reads and richer ABI inputs remain separately qualified.

## Current implementation and open work

Profiler is currently layout only. The HTML showcase used sample data and
preset markers; it did not implement gutter placement/pairing or collectors.
Attach, Unity C# adapter qualification, Gold source-event providers and Unity
Play/frame/memory integration are not delivered by this documentation commit.

Open decisions include marker persistence/schema, the non-stopping provider,
condition grammar/evaluation, bounded retention limits and any optional Unity
profiling bridge. The bridge would be distinct from an LDI boundary interposer.
Safe attach ownership must be implemented before exposing the first attach
path, not deferred until after it. A loaded process cannot be instrumented by
merely changing gutter metadata or setting launch-time environment variables.

## First concrete proof

Qualify one installed LLDB-DAP attach route against a foreign Linux native
process, then a Unity native plugin: loaded symbols, ordinary breakpoint,
threads, disconnect, crash/close and group Stop without target termination.
Record real outcomes, including unresolved detach behaviour.

The next independent profiling checkpoint is discovered perf PID sampling
with raw samples and module attribution. Exact Gold recording requires a
separate non-stopping event proof and allocation-lifetime evidence. Do not
claim the CPU sampling checkpoint completes Gold CPU/memory profiling.

## References and next opening prompt

Read [AGENT.md](../../AGENT.md) and its required documents, then the
[Unity collection](../unity/README.md), [Gold contract](../feats/profiling/design-gold-capture.md)
and [attach design](../feats/debugging/design-attach-to-process.md).

> Continue feat/unity/profiling-a-to-p. Start by recording the current attach
> ownership paths and installed-adapter behaviour against a foreign native
> process. Preserve dirty work and the managed LDI hold/reproduction contract.
> Propose the smallest ownership-safe attach slice from that evidence. Keep
> Unity C# support, Gold non-stopping providers and runtime acceptance distinct.

---

*Last updated: Phase 3.x / 3.5, 14 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
