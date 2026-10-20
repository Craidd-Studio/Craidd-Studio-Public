# GR-001: Metric CSV import and live follow in the Profiler

**Status:** M1 automated release gates PASS in the [M1 results](gr-001-m1-results.md);
[human acceptance](gr-001-m1-human-acceptance.md) remains open before push/merge.
M2 then M3 remain approved but wait behind in-IDE timed perf; neither is implemented.
**Craidd baseline reviewed:** `feat/unity/debug-a-to-p` at `8bac01e`.
**Area:** Profiler (Phase 3.5 profiling).

The [accepted implementation decisions](implementation-decisions.md) and
[common source contract](../design-profile-source-contract.md) govern staged
delivery. Open questions and initial inference wording below are superseded
where the addendum resolves them; row spacing never sets window duration.

## Summary

Let the Profiler read metric series that a program already writes to CSV files, either a finished file or one that
is still growing, and show them as a labelled source beside process gauges and Gold captures. The program has already
done the measuring; Craidd should show those numbers faithfully rather than measure the same thing a second time.

## Problem

Many long-running programs (headless servers, simulations, batch jobs, test harnesses) measure themselves. They write
a row per time window to CSV: for example a window's mean, p95, p99 and max of some loop duration, counts of live
objects, bytes sent, and a breakdown of the loop into named sections in a companion file.

Today Craidd's Profiler can only show what its own collectors produce: process CPU, RSS, virtual memory and threads
every 250 ms, Gold ranges, and native allocation cohorts. There is no source for external data, so a user has to:

- inspect those files in a spreadsheet or a separate script, with no link to the session, the source or the process
  gauges for the same moment;
- compare two runs by hand;
- watch a live run by re-opening a file.

The program's own section breakdown is often the fastest way to know *where* to look, before any sampling or Gold
marker is placed. Without it, the user places markers blind.

## Proposal

### A new source kind: imported metric series

- **Import a finished file** or **follow a growing file**, chosen explicitly. Following is append-only and read-only:
  Craidd never writes to, locks, truncates or deletes the file.
- **A file set:** files sharing a prefix and written by one run (`run.csv`, `run-sections.csv`, `run-worst.csv`) can be
  loaded together as one source set, each file a group.
- **Time axis per file**, chosen or inferred: elapsed seconds since the run started, a wall-clock timestamp (epoch
  seconds or ISO 8601), or the row's ordinal when there is no time column. Ordinal axes are labelled as such and are
  never presented as time.
- **Columns:** numeric columns become series. Units are inferred from common suffixes (`_ms`, `_us`, `_s`, `_kb`,
  `_kb_s`, `_bytes`, `_hz`, `_pct`) and can be overridden; unknown units stay "unitless", not guessed. Non-numeric
  columns are kept as row attributes, visible when a row is inspected.

### Honest semantics

Window statistics are not samples, and the UI must not treat them as samples:

- **The window length** is recorded (inferred from the time step, or set). A point means "this window", drawn as a
  step or a band, not as an instant.
- **Percentiles are never re-aggregated.** Averaging per-window p99 values is not a p99 of the run. A summary across
  windows shows the median, spread and maximum *of the per-window values* and says so.
- **Columns are not assumed to be additive.** Section breakdowns often nest or overlap (a section that contains
  another; a final "wait" column that absorbs asynchronous work). No automatic stacking or totals unless the user marks
  a set of columns as exclusive.
- **Thresholds** are user-set lines (for example a frame or loop budget), saved with the source. Craidd does not
  invent one.

### Coverage and integrity

- Count and show invalid rows (wrong field count, non-numeric where numbers were seen), empty cells and missing
  expected columns. An invalid row is skipped, never shifted into its neighbour's columns.
- Follow mode defers an unterminated last line until its newline arrives.
- A file that is truncated or replaced (size shrinks, or the inode changes) starts a **new generation**. Old and new
  data are never mixed into one series.
- Single-line CSV records only in the first delivery. Quoted multi-line fields are reported as unsupported, not
  misparsed.
- The import records the path, size, modification time and a content hash of what was read, so a snapshot can say
  exactly which data it shows.

### Relation to a profiling session

- An imported source can be used **standalone** (no process), or **associated** with a profile session's target.
- Association does not align clocks by itself. The file's clock and the session's clock are shown on separate axes
  until the user maps them with an explicit anchor: "row time T equals session time S", or "the file's epoch column
  is wall clock". The mapping and its basis are shown and saved.
- With a mapping, selecting a window in the series selects the same range in process samples, Gold captures and
  events, and the reverse.

### Viewing

- The Profiler shows the imported source with its own label, beside the existing sources, in the same timeline.
- Choose series per group, inspect a window (every column of that row and its companions at the same time), and filter
  by time range.
- **"Worst windows":** list the N windows with the highest value of a chosen column and jump to each.
- **Compare two imports** of the same shape: align them on elapsed time from each run's anchor, exclude a warm-up span,
  and show per-column median, spread and the difference. Descriptive only, never a verdict or significance claim.

### Persistence

- A snapshot that includes an imported source stores either a bounded copy of the rows shown, or the path, hash and
  range read, with a clear "file changed since" state if it no longer matches. This is an open question; both must
  never be silently mixed.
- Follow mode has a bounded in-memory window, with eviction counted and shown like the existing `agedSamples` and
  `evictedCaptures` counters.

### Out of scope

- No derived metrics beyond the descriptive summaries above, and no causal attribution ("this section caused the slow
  window").
- No remote fetch, no database or log-format parsers, no launching or controlling the producing program.
- Importing a program's own numbers is not independent validation of them; the UI must not imply that it is.

## Existing foundation

- [`src/store/profilingStore.ts`](../../../../src/store/profilingStore.ts): `Profile`, `Snapshot`, `ProfileCounters`.
  The new source needs its own type, not extra fields on `ProfileSample`.
- [`src/components/panels/ProfilerPanel.tsx`](../../../../src/components/panels/ProfilerPanel.tsx): timeline,
  Summary / Gold / Memory / Events, graph range and filters.
- [Attached profiling, "Result model"](../design-attach-profiling.md#result-model): a common envelope with clock
  domain, units, coverage and truncation. Imported series fit this envelope.
- [Profiler scopes](../design-profiler-scopes.md): scopes and snapshot inspection.
- [Profiling philosophy](../../../philosophies/debugging/profiling/philosophy-profiling.md): discovery, parsing and
  routing of external tool output.
- [GR-002](gr-002-external-pid-sampling-perf.md): proposed PID stack sampling beside imported metric windows.

## Acceptance

Proposed fixture: a small program in `workspaces/` that writes a main CSV and a companion section CSV once a second,
with a switch to inject slow windows, malformed rows, truncation and file replacement.

**Automated:**

- The parser matches the raw file exactly for values, units, window lengths and row counts. Invalid and partial rows
  are counted, and an unterminated line is held until complete.
- Truncation and replacement each start a new generation with no mixed series.
- Summaries never average percentile columns; nested columns are never stacked by default.
- A clock mapping round-trips through a snapshot.
- A 1,000,000-row import stays responsive. Record the actual load time and memory, and keep the UI interactive.

**Desktop:**

- Import a finished file set; follow a live one through a slow window; find it with "Worst windows".
- Map its clock to an attached session, and confirm range selection is linked both ways.
- Compare two runs.
- Close the window and reopen the snapshot.

**Failure and recovery:**

- Missing file, unreadable file, file deleted during follow, and unit override conflicts all show a clear state.
- Stopping follow or closing Craidd never touches the producing process or the file.

## Open questions

1. A snapshot stores a copy of the rows, or a reference with hash?
2. Is a file set declared per import, or remembered per folder or `.cln` project?
3. Is the time-axis and unit inference editable after import, or only at import?
4. Should a run be able to declare its schema (units, window length, nesting) in a sidecar file, so inference is not
   needed?

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
