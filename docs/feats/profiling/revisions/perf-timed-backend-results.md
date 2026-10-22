# GR-002 timed backend: results and remaining gates

**Roadmap track:** Phase 3.5 profiling.
**Status:** Backend checkpoint, 22 October 2026. UI implementation is on hold for the user's ChatGPT design. This is not the delivered in-IDE slice or public-release acceptance.
**Source:** `codex/profiling-perf-timed`, stacked on M1 `5039abf`; local only.

The [decisions addendum](perf-timed-implementation-decisions.md) records the
accepted scope and proposed cap. The native [evidence JSON](../../../../workspaces/profiling-perf-backend/evidence-2026-10-22.json)
records the machine, binary hashes, exact configurations, result trees,
provenance, recovery cases and separate gates. Reproduction is in the
[backend fixture README](../../../../workspaces/profiling-perf-backend/README.md).

## Implemented backend

The window-scoped `perf_action` command resolves the solution and active
profiling target from this window; callers cannot submit a replacement PID.
It prepares, starts, stops, lists, pins and reopens captures, and queries bounded
top-down/bottom-up branches and verified source locations. All capture,
symbolization, parsing and queries run away from the UI thread. No panel,
toolbar or visual layout was changed.

Results are a separate stack-sample type with source identity, generation,
process incarnation, profile association, clock domain, units, coverage,
retention and completion metadata. The monotonic axis remains separate from
session time. Thread/module/time filters use the same period-weighted samples.
A module lens selects samples containing that module and retains their full
calling context. It does not establish project ownership. Symbols at different
instruction addresses aggregate as functions; raw data preserves the original
addresses. Source navigation returns the first retained source mapping for a
function, requires a matching current module build ID and a canonical file
inside the solution directory, and performs no implicit path remapping.

Existing-thread coverage includes TID/start ticks. New-thread observations are
polled every 100 ms; short-lived threads can be missed. Retain at most 4,096
initial and 4,096 gained identities. Overflow exposes omitted observations and
a lower-bound count; it cannot grow manifests indefinitely. Data queries retain
at most 500,000 samples, 100,000 frames, eight million frame references and
16 MiB of frame/source text. Any omission marks the result PARTIAL. At most two
captures are loaded or active in memory. Raw cache retention keeps ten unpinned
captures per solution plus pins, including a just-completed older capture.

The backend checks current-user ownership and PID/start tick, refuses an active
tracer, guards internal LLDB attachment against an active perf capture, and
invalidates attribution on observed PID/TID reuse. Capture subprocesses use the
existing IDE process supervisor. Stop uses only the owned collector; profile
Stop, window-close hooks and application shutdown route cleanup to that owner.
Emergency collector failure retains raw output and diagnostics even when no
samples can be decoded. A closed owner's result can reopen in a replacement
window. Reopening checks the immutable raw-data hash before re-parsing.

## Native measurements

Machine `sk27`: Ryzen 9 9950X3D, Linux `7.2.11-arch1-1`, perf **7.2.11-1**,
UID 1000, effective capabilities zero; paranoid **2**, kptr restriction **0**.
No policy changes or elevated perf execution. The optimized no-UI harness uses
the production core; the Tauri integration separately compiles and passes its
Rust tests. These ordinary-desktop measurements are not isolated workload
slowdown benchmarks.

Two busy workers, waiting main, 99 Hz, two-second timed captures:

| Mode | Samples | Raw bytes | Module/build-ID checks, ms | Decode + streaming parser wall, ms | Rust parser CPU, ms | Loss scan, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FP | 392 | 73,412 | 100 | 25 | 2 | <1 |
| DWARF 8,192 | 392 | 3,345,652 | 125 | 25 | 4 | <1 |
| DWARF 16,384 | 394 | 6,590,236 | 126 | 25 | 6 | <1 |

Perf unwinding/symbolization and Rust parsing stream concurrently. Their wall
time is reported together; parser-thread CPU is a separate measurement, not a
subtracted estimate. Module/build-ID checking is not called total symbol
resolution time. The [separate no-FP qualification](gr-002-many-thread-retention.md)
demonstrates the missing FP ancestors and the full DWARF chain.

**Proposed 512 MiB cap:** 32 busy workers, 999 Hz, 16,384-byte DWARF stopped at
**507,665,148 bytes (about 484 MiB)**, retained 30,549 samples and was PARTIAL
with an explicit cap reason. The target remained alive. No LOST records were
present and the loss scan completed. Module checks took 580 ms; decode/parser
wall 1,134 ms; parser CPU 460 ms; loss scan 50 ms. A 32 MiB early-stop reserve
allows for finalization, with a hard 512 MiB file-size limit on the collector.

An earlier comparable 514,511,508-byte run spent **47,797 ms** formatting and
scanning `perf script -D`. That measured bottleneck led to a bounded direct
record-header scan. The two workloads are comparable, not identical-byte A/B
trials. The direct scanner supports only the qualified regular, little-endian,
uncompressed `PERFILE2` layout; unsupported/truncated records make loss coverage
unknown and the capture PARTIAL. It follows the upstream
[perf file header](https://raw.githubusercontent.com/torvalds/linux/master/tools/perf/util/header.h)
and [Linux LOST record layouts](https://raw.githubusercontent.com/torvalds/linux/master/include/uapi/linux/perf_event.h).

A fresh positive-loss trial stopped only the collector for 600 ms, then resumed
it. The native scanner found **two LOST records, 1,132 lost samples**, and
separately **two LOST_SAMPLES counters, also 1,132**. Perf's own raw dump matches
all four records exactly. They are not added together. The capture remains
PARTIAL. An extracted binary fixture retains the exact loss records under a
rebuilt minimal header, with parent raw hash and parity evidence. That earlier
fixture has 1,126 losses; the final rerun has 1,132, with independently verified
perf-dump parity. The recorded binary matches the final optimized harness
SHA-256 exactly. Nineteen tests pass in the application crate; three existing
profiling/native-debug frontend test files also pass.

## Gates

| Gate | Result | Evidence or limit |
| --- | --- | --- |
| Installed-version parsing, weights, timestamps, identities, unknown/unresolved records | PASS | Recorded text/binary fixtures and native results |
| Second perf version | NOT TESTED | No compatibility claim |
| Native FP / DWARF 8,192 / DWARF 16,384 timed capture | PASS | Explicit modes; matched modules; target survives Stop |
| FP completeness across the no-FP library | FAIL | Demonstrated unwinder limitation, not concealed |
| DWARF constructed ancestry | PASS | Separate 590-sample qualification |
| Both weighted trees, thread/module/time queries | PASS | Same sample set; bounded branch results and core tests |
| Source mapping backend | PASS | Verified generated source files and build IDs; actual desktop source opening pending |
| Actual substituted debug/module file mismatch | NOT TESTED | Guard implemented; matched-file path exercised |
| Positive loss and no double counting | PASS | Native 1,132-loss trial matches perf's dump |
| Raw cap | PASS | Stops below 512 MiB; explicit PARTIAL; target survives |
| Stop, target exit, collector SIGKILL | PASS | Partial raw/diagnostics retained; SIGKILL can leave zero decodable samples |
| Core window-close cleanup and same-manager reopen | PASS | Old loaded data cleared; replacement owner re-parses raw data |
| Core shutdown and independent-manager reopening | PASS | Collector ends; raw remains; target survives shutdown |
| Retention, pinning, interrupted-host recovery, storage bounds | PASS | Core tests plus native pin/reopen |
| Stale incarnation refusal | PASS | Rejected before spawn |
| Live PID reuse race | NOT TESTED | Observed reuse invalidates attribution; race qualification still required |
| Gained-thread coverage | PASS | Deliberately created `coverage-gained` observed and excluded from initial scope |
| Missing perf | PASS | Empty-PATH subprocess returns clear unavailable state |
| Actual LLDB session refusal / restrictive sysctl modes | NOT TESTED | Hooks compile; no policy changed to manufacture this gate |
| Matched workload slowdown, full decoder memory | NOT TESTED | Output size and timings are not overhead acceptance |
| Actual desktop window close / IDE exit / Profile only IPC flow | NOT TESTED | Core harness does not qualify the desktop host |
| Desktop tree interaction, source opening and human usability | NOT TESTED | Waiting for UI design and implementation |

The 16/32-busy-thread [retention matrix](gr-002-many-thread-retention.md) is
separate evidence. Flight recording remains proposed; JIT maps, large-symbol
qualification and flame graphs remain deferred. M2/M3 still wait behind this
slice. M1's existing human-usability failure remains open; this backend work
does not change that gate.

---

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
