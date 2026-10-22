# Proposed first in-IDE perf timed slice

**Roadmap track:** Phase 3.5 profiling.
**Status:** First timed slice approved, 22 October 2026. Backend implementation/qualification is separate from UI delivery; the UI is on hold for design review. See the [accepted decisions](perf-timed-implementation-decisions.md) and [backend results](perf-timed-backend-results.md).
**Basis:** [Native timed qualification](perf-qualification-results.md) passed on perf 7.2.11-1 for the declared user-only configuration.

## User-visible behaviour

1. Select a PID/incarnation through the existing Attach to Process **Profile only**
   route. This acquires a profiling target without a debugger; it does not
   automatically start statistical sampling.
2. Explicitly start a bounded timed capture, or stop it early. Show the event,
   frequency, unwinder, included existing TIDs, output limit and ownership before
   starting. Stop addresses only Craidd's collector, never the target.
3. Inspect **top-down and bottom-up call trees** built from the same parsed
   samples. Distinguish self and inclusive sampled-event weights. Preserve the
   sample period; percentages are shares of the selected sampled CPU-clock
   event, not exact function durations or causal attribution.
4. Filter by **thread name and TID**, module and an in-capture time range.
   Identically named workers retain separate identities. Module filtering is a
   display lens; it establishes neither ownership nor a “my code” binding.
5. Keep unresolved frames visible with module/address or verified module offset.
   Open a source line only when verified debug information maps to a solution
   file. Fixture symbols resolved in qualification; system-library frames did
   not all resolve and must not disappear from either tree.
6. Show sample count, raw bytes, covered span, LOST records and loss counters.
   Mark any capture with loss **PARTIAL**. Preserve separate potentially
   overlapping LOST and LOST_SAMPLES accounting; never double-count them.

The existing Profiler sidebar/editor hosts remain intact. This proposal adds a
labelled sampling source; it does not replace Gold, process gauges or the CSV
analysis host decision. Its elapsed capture axis records the underlying clock
basis. Session association alone never aligns clocks: retain separate axes
until an explicit, recorded mapping exists.

## Proposed technical boundary

- Discover perf/version and report the exact supported mode. The qualified
  command uses `cpu-clock:u`, `--user-callchains --per-thread --no-inherit`,
  explicit timestamps and monotonic clock. Omitting user-only callchains caused
  EACCES on this machine despite a user-only event; do not infer permissions
  from paranoid alone. Never change policy or offer privileged perf execution.
- Use a separate typed stack-sample payload and the
  [common source envelope](../design-profile-source-contract.md). Do not place
  stacks in `ProfileSample` or convert their weights into Gold durations.
- Parse and aggregate off the UI thread; deliver bounded rows/tree branches.
  Retain bounded raw perf.data and diagnostic output for re-parsing.
- Own the collector per window/session/capture generation. Verify PID/start
  tick before launch, preserve partial data on target exit or collector failure,
  and route Stop/close/IDE exit only to the owned collector. A deliberate SIGINT
  exit may be `-2` after valid finalisation on the tested version; successful
  decoding and lifecycle evidence are still required.
- Offer FP and DWARF as explicit modes with capability/coverage labels. No
  automatic fallback or claim that arbitrary binaries have usable frame
  pointers. State DWARF stack bytes and output cost before launch: the fixture
  produced 39.27 times as many raw file bytes at the same sample count.
- State that this qualified no-inherit mode covers threads existing at capture
  start. Later-created threads/descendants require additional qualification,
  not an implicit all-threads promise.

**Accepted since this proposal:** `cpu-clock:u`, 99 Hz default / 999 Hz
selectable, 10-second default / 120-second maximum, explicit FP and DWARF
8,192/16,384, existing-thread coverage with gained-thread observations, per-solution
cache retention/pinning and refusal of the unqualified LLDB pair. The proposed
512 MiB raw cap awaits the user's review of its measured evidence. Separate
clock axes remain mandatory. See the addendum for the full decisions.

## Acceptance before this slice is called delivered

- End-to-end Profile only → native timed capture → both trees → thread/module/
  time filtering → verified fixture source navigation in the actual desktop.
- Installed-version parser fixtures preserve weights, timestamps, TIDs,
  unresolved frames and positive LOST/counter records; unknown records remain
  diagnostic. A second perf version needs separate compatibility evidence.
- Native failure/lifecycle checks: missing/refused tool, target exit, collector
  crash, owner-window close, IDE exit and PID reuse; partial results retained
  and target untouched. These product cases were not qualified by the no-UI
  fixture's successful collector Stop.
- Measure real workload slowdown, collector CPU/memory, symbol-resolution time
  and UI responsiveness separately. Do not call output-size evidence overhead.
- Refuse unqualified concurrent debugger/collector combinations rather than
  assuming that an LLDB attachment composes with perf.

Flight recording, JIT maps, symbol scale, flame graphs, off-CPU, GPU and memory
tracing stay outside this first slice. The measured ring-retention table
supports a separate flight-recorder decision; it approves no “last N seconds”
guarantee and cannot make sampling reliably capture every short spike.

---

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
