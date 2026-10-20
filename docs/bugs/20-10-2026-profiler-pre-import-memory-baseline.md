# Open issue: two-window IDE memory before metric import

**Roadmap track:** IDE baseline/performance, separate from Phase 3.5 GR-001 M1.
**Status:** OPEN investigation. No baseline-memory fix authorized in M1.

The user accepted incremental import RSS <3× file size as the M1 gate. The
previous approximately 1.27 GB whole-IDE baseline is a separate issue. This
record accounts for the measured processes; it does not attribute a leak or
propose a fix without a reproducible diagnosis.

## Measured composition

Machine: Ryzen 9 9950X3D, Linux 7.2.11-arch1-1, ~64 GB RAM. Embedded optimized
Craidd release, initial shell plus one disposable solution window, same accepted
million-row workload but **before** importing it. Native GTK/WebKitGTK 2.54.1;
ordinary GNOME/Wayland and private Xvfb/X11 measured separately. The benchmark
enabled Basic JSC GC logging and optional metric lifecycle logging. All values
below are decimal MB; RSS sums shared pages more than once. PSS apportions shared
pages and is a separate diagnostic, not a replacement M1 gate.

| Display / pre-import process group | RSS MB | PSS MB |
| --- | ---: | ---: |
| ordinary-desktop / Native IDE host | 274.57 | 79.82 |
| ordinary-desktop / Native process-cleanup supervisor | 38.33 | 10.00 |
| ordinary-desktop / WebKit network process | 70.35 | 30.14 |
| ordinary-desktop / WebKit web processes (2) | 851.65 | 401.23 |
| **ordinary-desktop / total** | **1234.90** | **521.19** |
| xvfb / Native IDE host | 307.65 | 112.86 |
| xvfb / Native process-cleanup supervisor | 38.81 | 10.01 |
| xvfb / WebKit network process | 70.04 | 30.16 |
| xvfb / WebKit web processes (2) | 876.68 | 414.94 |
| **xvfb / total** | **1293.17** | **567.97** |

Each run has five sampled processes: native host, native cleanup supervisor,
one WebKit network process and two WebKit web processes. There was no separate
GPU-process PID in these samples; GPU/driver allocations are not fully accounted
for by this table. The two web processes serve the two-window configuration,
but shared resources are not assigned exclusively to an individual window.

The initial single-window samples were 771.61 MB RSS (ordinary) and 799.54 MB (Xvfb).
They were taken immediately after initial frontend readiness, not after an idle
settling protocol, so their difference from the two-window samples is not a
controlled per-window cost estimate.

## Investigation boundary

Keep baseline and incremental import memory visible on every future run. A
separate investigation should first reproduce steady one-/two-window baselines,
attribute private/shared memory and capture process lifetimes/retention over
repeated open/close cycles. Only then propose changes. Do not call summed RSS
unique physical memory, infer a leak from these samples, or optimize the IDE
shell as part of M1.

Raw per-PID RSS/PSS, executables, ancestry and timestamps are in
[ordinary release evidence](../../workspaces/profiling-metrics/release-ordinary-2026-10-20.json)
and [Xvfb release evidence](../../workspaces/profiling-metrics/release-xvfb-2026-10-20.json).
The [owner-close recovery](../../workspaces/profiling-metrics/owner-close-recovery-2026-10-20.json)
shows native parser RSS returning after cancellation; it is not baseline issue
closure. See the [M1 report](../feats/profiling/revisions/gr-001-m1-results.md).

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
