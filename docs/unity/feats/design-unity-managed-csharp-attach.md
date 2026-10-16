# Design: smallest Unity managed C# attach in Craidd

**Roadmap track:** Phase 3.x debugger attach. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal, 16 October 2026. Not implemented. It is based on the
[protocol qualification record](record-unity-managed-csharp-qualification.md)
for DotRush `monodbg` 2026.10, a Unity 6000.5.10f1 Mono development player
and a disposable batch Editor. That record does not prove Craidd integration.

**Companions:** [attach to process](../../feats/debugging/design-attach-to-process.md),
[Unity native plugin workflow](design-unity-native-plugin.md),
[attach implementation record](../../feats/profiling/implementation-attach-gold.md).

## Scope

The proposal adds one attach route: **Unity Mono (DotRush)**. It is chosen
explicitly in **Run → Attach to Process…** for a Unity Editor or a Mono
development player. Each change is listed with the evidence behind it.
Everything else stays out of scope: IL2CPP, Unity LDI, mixed native/managed
stepping, profiler changes and broader debugger refactors.

## 1. Discovery and configuration

- Add an explicit adapter path for the **Unity managed debugger**: the user's
  `monodbg.dll`. It is shown in Preferences with its source and version. The
  only automatic candidate is an installed DotRush extension at
  `~/.vscode*/extensions/nromanov.dotrush-*/extension/bin/DebuggerMono/monodbg.dll`.
  Report every match; if there is more than one, the user picks. Craidd never
  downloads, bundles or updates it (*no bundling of tools*).
- Run it as `<dotnet> <monodbg.dll>`, using the C# toolchain's `dotnet` (the
  `sdk` role). Report a missing .NET 10+ runtime as a prerequisite error.
- Record the adapter's file version and extension folder version in session
  output, so evidence always names the version under test.
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
    **Decision needed:** (a) propose a small upstream change for an explicit
    endpoint without that file (preferred; Craidd waits for a release), or
    (b) a Craidd-private shim under
    `$XDG_RUNTIME_DIR/craidd-debug/<pid>-<birth>/`. Option (b) was proven by the
    probe; Craidd would label it in output and remove it on teardown.
    Option (a) defers player support; option (b) adds a workaround to maintain.
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

## 5. Validation plan

1. Rust unit tests: endpoint selection from `/proc` fixtures (Editor, player,
   none, two ports, foreign owner), attach-argument construction (port, never
   PID), `DapStartup` without the capability, and `terminated` → disconnect
   for this kind only.
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

*Last updated: Phase 3.x, 16 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
