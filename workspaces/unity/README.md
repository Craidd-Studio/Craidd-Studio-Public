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
CoreCLR support; this fixture does not make that adapter work in Craidd.

For live source profiling, copy the socket path from Craidd's Profiler and set
`CRAIDD_PROFILE_SOCKET` **before starting** the Editor or player. Then select that
PID using Run → Attach to Process → Profile only, or attach a native debugger.
The prepared C++ hooks record automatically: one solo plus per-invocation ranges.
Explicit allocation hooks account only for these native malloc/free calls. Managed
GC.GetTotalMemory and process RSS are gauges, not a leak diagnosis. Component disable only cleans up its workers and allocations. Player OnApplicationQuit
and Editor EnteredEditMode send separate fixture-specific runtime-end events.
Re-entering Play needs a fresh profiling session. GPU and managed heap events are unavailable.

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
