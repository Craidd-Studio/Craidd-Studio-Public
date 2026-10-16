# Unity C# / C++ debugging probe

Small local Linux x86_64 fixture, pinned to installed Unity **6000.5.10f1**.
Source, scene, metadata and settings are tracked. Library, generated native plugin,
player builds and editor caches are ignored. No game assets or services are configured. Unity generated its engine-module manifest and the Linux SDK/sysroot/toolchain package requirements during import/build; their potentially large caches stay ignored.

Open `workspaces/unity/unity.cln` in Craidd for the managed sources, Editor tools and native plugin. Unity compiles C# and owns Editor/player launch.

From the repository root:

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

Discovery is published only after target selection, in the user's private
`/run/user/<uid>/craidd-profiling/<pid>-<birth>.endpoint`. PID start time,
private-file ownership and native socket peer credentials guard routing.
Stop/close revokes the route; a provider reconnects after a new selection or
Craidd restart. `CRAIDD_PROFILE_SOCKET` remains a fallback for older/manual
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

Managed C# protocol probes (external DotRush `monodbg`, not a Craidd route). Each
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
