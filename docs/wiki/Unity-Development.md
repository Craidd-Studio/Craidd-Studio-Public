# Unity Development

## Native profiling

Craidd can discover eligible running Unity targets and profile prepared native
providers. The tracked Unity fixture demonstrates a C#→C++ bridge, Gold ranges,
allocation observations, recording scopes, manual snapshots and Play lifecycle
handling. Attaching an arbitrary Editor does not instrument its entire managed
application.

Start with [the Unity fixture guide](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/workspaces/unity/README.md).
Its recorded qualification used Unity 6000.5.10f1; match the fixture's Editor and
build instructions. Use a disposable project copy for automation, not an active
user project whose buffers or generated plugin are in use.

The native flow is: discover/select the intended Editor, **Profile only**, enter
Play, create the fixture's observations, inspect/snapshot them and explicitly
stop collection. Inspect generation/batch identity and incomplete/loss indicators
when repeating Play or reopening retained history.

## Managed C# attach — experimental

The Editor route uses an explicitly selected DotRush Mono adapter. It has bounded
protocol/runtime evidence and incomplete desktop acceptance. Player support has
separate endpoint/upstream requirements; the existing Editor route is not a
promise of arbitrary Player, IL2CPP or Unity LDI support.

See [managed attach design](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/unity/feats/design-unity-managed-csharp-attach.md)
and [qualification record](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/unity/feats/record-unity-managed-csharp-qualification.md)
before choosing a target or adapter.

## Measurement limits

Native process/range/allocation observations do not measure managed heap/GC or
GPU/hardware-cycle performance. Some diagnostics describe missing instrumentation
rather than an Editor malfunction. Preserve these labels when sharing results.

Detailed implementation/evidence is indexed in
[the Unity technical documentation](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/unity/README.md).

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
