# Profiling language extension — qualification plan after Unity review

**Roadmap track:** Phase 3.5 profiling with Phase 3.x ordinary MT and LDI.

**Status:** Proposed execution sequence, 17 October 2026. **Not executed.**
This is the extension to the [Unity UI/UX runbook](unity-profiling-manual-acceptance-checklist.md),
not evidence that every language already has Gold instrumentation. Remain on the
current branch for the Unity review; creating `feat/profiling` is a later decision.

## 1. Sequence and branch boundary

1. Execute the Unity native/UX checks and publish results, preserving human,
   automated embedded-app and source/protocol evidence separately.
2. Repair/triage the failed cases, especially source loss, pointer history
   navigation and host/snapshot regressions. Keep gated Unity managed/LDI/heap
   work explicit rather than making it look supported by native hooks.
3. Review the exact Unity checkpoint and open defects with the user. A limited
   experimental continuation is possible only with its limitations recorded;
   it is not a fully accepted profiler or a passed zero-loss gate.
4. If directed to proceed, create/use **`feat/profiling`** from that reviewed
   checkpoint, preserving dirty/untracked work. Do not silently branch from an
   older pre-workspace implementation or overwrite an existing branch.
5. Run standalone single-language profiling first, then ordinary MT, then
   same-process native interop and managed LDI composition. Add only the missing
   provider/fixture capability needed for each separately reviewed slice.
6. Complete the combined breakpoint/load matrix and publish a result per
   language/runtime/provider/adapter combination. Reuse the Unity UI contracts;
   do not redesign the Profiler or commission shared-view B/C implicitly.

No new branch, application/provider implementation or runtime test is performed
by authoring this plan. Proposed fixtures/scripts below must exist and be
reviewed before anybody reports running them.

## 2. Execution mechanisms are different

| Path | Process/debugger model | Profiling implication |
| --- | --- | --- |
| C++ application | One original process; native adapter when debugging. | Existing C++ provider can be explicitly prepared. Qualify both process gauges and supported Gold source/allocation events. |
| C# application | Original managed process; a qualified CoreCLR adapter for applicable labs. | Process gauges do not establish managed Gold, GC or heap-object support. Choose and qualify the actual C# event provider before claiming it. |
| C# → C++ ordinary interop | Native library executes in the managed consumer's original process. | Instrumented native events belong to that process. Do not invent a separate library PID or label native cohorts as managed heap. |
| C# → C++ managed LDI | Held original process A plus separate native reproduction B with copied supported inputs and a token. | Separate CPU/heap/profile histories; B's instrumentation must actually be compiled into its driver. Never add replay cost to A's original execution. |
| Rust application | One original native process, ordinarily one LLDB-DAP session. | Process gauges are separate from Rust Gold hooks. The current C++ source exporter is not a Rust macro/provider. |
| Rust → C++ with Blue live-native pairing | **Same original process and LLDB session**, with a native debug view/binding. No managed hold/driver by default. | C++ library Gold events belong to the Rust process. One capture, no duplicate process/heap and no automatic shared Profiler tab in the other window. |

Rust Native Breakpoint pairing is governed by the
[Rust live-native design](../feats/ldi-debugging/design-ldi-debugging-rust.md).
Do not implement its tests by sending Rust through the managed LDI reproduction
state machine. Callbacks, reverse C++→Rust and arbitrary concurrent origins are
separate unqualified extensions.

**Colours are not execution providers.** Red means a real debugger stop; Gold
means non-stopping profiling intent; Blue means a qualified linked native
binding. Gold Linked Debug is a toolbar orchestration command, not a profiling
range marker. Conditions and thread control depend on the actual provider/adapter.

## 3. Entry checklist

- [ ] **PX-ENTRY-01** Link the executed Unity report and reviewed checkpoint SHA. Carry every open defect, including the sustained uncapped failure; do not reset the issue count by opening a new branch.
- [ ] **PX-ENTRY-02** Record the branch decision and which claims are intended: process gauges, native Gold, managed/Rust Gold, native allocations, debugger composition, MT and/or LDI. Keep unsupported capabilities visible.
- [ ] **PX-ENTRY-03** Inspect each existing lab/config before reuse. Copy/build disposable variants where tests mutate, inject failures or launch external applications. Never retarget the user's live Unity process or original loaded plugin.
- [ ] **PX-ENTRY-04** Record toolchains, runtimes, adapters/capabilities, source/build hashes and symbols. A source breakpoint must be verified against its loaded artifact before accepting source-level measurements.
- [ ] **PX-ENTRY-05** Inventory implemented provider APIs and exporter languages. Reject imaginary `[Craidd.Profile]` attributes, Rust macros or automatic arbitrary-line hooks copied from future-design examples as evidence of a real SDK.
- [ ] **PX-ENTRY-06** Define independent oracles and expected invocation/allocation counts for each deterministic workload. Performance direction can be checked without pretending scheduling is deterministic to the millisecond.
- [ ] **PX-ENTRY-07** Preserve the accepted sidebar/editor workspace, shared resolver, eight-view retention, End summaries and bounded transport/publication design. No new per-view collector or silent snapshot model is introduced.
- [ ] **PX-ENTRY-08** Treat unavailable provider/tool permissions as BLOCKED with a specific missing prerequisite. Unsupported-state clarity can pass separately from end-to-end recording.

## 4. Lab reuse and gaps

| Existing lab / tests | Useful starting point | Does not prove |
| --- | --- | --- |
| [MT Lab](../../workspaces/mt-lab/README.md) / `mt-lab.cln` | C#, Rust, C++ basic/burst/handoff console workloads and GUI worker variants. | Their existing debugger markers do not provide Gold hooks or allocation lifetime traces automatically. |
| [Rust native playground](../../workspaces/ldi-rust-native-playground/README.md) | Same-process Rust/C++, mixed stack, scalar result and borrowed-buffer mutation, Blue/live-native routing. | Managed reproduction, reverse calls/callbacks, arbitrary concurrent call-site isolation or a Rust profiling provider. |
| `workspaces/ldi-interop-playground/ldi-interop-playground.cln` | Inspect its configurations for managed scalar/typed LDI origin and native driver cases. | Every function is safely reproducible, or that the driver/managed origin emits Gold events. |
| [Existing scope harness](../../tests/ui/unity-scopes.test.mjs) | Stable window, End/late-free, nested attribution, snapshot association and retention assertions. | Equivalent language provider correctness; it presently drives disposable Unity/C++ hooks. |
| [Workspace UI harness](../../tests/ui/profiler-workspace.test.mjs) | Real embedded IDE, disposable C++ process, file/split/rehosting regressions. | C#/Rust/Unity debugger composition or physical pointer acceptance. |

Required fixture variants for each path: deterministic scalar work; known sleep
versus CPU work; exact retained/free allocation where a provider supports it;
repeated paired ranges and one Solo; nested/recursive intervals; worker burst
and producer/consumer handoff; late free after End; process restart and loss.
Give every new variant its own documented expected counts, cleanup and build
steps. Do not duplicate all labs just to change their language label.

## 5. Language delivery and test matrix

Use one result record per row **and per console/GUI/configuration actually tested**.
Each row needs M/A/D evidence lanes as defined in the Unity runbook. The matrix
starts NOT RUN; source implementation and prior debugger validation are references.

| ID | Path / stage | Required proof | Initial result |
| --- | --- | --- | --- |
| PX-CPP-ST | C++ single-thread, Run/Profile only/Debug | Process gauges; actual paired/Solo hooks; conditions; native count/free; fixed End; snapshots; safe Stop; native Red composition. | NOT RUN |
| PX-CPP-MT | C++ workers, burst, handoff | Correct marker/thread/invocation pairing; cross-thread frees; honest process CPU; stops/continues; bounded history and loss reporting. | NOT RUN |
| PX-CS-ST | C# standalone | Correct CoreCLR runtime/adapter and process identity; process gauges; explicit managed Gold provider qualification; no invented GC/heap support. | NOT RUN; managed Gold prerequisite unqualified |
| PX-CS-MT | C# workers, burst, handoff | Managed thread names/IDs within adapter namespace; separately verified provider thread attribution; async tasks not relabelled as OS threads; scoped capture and native/managed coverage clear. | NOT RUN |
| PX-CS-FFI | C# calls C++ without reproduction | Original consumer receives native hooks; loaded module/symbol/source match; one original-process native allocation accounted once; return value/state agrees with oracle. | NOT RUN |
| PX-CS-LDI | C# → native scalar/value reproduction | Held A and B/token identities; verified arguments and result; provider/Gold in each covered process; original/replay memory/CPU separated; release/cancel/next hit. | NOT RUN |
| PX-CS-LDI-MT | Ordered worker-origin LDI then native worker variants | Fixed captured origin despite inspection changes; no stale token/thread routes; worker measurements remain in their own execution; cancellation/rearm. | NOT RUN; no arbitrary simultaneous-origin claim |
| PX-RS-ST | Rust standalone | Native source/locals; process gauges; qualified Rust Gold binding or explicit unsupported state; timing/native allocation meanings and snapshots. | NOT RUN; Rust Gold prerequisite unqualified |
| PX-RS-MT | Rust workers, burst, handoff | Named threads, same-marker invocation pairing, joins/waits, completed cohorts, counters and debugger stop scope. | NOT RUN |
| PX-RS-FFI | Rust calls C++ ordinarily | Same PID/incarnation; mixed stack/loaded symbols; original borrowed-buffer mutation; supported native Gold; no fake second library process. | NOT RUN |
| PX-RS-BLUE | Rust→C++ live-native Blue pairing | Native landing and controls use A's existing LLDB session; source focus/config preserved; profile history counted once; no managed hold/reproduction. | NOT RUN |
| PX-RS-BLUE-MT | Rust/native workers with live-native pairing | Correlate actual caller/stop/frame before claiming call-site isolation; worker progress and pause scope truthful; correct release/close/restart without duplicate tracing. | NOT RUN |

For each language run profile-only and debugger-attached/owned launch where that
path exists. Native exact allocation hooks establish instrumented native
coverage, not all heap allocations. GC/heap/cycles/GPU need separate providers
and evidence. A row may report “process gauges PASS, Gold BLOCKED” but cannot
be called fully passed Gold profiling.

## 6. Reusable scenario checks for every applicable row

Complete each applicable scenario for every matrix row; use IDs such as
`PX-CPP-MT / PX-S-05 / A`. An unsupported case needs a reason, not an empty cell.

- [ ] **PX-S-01** Cold → launch or explicit attach gives the intended PID/birth/owner; no opening of source/windows creates a collector or debugger unexpectedly.
- [ ] **PX-S-02** Full session is default. All armed Gold markers record without pausing; changing display does not determine which markers execute.
- [ ] **PX-S-03** A live recording selection becomes Recorded on the same ID/fixed bounds; repeated hits, Run/Play equivalents and new generations do not hijack it.
- [ ] **PX-S-04** End CPU/cohort/RSS summaries have real units/clock observations; missing/sub-poll process data is unavailable; late frees do not rewrite End.
- [ ] **PX-S-05** Exact allocation/clear counts agree with an independent provider/runtime oracle. Nested inclusive ownership is not summed as unique process bytes; old allocations freed inside a new interval remain distinguishable.
- [ ] **PX-S-06** Snapshots from Full session, active and completed scopes and older history always capture supported current live data and associate with active recordings only. Overlap shares one identity; selected view/tab survives.
- [ ] **PX-S-07** Global/related snapshot histories remain navigable and immutable, including oldest-unreviewed eviction within eight views and one-click Live return.
- [ ] **PX-S-08** Sidebar/editor/source/split switching preserves inspection and normal file/keyboard commands. Physical pointer and keyboard navigation check actual scope IDs, not native select value alone.
- [ ] **PX-S-09** Marker preparation, conditions, rebuild and stale-symbol/source rejection are tested in that language's actual provider. Gutter intent never proves loaded instrumentation by itself.
- [ ] **PX-S-10** Same marker recurses/repeats/overlaps on multiple workers without cross-pairing endpoints. No End closes the wrong thread or generation.
- [ ] **PX-S-11** Worker exit/recreation, thread-ID reuse, filters and selected waiting stacks retain identity/empty-state clarity. No logical async request/task is equated with one thread without instrumentation.
- [ ] **PX-S-12** Red pause/Step/Continue has adapter-verified scope. Gold wall time includes relevant pause; selection/conditions do not claim that other threads are frozen.
- [ ] **PX-S-13** Restart/Stop/Detach/close/cancel follow actual target ownership. Foreign targets survive profiler Stop; owned reproduction cleanup cannot kill an unrelated original process.
- [ ] **PX-S-14** Disconnect, malformed input and missing sequence produce scoped incomplete coverage and recoverable fresh recordings; exact pre-cleanup error counters are saved.
- [ ] **PX-S-15** Stress beyond capture and sample bounds, retain rare/live cohorts, then allocate/free, snapshot, restart a recording and Stop. Zero-loss and boundedness are independent assertions.
- [ ] **PX-S-16** Console/GUI responsiveness, narrow/sidebar/wide layouts and unavailable labels pass in the actual application. A headless provider pass is not a GUI/packaged-app pass.

## 7. Breakpoint composition matrix

Run the applicable rows below for each qualified language/provider path. Keep
profile-only cases separate from cases with a real debugger. Test Red before,
inside and after a Gold interval; verify each armed state rather than inferring
it from colour. Include condition false/true, remove/disable and restart where
supported. Record source locations, compiled binding and debugger verification.

| ID | Armed intent | Check beyond the reusable scenarios |
| --- | --- | --- |
| PX-BP-0 | None | Process overview/capture availability is truthful; no synthetic Gold hit or surprise pause. |
| PX-BP-G | Gold only | Solo/pairs capture automatically with no debugger stop requirement. |
| PX-BP-R | Red only | Real source stop, stack/locals and resume; process gauges remain honest without invented Gold ranges. |
| PX-BP-RG | Red + Gold | Red can pause the real interval; Gold does not become another stop breakpoint; pause time/CPU/cohorts remain interpretable. |
| PX-BP-B | Blue only, eligible caller/provider | Correct managed-reproduction **or** live-native mechanism, target/origin identity, landing and release. Blue does not itself imply Gold profiling hooks. |
| PX-BP-BG | Blue + Gold | Measure only executions actually instrumented; keep A/B separate for managed replay and one history for Rust live-native. |
| PX-BP-BR | Blue + Red | Red native landing and Step/Continue/cancel address the correct execution without stale holds or a second adapter controlling the same native process. |
| PX-BP-BRG | Blue + Red + Gold | All three roles remain legible and independently controllable; capture provenance, stop scope, fixed End, snapshots and release are all proven. |

Blue is not required for a standalone program with no declared native boundary.
Mark it N/A with that reason there. On a promised C# LDI or Rust/native pairing
path with missing support, mark BLOCKED rather than N/A/pass. Gold-only intent
can remain unbound on an unsupported provider; that is a truthful-state result,
not a successful capture result.

### Extra C# managed LDI checks

- [ ] **PX-LDI-01** Confirm the real supported input subset, captured values, A's hold/call site/thread/session and B's token before reading any profiling outcome.
- [ ] **PX-LDI-02** Confirm B's executable/module is the rebuilt instrumented artifact and events authenticate to its PID. Ordinary original-call hooks in A do not imply the driver is instrumented.
- [ ] **PX-LDI-03** Observe A held, B running/stopped/completed, then A's original call. Keep each invocation's CPU, allocations and snapshots distinct; do not charge replay time as original function execution.
- [ ] **PX-LDI-04** Change inspection thread/window/scope during B. Controls keep the fixed original relationship; selecting a Profiler scope is not permission to retarget Build/Run/Debug.
- [ ] **PX-LDI-05** Cancel/Continue A during B startup and during a native pause; repeat with B exit/failure and owner close. Only owned reproduction processes are cleaned up; no stuck origin or token remains.
- [ ] **PX-LDI-06** Hit the prepared Blue binding again after normal completion and cancellation; remove/restore/edit supported conditions and verify documented rearming versus required Gold Restart for new unprepared bindings.
- [ ] **PX-LDI-07** Reject stateful globals/unsupported heap/pointers in a value-only reproduction claim. Scalar success does not certify arbitrary managed/Unity object or native global state cloning.
- [ ] **PX-LDI-08** Run ordered MT origins before considering concurrent-origin work. The lab's seven ordered callers are not seven simultaneously held origins or proof of arbitrary request correlation.

### Extra Rust→C++ live-native checks

- [ ] **PX-NATIVE-01** Prove one original PID and one LLDB-DAP session. B is a native debug view, not a new library debuggee or a managed reproduction.
- [ ] **PX-NATIVE-02** Verify a mixed stack with the Rust caller and native arguments. Original borrowed-buffer mutation/result survives native Step Out/Continue back to Rust.
- [ ] **PX-NATIVE-03** Native landing focuses/reveals the appropriate source/debug context without overwriting either window's Power Config or file state. Commands route to A's original session.
- [ ] **PX-NATIVE-04** A native-entry stop reached by another worker is not falsely labelled the selected call site. Record verified caller/thread/frame correlation; otherwise retain a broad-entry limitation.
- [ ] **PX-NATIVE-05** Native Red/Gold and Rust Gold, if separately supported, coexist in the same process without duplicate sample streams or double-counted allocator events.
- [ ] **PX-NATIVE-06** Closing/unbinding B leaves A's original debug/profiling context usable. Restart/PID reuse invalidates old frames and bindings; no managed hold/release cleanup runs on the Rust path.
- [ ] **PX-NATIVE-07** A's Profiler can inspect the original process while B's ordinary independent Profiler does not silently claim the same live history. Shared-session Profiler B/C remains deferred.

## 8. MT and load axes

| Axis | Minimum deliberate cases |
| --- | --- |
| Worker count/lifetime | One; two overlapping; short burst; repeated worker cohorts; waiting and exited workers. Record actual counts and names, not inferred task counts. |
| Pairing/conditions | Same marker on several threads; recursion; nested overlap; false/true Start; missing End; unwind/early return. |
| Allocation | Retain/free within range; free after End; free an older allocation during a new window; cross-thread free; address reuse; allocation-tracking capacity. |
| Debug pause | Main versus worker Red; before/inside/after Gold; all-thread versus qualified single-thread execution; resume while other workers advance. |
| Blue | Managed ordered origin/driver or Rust live-native caller verification; native workers; cancel during startup/pause; repeat binding after exit. |
| Ownership | Owned launch versus foreign attach; replacement profile; ordinary second IDE; explicit Stop versus target exit; no cross-process snapshot association. |
| Sustained operation | Nominal controlled rate and uncapped/burst; beyond 2,000 captures and actual 2,400-sample rollover; responsive UI; allocate/free/snapshot/restart after rollover. |

A `threads` response is membership, not execution isolation. Record adapter
capabilities and actual `allThreadsStopped` / `allThreadsContinued` evidence.
Use only verified adapter-specific conditional syntax; do not assume `thread.id`
works everywhere or a managed thread ID equals its DAP/native ID. Async request
correlation and arbitrary concurrent LDI have their own deferred requirements.
See the [current MT contract](../feats/mt-debugging/design-multi-thread-debugging-implementation.md).

## 9. Test implementation work, after commissioning each slice

- [ ] **PX-AUTO-01** Reuse `tests/ui/lib` for real embedded app and isolated settings; extend fixtures/provider oracles, not a synthetic HTML screenshot masquerading as runtime evidence.
- [ ] **PX-AUTO-02** Each new language scenario explicitly selects its own process incarnation and verifies prepared artifact/provider. Readiness waits are bounded, with useful failure output and no attachment to unrelated desktop processes.
- [ ] **PX-AUTO-03** Add only the missing deterministic workload/hooks; document build/run instructions and independent expected results. Compile in a disposable output tree, retaining source hashes and cleanup ownership.
- [ ] **PX-AUTO-04** Test source/backend semantics, frontend scope/retention and actual Tauri interaction at their respective layers. Keep separate test/report counts and do not claim manual acceptance from automation.
- [ ] **PX-AUTO-05** Persist loss counters/UI state before asserting or cleaning up. Keep intentional fault runs separate from nominal zero-loss runs and execute the tail after real sample rollover.
- [ ] **PX-AUTO-06** Use actual keyboard/pointer interaction as appropriate, wait for rendered identities and reject select-value-only assertions. Add physical human pointer review for the known history-return issue.
- [ ] **PX-AUTO-07** Register new scripts only once the real scenarios exist. There is currently no universal `test:profiling:all-languages` command; do not invent a successful invocation in the report.
- [ ] **PX-AUTO-08** Rerun relevant Unity/sidebar/editor and native-provider regressions after shared changes. Retain CSP, failure/permission and debugger ownership boundaries.

Existing baseline commands, to be executed and reported on the chosen branch:

```sh
npm run build
node tests/profiling.test.mjs
npm run test:profiler-workspace
npm run test:native-debug
npm run test:ui:build
npm run test:ui:profiler-workspace
```

These do not cover the complete matrix above. Unity-specific regressions remain
`npm run test:ui:profiling` and `npm run test:ui:profiling:long`, using disposable
Editors. Inspect adapter/tool prerequisites before running debugger probes;
missing tools/permissions are not a language implementation pass.

## 10. Report and acceptance boundaries

Use one dated report with a matrix and linked per-path records:

```text
Reviewed Unity checkpoint / carried defects / branch decision:
Language + runtime + build mode + provider + adapter + exact versions:
Configuration/fixture + source/artifact hashes + PID/birth + owner/profile IDs:
Execution mechanism: ordinary / same-process live-native / managed reproduction
Thread namespaces / Gold bindings / Blue origin-token where applicable:

For each PX row + scenario + breakpoint combination:
  M/A/D result, expected/actual values, scope/snapshot/capture identities,
  command, bounded logs/screenshots, defect and repair/retest revision.

Separate claims:
  Process gauges / Gold CPU timing / instrumented allocation lifetime /
  managed heap/GC / Red composition / Blue mechanism / MT / long-run loss

Totals: PASS / FAIL / PARTIAL / BLOCKED / NOT RUN / reasoned N/A per lane
Remaining gaps and user-visible limitations:
Human acceptance / approved supported configurations / next slice:
```

A standalone C++ pass does not qualify C#, Rust, Unity, MT or Blue. A native
interop pass does not establish managed heap coverage. A native-view debug
binding does not deliver shared Profiler sessions. A short run does not close a
ten-minute failure. A mixed-colour screenshot proves neither instrumentation
nor a correctly released held origin.

The desired end state is a usable, measured workflow in each explicitly supported
configuration, with current sidebar/editor UI and honest boundaries. Keep the
full profiler/public-release claim open until its own acceptance gates pass.

---

*Last updated: Phase 3.5 / 3.x, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
