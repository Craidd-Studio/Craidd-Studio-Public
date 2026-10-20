# Unity C# / C++ debugging probe

Small local Linux x86_64 fixture, pinned to installed Unity **6000.5.10f1**.
Source, scene, metadata and settings are tracked. Library, generated native plugin,
player builds and editor caches are ignored. No game assets or services are configured. Unity generated its engine-module manifest and the Linux SDK/sysroot/toolchain package requirements during import/build; their potentially large caches stay ignored.

Open `workspaces/unity/unity.cln` in Craidd for the managed sources, Editor tools and native plugin. Unity compiles C# and owns Editor/player launch.

From the repository root:

Close any Editor/player that has loaded this fixture plugin before an ordinary
CMake rebuild. The UI harness below always builds a disposable copy instead;
it never rebuilds the original plugin or restarts the user's Editor.

```sh
cmake -S workspaces/unity/Native -B workspaces/unity/Native/build -DCMAKE_BUILD_TYPE=Debug
cmake --build workspaces/unity/Native/build
ctest --test-dir workspaces/unity/Native/build --output-on-failure
unity run workspaces/unity --timeout 300 -- -nographics -executeMethod ProbeProject.Prepare
unity run workspaces/unity --timeout 600 -- -nographics -executeMethod ProbeProject.BuildLinux
workspaces/unity/Builds/Linux/CraiddUnityProbe.x86_64 -batchmode -nographics --craidd-smoke -logFile /tmp/craidd-unity-player.log
unity open workspaces/unity
```

Open `Assets/Scenes/DebugProbe.unity`, enter Play, select **CSharp to Cpp Probe**.
Its inspector controls workers, scalar work and periodic retained native allocation.
The Game view also has an opaque diagnostic overlay with **Allocate 1 MiB**,
**Clear**, native live bytes, frame count and the last action's before/after
values. These buttons call the same native allocation/clear actions as the
menus. The fixture defaults to 60 fps; set Target Frame Rate before Play to
`-1` for uncapped testing. Run Periodic Allocations can be disabled for an exact
manual memory baseline. It remains enabled by default.
Component context menu **Probe/** provides managed retain/release/GC and native retain/clear.
`Native/probe.cpp` has `NATIVE_BREAK_HERE`; `Assets/Scripts/NativeProbe.cs` has `MANAGED_BREAK_HERE`.
Native scalar locals form a future value-LDI qualification case. `craidd_probe_stateful`
is deliberately separate and must be rejected by any value-only reproduction claim.

Attach LLDB to the **Unity Editor or development player process**; the `.so` is a
loaded module, never an attach target of its own. Linux ptrace policy may prevent
sibling attach; this project does not change that policy. Launch under an authorized
debugger where needed. Managed Unity Mono/IL2CPP is not qualified by netcoredbg's
CoreCLR support; this fixture does not make that adapter work in Craidd. `MANAGED_BREAK_HERE`
is the managed probes' breakpoint line.

For normal native Gold profiling, **Unity can start first**. After updating the
native provider, rebuild the plugin and reopen Unity once if it had already
loaded the old `.so`. Subsequent sessions need no launch environment variable. Previously built
players must be rebuilt to include the updated plugin.

1. Open this project in Unity, then open `unity.cln` in Craidd.
2. Choose **Run → Attach to Process**. The matching Unity Editor is identified
   from its actual project path and preselected when unambiguous.
3. Choose **Profile only** for profiling, or explicitly attach LLDB for native
   C++ debugging. The prepared plugin discovers the selected owner within a
   second, including when Unity is already playing.
4. Press Play. Solo and paired native benchmarks record automatically.
5. Stop Play. Results remain; Craidd shows **Ready for Play**. The next Play
   records in a new batch without another Attach operation. **Stop profiling**
   explicitly disarms discovery and leaves Unity running.

While playing, use Unity's top menu **Craidd → Probe → Allocate retained native
1 MiB**, take a Craidd snapshot, then **Craidd → Probe → Clear native allocations**
and snapshot again. These actions also exist in the NativeProbe component's
context menu. The Unity Console reports native before/after byte counts and the
Inspector's Native Live Bytes updates immediately. That field is an observation;
typing a number into it does not allocate memory. Component disable reports any
retained bytes it clears. Inspect Solo or the native allocation benchmark to see
its tracked cohort clear. Process RSS need not fall with the cohort.

This discovers prepared native C++ hooks; it does not implement Unity managed
C# breakpoints or heap object capture. The existing plugin has built-in test
markers; placing arbitrary C#/C++ gutter intent does not instrument loaded code.
Explicit allocation hooks account only for the fixture's native malloc/free.
Component disable cleans up workers/allocations; Editor EnteredEditMode and
player OnApplicationQuit report runtime end. An Editor stays armed across Play
runs; player application end finishes its profiling session. GPU is unavailable.

Discovery is published only after target selection, in a private namespace
under `$XDG_RUNTIME_DIR/craidd-profiling/`. The namespace follows canonical
HOME, isolating scratch harness settings; a shared `CRAIDD_PROFILE_NAMESPACE`
can explicitly pair an isolated host and disposable provider. Without
XDG_RUNTIME_DIR, the private fallback is `$HOME/.cache/craidd-studio/`.
Both endpoints must use the same runtime base and namespace. PID start time,
private-file ownership and native socket peer credentials guard routing.
Stop/close revokes the route; a provider reconnects after a new selection or
Craidd restart. Dead-host endpoint/socket files are removed by the live provider
or the next host startup in that namespace. Namespace locks remain intentionally.
`CRAIDD_PROFILE_SOCKET` remains a fallback for older/manual
builds, and is still supplied automatically for debugger-owned launches.

Generated Gold source copies can be built separately using the Profiler's Prepare
source copy action; ordinary gutter markers never alter this project's source or loaded plugin.

For gutter-to-build testing, open `Native/anchored.cpp`, place Start on
`CRAIDD_GOLD_START();` and End on `CRAIDD_GOLD_END();`, then choose Prepare
current source copy in Profiler. Reconfigure the plugin with
`cmake -S workspaces/unity/Native -B workspaces/unity/Native/build -DCRAIDD_GOLD_SOURCE=/tmp/<bundle>/anchored.cpp`
and rebuild before starting Unity. Restore the default with `-UCRAIDD_GOLD_SOURCE`.
The original file stays untouched. Arbitrary line rewriting is not yet qualified.

Automated live bridge check after the player build:

```sh
python3 tests/fixtures/attach-profiling/unity_probe.py
```

Run it with normal desktop/socket access. A restricted sandbox can crash this
Editor version's SDL/input initialization even with `-batchmode -nographics`.

Native attach test (after building the player):

```sh
python3 tests/fixtures/attach-profiling/attach_probe.py --output /tmp/craidd-unity-attach-proof --unity-player workspaces/unity/Builds/Linux/CraiddUnityProbe.x86_64
```

The disposable player opts into sibling debugger access with `--craidd-allow-attach`
for its own PID only. Normal player launches and the Editor do not call this hook;
host ptrace policy is never changed.

Managed C# Editor debugging in Craidd (experimental): install DotRush, or build its adapter
with [`experiments/unity-managed-debug/build-monodbg.sh`](../../experiments/unity-managed-debug/README.md)
and choose that `monodbg.dll` in Preferences → Toolchain → C#. Set Unity's Code Optimization to
Debug, then **Run → Attach to Process**, select the Unity Editor and choose
**Unity C# · DotRush Mono (Editor)**. Players are not yet routed.

Managed C# protocol probes (external DotRush `monodbg`, independent of Craidd). Each
starts its own player or a batch Editor on a scratch project copy, and connects only
to a debugger port owned by that PID. See the
[qualification record](../../docs/unity/feats/record-unity-managed-csharp-qualification.md):

```sh
python3 -I tests/fixtures/unity-managed-debug/unity_managed_probe.py --adapter <monodbg.dll> --output /tmp/craidd-unity-managed-player
python3 -I tests/fixtures/unity-managed-debug/unity_editor_probe.py --adapter <monodbg.dll> --output /tmp/craidd-unity-managed-editor --scratch <empty-dir>
```

Unity-first connection/reconnection check, using a disposable project copy and
a real Editor launched without a socket variable:

```sh
python3 tests/fixtures/attach-profiling/unity_first_probe.py
```

The test proves late provider discovery, peer PID, route revocation and
reconnection without restarting that Editor. It calls native methods from an
Editor test method; it does not qualify interactive GUI Play or Tauri lifecycle
acceptance. Rust tests separately exercise Editor Play end/rearm and bounded
capture-history retention.

Real embedded UI/UX acceptance (all Unity instances are disposable copies):

```sh
npm run test:ui:build
npm run test:ui:profiling
# Includes a real ten-minute sample-history rollover:
npm run test:ui:profiling:long
```

The batch-mode controllers drive `EditorApplication.ExecuteMenuItem` using file
signals, at 60 fps and uncapped. The separate graphical copy captures the Game
overlay. Native state repeats the current Play generation/active flag every
250 ms and on ordinary events; no single Play-end message is required for
Editor rearming. Sequence gaps/disconnects mark affected captures incomplete
and allow a fresh Solo. Ordinary history rolls per marker; Solo/live cohorts
stay pinned. Taking a snapshot keeps Live selected; choose a snapshot row to
inspect it, then use Live to return. See [the harness](../../tests/ui/README.md)
and [acceptance report](../../docs/bugs/16-10-2026/unity-profiling-final-report.md).
