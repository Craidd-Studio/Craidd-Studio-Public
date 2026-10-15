# Attach and Gold profiling implementation record

**Status:** Experimental implementation, 15 October 2026. This record distinguishes source,
automated checks and real adapter/desktop acceptance.

## Baseline observations before changes

- Branch `feat/unity/profiling-a-to-p` starts at `65171c3`, with a clean tree.
- Debug Session has no owned/foreign target discriminator. Stop, close,
  transport failure and reader exit assume an owned launch; disconnect uses
  `terminateDebuggee: true` and schedules owned process-tree cleanup.
- Run has no Attach command. Profiler is layout only. The source gutter has
  red and blue intent but no persisted Gold solo/range records.
- Installed tools discovered for this work: LLDB-DAP and netcoredbg. perf,
  heaptrack and bpftrace are not installed. Do not substitute invented samples.
- The disposable native attach probe initially asserted breakpoint verification
  before configurationDone. LLDB reports the location pending at that stage;
  qualification must await completed attach/configuration and a real hit.

## Gutter regression observed on 15 October 2026

User screenshots showed an existing Gold marker opening a menu with Set Red
Breakpoint first and its own Remove/Condition actions hidden inside Profiling.
The Gold lookup existed, but those actions were always nested in a collapsed
section instead of being the selected marker's primary actions.

A second screenshot showed Gold diamonds drawn inside red breakpoint circles.
Both decorations used Monaco's default glyph lane, so Monaco combined their
CSS classes on one element. The Gold pseudo-element was consequently painted
on the red circle. Correct this with an independent Gold lane and lane-specific
hit testing; CSS offsets within the shared glyph are insufficient.

## Diagnostic tool window correction

The initial panel stacked setup explanations, graphs, filters and expanded
results in one long scroll. User screenshots established that memory capture
was hard to discover and the tool window was too bulky compared with the
Visual Studio 2019 Diagnostic Tools reference.

The corrected panel keeps a compact toolbar, process identity, shared time
ruler, process RSS and CPU-time graphs above one tabbed results pane. Summary,
Gold, Memory and Events share the selected process and time interval. Dragging
a graph or using the keyboard-accessible range controls filters overlapping
Gold captures; thread and batch filters affect Gold results, not process gauges.
Gold groups and individual hits start collapsed. Expanded groups retain CPU
and native-live graphs. CPU summaries use per-capture means rather than sums
that would double-count nested invocations. Collector setup moves to Settings.

Memory exposes immutable observation snapshots, a same-session RSS difference
table and recorded allocation cohorts, including subsequent frees. Snapshot
and record again preserves the current view before starting another batch.
These snapshots copy collected observations; they are not heap object dumps.
Managed heap/GC and heap object capture remain explicitly unavailable.

Gold now has a separate Monaco glyph lane reserved alongside red/blue for
files with Gold markers. Lane-specific hit testing preserves each marker's
menu. Existing Gold offers Remove and Add/Edit Condition directly; pair
removal names both endpoints. Editing from End changes the Start condition.

Validation for this correction: production build and the five focused profiling
tests pass. The synthetic browser fixture exercises the real editor and panel:
separate red/Gold geometry, direct condition editing, red-menu preservation,
frozen snapshots followed by a simulated free, RSS differences, keyboard time
selection and thread filtering. The fixture has mocked IPC; it does not qualify
a heap collector or production desktop lifecycle.

## Delivered experimental slice

- Run → Attach to Process and Command Palette entry; searchable same-user PID
  list, explicit adapter, PID + Linux start-time checks, native/CoreCLR routes,
  target ownership card, module events and a mapped-module refresh.
- Attached adapters bypass the owned-process supervisor. Stop/close/cancel ask
  for `disconnect(terminateDebuggee: false)`. Rejected detach retains the slot;
  successful detach waits for the acknowledgement even when LLDB emits
  `terminated` first. No foreign-target kill or owned-tree cancellation fallback.
  Unconfirmed transport teardown reports the ambiguity and sends no signal.
- Profile-only target selection, independent of a debugger. Debug starts a
  profiling context for its verified PID; session IDs prevent late debug cleanup
  from stopping a replacement/manual profiling session.
- Linux `/proc` CPU-time, RSS, virtual-memory and thread-count gauges at 250 ms,
  bounded to 2,400 samples. They remain process context outside Gold ranges.
- Prepared Linux C++ source hooks, authenticated by Unix peer credentials and
  PID start-time checks. The receiver allows one connection per process, at most
  64 connections, 4 KiB lines, 2,000 captures and 20,000 tracked allocations.
  Interrupted streams retain incomplete results and report lost coverage.
- One accepted solo per process profiling session, repeated/concurrent/recursive
  invocation IDs, explicit End versus scope-exit/incomplete, thread CPU time
  distinct from wall duration, and explicit native allocation cohorts whose
  frees can update the original capture after End. Native allocations are not
  process-wide malloc interception, managed GC or a complete heap diagnosis.
- Group and per-capture collapsibles, CPU/RSS and per-capture CPU/native-live
  graphs, thread/batch filters, observed DAP stop intervals, Snapshot and Record
  again. Old open pairs retain their batch; solo segments at the batch boundary.
  At most eight in-memory snapshots/previous sessions are retained.
- Persisted Gold source intent and gutter Profiling actions for Start, a chosen
  pending Start's End, Solo/Move Solo, conditions and pair removal. A marker edit
  invalidates that compiled marker for the current profiling context, retaining
  partial results. A rebuild/restart/new profiling session is required afterwards.
- An explicit prepared-copy exporter replaces `CRAIDD_GOLD_START();`,
  `CRAIDD_GOLD_END();` and `CRAIDD_GOLD_SOLO();` statement anchors in a **copy**.
  It never patches originals or loaded binaries. The C++ compiler checks lexical
  scope; scalar type assertions and a restricted comparison/boolean grammar
  reject calls, member access, assignment and arithmetic side effects.
- [Lightweight Unity fixture](../../../workspaces/unity/README.md), Unity
  6000.5.10f1: C# P/Invoke, C++ shared plugin, deterministic scalar and separate
  stateful entries, optional workers, managed-reference/GC controls and native
  retain/clear cases. Scene creation uses Editor APIs. A `.cln` opens its source
  projects; Unity retains C# compilation and Editor/player launch ownership.
  Source/settings and the package lock are tracked; caches, `.so` and player
  builds are ignored. Unity added its Linux SDK/sysroot/toolchain registry
  requirements while building; their large caches are not committed.

## Evidence

Commands run against this implementation:

```sh
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
npm run build
node tests/profiling.test.mjs
node --test tests/*.test.mjs
cmake -S workspaces/unity/Native -B workspaces/unity/Native/build -DCMAKE_BUILD_TYPE=Debug
cmake --build workspaces/unity/Native/build
ctest --test-dir workspaces/unity/Native/build --output-on-failure
unity run workspaces/unity --timeout 300 -- -nographics -executeMethod ProbeProject.BuildLinux
python3 tests/fixtures/attach-profiling/attach_probe.py --output /tmp/craidd-attach-qualified
python3 tests/fixtures/attach-profiling/unity_probe.py
python3 tests/fixtures/attach-profiling/attach_probe.py --output /tmp/craidd-unity-attach-qualified --unity-player workspaces/unity/Builds/Linux/CraiddUnityProbe.x86_64
```

- Rust: 153 passed, four pre-existing ignored tests. Includes a real compiled
  C++ provider over a real Unix socket, peer PID verification, recursive and
  concurrent pairing, early return, free after End, batches, solo and a compiled
  prepared anchor copy with original-source preservation.
- Frontend production build passes. Five focused profiling store/presentation
  tests pass; the existing frontend test files also pass.
- Native CMake/CTest: deterministic scalar, retained/free native memory,
  stateful separation and worker start/stop pass.
- Installed LLDB-DAP 23.1.1 attached to a separately started native fixture,
  hit its source breakpoint, read stack/locals and detached from pause. The
  foreign process remained alive and continued producing output afterwards.
  Transcript: `/tmp/craidd-attach-qualified/dap.jsonl` (local, not tracked).
- Actual Unity Editor import/PInvoke check and development Linux player build
  pass: `CRAIDD_UNITY_EDITOR_INTEROP_OK`, `CRAIDD_UNITY_LINUX_BUILD_OK`.
- Actual development player smoke passes: `CRAIDD_UNITY_PLAYER_SMOKE_OK`.
  The final socket probe authenticates the Unity PID, observes 33 matched
  begin/end pairs, 8,192 allocated/freed bytes and exactly one player-quit signal
  after cleanup (`/tmp/craidd-unity-profile-final/events.jsonl`).
- Installed LLDB-DAP also attaches to the real development Unity player, hits
  `NATIVE_BREAK_HERE` inside its loaded plugin, reads stack/`seed`, detaches
  from pause and observes Unity CPU ticks advancing afterwards. Transcript:
  `/tmp/craidd-unity-attach-qualified/dap.jsonl`. The test-created player alone
  opts into sibling ptrace with a command-line flag; neither Editor nor host
  policy changes. This qualifies the standalone native route for this fixture,
  not the Tauri UI, managed adapter, Editor or all lifecycle failure cases.
- Browser presentation was inspected at 288 and 420 px panel widths. Snapshot,
  thread filter and hidden-process selection guard pass against the explicitly
  labelled synthetic fixture at `tests/ui/profiling.html`. Its IPC is mocked;
  this is not desktop debugger or collector acceptance.

Observed failures were recorded before fixes: an initial DAP probe asserted
breakpoint verification before configurationDone; a synthetic `/proc` fixture
had misplaced fields; C# Editor tools could not access internal P/Invoke
methods across assemblies; a source-event test created its context after its
first events; Unity's sandboxed player crashed in SDL/input after denied
socket/desktop access. Corrected tests/builds pass with normal local access.
Component OnDisable was also found to be insufficient proof of Play end:
player OnApplicationQuit now joins/clears before signalling, and Editor
EnteredEditMode uses SessionState across domain reloads. The latter still
needs interactive Editor Play acceptance.

## Remaining qualification and target-design gaps

This is a foundation for working on the feature, not completion of every
[Gold design acceptance gate](design-gold-capture.md#acceptance-before-implementation-is-called-complete).

- Arbitrary line rewriting, loaded-artifact/build-ID/source binding, automatic
  line/path relocation and managed Gold instrumentation are unqualified.
  Gutter intent is labelled prepared-build required; a connected native provider
  does not prove that every saved diamond is armed in the loaded binary.
- Draft persistence currently allows one solo per solution, which is stricter
  than the target per-process context rule. Independent process bindings and
  shared linked views/aggregation need a subsequent binding model. Duplicate
  profiling owners for one actual PID incarnation are rejected today.
- Prepared manual hooks report actual compiled intent. Editing the gutter does
  not rewrite a running binary or change its compiled condition. Rebuild and
  restart before a fresh context; never treat stale source intent as live code.
- Full heap stacks/retention, managed object/GC provenance, perf stack sampling,
  module attribution, hardware CPU cycles and GPU collectors are absent. Solo
  CPU time is unavailable; paired CPU is measured on the triggering native
  thread. RSS and explicit allocation cohorts are shown separately.
- Result retention is bounded and in memory. Persistent export/import, persistent
  timeline history, thread-incarnation/reload provenance and complete
  dropped-event sequence accounting remain work. Fork during multithreaded
  provider calls and arbitrary plugin reloads are not qualified.
- CoreCLR attach is a routed candidate, not Unity C# support. Unity Mono/IL2CPP
  adapters, Editor Play/reload workflows and Unity LDI reproduction/ABI gates
  remain separate. Existing LDI implementations are not broadened by this work.
- Tauri desktop Attach/Stop/window-close/group-stop/crash/transport-failure
  acceptance remains open. Standalone real adapter probes and browser mocked
  IPC do not prove every production lifecycle path. A separate destructive
  Terminate action has deliberately not been exposed.


---

*Last updated: Phase 3.x / 3.5, 15 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
