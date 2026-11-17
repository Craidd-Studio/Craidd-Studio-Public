# GR-001 / GR-002 implementation decisions

**Roadmap track:** Phase 3.5 profiling.
**Status:** Accepted decisions from the user, 20 October 2026. Delivery and evidence remain separate.
**Baseline:** `feat/unity/debug-a-to-p` at `8bac01e`.

The original [GR-001](gr-001-metric-csv-import.md) and
[GR-002](gr-002-external-pid-sampling-perf.md) proposals retain their original
scope. This addendum resolves their questions only as explicitly stated here.
The [source contract](../design-profile-source-contract.md) governs new sources.

## Accepted GR-001 defaults

- Snapshots hold bounded immutable data copies with provenance, reopening without
  producer files. No fallback to path-only references.
- File sets are selected per import. Project defaults are later scope.
- Time/unit interpretation is editable; saved snapshots never change.
- Schema sidecars are a follow-up; reserve a descriptor in the model now.
- Row spacing never determines window duration on its own.
- Column meaning is gauge / counter / rate / window statistic / unknown,
  explicit where known and unknown otherwise.
- Companion joins require a declared exact or toleranced key on named columns.
  Missing matches are unjoined; ambiguous matches must not select a neighbour.

## Accepted milestones and review gates

1. **M1:** Finished-file import, row inspection, integrity reporting, worst
   windows and snapshot reopening. Include editable interpretation, explicit
   file sets and joins needed to inspect companions. No live follow.
2. **M2:** Live follow and generation changes, only after M1 review/evidence.
3. **M3:** Session clock mapping and comparison, only after M2 review/evidence.

Each milestone receives its own review and evidence before the next starts.
M1 displays imported tracks on their own explicitly labelled axes; unaligned
sources never select process/Gold ranges. Snapshots have a separate import
save/open flow until a later integration explicitly changes existing history.

**Additional accepted presentation decision, 20 October 2026:** CSV analysis is
available only in the Profiling editor tab. A sidebar entry point opens that tab;
the sidebar itself always displays standard process/Gold profiling. Standard
profiling continues to support both hosts. Source/host navigation preserves CSV
range, series and row inspection within the owning window.

## Accepted GR-002 qualification scope

Perf is the user's higher-value capability. Run native timed-capture
qualification alongside M1 when capacity permits; otherwise M1 first.
Qualification needs no Craidd UI: one installed perf version, a fixture with
known hot functions, thread attribution, symbols, loss reporting and safe Stop.
Frame-pointer and DWARF capture are separate gates. Record tools, machine,
permissions, command lines, raw output and target survival.

Flame graphs, JIT maps and symbol scale follow only after that checkpoint passes.
Flight recording remains **proposed**, not accepted for delivery. Before the
user decides, measure observed retention at a stated rate/buffer size. A byte
ring does not guarantee N seconds, and samples can miss short spikes. No
sysctl/capability/policy changes or elevated perf execution are authorised.

**Still proposed:** event/frequency defaults, automatic unwinder selection,
JIT runtime setup, sampling payload details, flight-recorder implementation and
collector/debugger coexistence. Timed fixture choices are experimental settings,
not product defaults. Missing tool/permission is a recorded blocker, not support.

## Performance and evidence contract

Initial starting targets accepted by the user (memory and interaction gates
are superseded explicitly by the later M1 review decisions below):

- Fixture: 1,000,000 data rows, 1 time column, 20 numeric columns and 1 short text column.
- Parse: visible progress, under 15 seconds to first view, peak memory under 3×
  file bytes and UI responsive throughout.
- Loaded pan, zoom, series toggle and row inspection: under 100 ms per interaction.
- Record the machine, build and workload. Report parsing, symbol resolution,
  desktop behaviour and recovery independently as PASS / FAIL / PARTIAL /
  BLOCKED / NOT TESTED. Automated checks do not certify human desktop acceptance.

Measure first. If targets are unrealistic, report actual results and identify the
affected targets; do not silently weaken thresholds. Backend timings alone do
not prove UI latency. Include worker/backend and frontend memory where measurable,
state baseline versus total/incremental peaks, and disclose unmeasured processes.

## M1 review decisions after initial evidence

Accepted by the user on 20 October 2026:

- Memory acceptance is **incremental import peak RSS <3× file size**, with the
  IDE baseline and process/window composition reported separately on every run.
  The initial 2.08× release result passes. The whole-IDE baseline is a separate
  open issue and must not be optimized within M1.
- Interaction acceptance is the **release** build: 20 observations of each of
  six operations on the ordinary desktop and Xvfb, reporting nearest-rank
  p50/p95/max; each operation passes if p95 <100 ms. Retain the old debug 199 ms
  observation as historical evidence. Capture query/render/GC evidence before
  changing code in response to any new outlier.
- Close the native desktop owning-window-during-load recovery gate before the
  M1 commit. Commit locally on a feature branch from `feat/unity/debug-a-to-p`;
  no push or merge until human acceptance.
- After M1 closes, GR-002 in-IDE **timed** capture has priority over M2. Its first
  in-IDE slice is still a proposal after qualification; this approval does not
  authorize building it yet. M2 then M3 remain approved in order but wait.
- Rerun native perf qualification with the installed version and measure actual
  overwrite retention at 99/999 Hz across bounded ring sizes. Flight recording
  remains a user decision after the evidence.

## M1 implementation choices

The following are bounded implementation choices, not changes to accepted scope:
native streaming reads and compact storage; bounded query responses; cancellable
imports with progress; no whole-file JSON transfer to the UI; versioned snapshot
artifacts; explicit resource-limit errors; and a narrow imported-source view in
the existing Profiler. CSV supports UTF-8, comma delimiters, a header, escaped
quotes and single-line records. Multi-line quoted records are rejected and
counted as records rather than treating continuation lines as new rows.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
