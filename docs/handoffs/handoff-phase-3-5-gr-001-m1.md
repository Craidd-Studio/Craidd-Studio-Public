# Handoff: GR-001 M1 release review and GR-002 qualification

**Roadmap track:** Phase 3.5 profiling.
**Status:** M1 automated gates pass; human acceptance pending, 20 October 2026.

Craidd is a Linux polyglot IDE that discovers external tools and preserves honest
ownership, coverage and evidence. This work adds inspection of program-produced
metric CSVs without treating those values as independent Craidd measurements.

## Current checkpoint

Branch: `codex/profiling-metric-csv-m1`, based on `feat/unity/debug-a-to-p` at
`8bac01edf9bf1f0a0b84b55441b5638bc1233a29`. Read the current commit with
`git log -1 --oneline`; this handoff does not embed its own future commit hash.
No push/merge is authorized until the user completes human acceptance.

Finished CSV import, integrity/row inspection, exact worst values, declared
companion joins and immutable portable snapshots are implemented. CSV analysis
is editor-tab only; standard Process/Gold supports sidebar and editor modes.
Source/code navigation retains bounded inspection descriptors within a window.

M1 release acceptance passes on ordinary desktop and Xvfb: 20 observations of
six operations per display, all p95 30–33 ms, no >=100 ms observation. Incremental
RSS is 1.93× and 1.87× file size respectively; baselines are separate. Native
owner close during load cancels the reader, releases storage/RSS/FDs, removes
its source and leaves the IDE able to render another import. The old debug
199 ms observation is retained as history, not the accepted release gate.

Native suite: 184 passed / 6 existing ignored. Parser/storage/fixture: 14 passed;
profiling/workspace/resize regression suites: 28 / 5 / 3 passed. Exact build
hashes, settings, methods and raw observations are in the linked records.

The native timed perf checkpoint and bounded overwrite-ring experiments now
have installed-version evidence. Read its gates individually; no perf UI or
flight-recorder product is implemented. Kernel callchains remain outside the
qualified user-only settings. JIT, scale, LLDB coexistence and broader recovery
remain separate gates.

## Locked decisions and open items

- [Implementation decisions](../feats/profiling/revisions/implementation-decisions.md)
  and [source contract](../feats/profiling/design-profile-source-contract.md)
  govern distinct CSV/process/stack payloads, clocks, units, coverage and retention.
- [M1 results](../feats/profiling/revisions/gr-001-m1-results.md) retain old runs and
  the newly accepted incremental-memory and release-p95 thresholds.
- [Twelve-step human checklist](../feats/profiling/revisions/gr-001-m1-human-acceptance.md)
  is NOT TESTED. Native OS chooser, visual judgement and actual project CSVs need
  that review; automated checks do not provide public-release sign-off.
- [IDE baseline-memory issue](../bugs/20-10-2026-profiler-pre-import-memory-baseline.md)
  accounts for both windows and native/WebKit processes. It is OPEN and outside M1.
- [Perf qualification](../feats/profiling/revisions/perf-qualification-results.md)
  records the exact installed version, FP/DWARF, symbols, samples, LOST and Stop.
  The [first in-IDE timed proposal](../feats/profiling/revisions/perf-timed-delivery-proposal.md)
  is ready for review. The flight-recorder product decision waits for the user to review actual
  retained durations; ring bytes never guarantee a fixed last-N-seconds history.
- Priority after M1 review: proposed in-IDE GR-002 timed capture, then M2 live
  follow, then M3 mapping/comparison. M2/M3 remain approved in order but wait.
  Do not build in-IDE perf from qualification alone; the requested deliverable
  for that first slice is a proposal.

## Local reproduction

The [metric fixture guide](../../workspaces/profiling-metrics/README.md) has
build, 20-per-operation distribution and owner-close commands. The embedded
review release binary is `/tmp/craidd-gr001-target/release/craidd-studio`;
it is temporary, not a packaged-release artifact. Generate the million-row CSV
at a fresh path. Run display workloads serially and record the baseline each run.
The [perf guide](../../workspaces/profiling-perf-qualification/README.md) has
fresh-output qualification and ring experiments. Never change sysctls or acquire
capabilities/elevated perf rights to make a gate pass.

## Opening prompt for the next chat

Read AGENT.md and required documents, then this handoff and its M1/perf records.
Preserve the feature branch and evidence. Help run the 12-step human acceptance
in the Profiling editor tab, record results against the exact commit/build, and
address demonstrated defects only. Do not push/merge before human acceptance.
Review the first in-IDE timed perf proposal before implementing it. Keep the
baseline-memory issue outside M1 and M2/M3 waiting behind timed perf.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
