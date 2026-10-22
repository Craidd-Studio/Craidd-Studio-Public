# Native perf timed-capture qualification fixture

This GR-002 checkpoint supplies an owned C++ target with a `hot-worker` calling
`hot_parent` → `known_hot` and two identically named `pool-worker` threads calling
`known_pool`. `stop` on stdin shuts it down normally. It does not need Unity,
Craidd UI, a debugger, Gold hooks, JIT maps or downloaded dependencies.

From the repository root:

```sh
python3 workspaces/profiling-perf-qualification/qualify.py
```

The runner creates a fresh `/tmp/craidd-perf-qualification-*` directory, builds
separate frame-pointer and omitted-frame-pointer/DWARF binaries with build IDs
and debug information, and records machine/tool/permission/build evidence. Pass
`--output /absolute/new/directory`, `--seconds 3` and `--frequency 99` to declare a
different evidence location or bounded qualification settings. These settings
are experiments, not accepted Craidd defaults.

If perf exists, each capture uses `cpu-clock:u` on the fixture PID, with explicit
`--user-callchains --per-thread --no-inherit --timestamp --clockid mono` and either
`--call-graph fp` or `--call-graph dwarf,8192`. This captures the existing threads;
it does not promise coverage of future threads or descendants. After the span, only the
owned perf child receives SIGINT. The runner verifies the fixture PID and birth
are unchanged and alive, then shuts the fixture down via stdin. Raw `perf.data`,
stderr, `perf script`, `perf report` and raw records are retained for review.

Exit 2 means perf discovery is blocked. No installation, sysctl/capability/policy
change or elevation is attempted. A missing/refused tool does not qualify either
unwinder. The JSON records blocked gates explicitly. A successful capture still
requires inspecting its evidence: `known_hot` must lead self-sample attribution
on the hot thread, its parent must appear in stacks, identical worker names
must retain distinct TIDs, resolved symbols must match this build, and LOST
records/sample counts must be reported. The runner does not claim a production
parser or certify a capture merely because perf exited successfully. This perf
version finalises output then re-raises the deliberate SIGINT (Python exit `-2`);
the runner tracks that case explicitly and still requires decoded evidence.

## Installed-version analysis and retention experiment

The historical missing-tool JSON is preserved. The later
`evidence-2026-10-20-installed.json` records installed perf 7.2.11-1 timed captures,
positive loss and a six-cell overwrite experiment. These commands reproduce
analysis and one experiment (use the fresh timed directory printed above):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/analyse.py /tmp/new-perf-timed --prefix fp-
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/analyse.py /tmp/new-perf-timed --prefix dwarf-
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/experiment.py retention --binary /tmp/new-perf-timed/fixture-fp --output /tmp/new-perf-ring --frequency 99 --pages 4 --seconds 8
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/analyse.py /tmp/new-perf-ring
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/experiment.py loss --binary /tmp/new-perf-timed/fixture-dwarf --output /tmp/new-perf-loss --frequency 999 --pages 4 --seconds 3
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/analyse.py /tmp/new-perf-loss
```

Retention uses only the named hot TID's per-thread byte ring. Try 1, 4 or 16
pages at 99/999 Hz and record actual first/last timestamps and trigger ages;
do not turn byte capacity into a promised duration. `loss` pauses only the
owned perf child for 600 ms, resumes it and retains positive LOST records.
The analysis keeps LOST and LOST_SAMPLES counters separate to avoid counting
the same loss twice. The positive-loss capture is partial even when the loss
reporting test passes. `analyse.py` is version-specific qualification tooling,
not a production parser.

Flight-recorder product delivery, JIT, symbol-scale, debugger coexistence and
desktop UI are outside this fixture. The overwrite experiment approves no
flight-recorder product scope. Results live in the
[qualification report](../../docs/feats/profiling/revisions/perf-qualification-results.md).

## 22 October: runtime-loaded no-FP module and many busy threads

The [extended report](../../docs/feats/profiling/revisions/gr-002-many-thread-retention.md)
and `evidence-2026-10-22-many-thread.json` keep the later measurements separate
from the original fixtures/evidence. Build the FP main and generated no-FP
shared library, then capture explicitly:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/many_thread_qualification.py build --output /tmp/new-many-build
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/many_thread_qualification.py capture timed --build /tmp/new-many-build --output /tmp/new-many-fp --workers 2 --frequency 99 --pages 128 --seconds 3 --unwinder fp
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/many_thread_qualification.py capture timed --build /tmp/new-many-build --output /tmp/new-many-dwarf --workers 2 --frequency 99 --pages 128 --seconds 3 --unwinder dwarf
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/many_thread_qualification.py capture retention --build /tmp/new-many-build --output /tmp/new-many-ring --workers 16 --frequency 99 --pages 4 --seconds 8 --unwinder fp
```

The library has 256 generated functions plus an entry, not the deferred
200,000-symbol fixture and not a Unity/IL2CPP artifact. All selected 16/32
workers remain busy; the waiting main is excluded from the explicit TID list.
Repeat retention serially for 16/32 workers, 99/999 Hz and 1/4/16 data pages.
The output records actual per-TID histories, rates, CPU ticks, real perf mapping
sizes and collector resources. Full-ring/time evidence is labelled as inferred
wrap; unfilled histories are lower bounds. A direct read-only owned-perf ring
header probe returned EIO and is recorded as unavailable, never replaced with
invented counters. Signals still address only the owned collector.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
