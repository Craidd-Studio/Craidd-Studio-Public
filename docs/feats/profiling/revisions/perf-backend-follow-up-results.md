# GR-002 backend follow-up: overhead, maps and identity gates

**Roadmap track:** Phase 3.5 profiling.
**Status:** Backend measurement record, 22 October 2026. Some gates remain failed or blocked. No UI delivery or public-release acceptance claim; no push or merge.
**Source:** `codex/profiling-perf-timed`, follow-up to accepted checkpoint `82cbf47a258e71fa95cc3541e57b0142fccf1ecc`, stacked on M1 `5039abf`.

The [accepted decisions](perf-backend-follow-up-decisions.md) exclude flight
recording from this release. Its [many-thread matrix](gr-002-many-thread-retention.md)
remains evidence. The [metric-inspection editor candidate](../design-metric-inspection-editor.md)
is documented separately; UI work remains on hold. Large-symbol qualification
had **not** started at this 22 October checkpoint. On 23 October the user
accepted the environmental block and .NET-specific failure as separate from
scale qualification; the [later scale/diagnostic record](perf-scale-and-dotnet-diagnostic-results.md) supersedes that hold. Normal .NET naming still FAILS.

## Machine, builds and evidence

Machine `sk27`: AMD Ryzen 9 9950X3D, 16 cores / 32 logical CPUs, Linux
`7.2.11-arch1-1`, perf **7.2.11-1**, UID 1000, zero effective capabilities.
`perf_event_paranoid=2`, `kptr_restrict=0`, `ptrace_scope=1` were unchanged.
Tools: Rust **1.99.1**, GCC **16.2.1 20260810**, lldb-dap **23.1.3**,
.NET SDK **10.0.113** / runtime **10.0.13**, Mono **6.12.0**.

The optimized no-UI harness imports the production Rust manager/parser. Its
final executable SHA-256 is
`d4e6f57368af0ab40813d45daa5b15bf90ee7da612c41fd146a8faf45ebb2172`.
The evidence records exact source hashes before this local commit, build
commands, fixture/module hashes, configurations, raw hashes and full outcomes:

- [Matched overhead JSON](../../../../workspaces/profiling-perf-qualification/evidence-2026-10-22-overhead.json): separate instrumented native fixture and direct installed perf. Build/analysis hashes distinguish the measured runner from its later offline scanner correction.
- [Managed map JSON](../../../../workspaces/profiling-perf-managed/evidence-2026-10-22.json): production harness, four managed captures, perf and product trees, method-weight denominators and runtime-map fingerprints.
- [Debugger/mismatch JSON](../../../../workspaces/profiling-perf-backend/evidence-follow-up-2026-10-22.json): production harness, real DAP transcripts under the recorded temporary output directory, matched and substituted-file captures.

Raw files and detailed transcripts remain at the temporary paths in the JSON;
they are not bundled into Git. The overhead run alone retains about 2.43 GB of
raw data. Repository evidence is bounded JSON, source and small existing
fixtures. The ordinary desktop continued running. Functional map/debug probes
and builds occurred **after** the exclusive overhead measurement slot.

## Matched completed-work overhead

The [full overhead report](perf-matched-overhead-results.md) documents 70
one-second work windows, five alternating repetitions per mode with 16 and 32
busy workers, adjacent baseline interpolation, actual interval widths and
machine observations. All workers execute the same runtime-loaded generated
no-FP library. Identical per-worker atomic completion counters run in every
mode. No outlier was removed.

Slowdown is `100 × (interpolated baseline throughput / captured throughput − 1)`.
Values below are percentages, not exact timing corrections.

| Workers | Mode | Median slowdown % | P25–P75 % | Min–max % |
| --- | --- | --- | --- | --- |
| 16 | FP 99 Hz | 0.008 | −0.015–0.024 | −0.080–0.088 |
| 16 | DWARF 8,192 / 99 Hz | 0.019 | 0.003–0.076 | −0.015–0.153 |
| 16 | DWARF 8,192 / 999 Hz | 0.111 | 0.017–0.262 | 0.016–0.273 |
| 32 | FP 99 Hz | −0.063 | −0.080–0.096 | −0.722–0.282 |
| 32 | DWARF 8,192 / 99 Hz | 0.155 | 0.016–0.673 | −0.050–0.784 |
| 32 | DWARF 8,192 / 999 Hz | 0.473 | 0.170–0.694 | 0.077–0.985 |

Every selected worker was sampled in every profiled window. All 30 captures
had zero LOST and zero LOST_SAMPLES, remained active across the work window and
stayed below the raw cap; maximum file size was 294,036,484 bytes. Stop addressed
only perf, and both persistent targets later exited normally through stdin.
The sample event was `cpu-clock:u` with explicit worker TIDs.

This passes the **measurement protocol** on this fixture. Negative values and
overlapping ranges are noise-compatible observations, not speedup or
significance claims. The one-second intervals do not qualify a long production
capture, other stack depths, .NET, Unity or IL2CPP. Collector startup,
finalisation and offline decoding were outside these throughput intervals.
Do not subtract these percentages from production timings or call captured
timings unperturbed. FP's lower cost does not restore its missing callers.

## Existing perf-map path

The [managed fixture](../../../../workspaces/profiling-perf-managed/README.md)
has two named busy threads and known no-inline managed methods. Each case warms
up for two seconds, then takes a two-second 99 Hz FP capture. The controls have
maps disabled; enabled cases use the requested .NET `DOTNET_PerfMapEnabled=1`
and Mono `--jitmap`. These are documented runtime options, not Craidd runtime
configuration features. See [Microsoft's runtime option](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/debugging-profiling)
and [Mono's option documentation](https://github.com/mono/mono/blob/main/man/mono.1).

Shares are fixture-method **leaf sampled period weight / all decoded leaf
period weight**, including unresolved samples in the denominator. They do not
measure the fraction of stack frames resolved or prove caller completeness.

| Runtime / map | Samples | Named method weight / total weight | Perf share | Craidd share | Naming gate |
| --- | --- | --- | --- | --- | --- |
| .NET, disabled | 391 | 0 / 3,949,494,910 | 0% | 0% | Control observation |
| .NET, enabled | 394 | 0 / 3,979,797,940 | 0% | 0% | FAIL |
| Mono, disabled | 392 | 0 / 3,959,595,920 | 0% | 0% | Control observation |
| Mono, enabled | 393 | 3,969,696,930 / 3,969,696,930 | 100% | 100% | PASS |

All four decode/capture executions completed, with zero LOST/LOST_SAMPLES,
zero omitted tree children and surviving targets; all fixtures exited zero
through stdin. The .NET map was stable at 9,264 bytes and contains the sampled
hot instruction's range. Nevertheless perf reports `/memfd:doublemapper
(deleted)` without a managed name on this configuration. Craidd preserves those
unresolved frames. This observation does not establish a general cause or
failure across all .NET/perf versions. No `perf inject`, W^X switch, custom map
resolver or alternate JIT mechanism was added. Overall JIT-name qualification
is **PARTIAL**, with the .NET gate explicitly failed.

The initial Mono probe showed perf resolving names while Craidd withheld them.
Two measured defects were corrected: method-argument parentheses were parsed
as part of the module, and the ELF-only identity guard erased map names. The
parser now finds the final balanced module group. Frames expose `symbolOrigin`
(`perfMap`, `elfBuildId`, or `unresolved` after validation). Map names come from
perf, carry no claimed ELF/source-line verification, and never acquire a source
link. The map is read-only, current-user, regular, non-symlink, bounded to 16 MiB,
and fingerprinted before/after decoding. Reopening requires the recorded hash;
changed/unavailable recorded maps withhold those names and report the limitation.
A present map unused by perf is labelled `observedNotUsedByPerf`.

## Debugger and file identity

**LLDB first:** a real lldb-dap launches the fixture under existing Yama policy;
`TracerPid=226783` is observed on target PID 226802. The production manager
refuses sampling that traced process. LLDB detaches without terminating the
target; the target remains alive. No ptrace relaxation was used.

**Perf first:** the production manager starts a capture and a real lldb-dap is
initialized. Craidd's exact shared debugger guard refuses attachment before
sending a DAP attach request. `TracerPid` stays zero, Stop leaves the target
alive, and partial samples remain. This tests the backend guard with a real
adapter, not the Tauri command/desktop path; the latter is NOT TESTED.

**Substitution:** a private copy of the generated library is stripped into a
separate `.debug` file and `.gnu_debuglink`. With matched files, a one-second
DWARF capture retains 196 samples with resolved module names. Replacing only
the debug file with one from a different executable originally went unreported:
the result incorrectly remained COMPLETE. The corrected backend checks a
bounded set of conventional local `.gnu_debuglink`/build-ID candidates, records
their IDs, and conservatively withholds module names/source mappings if a
candidate mismatches or cannot be verified. It does not claim that a candidate
is the file perf actually chose, search arbitrary folders or enable debuginfod.

The final substitution detects expected library ID
`fbc016c3494713865f89daddee8dde632f5ddc98` against debug ID
`35f3a4430163e161774cf8b80fa64f3708834260`; the capture becomes PARTIAL and the
module's tree frames are unresolved. Replacing the module itself with a
different ELF also becomes PARTIAL with names withheld. Current debug identity
is rechecked before source navigation. The matching-module function names can
be valid despite a bad debug file, but withholding them is the deliberate
conservative policy for this slice.

**Live PID reuse:** BLOCKED. There is no ordinary-user API to select a reused
host PID. Forcing wrap with large numbers of forks, writing next-PID state or
adding namespace capabilities/policy is outside the agreed constraints. The
existing stale-incarnation test passes, but is not a live reuse race. No live
reuse PASS is claimed.

## Separate gates

| Gate | Result | Scope / remaining limit |
| --- | --- | --- |
| Matched native overhead protocol | PASS | Five alternating repetitions per mode/count, median/spread above; no universal overhead bound |
| Installed-version parser / provenance | PASS | 20 application-crate perf tests; real Mono names and nested module parentheses retained |
| Mono perf-map method names | PASS | 0% control → 100% enabled leaf weight through perf and Craidd |
| .NET perf-map method names | FAIL | 0% despite stable map containing sampled IP; frames remain visible |
| Combined JIT naming | PARTIAL | No alternate mechanism built; full JIT delivery not claimed |
| Actual LLDB-first refusal | PASS | Real traced fixture, manager refusal, target survives detach |
| Perf-first backend debugger refusal | PASS | Real adapter initialized; shared guard prevents attach; no target tracer/signal |
| Substituted module and separate debug file | PASS | Actual private substitutions, IDs recorded, names/source withheld, PARTIAL |
| Native recovery / target survival in these probes | PASS | Stop, detach and normal stdin fixture shutdown; earlier broader lifecycle evidence retained separately |
| Live PID-reuse race | BLOCKED | Cannot induce safely within current ordinary-user constraints |
| Restrictive sysctl combinations | NOT TESTED | No policy changed; ordinary host settings only |
| Parsing / symbol-resolution timings | PARTIAL | Managed module checks 75–126 ms, decode+parse 25 ms, parser CPU 1–3 ms; perf decoding/unwinding overlap, not isolated symbol-only time |
| Whole decoder memory / 200k-symbol scale | NOT TESTED | Large scale deferred until prerequisite gates pass |
| Tauri attach/IPC, desktop source opening, window close/IDE exit | NOT TESTED | Native harness does not pass desktop gates |
| Metric/profiler UI, accessibility, human acceptance | NOT TESTED | Candidate documented; implementation remains on hold |
| Flight recording delivery | NOT TESTED | Explicitly excluded from this release; matrix retained only as evidence |

`cargo check --offline` passed for the application crate. Its filtered perf
suite passed **20/20**; three existing profiling/native-debug Node test files
passed. These checks do not turn failed naming or blocked reuse into passing
gates. Build/reproduction commands are in the linked fixture READMEs.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
