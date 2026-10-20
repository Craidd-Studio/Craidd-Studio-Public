# Philosophy: value vs state

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Design boundary reviewed 14 October 2026 during the Unity
attach/profiling discussion. Attached origins and richer input types remain
qualification targets, not implemented support claims.
Defines the two axes that bound LDI's applicability: **values vs state** and
**owned vs attached**. Cite this document when evaluating whether LDI can
handle a proposed FFI case.

**Companions:** [LDI debugging](../../../feats/ldi-debugging/design-ldi-debugging.md),
[Attach to process](../../../feats/debugging/design-attach-to-process.md),
[Unity native plugin](../../../unity/feats/design-unity-native-plugin.md).

**Governs:** Where LDI works, where it does not, and why. Applies to every
language and every FFI surface, not only to Unity.

---

## The thesis

**LDI reproduces values. It cannot reproduce state.**

A *value* is self-contained data: an integer, a float, a bounded byte
buffer, a POD struct passed by value. Copy the value into a second
process and it means the same thing. LDI works for values.

A piece of *state* is anything whose meaning depends on where it lives or
what it is connected to. Copying the number is not the same as recreating
the thing it names. LDI does not work for state, and cannot be extended
to, because every extension would violate the reproduction contract the
rest of LDI depends on.

The second axis is orthogonal. **LDI needs the origin frame, and the
frame can come from a process Craidd launched or a process Craidd
attached to.** Owned origins have bounded implemented providers. Attached
origins are candidates requiring adapter, frame/input and lifecycle proof;
the reproduction contract is retained when that proof exists.

Two axes. Two answers. The rest of this document is the reasoning.

---

## Axis 1 — values vs state

### What counts as a value

These are value-shaped categories, not a statement of current input support.
The implemented provider/signature matrix in the LDI design governs what can
actually be captured. Candidate extensions include:

- Signed and unsigned integers, `bool`, `float`, `double`.
- Enums, whose underlying representation is one of the above.
- Bounded byte buffers, `char*` + length, `byte[]` + `(nuint)length`.
- UTF-8 strings, at the boundary where the runtime has materialised the
  bytes.
- **Value structs passed by value.** `Vector3`, `Matrix4x4`, `Quaternion`,
  or any POD type whose ABI is expressible as a fixed field layout. Not
  implemented yet; see the LDI design for the `CallKind::ValueStruct`
  extension this implies.

A value is faithful when:
- The bytes are copied whole.
- The ABI is declared and checked.
- Nothing the callee observes depends on a hidden address.

### What counts as state

Anything whose meaning is not carried by the bytes:

- **Pointers used as identity.** The address is meaningful only inside
  the origin process. In the driver, the address is either invalid, or
  valid but pointing at a different object.
- **Pointers used to reach memory.** The address is meaningless without
  the memory it addresses, and the amount to copy is not knowable from
  the pointer alone.
- **Object graphs.** A C# or C++ object is a reference into a
  garbage-collected or manually-managed heap, reachable through other
  references, with identity other objects compare against.
- **Callbacks.** A function pointer, delegate, or event handler that
  points back into the origin process. The driver has no origin process
  to call.
- **Handles and identity tokens.** `InstanceID`, `GCHandle`,
  `SafeHandle`, `IntPtr` used as a lookup key. The number is not the
  object; it names the object in a registry the driver does not have.
- **Opaque structs with vtables.** Bytes are not the class; virtual
  dispatch depends on the compilation unit.
- **Locks, thread-local storage, atomics, shared memory.** Semantics
  depend on being the only instance or being the same instance.
- **Unmanaged resources.** File descriptors, sockets, GPU contexts,
  mmap'd regions. Copying the number does not copy the resource.

### The boundary

The boundary is not fuzzy. Every case above fails for the same reason:
the callee's behaviour depends on something that is not present in the
bytes. The driver has the bytes; it does not have the anything.

An extension that keeps the callee's behaviour determined by the bytes is
a real extension. An extension that requires the callee's behaviour to
depend on something the driver does not have is not an extension — it is
a different tool wearing LDI's name.

### Why this is not a defect

LDI offers an isolated native reproduction while a managed origin stays held.
Native ptrace ownership constrains independent tracers, but does not prove
that every managed/native runtime protocol or interop debugger is impossible.
The LDI design documents netcoredbg interop as a separately qualified option.
Its reproduction workflow serves the shape it was built for.
The shape is: **value-shaped calls at an FFI boundary in a process the
origin debugger controls.** That shape is real and useful. Extending LDI
past it does not make LDI better; it makes LDI worse at what it does.

The rule: **when in doubt, LDI is smaller than it looks.**

---

## Axis 2 — owned vs attached

The second axis is orthogonal, and it is the axis the Unity investigation
clarified.

### What "owned" means

The implemented owned-origin providers are prepared for a process Craidd
launches. Their lifecycle and value-acquisition paths include:

- The origin is Craidd's child, recorded by the process supervisor
  before it exec'd.
- The debugger adapter that owns the origin's `continue` is one Craidd
  started; Craidd knows its PID and its lifetime.
- At session end, Craidd knows whether to detach or to terminate.
- The interposer can be loaded at exec time, via `LD_PRELOAD` and the
  runtime's own startup hook, because Craidd controls exec.

### What "attached" means

The origin process was started by the user, by the desktop environment,
by another tool. Craidd finds it running and connects to its debugger.

- The origin is not Craidd's child. The process supervisor does not
  record it.
- The debugger adapter that owns the origin's `continue` is one the
  runtime's debug protocol allows to attach; Craidd knows its identity
  through the protocol and verified process-incarnation metadata.
- At session end, the default is Detach, not Terminate. Terminate is a
  separate, confirmed action.
- The interposer cannot be loaded retroactively. `LD_PRELOAD` is a
  launch-time mechanism; `DOTNET_STARTUP_HOOKS` is a CoreCLR
  startup mechanism. Neither is available to a process already running.

### What both share

The **held-frame contract**. Launch and attach may expose similar DAP
inspection requests, but each provider still needs proof of exact source stop,
available input representation, ABI, stop scope and release. Once those are
qualified, the reproduction can consume validated copied inputs without
changing the original hold/driver/release model.

So LDI's value acquisition has two sources on axis 1 (frame reads,
interposer), and LDI's frame acquisition has two sources on axis 2
(owned, attached). The four combinations are:

```text
                          LDI
                           │
             ┌─────────────┴─────────────┐
             │                           │
        Held frame                  Boundary capture
        (default)                   (interposer)
             │                           │
             │  reads values             │  captures marshalled bytes
             │  from DAP variables       │  at the FFI boundary
             │                           │
             └─────────────┬─────────────┘
                           │
                   Reproduce in driver
                           │
                      Debug, release
                           │
             ┌─────────────┴─────────────┐
             │                           │
        Owned frame                 Attached frame
        (Craidd launched)           (foreign process)
             │                           │
        netcoredbg owns hold        Qualified runtime adapter owns hold
```

Reading the combinations:

| Frame source | Value source | Status |
|---|---|---|
| Owned | Frame reads | **Implemented today.** The scalar path in `ldi.rs` reads `left` and `right` from DAP variables and drives the reproduction. |
| Owned | Boundary capture | **Implemented today.** The typed interposer path loads at exec, captures marshalled bytes, drives the reproduction. |
| Attached | Frame reads | **Candidate.** Requires qualified attach, exact stopped-frame/input/ABI extraction and safe hold/release; similar DAP shapes are not proof. |
| Attached | Boundary capture | **Unprepared target unsupported.** The existing launch-time hooks cannot be applied retroactively. A separately prepared in-process integration would need its own design and evidence. |

Attach is independently useful for ordinary debugging and profiling, and
also provides a candidate second LDI origin. Target ownership still changes
teardown: cancel an owned driver and resolve the hold without killing the
foreign origin. Acquisition and lifecycle qualification cannot be skipped.

---

## Why the interposer is not the LDI mechanism

The interposer is often read as "the LDI mechanism." It is not. It is a
**specialized value source for one shape of argument**.

- Supported scalar locals are read from the stopped managed frame. Value
  structs and bounded managed arrays/strings are proposed extensions, with
  provider-specific extraction and ABI qualification.
- Values that only exist at the FFI boundary — the marshalled bytes of
  a `string`, the pinned pointer the runtime hands to the native call —
  are captured by the interposer. This is the narrow case the
  interposer was built for.
- Values that cannot be reproduced regardless — pointers as identity,
  callbacks, object graphs — are neither. This is the value-vs-state
  boundary.

The interposer is therefore best understood as one of two ways LDI gets
a value, and the narrower of the two. Its existence does not change what
LDI is for.

---

## What this document rules in and rules out

**Ruled in:**

- Attach as a second frame source. The reproduction is unchanged.
- Value structs as a natural extension of the frame-read path.
- Bounded flat buffers as a natural extension of the boundary path.
- Managed strings and arrays as bounded future frame-read inputs after
  extraction/ABI proof; the typed interposer handles its qualified marshalled
  signature today.
- The Unity plugin *as a possible later artifact* that lets the
  boundary path run inside a foreign runtime, if a real user case
  warrants the cost.

**Ruled out:**

- Extending LDI to reproduce pointers as identity, object graphs,
  callbacks, handles, or unmanaged resources. These are state, and
  state cannot be reproduced by copying bytes.
- Claiming that attach applies LD_PRELOAD or the CoreCLR startup hook
  retroactively. A separately prepared runtime integration is different work;
  it would still not recreate opaque state.
- Extending LDI's claim to mean "any C# → C++ FFI call." LDI is
  *scalar-and-value FFI*. Object-shaped FFI is a different problem
  with a different tool.

---

## The one-sentence summary

> **LDI reproduces values, not state; it holds a frame from a process
> Craidd owns or attaches to; the interposer is one of two ways it gets
> a value; everything past that boundary is a different tool.**

---

*Last updated: Phase 3.x, 14 October 2026. Author(s): ShinkuKira21.*
*This document is a philosophy.*
