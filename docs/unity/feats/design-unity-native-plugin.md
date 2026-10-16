# Design: Unity native plugin debugging and Gold profiling on Linux

**Roadmap track:** Phase 3.x debugger attach and Phase 3.5 profiling.
See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal tightened 14 October 2026. Attach, Unity adapter
qualification and Gold collectors are not established by this document.
Existing managed LDI is a separate bounded implementation. A [small C#↔C++ fixture](../../../workspaces/unity/README.md) and experimental source profiler now exist; see the [implementation evidence](../../feats/profiling/implementation-attach-gold.md). A general Unity adapter or LDI boundary interposer is not established by those tests.

**Companions:** [Attach to process](../../feats/debugging/design-attach-to-process.md),
[Gold capture contract](../../feats/profiling/design-gold-capture.md),
[attached profiling](../../feats/profiling/design-attach-profiling.md),
[value vs state](../../philosophies/debugging/ldi-debugging/philosophy-value-vs-state.md),
[LDI](../../feats/ldi-debugging/design-ldi-debugging.md).

## Unity owns execution

The motivating case is a Linux Unity game using a native C/C++ plugin.
Unity starts the Editor/player and loads the plugin. Craidd opens the plugin's
source/project and attaches to the actual consumer process. The plugin's `.so`
is a module in that process, not another executable participant to launch.

Craidd does not mirror Unity's Assets/Packages/ProjectSettings model into a new
`.craidd` framework type. A plugin source project can retain its ordinary
C/C++ declaration. External process discovery and opening a script do not
silently attach, profile, pause, restart scenes or modify the Unity project.

**Run → Attach to Process…** is the primary entry. The picker identifies the
Editor/player, PID/incarnation and explicit adapter choice. Loaded modules,
symbols and source mapping must resolve the intended plugin artifact. Attached
state appears in Debugger/external session context, not as an invented project
in Solution Explorer. Detach keeps the target running; Terminate is a separate
explicitly confirmed action under the general attach contract.

## Native and C# debugging are separate qualification routes

| Route | Proposed Craidd behaviour | Prerequisite / limitation |
| --- | --- | --- |
| Native plugin in Editor, Mono player or IL2CPP player | LLDB-DAP attaches to the real process and inspects native plugin code | Installed adapter, attach permission, debug symbols and loaded-artifact mapping |
| Unity C# source debugging | Connect a Unity-compatible managed-debug protocol adapter | Endpoint discovery, Unity configuration and a specifically qualified adapter; stock CoreCLR netcoredbg support is not proof. DotRush `monodbg` is protocol-qualified for the Mono player and batch Editor ([record](record-unity-managed-csharp-qualification.md)); Craidd routing is a [proposal](design-unity-managed-csharp-attach.md) |
| Value-shaped C# → native LDI | Hold a supported Unity C# call site and reproduce copied inputs in an owned native driver | Qualified held-frame extraction, ABI/driver support, release/cancellation and artifact identity |
| State-shaped native call | Inspect the real native execution or C# side through the chosen route | Never reproduce pointers, handles, callbacks or Unity object state by copying their numbers |

Unity documents C# debugging for **both Mono and IL2CPP**, on supported
platforms. IL2CPP's compilation to native code does not imply that Unity
provides no C# debugging protocol. This corrects the earlier proposal's blanket
exclusion. Craidd support still requires adapter and protocol qualification;
Unity support does not establish our DAP integration or LDI frame reader.
See [Unity's C# debugging setup](https://docs.unity3d.com/6000.0/Documentation/Manual/managed-code-debugging.html).

For C# player debugging, Unity documents Development Build and Script Debugging
setup. For Editor debugging, its code-optimisation mode must support debugging.
Record the actual Unity version, scripting backend and target configuration in
acceptance; do not treat generic Mono process detection as an endpoint.

Do not promise mixed managed/native stepping from two separately attached
adapters. Ptrace ownership limits native tracers; Unity's managed protocol and
native attach coexistence require their own tests. The LDI design already
corrects the broad claim that all Linux mixed debugging is impossible. No
universal ecosystem exclusion is needed to justify a separate reproduction.

## LDI with Unity

The intended frame-read sequence retains the existing LDI contract:

1. In the eligible linked-debug context, blue identifies a supported C# call
   site and native export. Ordinary Gold profiling markers do not activate LDI.
2. The managed adapter holds the exact origin frame. Read already available,
   supported argument values without executing getters or user expressions.
3. Validate signature, loaded native artifact and driver setup; start the
   owned native reproduction with immutable copied inputs.
4. Debug that driver through LLDB-DAP. Its heap, globals, TLS and native
   initialization are separate from Unity's.
5. Verified completion or explicit cancellation releases the exact held
   origin once; Unity then executes its original call with its own result.
6. On detach/close, cancel the owned driver and resolve any Craidd-owned hold
   through the qualified teardown barrier. Never leave an invisible origin
   hold or send a late release into a new Unity run.

Unity scalar frame reads are a future candidate, not an accepted product
path. Value structs such as Vector3/Quaternion additionally need the proposed
ABI-aware value-struct extension; an adapter alone is not the only dependency.
A scalar signature also does not prove the callee is independent of Unity
state. Decline known unmet initialization/state dependencies explicitly.

The current CoreCLR startup hook and typed proxy are not a Unity attach path.
Setting LD_PRELOAD or DOTNET_STARTUP_HOOKS after a process starts cannot apply
those launch-time mechanisms retroactively. A future in-process integration
would need separate runtime/loading/binding proof; it is not universally
impossible to load code into a running process. Neither integration nor a
copied bounded buffer recreates opaque Unity objects, GPU contexts or callbacks.

Post-hoc captured values remain logs/fixtures, not this held-origin LDI flow.
An immutable scalar copy does not become corrupt merely because time passes,
but later replay lacks the live held-origin relationship and still cannot
recreate the origin's state. Saved profiling snapshots never start a driver.

## Gold capture workflow

1. Open plugin source and place the optional single solo Start and explicit
   Start/End pairs using the [gutter contract](../../feats/profiling/design-gold-capture.md#gutter-interaction).
2. Prepare a supported marker provider. Instrumented plugin code must be built
   before Unity loads it. Record the exact loaded artifact and source version.
3. Start Play Mode or the player in Unity; select its real process in Craidd.
4. Debug attach automatically arms enabled, compatible Gold bindings. If
   instrumentation is absent or stale, show Unbound / Pending rebuild/reload.
5. The solo's first eligible hit opens the overall capture. Repeated paired
   function/update invocations accumulate beneath their range's collapsible
   group. Pairs work independently before the solo or when no solo exists.
6. Snapshot preserves an immutable as-of view while Live continues. Record
   again creates a fresh batch; it does not restart Unity or rerun a method.

External PID sampling can work without debugger attachment or Gold markers.
It remains a separately labelled source in Profiler, with a verified plugin
module filter. Sampling alone does not establish exact Gold source boundaries.

Do not silently rebuild or overwrite a plugin already loaded by Unity. The
user must see the preparation and required reload/restart path. Updating gutter
metadata cannot instrument an already running unprepared binary.

## Runtime events and the optional Unity bridge

Gold requires non-stopping source events. Attach alone does not supply them,
and ordinary stop/continue breakpoints do not satisfy the recording contract.
An instrumented native plugin or a qualified generic tracing provider may
supply Gold events without a dedicated Unity integration.

Unity-specific frames, Play lifecycle, GC observations and engine thread names
may justify a **small profiling bridge**. This is a different artifact from
an LDI boundary-capture interposer. Its possible value is now broader than the
old document's assertion that every Unity plugin exists only for LDI buffers.
It remains deferred until a concrete provider design and use case are accepted.

Unity exposes IUnityProfiler for native instrumentation and
IUnityProfilerCallbacks for forwarding marker/frame/thread and allocation/GC
events to external tooling. These are candidate integration surfaces, not
proof that arbitrary source-line placement or per-object retention is provided.
See [Unity's native profiling API](https://docs.unity.com/en-us/engine/6000.0/manual/programming-environment/plug-ins/native-plugin-interface/low-level-native-plugin-profiler).

A bridge contract must define opt-in installation, version/runtime compatibility,
source/artifact binding, event buffering/loss, target identity, Play generation,
transport lifetime and collector scope. Native allocation/free lifetime tracing
and managed object retention remain separate capabilities. GC event occurrence
alone does not prove reclamation of the range's objects.

The recommended first proof is native attach plus external CPU sampling. Exact
Gold CPU/memory, Unity C# LDI and a profiling bridge each have independent gates.
None is claimed shipped by that first checkpoint.

## Unity capture lifecycle

For a standalone player, the solo ends on process exit or ending its Craidd
capture session. Ending the session detaches rather than terminates the player.
An unexpected disconnect/collector loss retains partial data with the reason.

For Editor Play Mode, the target design closes the overall capture when that
Play run ends, even if the Editor PID survives. A later Play entry creates a
fresh run/generation and rearms the solo without reusing pending invocations.
Scene changes within one Play run do not automatically create a new run.

**This requires verified Play lifecycle events.** With only PID attach/sampling,
Craidd cannot infer leaving Play Mode from the Editor remaining alive. Show
Process capture · Play lifecycle unavailable; its boundary is explicit capture
session end. Do not claim automatic Play-end closure without a bridge/event
source. Domain reload disabled, managed reload, native plugin reload and Editor
restart need explicit acceptance because PID equality is not a run identity.

Open paired ranges interrupted by Play end, unwind or reload are incomplete.
A completed solo has its normal run/session endpoint. Late worker/GPU events
retain the previous run/capture identity and cannot populate a fresh run.

## Results and scope

Use the [Gold metric contract](../../feats/profiling/design-gold-capture.md#profiler-presentation):
CPU time/cycles/samples, native and managed memory capabilities, contributing
threads and an optional planned GPU section. Retain Unity frame IDs only when
provided by a qualified event source. An Update hit is not automatically one
whole frame, and overlapping paired ranges are not proof of sequential work.

Distinguish PlayerLoop from EditorLoop where runtime events identify them.
Without those events, PID samples include applicable Editor work; a module
filter alone is not equivalent to game-only profiling. For frame correlation,
see [Unity Play-mode profiling](https://docs.unity.com/en-us/engine/7000.0/manual/analysis/profiler/profiling-applications/profiling-play-mode).

Jobs and render-thread work need explicit correlation to attribute them to a
range. CPU submission may precede GPU completion; keep both events without
calling CPU wall time GPU time. Thread filters are inspection scopes and do
not freeze workers.

LDI driver results are labelled Reproduction with their own process and heap.
The original Unity process's measurements are the evidence for game behaviour;
a fast or leak-free driver does not establish those properties in Unity.

## Acceptance matrix

| Gate | Required real evidence |
| --- | --- |
| Native attach | Plugin source breakpoint, stack/threads, verified loaded module; Detach/close leaves Editor/player running |
| PID sampling | Discovered tool/permissions, raw samples, correct module attribution, clean collector Stop without target termination |
| Gold events | Non-stopping hits, one solo, paired repeats/conditions/recursion, missing events and unsupported-provider states |
| CPU and memory | Compare with raw counters/traces; distinguish native/managed scope, earlier frees, survivors and intentional cleanup |
| Play lifecycle | Enter/exit twice with the same Editor PID; domain reload on/off, scene changes, reload and stale/late-event rejection |
| C# attach | Per-version/backend endpoint, breakpoint, valid frame reads and safe disconnect, recorded separately from native attach |
| Unity LDI | Supported scalar/ABI input, fixed held origin, real driver, exactly-once release, cancellation and external-process-safe detach |
| GPU (optional) | Qualified provider and submission/completion identity, including completion after range End |

Code presence, harness checks and desktop/runtime acceptance remain separate.
Record which gates passed; no acceptance is implied by this design commit.

---

*Last updated: Phase 3.x / 3.5, 16 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
