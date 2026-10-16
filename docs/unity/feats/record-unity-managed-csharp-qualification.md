# Unity managed C# debugging: adapter qualification record

**Roadmap track:** Phase 3.x debugger attach. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Protocol qualification, 16 October 2026. A direct DAP probe drove an
external adapter against real, disposable Unity targets. **Craidd does not use
this route yet.** No Craidd UI, Tauri lifecycle or production code was exercised.
The integration proposal is [design-unity-managed-csharp-attach.md](design-unity-managed-csharp-attach.md).

**Companions:** [Unity native plugin workflow](design-unity-native-plugin.md),
[attach to process](../../feats/debugging/design-attach-to-process.md),
[attach implementation record](../../feats/profiling/implementation-attach-gold.md),
[Unity fixture](../../../workspaces/unity/README.md).

## Result

**DotRush's Mono debug adapter (`monodbg`) is the recommended candidate.** It
is MIT-licensed and maintained. It speaks DAP over stdio and connects to the
Mono soft-debugger agent that Unity embeds. It passed the full path
attach → C# source breakpoint → stack and locals → step → continue → detach
against two qualified targets:

| Target | Backend | Result |
| --- | --- | --- |
| Linux x86_64 **development standalone player** (Development + Script Debugging) | Mono (`Mono2x`, Unity MonoBleedingEdge `libmonobdwgc-2.0.so`) | Passed: 6 scenarios, run `player-run4` |
| **Disposable batch-mode Editor** with session-only `-debugCodeOptimization`, Play Mode entered twice | Editor Mono | Passed: 3 scenarios, run `editor-run6` |

Not qualified: IL2CPP players, the interactive GUI Editor, Editor Play with
domain reload disabled, mixed managed/native stepping, coexistence with LLDB on
the same process, and anything inside Craidd. netcoredbg was not tested against
Unity. It targets CoreCLR, and the current Craidd route correctly rejects
non-CoreCLR targets.

## Environment and versions

| Item | Value |
| --- | --- |
| Host | Arch Linux, kernel 7.2.9, x86_64 |
| Unity | 6000.5.10f1 (revision `3bd4f66ad299`), Hub install `~/Unity/Hub/Editor/6000.5.10f1` |
| Project | `workspaces/unity` on branch `feat/unity/debug-a-to-p` (from `d00d19d`); Editor runs used a scratch copy |
| Player build | `ProbeProject.BuildLinux`: `BuildOptions.Development \| BuildOptions.AllowDebugging`, Mono backend; `CraiddUnityProbe.x86_64` sha256 `a7ad5b15…e292` |
| Adapter | DotRush tag `2026.10`, commit `4b87e96584b1f0e4e81fde5ed8f1aa665a03228d`; submodule `JaneySprings/Mono.Debugger` at `9edc6120533e818e593cb73b0910e9c7990cffb2` |
| Adapter build | `dotnet publish src/DotRush.Debugging.Mono/DotRush.Debugging.Mono.csproj -c Release -o <out>`; `monodbg.dll` sha256 `a7c2dc4d…84af` |
| .NET | SDK 10.0.112, runtime Microsoft.NETCore.App 10.0.12 (adapter targets `net10.0`, `RollForward=LatestMajor`) |
| Comparison adapters | lldb-dap (LLVM 23.1.1 per existing record) and netcoredbg 3.2.0-1 both advertise `supportsConfigurationDoneRequest: true` |

The adapter was built from source rather than taken from the release's
`DotRush.Bundle.DebuggerMono.zip`. A packaged bundle needs its own version
check before anyone relies on these results.

## Candidates considered

| Candidate | Finding (primary source) | Decision |
| --- | --- | --- |
| [JaneySprings/DotRush](https://github.com/JaneySprings/DotRush) `monodbg` | MIT; not archived; last push 4 Oct 2026; DAP via `DebugAdapterBase`; Unity attach agent | **Qualified at protocol level** |
| [Unity-Technologies/vscode-unity-debug](https://github.com/Unity-Technologies/vscode-unity-debug) | Archived on GitHub (last push 5 Apr 2024); licence reported as NOASSERTION | Rejected: unmaintained |
| [mono/debugger-libs](https://github.com/mono/debugger-libs) | MIT soft-debugger client libraries; not a DAP adapter | Library only; DotRush uses a fork |
| netcoredbg | CoreCLR debugger (MI/DAP) | Not a Unity route; not tested against Unity |
| Microsoft's Unity extension for VS Code | Not evaluated | Licence and redistribution terms would need primary-source review |

## Licensing and distribution

- DotRush: MIT, © 2025 Nikita Romanov. Mono.Debugger fork: MIT (Novell/Xamarin
  notices). The fork repository also contains `eula.rtf` and Windows CorApi
  projects, which `monodbg` does not build.
- `monodbg` links **Microsoft.VisualStudio.Shared.VSCodeDebugProtocol
  18.0.10427.1**, which is under *Microsoft Software License Terms* (proprietary,
  with conditions on redistributing its object code). Mono.Cecil and
  StreamJsonRpc are MIT. Mono.Options' licence link was not reviewed.
- Craidd bundles no tools. It should **discover a user-installed** adapter
  (the DotRush extension or bundle) and never vendor `monodbg` or its
  dependencies. Revisit this if that policy ever changes.
- The adapter writes NLog files to `logs/` beside its own binary.

## Protocol and endpoint discovery

- Craidd ↔ adapter: DAP over stdio. Launch command: `dotnet <path>/monodbg.dll`
  (no arguments).
- Adapter ↔ Unity: Mono soft-debugger wire protocol over TCP. The adapter
  always connects to `127.0.0.1`.
- **Editor:** the agent listens on `127.0.0.1:56000 + (PID % 1000)` (observed:
  `--debugger-agent=…address=127.0.0.1:56471` for PID 317471). The Editor writes
  `Library/EditorInstance.json` (`process_id`, `version`, `app_path`,
  `app_contents_path`). This was observed for both the user's GUI Editor (read
  only) and the batch Editor. Unity deletes the file on exit.
- **Player:** the agent listens on **`0.0.0.0`**, at `56000 + (Guid % 1000)`,
  where `Guid` is in the player-connection announcement
  (`225.0.0.222:54997`). The player log also states it: `Starting managed
  debugger on port N`. **The port is not derived from the PID:** PID 301622
  used port 56516, and PID 301882 used 56789. Players also listen on 55000
  (player connection).
- PID-owned discovery that needs no network: map `/proc/<pid>/fd` socket inodes
  to `LISTEN` rows in `/proc/<pid>/net/tcp{,6}`. The probes connect only to
  ports they found this way.
- Ports are reduced modulo 1000, so two Unity processes can compete for the
  same port. Verify ownership before every connection.
- **Security:** a development player with Script Debugging exposes an
  unauthenticated debugger on every interface. This is Unity's behaviour.
  Craidd must not widen it and should state it to the user.

### DotRush attach arguments (2026.10)

From `LaunchConfiguration.cs` and `UnityDebugLaunchAgent.cs`, confirmed by run:

- `processId` is used as the **TCP port**, not a PID. A value of `0` selects the
  Editor formula from `EditorInstance.json`. Craidd's current attach sends the
  PID as `processId`. With this adapter that would connect to an arbitrary
  local port.
- `cwd` must contain `Library/EditorInstance.json`, **even for a player**. An
  unshimmed player attach is rejected with `EditorInstance.json not found`
  (observed, S0). The player probe uses a private shim directory. This is a
  harness workaround, not a product recommendation.
- `userAssemblies` defaults to `<cwd>/Library/ScriptAssemblies/Assembly-CSharp*.dll`.
  For a player, pass `<Player>_Data/Managed/Assembly-CSharp.dll`, which has a
  portable PDB beside it.
- Capabilities do **not** include `supportsConfigurationDoneRequest` or
  `supportsTerminateRequest`.
- `disconnect` always calls `session.Detach()` and ignores `terminateDebuggee`.

## Results

Every connection used a port verified as owned by the started PID. Before
and after each run, the probes recorded every process whose executable name
contains `unity`. These included the user's GUI Editor (PID 168668), its
helpers, Hub and licensing processes. All of them survived with unchanged
start times. The probes never signalled or connected to them.

### Development player (`player-run4`)

| Step | Observed |
| --- | --- |
| S0 unshimmed attach | Rejected (`EditorInstance.json not found`); player unaffected |
| S1 attach → breakpoint `NativeProbe.cs:41` | Breakpoint reported `verified:false`, then `breakpoint changed verified:true`. Hit on `Main Thread`; frame `[Managed] NativeProbe.Update()`, depth 1; locals `this`, `count=20000`, `input` |
| S1 step / continue | `next` stops at line 42 with reason **`pause`**. `continue` reaches the next Update (`frames` +1) |
| S1 detach while running | `disconnect(false)` acknowledged; adapter exit 0; player alive |
| S2 reattach | Accepted; `frames` advanced (11166 → 64875); detached **while paused** with the breakpoint set |
| S3 after paused detach | The target had resumed and dropped the breakpoint (`frames` 142288). Adapter then **SIGKILLed while paused**; player alive |
| S4 after adapter failure | The agent accepted a new debugger; the target had resumed (`frames` 219032) |
| S5 player end while attached | Adapter emits `terminated` (no `exited`) and **stays running**. `disconnect(false)` is then acknowledged and the adapter exits 0 |
| S6 new player incarnation | New PID, start time and port; attach, breakpoint and detach pass; the new player stays alive |

### Disposable Editor, two Play runs (`editor-run6`)

| Step | Observed |
| --- | --- |
| Endpoint | `EditorInstance.json.process_id` = Editor PID; `56000 + PID % 1000` listening and owned by that PID |
| E1 attach in Edit mode, then Play | No Edit-mode stop. The first Play Update hits line 41 (`input=7`, frame 0). Step returns reason `pause`; continue reaches the next frame |
| E1 detach while playing | Acknowledged; Editor alive and still in Play (`result` changing) |
| E2 reattach in Play → exit Play → Play again, **one session** | Survives Play exit. On re-entry the breakpoint goes `Assembly unloaded` (unverified), then verified again, and hits in the **second Play run** (`input=7` again) |
| E3 fresh attach in second run → exit Play while attached → detach in Edit | Acknowledged; Editor alive in Edit mode; `EditorApplication.Exit(0)` then exits with code 0 |

## Observed failures and diagnosis (chronological)

1. **`configurationDone` kills the adapter** (`player-run1`). The adapter does
   not advertise `supportsConfigurationDoneRequest`. Microsoft's
   `DebugAdapterBase` throws a fatal `NotImplementedException` and closes
   stdout. Per DAP, the client must not send it in that case. **Craidd's
   `DapStartup` sends `configurationDone` unconditionally** after `initialized`,
   so it would hit the same failure. Trace:
   `tests/fixtures/unity-managed-debug/traces/player-run1-configurationdone.jsonl`.
2. **Step completes as `stopped(reason: "pause")`** (`player-run2`). DotRush
   maps every `TargetStopped` to `Pause`. Craidd's ordinary stopped handling
   accepts any reason. Its LLDB-only step machinery does not apply here.
3. **The player route requires `EditorInstance.json`** (S0). This is an
   adapter limitation; see the proposal for options.
4. **No `exited` event, and the adapter persists after `terminated`** (S5).
   Craidd's attached path ignores `terminated` and waits for a `disconnect`
   acknowledgement. Only its `exited` branch sends `disconnect`. A Craidd
   session would therefore wait indefinitely when the player quits.
5. **Editor quit immediately** (`editor1`–`editor3`). The `unity run` wrapper
   injects `-batchmode -quit`, so the Editor exited after the method returned,
   and Unity deleted `EditorInstance.json` on exit. An initial interpretation
   that "batch Editors do not write the file" was wrong. A log line in
   `editor4` confirmed that Unity itself had written it. The probe now launches
   the Editor binary directly, without `-quit`.
6. **Play appeared to stall** (`editor4`, `editor5`). The breakpoint hit in
   the first Play Update before `EnteredPlayMode` was delivered. The harness
   was waiting for Editor-side state that could not update while the main
   thread was held. This was a harness ordering bug; the stop is the readiness
   signal. It also showed that an Edit-mode breakpoint rebinds across the Play
   domain reload.
7. **Unity crashed during shutdown** (`editor4`, `editor5`): SIGSEGV in
   `UnityWebRequest::~UnityWebRequest` (analytics cleanup). Both crashes
   followed the harness's SIGTERM fallback to its own disposable Editor after
   Play, and in both the debugger was already gone. A clean
   `EditorApplication.Exit(0)` in Edit mode (`editor6`) exited with code 0.
   **Not attributed** to debugging, and not isolated further. That SIGTERM
   also left two `AssetImportWorker` children of the `editor5` copy running.
   The `editor6` before/after snapshot listed them as foreign processes (PIDs
   314853 and 314954). They were found after the runs, confirmed by project
   path, and terminated. A future harness should reap the Editor's whole
   process group.

Batch Editor logs contain Hub `-accessToken` arguments. Raw Unity logs are
therefore kept out of the repository; the scratch copies were redacted.

## Remaining gaps

- Craidd integration and real Craidd UI acceptance, including the attach
  dialog, Stop, window close, crash, and Craidd quitting while paused.
- The interactive GUI Editor (DotRush's documented route), Code Optimization
  toggled from the UI, Editor-attaching preference states, and Play with
  domain reload disabled.
- Script recompilation and asset refresh while attached; multiple Editors or
  players (port collisions); remote or network players.
- IL2CPP players; the Editor's IL2CPP build workflow.
- Conditional breakpoints, `evaluate` side effects (implicit getter
  evaluation), exception breakpoints, private-member presentation, and thread
  naming. Thread `started` events repeated id 1 in some runs, so the
  `threads` request was the source of truth.
- Native LLDB and managed Mono attached to the same process at once; mixed
  stepping across P/Invoke.
- Unity LDI: held-frame value extraction, ABI and release. Prerequisites are
  listed in the proposal.

## Reproduce

From the repository root, on the debug branch:

```sh
cmake -S workspaces/unity/Native -B workspaces/unity/Native/build -DCMAKE_BUILD_TYPE=Debug
cmake --build workspaces/unity/Native/build
unity run workspaces/unity --timeout 900 -- -nographics -executeMethod ProbeProject.BuildLinux
git clone https://github.com/JaneySprings/DotRush.git /tmp/dotrush && git -C /tmp/dotrush checkout 2026.10
git -C /tmp/dotrush submodule update --init src/DotRush.Debugging.MonoLib
dotnet publish /tmp/dotrush/src/DotRush.Debugging.Mono/DotRush.Debugging.Mono.csproj -c Release -o /tmp/monodbg
python3 -I tests/fixtures/unity-managed-debug/unity_managed_probe.py --adapter /tmp/monodbg/monodbg.dll --output /tmp/craidd-unity-managed-player
mkdir /tmp/craidd-unity-editor-copy
python3 -I tests/fixtures/unity-managed-debug/unity_editor_probe.py --adapter /tmp/monodbg/monodbg.dll --output /tmp/craidd-unity-managed-editor --scratch /tmp/craidd-unity-editor-copy
```

Run the probes with normal desktop and socket access. They start their own
player or Editor, so other Unity windows can remain open. Sanitised excerpts
and reports for the passing runs and the first failure are in
`tests/fixtures/unity-managed-debug/traces/`. These excerpts omit module,
output and thread noise, and they record the run that produced them.

---

*Last updated: Phase 3.x, 16 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
