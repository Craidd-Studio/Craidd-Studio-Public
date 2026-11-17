# Design: Attached profiling

**Roadmap track:** Phase 3.5 profiling proposal, composing with Phase 3.x
attach. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal tightened 14 October 2026. External PID sampling is an
initial delivery checkpoint. Gold-controlled CPU and memory capture is the
public target and requires its own event provider. Neither is implemented by
the current layout-only Profiler.

**Companions:** [Gold capture contract](design-gold-capture.md),
[profiling philosophy](../../philosophies/debugging/profiling/philosophy-profiling.md),
[profile infrastructure](design-profile-markers.md),
[attach to process](../debugging/design-attach-to-process.md),
[Unity workflow](../../unity/feats/design-unity-native-plugin.md).

The [experimental implementation](implementation-attach-gold.md) supplies Linux process gauges and opt-in C++ source events. These are separate from the proposed perf stack/module checkpoint below.

The proposed [generic profiling revisions](revisions/README.md) extend this
design: [GR-001](revisions/gr-001-metric-csv-import.md) adds imported/live CSV
metric sources, and [GR-002](revisions/gr-002-external-pid-sampling-perf.md)
specifies the PID sampling checkpoint for large native and JIT workloads.
The [accepted decisions](revisions/implementation-decisions.md) stage delivery.
[GR-001 M1](revisions/gr-001-m1-results.md) passes automated release gates and
awaits human acceptance. [GR-002 qualification](revisions/perf-qualification-results.md)
records the installed native timed checkpoint. In-IDE timed perf is next in
priority, with M2 then M3 waiting; neither full revision is delivered.

## Target ownership and capture mechanism are separate

A profile targets either a process Craidd launched or a foreign process the
user selected. Ownership determines teardown. The available collector and
marker provider determine what can be measured.

| Capture mechanism | Needs debugger attach? | Needs Gold event binding? |
| --- | --- | --- |
| External whole-process/module sampling | No; collector permissions still apply | No |
| Gold solo and paired ranges | No universal requirement; depends on provider | Yes |
| Unity runtime/frame events | Depends on the integration, not the PID picker | Qualified runtime bridge/event source |

Source-instrumented code may be built beforehand and later loaded by a process
Craidd did not launch. Conversely, launching a target does not guarantee that
its Gold markers are instrumented. Do not equate attached with uninstrumented
or owned with instrumented.

A connected debugger supplies a convenient target identity, but profiling
can also select a foreign PID without acquiring a debugger. Discovering Unity
or opening a script does not silently attach, pause or profile it.

## The collectors

Craidd discovers installed tools, records capabilities, invokes them and
parses their outputs. It does not bundle a profiler. A capability record must
include target/runtime compatibility, permissions, required preparation,
concurrent-debugger compatibility, event/metric scope and parser version.
An `attach` boolean alone is insufficient.

### CPU: initial perf checkpoint

`perf record -p <pid>` can sample a running process; `perf script` can expose
sample records for parsing. Preserve the event type, period/weight, timestamp,
module and thread attribution when available. Percentages are shares of the
selected sampled event, not exact self-time measurements for arbitrary lines.
Hardware cycles, CPU time and wall duration have different meanings.
See [perf's documented counter and sampling model](https://perfwiki.github.io/main/tutorial/).

Tool discovery and permission checks are required. Do not assume perf is
installed or usable on every Linux system, or that every output version has
one identical text shape. Malformed/unknown records remain diagnostic output;
parser fixtures and real installed-tool validation establish support.

Sampling provides a useful whole-process view before Gold event binding is
ready. It cannot infer exact Start/End hits from a saved gutter marker.

### Memory: separately qualified collectors

Native allocation tracking and managed GC/heap inspection are separate
capabilities. A heap-size gauge or sample is not an allocation-lifetime trace.
The [Gold memory contract](design-gold-capture.md#memory) governs range cohorts,
freed/collected data, survivors and coverage labels.

`heaptrack --pid <pid>` uses GDB injection, according to its
[upstream documentation](https://github.com/KDE/heaptrack). Its attach path
must be qualified against any debugger already controlling the target;
it cannot be assumed to compose with a live LLDB attachment. Launch-time
preparation is a possible separate path, with explicit user-visible setup.
Neither path supplies arbitrary Gold source events without a marker binding.

Unity managed allocations and object retention need a qualified Unity/runtime
collector. Native allocator traces alone do not establish the lifetime of
individual Unity C# objects. Late attachment must state its coverage start.

### Tracing and GPU

A tracing provider may supply non-stopping Gold events, but it must prove
source/artifact mapping, pairing and conditions. User-supplied bpftrace
scripts remain later scope with an explicit invocation/permission contract.

GPU duration/counters and late completion correlation are drawn into the
[GPU section](design-gold-capture.md#gpu). Delivery is optional for the initial
public iteration and depends on installed tools and supported device APIs.

## Result model

The earlier `ProfileEntry` sketches in the philosophy and marker documents
are not a committed shared schema. Samples, diagnostics, allocation events,
range measurements and result snapshots have different lifetimes and fields.
Keep a common envelope for routing, without flattening away their meaning:

- Target process incarnation and owner session/run generation.
- Linked owner/view identity, collector/provider identity and artifact binding.
- Timestamp/clock domain, measurement kind, scope, units and coverage.
- Optional source/module/symbol resolution; unresolved is not file line zero.
- For Gold results: marker/range, batch, capture and invocation identity.
- For allocation traces: allocation/free identity where the provider supplies it.
- Completion status, missing events, truncation and collector errors.

The final representation is an implementation decision. Module/source fields
remain optional because useful samples can exist without symbols. Preserve raw
bounded output for diagnosis rather than inventing missing values.

## Profiler panel

Profiler lives in the right panel beside Debugger, consistent with
[the layout decision](../../uiux/design-public-release-sweep.md#3-profiling-layout-only).
The header identifies the process, its attached/launched ownership, and the
current collector/binding state.

Gold ranges follow the [automatic recording and collapsible-group contract](design-gold-capture.md#profiler-presentation).
There is no Record ranges prerequisite. Snapshot preserves the current result
view; Record again starts a fresh batch. External whole-process capture may
still have explicit Start/Stop controls because it has no source trigger.
Stopping that collector does not stop the foreign process.

Whole-process samples and Gold intervals appear as labelled sources in one
results workspace. They coexist; a collector mode toggle must not suggest
that debugger attach or Gold instrumentation is required for PID sampling.
CPU, memory, threads and GPU appear with honest capability/coverage states.

### Module filter

List observed modules and allow selecting the verified native plugin artifact.
A module filter is a display/attribution lens, not a new process or proof of
causal ownership. Do not call every non-main `.so` the user's plugin: Unity
loads engine and third-party libraries as well. A default Plugin only lens
requires an explicit or verified project-artifact-to-loaded-module binding.
Unresolved symbols remain visible and are never attributed to a guessed file.

### Linked aggregation

Aggregate distinct process contexts with owner labels. Two windows viewing
one live native process share one capture; they do not double its samples.
Managed LDI origin and native reproduction keep separate process, heap and
capture identities. The UI can show their relationship without summing the
reproduction into the origin's workload.

## Attach and collector teardown

Craidd owns the collector/adapter subprocesses it starts, but not the foreign
target. Only those owned subprocesses go through their owned cleanup paths.
The [attach contract](../debugging/design-attach-to-process.md#ownership-semantics)
governs target disconnect. Collector failure, Stop, Detach and IDE close
finalize/retain partial results and never acquire authority to kill the target.

If a collector buffers output or crashes, show that gap. Process identity is
verified against its incarnation; PID reuse cannot transfer a capture to a
replacement. A source/module change invalidates prepared binding and requires
an explicit rebuild/reload path, not mutation of an already loaded library.

## Delivery and evidence

1. **PID sampling checkpoint:** one discovered perf configuration, parser,
   right-panel results, module resolution/filter and foreign-target-safe Stop.
   Permit direct target selection without a debugger.
2. **Attach composition:** use verified debugger target identity; qualify
   collector coexistence and mixed linked ownership.
3. **Gold provider:** prove non-stopping source hits, conditions and dynamic
   pairing. Implement automatic arming, one solo, paired collapsible groups,
   immutable snapshots and fresh batches.
4. **Memory capability:** native allocation/free lifetimes and separately
   qualified managed data, with range ownership and historical coverage.
5. **Unity runtime lifecycle and aggregation:** use actual Play/frame/thread
   events where available; qualify restart and late-event behaviour.
6. **Optional GPU and later tracing:** add only qualified metrics/providers.

The public Gold profiling target requires steps 3–4, not just the CPU sampling
checkpoint. Record each delivered capability independently; the current roadmap
priority for ordinary MT and LDI reliability is unchanged by this proposal.

Acceptance includes real installed-tool output, source/module resolution,
missing tools/permissions, collector/debugger coexistence, crash and detach
without foreign-process termination, linked duplicate-view prevention, and
all [Gold capture gates](design-gold-capture.md#acceptance-before-implementation-is-called-complete).
Unity acceptance is recorded separately against an actual Editor/player.

---

*Last updated: Phase 3.5, 20 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
