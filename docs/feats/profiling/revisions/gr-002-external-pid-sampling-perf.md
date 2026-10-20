# GR-002: External PID sampling with perf

**Status:** proposed revision. Not implemented.
**Craidd baseline reviewed:** `feat/unity/debug-a-to-p` at `8bac01e`.
**Area:** Profiler (Phase 3.5 profiling). Delivers step 1, "PID sampling checkpoint", of
[attached profiling](../design-attach-profiling.md), with additional requirements for large native workloads.

The [accepted implementation decisions](implementation-decisions.md) limit the
first work to native timed qualification. Its [results](perf-qualification-results.md)
now record the installed-version checkpoint, explicit user-only callchains and
measured overwrite retention. This is collector qualification, not an in-IDE implementation.
Flight recording remains proposed. A ring buffer does not guarantee N seconds,
and sampling can miss a short spike.

## Summary

Sample a running process's stacks with `perf` for a chosen span, and show where the CPU time went by thread, module and
function, with no debugger and no prepared markers. This is the "where do I look" step: it comes before placing Gold
ranges, and it is the only option for code that cannot be instrumented, such as AOT-generated native libraries, engine
code and third-party modules.

## Problem

Craidd's current collectors give whole-process CPU, RSS and thread counts every 250 ms, plus Gold ranges where the
code has been prepared with hooks. When a process's CPU use is high, or a loop occasionally runs long, nothing in Craidd
says which functions are responsible. The design for sampling exists ([attached profiling, "CPU: initial
perf checkpoint"](../design-attach-profiling.md#cpu-initial-perf-checkpoint)) but is not built.

Large native workloads add requirements the design does not yet spell out:

- Large AOT-compiled libraries with hundreds of thousands of symbols, and engine binaries with separate debug files.
- Job-system worker pools: many threads with similar names, where the time per worker matters.
- JIT runtimes (Mono, CoreCLR) whose frames are anonymous unless the runtime writes a perf map.
- Spikes that last one iteration, where the interesting moment is often already in the past when the user notices it.

## Proposal

### Capture

- **Target:** a process incarnation (PID plus start time), chosen from Attach to Process with "Profile only", or the
  target of an existing profile session. No debugger is needed. PID reuse must never move a capture to another process.
- **Modes:**
  - **Timed:** sample for N seconds, or Start/Stop by hand.
  - **Flight recorder (open question 1):** keep sampling into a bounded ring and save the last N seconds on demand, so
    a spike that already happened can still be examined. `perf record --overwrite` with `--switch-output` is one
    candidate; it must be qualified, not assumed.
- **Settings shown with the result:** event (default `cpu-clock` or `cycles`), frequency, call-graph method
  (frame pointers, DWARF with stack size, or LBR where available) and threads included. DWARF's overhead and output size
  are stated before starting.
- **Overhead and loss:** show perf's `LOST` records, the samples written and the output size. A capture with lost
  samples is labelled partial.

### Permissions and tool discovery

- Discover `perf` and its version, and read `kernel.perf_event_paranoid`, `kernel.kptr_restrict` and the effective
  capabilities. Show which modes are possible as a result: user-space only, kernel stacks, other users' processes.
- Explain a refusal and what would allow it. **Never** change a sysctl, capability or policy, and never offer to run
  with elevated rights.
- Missing `perf` is a clear "not available" state with the reason, not an error dialog loop.

### Symbols at scale

- Resolve symbols off the UI thread with progress, and cache by build ID. A large library must not freeze the panel.
- Match debug files by build ID (separate `.debug` files, `debuginfod` where the user has enabled it). A mismatched
  build ID is shown, never silently used.
- Unresolved frames stay visible as `module+offset`. They are never attributed to a guessed file or line.
- **JIT runtimes:** read `/tmp/perf-<pid>.map` when the runtime writes one, and say plainly when it does not, so
  anonymous JIT frames are explained, not hidden. How a given runtime is told to write the map is per runtime (open
  question 2).

### Results

- **Views:** top-down and bottom-up call trees, and a flame graph, all built from the same parsed samples.
- **Filters:** by thread (name and TID), by module, and by a time range inside the capture. Worker threads with the
  same name can be grouped or kept separate.
- **Module lens:** as the design says, a module filter is a display lens, not ownership. A "my code only" lens needs an
  explicit project-artifact-to-loaded-module binding.
- **Navigation:** clicking a resolved frame opens the source line when the debug info maps to a file in the solution.
- **Percentages** are shares of the sampled event, labelled as such, never exact self time.
- **Timeline:** the capture's span is shown on the Profiler timeline beside process samples, Gold captures and any
  imported metric series ([GR-001](gr-001-metric-csv-import.md)), so a slow window can be matched to the samples taken
  during it.

### Safety and lifecycle

- Craidd owns the `perf` subprocess, not the target. Stop, collector crash, window close and IDE exit stop `perf` and
  keep partial results, and never signal the target.
- Target exit during a capture finalises the capture with "target exited" and keeps what was collected.
- Coexistence with an LLDB session on the same target is qualified, not assumed. Record the result per collector and
  debugger pair, and refuse combinations that have not been qualified.
- Raw `perf.data` is kept, with a bounded size, so a result can be re-parsed or opened in other tools.

### Out of scope

- Off-CPU and wait analysis (scheduler events), GPU, heap and allocation tracing, and system-wide sampling. Each needs
  its own qualified collector.
- Root causes. A hot function is where time went, not why.

## Existing foundation

- [Attached profiling](../design-attach-profiling.md): the collectors, capability records, result model, module filter,
  linked aggregation and teardown. This revision implements its step 1.
- [`src-tauri/src/commands/profiling.rs`](../../../../src-tauri/src/commands/profiling.rs): process identity, bounded
  profile storage and Stop routing per owner window.
- [`src/components/dialogs/AttachProcessDialog.tsx`](../../../../src/components/dialogs/AttachProcessDialog.tsx): target
  selection and "Profile only".
- [`src/components/panels/ProfilerPanel.tsx`](../../../../src/components/panels/ProfilerPanel.tsx): timeline, sources
  and scopes.
- [Gold capture](../design-gold-capture.md): coverage labels and partial-capture states, which samples should reuse.

## Acceptance

Proposed fixtures in `workspaces/`:

- **Native:** a C++ or Rust program with a known hot function on a named worker thread, a second pool of identically
  named workers, and a switch to cause a one-iteration spike.
- **Symbol scale:** the same fixture linked against a generated shared library with about 200,000 functions and
  separate debug info.
- **JIT:** a .NET program with and without a perf map.

**Automated:**

- The parser handles real `perf script` output from the installed version, plus recorded fixtures from at least one
  other version. Unknown records stay diagnostic output.
- The known hot function is the top self-time entry on its thread.
- Build-ID mismatch is detected; unresolved frames are kept; lost samples are reported.

**Desktop:**

- Sample the native fixture without a debugger and find the hot function. Filter to one worker.
- Open the source line from a frame.
- Catch the one-iteration spike in flight-recorder mode, if it is delivered.
- Open the symbol-scale fixture with the UI staying responsive, and record the actual resolve time.

**Permissions:**

- With `perf` missing, `perf_event_paranoid` at 3, and `kptr_restrict` at 2: each shows the correct capability
  state, and nothing is changed on the system.

**Failure and recovery:**

- Target exit mid-capture, `perf` killed, window closed during a capture, and PID reuse: each leaves the target
  untouched and the partial result labelled.

## Open questions

1. Is flight-recorder mode part of the first delivery, or a follow-up? It decides whether one-iteration spikes can be
   examined at all.
2. Should JIT perf-map setup be per runtime (a launch-time switch that Craidd shows), or left entirely to the user?
3. Should DWARF unwinding be the default when frame pointers are absent? It is more complete but much larger and
   costlier.
4. Does sampling share one result model with Gold captures, or is it a separate source linked by time range?

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
