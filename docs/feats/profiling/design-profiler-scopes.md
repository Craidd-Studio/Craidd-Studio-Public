# Unified Profiler scopes and independent manual snapshots

**Roadmap track:** Phase 3.5, composing with native Unity profiling.

**Status:** Approved on 17 October 2026, with the user's subsequent correction:
manual snapshot history and Gold scope selection must use separate dropdowns.
Implementation and evidence are recorded in the
[scope report](../../bugs/17-10-2026/profiler-scopes-report.md).

## Preserve the panel

Keep Attach, SVG actions, Summary, Gold, Memory, Events, CPU/RSS charts,
Gold timeline, saved snapshots and Recorded hits/segments. Scope selection
changes what these views inspect. It does not start/stop the target or change
capture instrumentation. Full session is the default; this supersedes the
previous automatic Solo focus. Solo remains explicitly selectable.

Manual snapshots are independently captured moments. Gold and Solo recordings
are intervals. Recording completion does not create a manual snapshot.

## Two compact selectors

The existing snapshot history retains its saved entries and a clear Live
button returning to the full current session in one action. It contains manual
snapshots and distinctly labelled previous-session archives, never individual
Gold invocations. It appears once saved views exist.

A separate Scope selector lists Full session and each recorded Gold/Solo
benchmark once. It does not list every periodic hit. Choosing a benchmark
focuses its most recent retained invocation/segment at that moment; new hits
do not replace that selection. Individual invocations are browsed through the
existing collapsed history, with a Focus recording action. The caption gives
batch, thread, recording status and start/end times. The Gold tab's Marker
filter browses hit history without independently changing the panel scope.

Selecting an active capture uses Start → latest observation. When End arrives,
the same selected capture becomes Recorded and its boundaries stay fixed.
Incomplete results say Recorded · Incomplete. New Play generations and Record
again cannot retarget an older selected segment. An evicted capture stays
explicitly Unavailable; no silent switch to another hit or full session.

Timeline intervals select their capture; selected intervals are highlighted.
Three compact lanes distinguish simultaneous/nested intervals within the
bounded rendered set. The selected interval is always included. Time overlap
is context, not proof of causal ownership. All retained hits remain accessible
in the history even when not all are rendered on the compact timeline.

## Capture, scope and presentation

The existing collector retains process samples, captures, allocation ownership,
Play generations, recovery and private routing. Add small boundary/cohort
summaries and a bounded diagnostic ledger; do not introduce another collector.

The store keeps a recording identity qualified by profile/session plus one
small descriptor, independently of its selected saved snapshot. A shared
resolver supplies boundaries, samples, fully contained CPU sample intervals,
related captures, pauses, diagnostics, native summaries and availability.
Every tab reads this resolved view. Scope state is independent of tab state.

A saved snapshot still copies collected current-session observations. Optional
recording context and active capture IDs associate it with Gold/Solo without
making those recordings prerequisites. Saving preserves current selection:
Live stays Live, a recording stays selected, and an explicitly reviewed older
snapshot remains selected. A snapshot's recording context uses only its frozen
copy; subsequent live End/free/Play events do not rewrite it.

The existing eight saved-view bound remains. Evicting a reviewed snapshot
returns to Live. Automatic previous-session archives retain their separate
label. No automatic Start/End snapshot feature is introduced.

## Measurement semantics

Process CPU/RSS charts are whole-process observations within the selected
window. They do not become function-exclusive metrics. CPU deltas are formed
before filtering; intervals crossing boundaries are excluded. A shorter-than-
polling recording can have valid native CPU/cohort data and no process samples.
Missing values show unavailable, not zero.

RSS retains its real process baseline. Start/End summaries preserve nearest
observed samples at or before each boundary, with their timestamps/offsets.
Observed change needs distinct observations and a usable observation inside
the window; an old sample reused twice cannot prove zero change. These are
sampled boundary observations, not exact RSS measurements at a source hit.

Native session totals count each accepted explicit allocation/free once,
independent of overlapping capture owners. Capture cohorts remain inclusive.
Window activity counts accepted native events on all provider threads while
the capture is open, including frees of older tracked allocations. Unknown-
size frees are counted separately. No process-wide malloc interception or
managed heap capability is inferred.

At End, freeze the cohort and process-boundary summary. Later frees continue
to update original ownership, displayed separately as current observed
survivors/freed after End. They do not alter fixed window activity or End
survivors. Inside snapshots, follow-up values are also frozen as of capture.

Thread CPU is attributed only where the existing provider measures it; Solo
CPU remains unavailable. Thread filters inspect Gold results and never suspend
threads or reattribute the whole-process charts.

Graph dragging may narrow sampled/temporal inspection inside the scope. Exact
allocation activity for arbitrary subwindows is unavailable without a raw
allocation journal; do not derive it from cumulative values. Whole-recording
cohort totals remain explicitly labelled as covering the entire recording.

## Bounded history and diagnostics

Retain 2,400 process samples, 2,000 captures, 128 ordinary completed hits per
marker, pinned Solo/open/live cohorts, 20,000 tracked allocations and eight
saved views. Existing capacity/reconnect safeguards remain. Boundary summaries
retain no duplicated full process history and require no per-event `/proc` IO.

The diagnostic ledger retains at most 256 bursts; nearby same-kind events may
coalesce. Timestamp overlap filters diagnostics, while a crossing burst's
count remains explicitly the whole burst count. Capture coverage counter
baselines distinguish prior session errors from loss during a recording.
Global retention/error counters remain labelled as session context.

Aged sample or diagnostic history is partial. Evicted capture identity is
unavailable. Present retained End summaries even when detailed process samples
have aged out, with their different availability states visible.

## Verification boundary

Keep [human manual evidence](../../bugs/17-10-2026/profiler-scopes-report.md#appendix-a--human-manual-verification-report)
separate from new automated checks. The human did not explicitly verify
Stop Play → Play again without reattaching. Automated disposable tests cannot
change that manual status. Never automate the user's live Editor.

Verify live/completed Gold and Solo, stable selection across tabs/Play, native
End versus late free, nested attribution, independent snapshots, missing/evicted
history, narrow 288/360/420 px layouts and the real native Unity regression flow.
Monaco CSP, explorer menu placement, C# hover and the remaining earlier Unity
gates stay separately tracked; this scope work does not qualify a public release.

---

*Last updated: Phase 3.5, 17 October 2026. Author: ShinkuKira21.*
*This document is a design.*
