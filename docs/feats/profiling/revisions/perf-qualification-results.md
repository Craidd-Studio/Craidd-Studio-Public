# GR-002 native timed-capture qualification results

**Roadmap track:** Phase 3.5 profiling.
**Status:** Native timed checkpoint PASS for the tested configuration, 20 October 2026. In-IDE delivery remains proposed.
**Source baseline:** `8bac01edf9bf1f0a0b84b55441b5638bc1233a29` plus the feature-branch qualification changes, measured before the local task commit. Exact measured source/binary hashes are in the evidence.

This reports the checkpoint authorised in the
[implementation decisions](implementation-decisions.md). The user subsequently
installed perf. This run qualifies one native fixture and one installed perf
version; it does not establish Unity, JIT, debugger coexistence or desktop
integration. Flight recording remains a separate proposed product decision.

## Evidence and reproduction

- [Installed-version evidence JSON](../../../../workspaces/profiling-perf-qualification/evidence-2026-10-20-installed.json): exact commands, source/tool/binary hashes, machine/credentials, sample and loss analysis, timestamp boundaries, retention settings and raw-file digests.
- [Historical missing-tool evidence](../../../../workspaces/profiling-perf-qualification/evidence-2026-10-20.json): original blocked run, preserved unchanged.
- [Fixture and runner instructions](../../../../workspaces/profiling-perf-qualification/README.md).
- [Proposed in-IDE timed slice](perf-timed-delivery-proposal.md): a proposal only; no product code was added by this qualification.

Current raw outputs remain in `/tmp/craidd-perf-gr002-20261020-installed-timed-v4`,
`/tmp/craidd-perf-gr002-20261020-loss-v1` and the six
`/tmp/craidd-perf-gr002-20261020-ring-{99,999}-{1,4,16}-v1` directories.
These temporary files include perf.data, complete decoded stacks, LOST records,
source-line output and stderr. They are not durable repository artifacts. The
checked-in JSON retains bounded excerpts, exact counts, commands and raw hashes;
it does not pretend to contain the raw binary captures.

From the repository root, use fresh output directories:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/qualify.py --output /tmp/new-perf-timed --seconds 3 --frequency 99
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/analyse.py /tmp/new-perf-timed --prefix fp-
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/analyse.py /tmp/new-perf-timed --prefix dwarf-
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/experiment.py loss --binary /tmp/new-perf-timed/fixture-dwarf --output /tmp/new-perf-loss --frequency 999 --pages 4 --seconds 3
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/analyse.py /tmp/new-perf-loss
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/experiment.py retention --binary /tmp/new-perf-timed/fixture-fp --output /tmp/new-perf-ring --frequency 99 --pages 4 --seconds 8
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/analyse.py /tmp/new-perf-ring
```

The scripts never change sysctls, capabilities or policy, install tools or run
perf with elevated privileges. Host execution here means leaving the task
sandbox while retaining ordinary UID 1000 and zero effective capabilities.

## Machine, permissions and the refusal diagnosis

Machine: `sk27`, AMD Ryzen 9 9950X3D 16-Core Processor, x86-64 Linux
`7.2.11-arch1-1`, 63,297,788 kB reported total memory. Installed tool:
`/usr/bin/perf`, **perf version 7.2.11-1**. Fixture compiler: GCC
`16.2.1 20260810`; ELF tools: GNU Binutils `2.47`.

The successful captures ran as UID/GID 1000, `CapEff=0`, `NoNewPrivs=0`,
`Seccomp=0` in the ordinary desktop host. Read-only values were
`kernel.perf_event_paranoid=2`, `kernel.kptr_restrict=0`,
`kernel.yama.ptrace_scope=1`; all were unchanged after every run.
No file capabilities were reported on `/usr/bin/perf`.

Initial attached FP/DWARF attempts were refused. A disposable perf-launched
child was also refused, so child launch alone was not a workaround. Verbose
output showed `perf_event_open` returning **-13 (EACCES)**. A per-thread probe
still failed with `exclude_kernel=1` but kernel callchains not excluded.
Adding **`--user-callchains`** set `exclude_callchain_kernel=1`; otherwise matching
ordinary-user probes then succeeded. The subsequent same-UID PID-attach
captures below also succeeded. The report does not infer another unmeasured
LSM/policy cause from perf's generic refusal text.

Qualified settings explicitly use `--per-thread --no-inherit --user-callchains`,
`cpu-clock:u`, timestamps and `--clockid mono`. These settings sample only
user-space stacks of the selected process's existing threads. Later-created
threads and descendants are not qualified by this no-inherit configuration.
The exact supported mode matters: merely finding perf and reading paranoid=2
would have missed the initial refusal.

## Native timed captures

The target has one `hot-worker` (`hot_parent` → `known_hot`) and two identically
named `pool-worker` threads (`known_pool`). All three worker TIDs remained
separate in samples. Both binaries are `-O2 -g -pthread -Wl,--build-id` builds;
FP uses `-fno-omit-frame-pointer -mno-omit-leaf-frame-pointer`, DWARF uses
`-fomit-frame-pointer`. Disassembly verifies the intended frame difference.

Both captures ran at 99 Hz for a 3-second requested span. FP used
`--call-graph fp`; DWARF used `--call-graph dwarf,8192`.

| Observation | Frame pointers | DWARF |
| --- | --- | --- |
| Written/decoded samples | 319 | 319 |
| Hot worker samples | 295 | 295 |
| Same-name pool workers | 12 + 12, distinct TIDs | 12 + 12, distinct TIDs |
| Observed hot-worker rate, samples/wall second | 98.932 | 98.912 |
| First-to-last sample span | 2.971734 s | 2.972340 s |
| Hot stacks containing `hot_parent` | 295 | 295 |
| LOST records / LOST_SAMPLES counters | 0 / 0 | 0 / 0 |
| Raw perf.data bytes | 69,524 | 2,730,260 |
| Unparsed explicit-field leaf lines | 0 | 0 |
| Target same incarnation alive after collector Stop | Yes | Yes |

`known_hot` leads the hot thread and `known_pool` leads each pool thread, with
100% of that thread's recorded sampled-event period in this fixture. These are
sampled CPU-clock shares, **not exact elapsed self time**. The sleeping main
thread supplied no CPU samples; this is not a missing-thread claim.

Captured fixture build IDs match their actual ELF build IDs:
FP `fc145315e72705f87e513770ecf0c281f4733ca9`; DWARF
`514262a4b67788b1665c4984a3b133b2e849ca32`.
Known fixture frames resolve to source lines in `fixture.cpp`. Each decoded
capture also retains **957 unresolved system-library frame occurrences** in
libstdc++/libc, with module and address present. These remain visibly unresolved;
fixture success does not claim complete library symbol coverage.

DWARF produced **39.27×** the raw file bytes for the same sample count in this
small test. This is an output-size measurement, not a CPU/latency overhead
measurement. Workload slowdown and collector CPU overhead were not measured.

SIGINT was sent only to the owned perf subprocess. This perf version finalises
valid data and then exits by SIGINT (`-2` in Python); the runner accepts that
only for its own deliberate Stop and still decodes the saved data. It never
signals the target. Target PID/start tick checks pass before and after Stop;
normal fixture shutdown occurs later through stdin `stop`.

## Positive loss and partial coverage

A separate 999 Hz DWARF test used a four-page per-thread ring (16,384 data
bytes per ring). The runner paused **only its owned perf collector** with
SIGSTOP for 600 ms, then sent it SIGCONT and later SIGINT. The target continued
running throughout.

The saved capture contains 2,564 delivered samples and three `PERF_RECORD_LOST`
records: **599 + 29 + 24 = 652 lost samples**. Three `PERF_RECORD_LOST_SAMPLES`
counters also report 652. These are separate, potentially overlapping sources;
**they are not summed to 1,304**. Raw examples and counts are in the JSON.

Loss-reporting gate: **PASS**. This capture's coverage: **PARTIAL**, because
samples were lost. The target remained the same live process after collector
Stop. This positive test supplements the zero-loss timed captures; an empty
capture or absent records would not have proven zero loss.

## Observed overwrite retention

This is an experiment, not a delivered flight recorder. Each independent trial
ran the already-busy single hot TID for an 8-second collection span, using
`cpu-clock:u`, FP, `--per-thread --no-inherit --user-callchains`,
`--overwrite --switch-output=signal` and a named page count. SIGUSR2 to perf
saved the snapshot; later SIGINT to perf stopped it. No target signal was sent.

The page size is 4,096 bytes. Capacities below are **data bytes of one selected
TID's ring**, excluding its metadata page and all other process memory.
Observed rate is `(retained samples - 1) / first-to-last timestamp span`.
Oldest/newest ages use the declared monotonic clock and the recorded instant
when the runner sent SIGUSR2; the snapshot signal has finite handling latency.

| Requested Hz | Pages / data bytes | Retained samples | Observed samples/s | First-to-last span, s | Oldest age at trigger, s | Newest age at trigger, ms |
| --- | --- | --- | --- | --- | --- | --- |
| 99 | 1 / 4,096 | 42 | 98.951 | 0.414347 | 0.415036 | 0.690 |
| 99 | 4 / 16,384 | 170 | 98.957 | 1.707809 | 1.714062 | 6.252 |
| 99 | 16 / 65,536 | 682 | 98.978 | 6.880323 | 6.883972 | 3.649 |
| 999 | 1 / 4,096 | 42 | 998.816 | 0.041049 | 0.041742 | 0.693 |
| 999 | 4 / 16,384 | 170 | 999.000 | 0.169169 | 0.169927 | 0.758 |
| 999 | 16 / 65,536 | 682 | 997.507 | 0.682702 | 0.683395 | 0.693 |

All six rings wrapped during the trial: the oldest retained sample was later
than collector startup (by at least 1.116 seconds), despite an already-running
hot worker. These are therefore measured retained spans after wrap, not claims
based on unfilled buffers. Every snapshot decoded with zero unparsed leaf
lines and no reported LOST records/counters; every target survived Stop and
every sysctl stayed unchanged.

Overwrite intentionally discards older history without ordinary LOST records.
Zero LOST here **does not mean complete history**. The actual overwritten count
was not measured. These are single trials for one TID, rate, callchain and
workload; additional threads, stack depth, DWARF record size, scheduling and
buffer configuration can change retention. No universal “last N seconds”
guarantee follows. Sampling can also miss a short spike entirely. Flight
recording remains for the user's separate decision.

## Gates and remaining limits

| Gate | Result | Boundary |
| --- | --- | --- |
| Native fixture build and installed-tool discovery | PASS | Exact one-machine/version evidence above |
| Frame-pointer timed capture | PASS | User-only PID capture, existing threads, qualified settings |
| DWARF timed capture | PASS | Separately built omitted-frame-pointer target, 8,192-byte stack setting |
| Known hot function / thread attribution | PASS | Known leaf functions, parent stacks and distinct same-name TIDs |
| Fixture build-ID / source resolution | PASS | Matching IDs and real fixture source lines |
| Complete system-library symbol coverage | PARTIAL | 957 unresolved frame occurrences retained per timed capture |
| Loss reporting and safe collector Stop | PASS | Positive 652-loss test plus zero-loss timed tests; targets survive |
| Positive-loss capture completeness | PARTIAL | 652 lost samples, never presented as complete |
| Single-TID overwrite retention measurement | PASS | Six bounded trials above; no product duration guarantee |
| Workload overhead / collector CPU cost | NOT TESTED | File-size comparison is not overhead proof |
| Later threads / descendants with no-inherit | NOT TESTED | Do not imply coverage of them |
| Collector crash / target exit / PID reuse handling | NOT TESTED | Product lifecycle acceptance still required |
| Second perf-version parser compatibility | NOT TESTED | Initial checkpoint explicitly covers one installed version |
| Desktop / in-IDE capture integration | NOT TESTED | No product UI/backend integration implemented here |
| JIT maps / symbol scale / flame graphs / debugger coexistence | NOT TESTED | Separate later qualification |
| Flight-recorder product delivery | NOT TESTED | Proposed decision remains open |

## Historical blocked run

The earlier run had no accessible perf executable in the task environment or
its bounded alternative locations. Its FP/DWARF fixture builds and smoke tests
passed, but captures, sampled attribution, loss and collector Stop were blocked.
The original evidence JSON remains unchanged. Later user installation and the
specific user-only configuration qualified above supersede that tool-discovery
blocker; they do not retroactively turn the old run into a passing capture.
The installed-version JSON also preserves refused attached runs and the verbose
EACCES diagnostics, so the supported configuration is traceable.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
