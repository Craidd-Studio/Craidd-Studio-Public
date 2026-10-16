# Design: Gold capture markers and Profiler results

**Roadmap track:** Phase 3.5 profiling, composing with Phase 3.x debugger
attach. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Target design agreed during the 14 October 2026 discussion.
An experimental Linux native slice now exists; see the [implementation record](implementation-attach-gold.md) for measured capabilities and remaining gates. This document remains the broader target contract; HTML concepts are references.

**Companions:** [Attached profiling](design-attach-profiling.md),
[profile marker infrastructure](design-profile-markers.md),
[attach to process](../debugging/design-attach-to-process.md),
[Unity workflow](../../unity/feats/design-unity-native-plugin.md).

**Governs:** Gold recording semantics, gutter actions, capture identity,
measurement scope and Profiler organisation. This contract supersedes the
older manual Record ranges controls and default source-insertion UX.

## The decision

Gold Breakpoints are IDE capture markers. They start and end recording;
they do not request a user-facing debugger pause. Red breakpoints retain
ordinary stop semantics. Blue markers retain native debugging/LDI semantics.
Gold marker colour does not make a marker an LDI trigger or a linked launch.

Debug automatically arms enabled, bound Gold markers for its context. There
is no separate Record ranges prerequisite. A marker lacking a qualified
provider says why it is unavailable; a saved gutter diamond is not evidence
that its source event can be observed.

## One solo, all other ranges paired

A capture context identifies one actual process incarnation and profiling
session/run generation, with its qualified provider bindings. Collector
changes do not create permission for another solo in the same context. Multiple linked views of that context share
the same markers and captures. There is **at most one solo Start**
within it, including when markers come from several source files. Independent
linked processes may each have their own solo; a solution-wide singleton
would wrongly prevent their separate recording.

| Form | On entry | Endpoint |
| --- | --- | --- |
| Solo Start | First eligible hit opens the overall recording | Capture session end, process exit, or verified runtime run end |
| Paired Start + End | Each eligible Start opens one invocation capture | Its matching End in that invocation |
| Incomplete pair | No capture; show Awaiting End | User supplies a valid End |

Repeated solo hits do not restart its clock or reset its counters. They may
increment a hit count. Solo is an explicit form, never an orphan Start
interpreted automatically. Function/method/block exit is not its implicit End.
Conditions, if supported, are evaluated at Start; the first matching solo hit
opens its recording. An End never re-evaluates the Start condition.

Pairs remain independently armed with or without a solo, including before
the solo's first hit. Pairs observed within its recording can be presented as
subranges beneath it. Earlier or independent captures retain their own place.
Temporal overlap does not imply causal ownership, and chronological display
does not serialize application execution.

## Gutter interaction

An empty gutter's context menu contains **Profiling** with:

- **Breakpoint [Start]** — begin placement of a paired range.
- **Breakpoint [End]** — complete an explicitly identified pending Start.
- **Solo recording Start** — create the sole open-ended marker. When one
  exists, offer **Move solo Start here** instead of another solo.

End is unavailable without a compatible pending Start. If several are
eligible, select the intended range; never pair by nearest line alone.
The first slice binds pairs within one executable function and a provider
that can identify dynamic invocations. Cross-function/async pairs require a
separate correlation contract. Provider validation can reject a pair before
arming, with the reason visible.

| Existing marker | Context actions |
| --- | --- |
| Unpaired Start | Add/Edit Condition; Remove Breakpoint (Start only) |
| Paired Start | Add/Edit Condition; Remove Breakpoints (Start + End) |
| Paired End | Remove Breakpoints (Start + End) |
| Solo Start | Add/Edit Condition; Remove Solo Start |

Selecting either endpoint highlights both endpoints and the range. Start/End
tooltips name their partner, condition, scope and binding status. Solo is
visibly labelled Solo, not a different meaning of an identical orphan icon.

Removing or moving markers changes future arming. If it invalidates an open
capture, close that capture as incomplete with a marker-edit reason. Never
erase already collected results or redirect a late End to a replacement.
Conditions apply to later entries; an open invocation retains its entry
decision. A changed build/source binding may need rebuild/restart and must
say Pending restart rather than claim the new location is active.

## A non-stopping event provider is required

Debug attach and PID sampling do not themselves provide arbitrary source-line
Start/End events. Supported paths may use instrumentation prepared before the
target loads it, or a qualified non-stopping tracing provider with verified
source/artifact mapping. Provider choice and source mutation must be visible.

Setting ordinary DAP breakpoints and immediately continuing is not accepted
as the default implementation of non-stopping Gold capture. It perturbs
execution and must not be disguised as an uninterrupted measurement.
Conditions need provider-supported observation without running getters or
other user code through the debugger. Unsupported expressions stay unarmed.

The first provider must prove pairing for repeats, recursion and concurrent
threads, early returns/unwinding, and missing/dropped events. Static source
order is not sufficient to identify the matching dynamic End. An unmatched
End produces an explicit diagnostic; it cannot close another invocation.

Marker persistence/schema and build-instrumentation mechanism remain open
implementation decisions. Source location, range identity, solo intent,
condition and target binding must survive independently of captured results.
The user placing a gutter marker does not authorize silent source changes.
No `.craidd` framework fields or solution project records are invented for
external targets.

## Capture identity and lifetime

Each result needs a capture ID, marker/range ID, run and batch IDs, actual
process incarnation, owner session generation, loaded artifact/source binding,
provider and measurement scope. A bounded range additionally needs triggering
thread incarnation and invocation/correlation identity. A DAP thread ID is
adapter-local; it is not assumed to be a Linux TID.

Label states **Unbound**, **Awaiting End**, **Armed**, **Recording**,
**Complete**, **Incomplete**, and **Unavailable** separately. A crash, missing
End, collector failure or disconnect retains a partial result with its reason.
The expected endpoint completes the solo normally; interrupted paired ranges
are incomplete. Restart creates fresh identities and clears pending matching
state without discarding retained results.

Debugger pauses and LDI holds must be recorded as timeline intervals. Display
elapsed wall duration, observed pause/hold duration and any justified active
duration separately. Never claim wall duration is CPU time or silently remove
unobserved pauses. A linked participant can still run while another is held.

## Unity-first connection

Unity may already be open or playing when Craidd starts. Explicit target
selection publishes a private per-process-incarnation rendezvous for prepared
native source providers. The provider discovers and reconnects without a launch
environment variable. Discovery uses a private XDG runtime directory (HOME
cache fallback), scoped by HOME or an explicit shared test namespace; routes
include the target PID and start identity. Dead-host routes/sockets are removed
by a live provider or the next host startup in that scope. A small lock file
and namespace directory remain intentionally. An unambiguous matching Editor can be preselected in
Attach from its executable, project argument and Unity version declaration;
preselection does not attach a debugger. No managed adapter support is inferred.

An Editor context remains armed between Play runs. Verified Play end closes
captures and preserves results; the next source start belongs to a fresh batch.
Native providers repeat the current Play generation and playing/idle state on
every event and a periodic heartbeat. A missed single Play-end event cannot
strand the context; a new generation closes old captures and opens a new batch.
A disconnected stream closes open results as incomplete, clears pending Solo
state, and permits a fresh segment on reconnection. Late frees keep their
original cohort ownership. Sequence gaps are coverage loss, separately counted.

Explicit Stop/close disarms routing and cannot automatically rearm later. A
player's application end finishes its context. Target exit/PID reuse invalidates
the selection. Old provider binaries need rebuilding/reloading once to gain
runtime discovery. Process gauges remain available without source coverage.

## Profiler presentation

Profiler lives in the **right panel beside Debugger**, per
[the public-release layout](../../uiux/design-public-release-sweep.md#3-profiling-layout-only).
It identifies the selected process/session, loaded module and capture state.
A **Gold benchmark dropdown** selects one recorded solo or paired range for
CPU/memory detail. Solo is the automatic default when recorded. Without Solo,
the initial view is Process overview. An explicit range or Process overview
choice takes precedence and survives new hits, batches and snapshot switching
within that process session. New hits never override an explicit choice. A
Solo shortcut returns to its overview; a different process gets its own default.

The selected benchmark's graphs are visible directly. Repeated hits or Solo
batch segments live in a collapsible list with expandable per-hit details.
All Gold markers continue recording independently of this view selection.
Benchmark choices come from recorded capture metadata, not names or later
source edits. A selected benchmark absent from a historical/filtered view stays
selected and reports no captures rather than silently switching to Solo.
Source navigation reveals the marker endpoints in their owner context.

CPU, memory, contributing threads and GPU sections report their selected
scope. Process-wide CPU/RSS graphs remain labelled as process context; changing
the benchmark does not turn RSS into range memory or attribute process CPU to
that range. Capture-level CPU means avoid summing nested invocations; native
allocation cohort sums are inclusive and labelled because cohorts can overlap.
Snapshot RSS remains process-wide while its native cohort column follows the
selected benchmark and filters. Missing collectors remain Unavailable/Planned.

The public target is CPU and memory tooling with per-thread inspection.
Whole-process sampling alone is an earlier checkpoint, not completion of
Gold-controlled profiling. GPU is designed here but optional for the first
public iteration. Missing metrics show Unavailable or Planned, never zero.

### CPU

Display elapsed wall duration, CPU time, call/hit count, and hardware cycles
where a qualified collector supplies them. Sampling counts/weights and their
coverage remain labelled as samples, not exact elapsed time. CPU time and
hardware cycles are separate metrics, as in the
[perf counter model](https://perfwiki.github.io/main/tutorial/).
Do not derive hardware cycles from an assumed clock frequency.

### Memory

Distinguish native allocation/free traces, managed allocations/collections,
and process-wide heap/resident gauges. Collector capability determines which
are available. Report:

- Allocated bytes/count within the range and peak observed live bytes.
- Frees/collections observed during it, including the scope of that figure.
- Allocations originating within this range that remain live at End, when
  allocation identity/lifetime tracking supports that statement.
- Later reclamation of those allocations only while an eligible tracker
  continues to observe them; otherwise say Not observed after End.

Bytes allocated minus all bytes freed during a range does not identify its
survivors: the frees can belong to earlier allocations. An allocation counter
or heap-size delta alone cannot prove reclamation. GC occurrence alone does
not establish which objects survived. Still live at End is not a leak verdict.
Late attachment limits historical coverage and must be disclosed.

### Threads

Show triggering thread, contributing threads, CPU/allocations where supported,
and separately qualified wait/contention evidence. This is measurement and
inspection scope; Gold does not freeze other threads. Work dispatched to jobs,
async continuations or other processes needs an explicit correlation token.
Time overlap alone supports a timeline relationship, not a causal claim.

### GPU

Reserve a labelled GPU section for device/queue, GPU duration, supported
counters/cycles, submission and completion correlation. Submission within a
CPU range may complete after its End; late events stay attached to their
original capture identity. CPU time around submission is not GPU duration.
Collector compatibility, device clocks and supported platforms need their own
qualification. A missing collector produces no invented chart.

## Snapshot and Record again

These are result controls; neither starts the program or replaces automatic
arming. **Snapshot** preserves an immutable view of current observations while
Live continues. Open intervals in that view are partial, with an as-of time;
later data cannot rewrite the snapshot. Saving keeps Live selected; reviewing
a saved snapshot is explicit, with a visible Live control to return. If a
reviewed snapshot ages out of the eight-view bound, return to Live. This is not
a solo point marker.

**Record again** preserves the previous batch and starts a fresh measurement
batch without restarting the target or altering user counters. Already-open
paired invocations finish in their original batch; later Starts belong to the
new batch. If the solo is open, split its recording into labelled batch
segments at the boundary, without pretending the solo source line was hit
again. Events completing late retain their original batch/capture identity.

The current native collector retains at most 128 ordinary completed hits per
marker, 2,000 total captures and 2,400 process samples. Solo segments, open
captures and cohorts with live allocations are pinned; a hot range cannot evict
them. When all slots are pinned, admission fails visibly and Record again
keeps the current recording intact. Pinned history is still bounded. Sample
aging and capture eviction are expected rolling retention; source rejections,
sequence gaps and disconnects are separate coverage counters. Eight snapshots
are retained in memory. Persistent export/storage remains future work.

## Acceptance before implementation is called complete

- Place, pair, highlight, condition, move and remove real gutter markers.
  No End exists alone; a second solo cannot be armed in the same context.
- Start ordinary/linked Debug and attach with compatible instrumentation.
  Enabled Gold markers arm automatically without Record ranges.
- A missing provider or stale artifact stays visibly unbound. Prove that
  capture does not send hidden debugger stop/continue commands.
- Repeat and recurse through a pair on concurrent threads; Ends match the
  correct invocation. Exercise early exits, missed events and collector loss.
- Verify solo first-hit behaviour, pairs before/after it, restart identities,
  and expected/abnormal teardown without killing a foreign target.
- Correlate CPU counters and allocation/free lifetimes with raw tool events.
  Test frees of older allocations, intentional survivors and later cleanup.
- Snapshot an open range, begin a new batch, then receive a late End/GPU event.
  The snapshot stays immutable and batch ownership stays correct.
- Confirm native live views share results, while LDI reproduction and origin
  remain distinct processes/heaps. Selecting a thread does not resume it.
- Exercise the [Unity Play/player lifecycle](../../unity/feats/design-unity-native-plugin.md#unity-capture-lifecycle)
  in the real Editor/player. A UI demonstration or protocol harness is only a
  checkpoint; record desktop and collector evidence separately.

---

*Last updated: Phase 3.5, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
