# Design: smallest Unity managed C# attach in Craidd

**Roadmap track:** Phase 3.x debugger attach. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Design, 16 October 2026. **Editor route: experimental
implementation.** Player route: deferred until DotRush accepts an explicit
endpoint (decision (a) below; patch drafted, not submitted). This design is
based on the [protocol qualification record](record-unity-managed-csharp-qualification.md)
for DotRush `monodbg` 2026.10. Unit tests, a live endpoint check and a protocol
probe using Craidd's arguments pass. **Desktop Craidd UI acceptance has not
been run.** See § Implementation status.

**Companions:** [attach to process](../../feats/debugging/design-attach-to-process.md),
[Unity native plugin workflow](design-unity-native-plugin.md),
[attach implementation record](../../feats/profiling/implementation-attach-gold.md).

## Scope

The design adds one attach route: **Unity Mono (DotRush)**. It is chosen
explicitly in **Run → Attach to Process…** for a Unity Editor and, once the
upstream endpoint change is released, a Mono development player. Each change is listed with the evidence behind it.
Everything else stays out of scope: IL2CPP, Unity LDI, mixed native/managed
stepping, profiler changes and broader debugger refactors.

## 1. Discovery and configuration

- Add an explicit adapter path for the **Unity managed debugger**: the user's
  `monodbg.dll`. It is shown in Preferences with its source and version. The
  only automatic candidate is an installed DotRush extension at
  `~/.vscode*/extensions/nromanov.dotrush-*/extension/bin/DebuggerMono/monodbg.dll`.
  Rescan lists every match, newest version first. Automatic uses the newest,
  and the user can pick another. Craidd never downloads, bundles or updates it
  (*no bundling of tools*).
- Run it as `<dotnet> <monodbg.dll>`, using the C# toolchain's `dotnet` (the
  `sdk` role). Report a missing .NET 10+ runtime as a prerequisite error.
- Session output names the adapter path, which includes the extension
  folder version, so evidence always names the version under test.
- The current `adapter_path("csharp")` assumes a single executable. Keep
  netcoredbg there unchanged and add a separate resolver for this adapter.

## 2. Endpoint selection

Selecting a Unity target never connects or pauses anything by itself.

| Target | Endpoint rule | Refuse when |
| --- | --- | --- |
| Unity Editor (`processes::unity_project` matches) | `<project>/Library/EditorInstance.json.process_id == PID`, and `56000 + PID % 1000` is a LISTEN socket owned by that PID | The file is missing or names another PID, or the port is not owned by the PID |
| Mono player (`libmono` mapped, not an Editor) | Exactly one LISTEN port owned by the PID in `56000–56999` | No port (not a Script Debugging build) or more than one |

- Ownership is read from `/proc/<pid>/fd` socket inodes and
  `/proc/<pid>/net/tcp{,6}`. This read-only check belongs in `processes.rs`,
  with fixtures in unit tests. There is no network scan and no multicast
  listener.
- Show the endpoint in the dialog. For players, add a warning that Unity binds
  the debugger to all interfaces without authentication.
- Re-verify PID + start time and port ownership immediately before starting
  the adapter, and again before `attach`.

## 3. Session routing

Extend `AttachRequest.adapter` with `unity-mono`. It routes to
`language = "csharp"` with an explicit adapter kind. The Unity-specific
behaviour stays local to that kind:

- **Launch:** `dotnet monodbg.dll`, without netcoredbg's `--interpreter=vscode`.
- **Attach arguments:** always pass the verified **port** as `processId`, the
  adapter's field for it. Never pass the PID; this adapter treats `processId`
  as a TCP port (record § Protocol).
  - Editor: `{processId: port, cwd: <project root>}`. Assemblies default to
    `Library/ScriptAssemblies`.
  - Player: `{processId: port, cwd: <dir>, userAssemblies: [<Player>_Data/Managed/Assembly-CSharp*.dll]}`.
    DotRush 2026.10 still requires `<cwd>/Library/EditorInstance.json`.
    **Decided (16 October 2026): (a)**, an upstream change, rather than (b), a
    Craidd-private `EditorInstance.json` shim. The drafted patches are in
    `tests/fixtures/unity-managed-debug/upstream/`. With them, a Generic
    `transportArgs.port` (optional `host`) connects without that file, and
    `configurationDone` returns an empty response instead of ending the
    adapter. Built from 2026.10 plus the patches, the player probe passes S1–S6
    with no shim and with `configurationDone` sent (run `patched1`). Once a
    DotRush release includes them, the player route sends
    `{transportArgs:{type:"generic",port}, userAssemblies:[…]}`.
- **Startup:** send `configurationDone` only when the adapter advertises
  `supportsConfigurationDoneRequest`; otherwise treat configuration as
  complete. This is a generic DAP correctness fix in `DapStartup`. lldb-dap and
  netcoredbg both advertise it (checked), so their behaviour is unchanged.
- **Identity:** DotRush sends no `process` event. The pre-verified target
  identity is authoritative, as for every other attach.
- **Stops:** step completion arrives as `reason: "pause"`. The existing
  generic stopped handling accepts it; the UI must not label it a user pause.
  Use the `threads` request rather than `thread` events.

## 4. Ownership and teardown

Reuse the existing attached session kind: no supervisor record and no
target signals.

| Event | Proposed handling | Evidence |
| --- | --- | --- |
| Stop / window close / cancel | `disconnect(terminateDebuggee:false)`, then await the ack | S1, S2, E1, E3: ack received, target alive |
| Detach while paused | Same; the target resumes and the adapter's breakpoints are gone | S2 → S3 |
| `terminated` (target ended) | **New for this kind:** send `disconnect(false)`, await the ack, then reap the adapter. The current attached path waits for an ack that never comes | S5 |
| Adapter crash / pipe loss | Keep today's honest "ended without confirmed Detach" message. Never signal the target | S3 → S4: Unity resumed and accepted a reattach |
| Terminate | Not offered: the adapter has no terminate support | Source |
| Editor Play exit / re-entry | Keep the session. Breakpoints go unverified (`Assembly unloaded`) and then verified again; reflect that in the gutter | E2 |
| New player incarnation | A new attach; the old session has ended | S6 |

`start_prepared` currently also starts a profiling context for every attached PID.
That is profiling scope and is unchanged here. If managed attach should not
auto-start profiling, the profiling track decides that separately.

## Implementation status (16 October 2026)

| Area | State |
| --- | --- |
| `processes.rs` | `listening_ports` (/proc only), `unity_editor_endpoint` (EditorInstance PID match + owned `56000 + PID % 1000`), `ProcessInfo.unity_managed_port`, adapter choice `unity-mono` |
| `toolchain.rs` | C# role `unity_debugger` (`monodbg.dll`), discovered under VS Code-family `nromanov.dotrush-*` extensions; Preferences → Toolchain → C# shows it |
| `debug.rs` | `unity-mono` attach: `dotnet monodbg.dll`, `{processId: port, cwd: project}`, endpoint re-verified before `attach`; generic `configurationDone` capability gate; attached `terminated` without a prior disconnect sends `disconnect(false)` |
| Attach dialog | Adapter option, endpoint line, disabled Attach without a verified Editor endpoint |
| Not done | Player route (upstream), gutter reflection of `breakpoint` changed events (Craidd ignores them today), IL2CPP |

Validation: `cargo test --lib` 165 passed / 6 ignored, including endpoint,
port-ownership, DotRush discovery and attach-argument tests. `npm run build`
and the 85 frontend tests pass. The opt-in
`running_unity_editor_managed_endpoint` test passes against a disposable
Editor (PID 351371, port 56371). The Editor probe with `--craidd-arguments` and
unpatched 2026.10 passes E1–E3 (run `editor7`). None of this is desktop UI
acceptance.

## 5. Validation plan

1. Rust unit tests (Editor parts done): endpoint selection from `/proc`
   fixtures and attach-argument construction (port, never PID). Still to add
   with the player route: player port selection. The startup gate and
   `terminated` handling live in the reader loop, so they are covered by the
   probe and desktop acceptance, not by unit tests.
2. Opt-in live tests that reuse `tests/fixtures/unity-managed-debug/`.
3. **Craidd UI acceptance on the real desktop**, recorded separately: Editor
   and player attach from the dialog, gutter breakpoint, stack/locals panel,
   step, continue, Stop, window close, Craidd quit while paused, Play
   exit/re-entry, player quit, and other Unity windows untouched.

## Deferred: Unity LDI prerequisites

- Held-frame reads must not run getters: configure DotRush evaluation options
  (`debuggerOptions`) so locals and arguments are read without implicit
  evaluation, and qualify that behaviour.
- Typed scalar values: DotRush returns display strings with type names. LDI
  needs verified raw values and an ABI mapping for the P/Invoke signature.
- A defined origin hold and release: one breakpoint stop held while an owned
  native reproduction runs, then exactly one continue. Detach-from-pause
  resumes Unity (S2), so teardown cannot leave an invisible hold.
- Coexistence of LLDB on an owned driver with a Mono session on Unity was not
  tested. Attaching both to Unity's own process was not tested either.

---

*Last updated: Phase 3.x, 16 October 2026 (Editor route implemented). Author(s): ShinkuKira21.*
*This document is a design.*
