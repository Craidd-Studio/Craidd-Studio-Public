# Profiler source contract

**Roadmap track:** Phase 3.5 profiling.
**Status:** Accepted design, 20 October 2026. This contract precedes GR-001 implementation.
**Baseline:** `8bac01e`; extends the [generic revisions](revisions/README.md).

## Shared envelope, distinct data

A source identifies its source ID, kind, generation, label and optional process
incarnation/session association. Its envelope records:

- Clock domain: ordinal, elapsed, wall clock or session clock, including the named
  column and interpretation. An ordinal is never labelled seconds.
- Units and column meaning: gauge, counter, rate, window statistic or unknown.
  Unknown stays unknown. Explicit declarations override editable inference.
- Coverage: records read/retained/rejected, empty cells, unsupported records,
  missing columns, gaps and truncation, with bounded diagnostic examples.
- Retention limits: maximum bytes/rows/sources and actual omitted/evicted counts.
- Completion: loading, complete, partial, cancelled or failed, with a reason.
  Progress is bytes read / initial file bytes, not an invented ETA.

CSV rows, process observations and stack samples are separate payload types.
The envelope allows labelled tracks on the Profiler timeline; it does not turn
CSV windows into process samples, stack weights into durations or Gold ranges
into statistical samples. Existing process/Gold types need not be migrated in
GR-001 M1. No shared collector or unrelated Profiler redesign is required.

## Interpretation and correlation

Each CSV column has a storage kind (numeric or text), unit and meaning. Time
interpretation names a column or explicitly uses row ordinal. Row spacing alone
never supplies window duration. Window statistics have unknown duration until
declared; only a declared duration permits window bands/steps. Ambiguous unit
suffixes retain their literal spelling; no implicit decimal/binary conversion.

Interpretation edits create a new revision of source metadata. They never mutate
an existing snapshot. A reserved schema descriptor can later identify a sidecar;
M1 does not read sidecars or assume their schema.

File sets are explicitly selected per import. A companion join declares both
named key columns, exact or numeric-tolerance matching, and tolerance units.
Missing or ambiguous matches remain unjoined, never paired by row position.
Grouping files does not establish that their clocks agree. Session association
also establishes no clock mapping; M3 will record an explicit mapping and basis.

## Snapshots and ownership

An imported-metric snapshot stores a bounded, immutable copy of the selected
rows and interpretation, diagnostics and provenance (path, byte size, mtime,
SHA-256 of bytes read, source/generation and selected range). Opening it requires
no access to the original CSV. Saving must state limits/omissions and fail
clearly rather than silently switching to a reference. Storage format is
versioned and validated on reopen. Existing process snapshots remain separate.

Imports only read producer files. Cancellation, errors and window shutdown close
Craidd's readers; they never signal the producer or modify its files. Explicit
snapshot saves create a new user-chosen artifact. Work and bounded data queries
run outside the UI thread; rendering receives bounded graph/row results.

## Delivery boundaries

**Presentation decision, 20 October 2026:** Imported metric analysis is editor-tab
only. The sidebar may open that editor view but never renders CSV analysis.
Standard process/Gold profiling remains available in sidebar and editor modes.
Returning to code restores standard sidebar profiling and retains imported
inspection for the next visit to the Profiling editor tab.

[Implementation decisions](revisions/implementation-decisions.md) define the
accepted defaults, milestone review gates and proposed collector qualification.
M1 delivers finished-file import only. Live generations (M2) and session clock
mapping/comparison (M3) require separate review before work begins.

---

*Last updated: 20 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
