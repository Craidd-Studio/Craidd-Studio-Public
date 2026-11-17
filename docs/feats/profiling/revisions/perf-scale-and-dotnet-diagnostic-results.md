# GR-002: large-symbol scale and one .NET diagnostic

**Roadmap track:** Phase 3.5 profiling.
**Status:** Qualification record, 23 October 2026. Backend/runtime scope only. UI implementation remains on hold; local commits only.
**Baseline:** `codex/profiling-perf-timed` at `96caae67d6c04a034eca0e4fd953b995c150ba08`.

The user accepted the previous overhead, Mono naming, debugger refusal and
module/debug substitution gates within their stated scope, and accepted live
PID reuse as BLOCKED. The stale-incarnation guard remains. The user explicitly
authorized symbol-scale work despite the .NET-specific naming failure and
environmental reuse block. Neither now holds this qualification.

## One .NET enabled-map diagnostic

The ordinary .NET naming gate **remains FAIL** and is a known limitation:
this installed path can retain anonymous `/memfd:doublemapper (deleted)` frames
even when a valid map contains the sampled addresses. A successful capture
with unresolved names is not successful method-name resolution.

Exactly **one** additional enabled-map capture ran with
`DOTNET_EnableWriteXorExecute=0`, only in the disposable fixture's environment.
No product setting, automatic retry, alternate resolver or workaround was built.
The parent environment remained unset. The normal-configuration failure was
not rerun or relabelled PASS. The original [22 October evidence](../../../../workspaces/profiling-perf-managed/evidence-2026-10-22.json)
is unchanged.

| Configuration | Samples | Named fixture-method weight / all leaf weight | Perf / Craidd method share | Result |
| --- | --- | --- | --- | --- |
| Previous enabled map, normal configuration | 394 | 0 / 3,979,797,940 | 0% / 0% | FAIL, retained |
| Single enabled-map W^X-off diagnostic | 392 | 3,959,595,920 / 3,959,595,920 | 100% / 100% | Diagnostic PASS only |

The diagnostic has no doublemapper mappings in `/proc/<pid>/maps`; perf names
come from `/tmp/perf-34155.map`. Its coverage has zero LOST/LOST_SAMPLES, no
parser omissions, a surviving target and normal stdin exit zero. This supports
W^X double-mapping as the explanation on this configuration, rather than a
missing runtime map. It is one intervention against a prior run, not a general
causal or version-compatibility claim. The upstream runtime has a
[matching reported interaction](https://github.com/dotnet/runtime/issues/97765).
The flag also exists in the [runtime configuration definitions](https://github.com/dotnet/runtime/blob/main/src/coreclr/inc/clrconfigvalues.h);
that reference is context, not approval to change a user's runtime settings.

[Diagnostic JSON](../../../../workspaces/profiling-perf-managed/evidence-2026-10-23-wx-diagnostic.json)
records environment overrides, runtime versions, map/raw/source/binary hashes,
period weights, trees and the absence of doublemapper mappings. No user process
or runtime configuration file was changed.

## Machine, build and workload

Machine `sk27`: AMD Ryzen 9 9950X3D, 16 cores / 32 logical CPUs, Linux
`7.2.11-arch1-1`, perf **7.2.11-1**, UID 1000 and zero effective capabilities.
Observed settings remain paranoid 2, kptr restriction 0, ptrace scope 1; no
sysctl/capability or privileged perf changes. SDK/runtime are .NET
**10.0.113 / 10.0.13**; GCC is **16.2.1 20260810**, Rust **1.99.1**.

Earlier temporary build outputs were absent at the start of this session.
Rebuilding the optimized production-core harness reproduced the previous
executable SHA-256 exactly:
`d4e6f57368af0ab40813d45daa5b15bf90ee7da612c41fd146a8faf45ebb2172`.
The separate actual Tauri test used `npm run test:ui:build`, an embedded **debug**
build with its own binary hash recorded. Production Rust/React files were not
changed by this qualification.

The [generator/runner](../../../../workspaces/profiling-perf-qualification/large_symbol_scale.py)
built **200,000 generated exported functions at 200,000 distinct addresses**:
199,999 `scale_fn_*` functions plus the entry. Toolchain startup stubs are not
counted. Forty source shards plus an entry unit bound compiler memory, with
only two compiler jobs. Build wall time was 55.75 seconds. The main executable
keeps frame pointers; generated shards omit them, the entry keeps them, and
sibling-call optimization is disabled. All functions remain defined/exported.

Twenty hot leaves and three callers per leaf are spread across the generated
address/name range. Other functions have distinct small arithmetic bodies.
The fixture dynamically loads the library, runs two identically named busy
workers, and exits through stdin. This tests the cost of a large symbol/debug
inventory with a modest sampled working set; it is not 200,000 sampled tree
nodes, a multi-gigabyte debug file or Unity/IL2CPP acceptance.

| Artifact | Bytes |
| --- | ---: |
| Runtime module, debug sections stripped | 26,411,144 |
| Separate `.debug` file | 36,363,272 |
| FP main fixture | 179,688 |

The module's `.gnu_debuglink` points to its separate file; embedded
`.debug_info` is absent. Both files have build ID
`eac32b7d8ae7129320c8b9db29c79ced58ec62d6`. All 20 sampled hot leaves resolve to
the expected names and original generated source lines through this setup.

## Symbolization, parsing and reopening

Two optimized captures and two fresh-process reopens completed. Each capture
uses `cpu-clock:u`, 99 Hz, three seconds, explicit DWARF 8,192 and the existing
three TIDs (two busy workers and waiting main). No fallback or flight recorder.
OS caches were warm; they were not flushed. Compilation and the UI trial were
outside the optimized measurement windows.

| Run | Samples | Raw bytes | Module/debug identity checks, ms | Symbolization + DWARF decode + parser wall, ms | Rust parser CPU, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Optimized capture A | 592 | 5,030,556 | 478 | 250 | 4 |
| Fresh-process reopen A | 592 | same raw | 503 | 225 | 5 |
| Optimized capture B | 592 | 5,030,492 | 453 | 250 | 5 |
| Fresh-process reopen B | 592 | same raw | 452 | 275 | 4 |
| Tauri debug / Xvfb capture | 592 | 5,030,556 | 493 | 251 | 42 |

The loss scanner reports less than one millisecond in these cases. Every result
is COMPLETE, has zero LOST and zero LOST_SAMPLES, no unknown records or omitted
samples, and a completed raw loss scan. Both weighted trees retain the same
samples; reopens verify the original raw hash.

**Timing basis:** identity checks are not total symbol resolution. Perf performs
symbol loading/lookups, DWARF unwinding and text output while Rust streams the
parser. Their 225–275 ms wall stage is measured together. Parser-thread CPU is
recorded independently and is not subtracted to invent pure symbol CPU time.
Isolated symbol-only CPU time is NOT TESTED. These are bounded observations,
not latency percentiles or a promise for arbitrary native debug files.

## Decoder memory

A requested 10 ms `/proc` sampler follows the optimized backend and its analysis
children, excluding the target, compiler and whole IDE. It records per-process
RSS, PSS and available VmHWM. Across the first capture/reopen, observed aggregate
peak was **82.44 MiB RSS / 68.53 MiB PSS**, versus a **3.26 MiB RSS / 1.49 MiB
PSS** idle backend baseline. The second pair observed **81.13 MiB RSS / 68.57 MiB
PSS**. RSS can count shared pages more than once; PSS apportions them.

In the first pair, perf-script's observed individual peaks were **73.98 MiB
RSS / 63.66 MiB PSS**, with observed kernel VmHWM **75.52 MiB**. The optimized
Rust backend's observed peak RSS was **4.69 MiB**, VmHWM **5.33 MiB**. These
individual high-water values are not added as a simultaneous tree peak.

Sampling can miss short-lived processes or peaks. The first run's actual
sample gaps were 8.38–23.82 ms, including a short manager-replacement interval.
A second native run therefore adds a standard-library `wait4` cross-check:
**77,272 KiB (75.46 MiB)** maximum RSS for the largest waited-for process. That
scope includes the monitor/fixture and propagated waited-for descendants; it
excludes the earlier compiler. It is **not a summed process-tree maximum**,
as the [Linux accounting contract](https://man7.org/linux/man-pages/man2/getrusage.2.html)
explains. Both measurements are retained with their limits. GNU time was
unavailable; that failed command launched no workload, and no tool was installed.

Memory characterization passes for this fixture. No scale-specific memory
budget was agreed, so no budget PASS is claimed. This does not qualify memory
at maximum sample/frame retention or fix M1's separate whole-IDE baseline.

## UI-thread independence through existing IPC

A disposable real Tauri window on Xvfb opens the fixture solution, supplies its
target to the existing `start_profiling` command, then starts the existing
`perf_action`. No capture controls or profiler redesign are added. The
[driver](../../../../workspaces/profiling-perf-qualification/large_symbol_ui.mjs)
records webview timer/animation callbacks and IPC status replies while the
capture is actually in `parsing`:

| During parsing | Observations | p50, ms | p95, ms | Max, ms |
| --- | ---: | ---: | ---: | ---: |
| Existing status IPC round trip | 24 | 1 | 2 | 2 |
| Requested 16 ms timer gap | 42 | 20 | 20 | 20 |
| Animation callback gap | 52 | 16 | 17 | 17 |

The source agrees with this runtime evidence: `perf_action` dispatches blocking
operations via `spawn_blocking`; capture/decode has a separate native worker,
with streaming parsing on another thread. The optimized no-UI manager also
served 72 status requests during parsing A with a 0.20 ms observed maximum.

This passes **thread independence in this existing IPC path**, using a declared
100 ms stall guard in the fixture driver. It is not public-release UI latency
acceptance, a chart/tree interaction test, hardware-input latency, an ordinary
physical display result or a release-build frontend benchmark. Both callback
and IPC observations are preserved, rather than equating an asynchronous API
signature with a responsive window. Targets survived collection and exited
normally; the disposable IDE closed afterward.

## Separate gates and retained evidence

| Gate | Result | Scope |
| --- | --- | --- |
| Normal .NET map naming | FAIL | Known limitation retained |
| Single W^X-off diagnostic | PASS | 100% named leaf weight; no doublemapper mappings; no product workaround |
| Generated 200k functions / distinct addresses | PASS | Exported native inventory verified with `nm` |
| Module/separate debug identity | PASS | Matching build ID; sampled leaf source lines present |
| Sampled names, both trees and raw reopen | PASS | All 20 hot leaves named; two captures and two fresh-process reopens |
| Decode timing / parser CPU measurement | PASS | Actual stage boundaries above; pure symbol-only CPU NOT TESTED |
| Decoder memory characterization | PASS | Sampled RSS/PSS/VmHWM plus separate kernel high-water cross-check |
| Memory budget | NOT TESTED | No scale-specific budget agreed |
| UI-thread independence | PASS | Existing IPC plus timer/animation evidence, debug Tauri/Xvfb only |
| Loss and target survival | PASS | Complete scans, no loss/omissions, targets survive; stdin exit zero |
| Live PID reuse | BLOCKED | Accepted environmental limitation; stale-incarnation guard retained |
| New profiler UI / accessibility / human acceptance | NOT TESTED | UI remains on hold |
| Cold caches / another perf version / production Unity workload | NOT TESTED | No generalization from this fixture |

[Scale evidence JSON](../../../../workspaces/profiling-perf-qualification/evidence-2026-10-23-scale.json)
contains source/binary/build/raw hashes, exact build commands, function
inventory checks, all native memory/status observations, both reopens, the
kernel cross-check and the Tauri callback/IPC observations. Raw/debug/build
files remain temporary artifacts at the recorded paths and may be removed;
source, bounded evidence and reproduction recipes are committed locally.
The application perf suite passed **20/20** again. No production code changes,
push or merge are part of this checkpoint.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
