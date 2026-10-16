# Design: Attach to process

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal tightened 14 October 2026. Defines attach as a
first-class capability and a candidate second LDI origin. No attach or Unity
adapter acceptance is established by this document.

**Companions:** [Value vs state](../../philosophies/debugging/ldi-debugging/philosophy-value-vs-state.md),
[LDI debugging](../ldi-debugging/design-ldi-debugging.md),
[Attached profiling](../profiling/design-attach-profiling.md),
[Unity native plugin](../../unity/feats/design-unity-native-plugin.md).

**Governs:** How Craidd connects to a process it did not launch, what
that session can do, and what it must not do.

---

Experimental attach routing and ownership handling now exist. See the [implementation evidence](../profiling/implementation-attach-gold.md) for adapter probes and the outstanding desktop lifecycle gates.

## The decision

Craidd offers **attach** as a first-class debugger capability, alongside
the existing launch path. Attach connects a Craidd-managed debugger
session to a process the user selects by PID. The process is not
Craidd's child. It is not recorded by the process supervisor. Its
default teardown is Detach, not Terminate.

Attach is motivated by the Unity case, but it is not Unity-specific. It
applies to any foreign process the user can name:

- A Unity player or the Unity Editor.
- A service started by systemd.
- A Rust or C++ binary started from a shell.
- A Python script started by another tool.
- A long-running server launched by a container runtime.

Each target still needs a qualified adapter, permissions and lifecycle path.
The same interaction can serve them; support is recorded per adapter/runtime.

### Attach is LDI's second origin

Attach provides a candidate held-frame origin for LDI. It remains an independent
capability for ordinary debugging and PID-targeted profiling.

A qualified attached adapter must expose the exact supported call-site frame,
argument representation, stop scope and release/cancellation behaviour. The
managed LDI coordinator still validates signature, native artifact, driver and
hold identity. Similar DAP request shapes do not prove equivalent value access
or runtime support. The CoreCLR scalar implementation is not automatically a
Unity implementation. The reproduction keeps its own heap and execution.

---

## What attach is and is not

**Attach is:**

- A debugger session whose origin is a foreign process named by PID.
- A participant in the linked-window group, on the same footing as a
  launched session.
- A source of a held frame, and therefore a source of LDI's origin.

**Attach is not:**

- A `.craidd` project. A foreign process has no project marker in the
  solution. Attach does not create one and does not appear in Solution
  Explorer.
- A build target. Attaching does not imply Build, Run, or any other
  target-shaped action.
- A supervisor-owned process. The supervisor does not record the PID
  and does not reap the process.

---

## The interaction

### Entry points

- **Command palette:** `Debug: Attach to Process…`
- **Run menu:** **Run → Attach to Process…**, the primary entry point.
- **Toolbar:** show the connected target/status after attach. A permanent
  Attach button beside Debug is not part of the default layout.
- **Contextual discovery:** an identified external target may offer attach;
  opening a Unity script never silently connects or pauses the target.

### The process picker

A dialog listing currently running processes. Columns:

- **PID**
- **Name** (from `/proc/<pid>/comm`)
- **User** (from `/proc/<pid>/status`)
- **Executable** (from `/proc/<pid>/exe`, resolved symlink)
- **CWD** (from `/proc/<pid>/cwd`, resolved symlink)
- **Likely adapter** — see the detection table below.

Filterable by name, user, and adapter. Sorted by executable by default.

**Likely adapter detection.** A best-effort hint, never silent:

| Signal | Adapter hint |
|---|---|
| The process has `libcoreclr` mapped | netcoredbg |
| The process has `libmono` mapped | Managed/Unity adapter candidate; DotRush `monodbg` is protocol-qualified for a Mono development player (see Unity record); Craidd routing is not implemented |
| The process has a Python interpreter mapped as its main executable | Python DAP (future) |
| The executable is an ELF binary with debug sections, or an LLDB-compatible target | LLDB-DAP |
| Nothing matches | "(no adapter detected)" — the user may still pick one |

The hint is a column. It is not a decision. The user picks the adapter
explicitly in a second field. If the hint is wrong, the user's choice
wins.

### After attach

The session appears in the tray, in the toolbar's active-debug context,
and in the Debug sidebar, exactly as a launched session does. The
thread dropdown works — it lists the threads the attached adapter
reports, with names, states, stop reasons, and the same running-time
counters a launched session would show.

The process does **not** appear in Solution Explorer. It has no
`.craidd`, and attaching does not create one.

---

## Adapter support

### First proposed qualification targets

- **LLDB-DAP.** Attach via the `attach` DAP request with `processId`.
  LLDB-DAP supports attach as a first-class operation.
- **netcoredbg.** Qualify its attach request against a CoreCLR process the
  user started. CoreCLR support does not imply Unity Mono/IL2CPP support.

### Documented, deferred

- **Unity-compatible C# adapter.** Protocol evidence, not Craidd support:
  DotRush `monodbg` 2026.10 passed attach, breakpoint, stack/locals, step,
  detach, reattach and adapter-failure cases against a Unity 6000.5.10f1 Mono
  development player and a disposable batch Editor. See the
  [qualification record](../../unity/feats/record-unity-managed-csharp-qualification.md)
  and [integration proposal](../../unity/feats/design-unity-managed-csharp-attach.md).
  Its `processId` is a TCP port, it lacks `configurationDone`, and it emits
  `terminated` without `exited`; the current attach path needs those three
  routing changes before use. Remaining: qualify runtime endpoint discovery in
  Craidd, frame reads for LDI, and teardown through the UI. A generic Mono label does not identify a usable
  adapter. Unity documents C# debugging on both Mono and IL2CPP; this is not
  a claim that Craidd supports either route today. See
  [Unity's debugger setup](https://docs.unity3d.com/6000.0/Documentation/Manual/managed-code-debugging.html).
- **Python DAP.** Requires its own language/runtime attach qualification.
- **Mixed managed/native control.** Do not promise cross-boundary stepping or
  simultaneous independent tracers. Native ptrace ownership, managed runtime
  protocols and adapter coexistence must be qualified individually.

---

## Ownership semantics

This is the correctness-critical section.

### The process supervisor does not record the PID

`process_supervisor::spawn` gates every Craidd launch. Attach does not
go through the supervisor. The owned-target tree must not contain the
attached PID. Craidd may supervise its own adapter/collector children; their
ownership never extends to the foreign target.

### Default teardown is Detach

When the session ends — the user closes the window, presses Stop, or
quits Craidd — the default action is **Detach**, not **Terminate**.

The backend sends the DAP `disconnect` request with
`terminateDebuggee: false` (or the adapter's equivalent). The required
accepted outcome is that the foreign process continues running.
Verify adapter detach semantics before exposing this as a supported route; an
unacknowledged disconnect is an error, not proof of safe detach.

### Terminate is a separate action

The proposed Terminate capability is a distinct action:

- The user requests it explicitly from the session's context menu.
- The UI requires confirmation before it fires.
- The backend sends `disconnect` with `terminateDebuggee: true`, or
  sends the platform signal if the adapter does not support the flag.

There is no path by which closing a window kills the attached process
by accident.

### Drop impls do not touch the process

`DebugManager::drop`, `RunnerManager::drop`, and the process
supervisor's shutdown paths iterate their own records. An attached
foreign target must be excluded from owned-target reaping. Enforce this with
a distinct backend ownership/session kind and audited cleanup paths. The final
collection layout is an implementation detail; frontend labels alone cannot
protect the target.

### The Debug sidebar reflects the distinction

An attached session's sidebar header states "Attached" and shows the
PID. A launched session's header states the launch configuration. The
difference is visible so the user cannot mistake one for the other.

---

## Symbol policy

An attached process's modules are on disk; their symbols may or may not
be. The attach dialog and the session expose:

- **Loaded modules.** From the adapter's `modules` request, `module`
  events or the equivalent, when supported. A module without symbols is
  marked "no symbols."
- **Symbol path.** A per-session field for additional paths. Stored in
  session state, not in any project file.
- **Download symbols.** A per-attach opt-in, mirroring the existing
  per-language `download_debug_symbols` setting. Off by default. When
  on, remote symbol requests are bounded (5 seconds), as in the
  existing implementation.

The policy is: **never download silently.** The user sees the module
list, sees which lack symbols, and decides.

---

## Composition with existing subsystems

### Linked windows

An attached session is a participant in the linked-window group, on the
same footing as a launched one. It can be hidden, restored, focused,
and selected in the tray.

A linked Gold action may mix launched and attached participants after
ownership qualification. The plan identifies attached targets as already
running; it never launches a second copy. Attach success is its own gate:
only launch-specific startup/readiness steps are skipped. Group Stop detaches
foreign participants and terminates only owned targets. Group Restart must
not kill/relaunch a foreign process; any reattach requires verified identity.
One native library viewport is a view of its consumer, not a second target.

### Breakpoints

Breakpoints are solution-scoped, as they are today. An attached session
uses the same breakpoint store. A breakpoint set in an attached session
belongs to the solution the user is in — the same as a breakpoint set
in a launched session.

### LDI

An attached managed session is a candidate LDI origin for a qualified
frame-read provider. It must pass held-frame, supported ABI/input, artifact
and release tests. The existing launch-time CoreCLR hook/interposer cannot be
enabled by attaching to an unprepared process. A separately prepared runtime
integration is future work, not an automatic attach capability. On Detach,
finish the cancellation barrier for any owned reproduction and resolve the
origin hold through the qualified adapter; never leave an invisible hold.
Failure must stay visible without silently terminating the foreign origin.

### Profiling

The verified target identity can be used by compatible collectors. Profiling
can also target a PID without debugger attach. Installed-tool discovery,
permissions, instrumentation and concurrent-debugger compatibility remain
separate requirements. Debug automatically arms qualified Gold bindings, per
[Gold capture](../profiling/design-gold-capture.md); attach alone does not
supply non-stopping source events.

### MT

Reuse the ordinary per-session thread presentation for adapter-reported
threads. Qualify names, stop/continue scope, reference invalidation and
restart/exit cleanup on each attach route. Similar DAP messages permit reuse,
but do not establish that every adapter has identical behaviour.

---

## Failure modes

- **Permission/runtime rejection:** preserve the adapter error and context;
  do not substitute another adapter silently or request unbounded escalation.
- **Process exits or PID is reused:** bind PID plus verified OS process
  incarnation (for example Linux start time), adapter generation and run ID.
  Validate identity before an operation; a connection generation alone cannot
  distinguish two different processes using the same PID.
- **Adapter crashes or Craidd dies:** no target termination is requested.
  Actual detach/resume behaviour is adapter-specific and requires fault
  acceptance. Never assume pipe closure resumes a stopped target safely.
- **Disconnect fails:** show the unresolved session/hold and recovery action;
  do not report Detached or fall back to killing the target.
- **Missing symbols/source:** permit honest unresolved inspection; refuse
  guessed Gold/LDI source bindings.

---

## Delivery order

1. **Attach command and picker.** Command palette entry, PID list,
   adapter hint, explicit adapter choice.
2. **LLDB-DAP attach.** The first adapter. Verifies the whole path
   against a foreign native process.
3. **netcoredbg attach.** The managed path. Verifies against a running
   CoreCLR process the user started.
4. **Additional ownership acceptance.** Session kind and safe Detach are
   prerequisites of steps 2–3, not deferred until after attach can be used.
   Exercise crash/close/Gold Stop and confirmed Terminate separately.
5. **Symbol policy.** Module list, symbol path, download opt-in.
6. **Linked-window composition.** Attached participants in the group;
   mixed launch-and-attach Gold actions.
7. **Unity C# adapter (deferred).** Qualify the actual version/backend
   endpoint and frame provider separately from LLDB native attach.

---

## Acceptance

- Attach LLDB-DAP to a foreign C++ process. Set a breakpoint, inspect
  the stack, step. Close the session. **The process is still running.**
- Attach netcoredbg to a CoreCLR process the user started from a shell.
  Set a breakpoint, inspect the frame. Close Craidd entirely. **The
  process is still running.**
- Attach LLDB-DAP to a Unity player. Set a breakpoint in a native
  plugin `.so`. Step. Use the thread dropdown. **The Unity process is
  still running after detach.**
- Terminate an attached session. **The process ends.** The action
  required explicit confirmation.
- Attach to a process, then attach to a different process. **The two
  sessions do not collide.** Neither process sees the other's session.
- Attach to a process, then press Gold Run on a linked group that
  includes the attached participant. **The attached participant is not
  launched; the group's other participants are.**

---

*Last updated: Phase 3.x, 16 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
