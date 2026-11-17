# Unity managed C# debugging experiment

Craidd's experimental **Unity C# · DotRush Mono (Editor)** attach route needs
DotRush's Mono debug adapter, `monodbg.dll`. If you have the DotRush VS Code
extension installed, Craidd finds it automatically. Otherwise, build the same
adapter here from pinned source. You don't need VS Code or the extension.

This is an experiment. It is not a default debugger, and Craidd never selects
this build on its own. The route's design, evidence and limits are in the
[C# attach design](../../docs/unity/feats/design-unity-managed-csharp-attach.md)
and the [qualification record](../../docs/unity/feats/record-unity-managed-csharp-qualification.md).

## Build

From the repository root, on Linux with git, network access and a .NET 10+ SDK:

```sh
experiments/unity-managed-debug/build-monodbg.sh
```

The script checks out DotRush `2026.10` (commit `4b87e96…`) with its
Mono.Debugger submodule (`9edc612…`) and refuses any other revision. It
publishes the adapter to `experiments/unity-managed-debug/.local-tools/monodbg/monodbg.dll`
and writes `BUILD-INFO.txt` beside it (commits, patches, SDK, sha256). Re-running
resets the cached source and rebuilds; nothing outside `.local-tools/` changes.
The hash depends on the checkout path, so compare `BUILD-INFO.txt` commits
across machines, not hashes.

`--with-upstream-patches` adds Craidd's two drafted DotRush patches from
[`tests/fixtures/unity-managed-debug/upstream/`](../../tests/fixtures/unity-managed-debug/upstream/)
and builds into `.local-tools/monodbg-patched/`. Use that build only for
player-probe work. Craidd's Editor route targets the unpatched release.

**Do not commit `.local-tools/`.** DotRush and Mono.Debugger are MIT, but the
build includes `Microsoft.VisualStudio.Shared.VSCodeDebugProtocol.dll`, which
is under Microsoft Software License Terms. Each tester builds their own copy,
and Craidd does not bundle it. The folder is ignored by git.

## Use it in Craidd

1. Run `npm install` once, then `npm run tauri dev`, from the repository root.
2. **File → User Preferences → Toolchain → C# → Unity debugger → Choose Path…**,
   then select the built `monodbg.dll`. Choose **Automatic** again to go back
   to an installed DotRush extension.
3. In Unity, set **Code Optimization** to **Debug** (the bug icon in the status
   bar). In Craidd, open [`workspaces/unity/unity.cln`](../../workspaces/unity/README.md)
   or your own project.
4. **Run → Attach to Process…**, select the **Unity Editor**, then choose
   **Unity C# · DotRush Mono (Editor)**. Attach is enabled only when Craidd has
   verified the Editor's debugger port (`127.0.0.1:56000 + PID % 1000`).
5. Set a breakpoint, for example on `MANAGED_BREAK_HERE` in
   `Assets/Scripts/NativeProbe.cs`, and press Play.

Check and record the following: breakpoint hit, stack and locals, Step,
Continue, Stop (Unity keeps running), leaving and re-entering Play, and
closing the Craidd window while paused. Include the `BUILD-INFO.txt` contents
in your report.

Known limits: Unity Editor only, since players are not routed yet. Steps
report as a pause. Gutter breakpoints do not yet show the unverified/verified
change around a domain reload. In Release code optimisation, Unity may ask to
switch to Debug when the debugger attaches. IL2CPP, mixed native/managed
stepping and Unity LDI are not supported.

## Direct probes (no Craidd UI)

These start their own disposable player or batch Editor and connect only to a
port owned by that process:

```sh
python3 -I tests/fixtures/unity-managed-debug/unity_editor_probe.py --adapter experiments/unity-managed-debug/.local-tools/monodbg/monodbg.dll --craidd-arguments --output /tmp/craidd-unity-editor-probe --scratch "$(mktemp -d)"
python3 -I tests/fixtures/unity-managed-debug/unity_managed_probe.py --adapter experiments/unity-managed-debug/.local-tools/monodbg-patched/monodbg.dll --explicit-endpoint --output /tmp/craidd-unity-player-probe
```

The player probe needs the development player built first; see the
[Unity fixture](../../workspaces/unity/README.md). Probe results are supporting
evidence. They are not Craidd UI acceptance.
