# GR-001 M1: program-shaped units, bulk edits and worst-row keys

**Roadmap track:** Phase 3.5 profiling.
**Status:** Two targeted defects reproduced and fixed locally, 23 October 2026. The layout redesign remains on hold. Functional gates below do not establish human/public-release usability acceptance.
**Branch:** `codex/profiling-metric-csv-m1`, based on `5039abfbf72148dc4a3195bc753113153d77d6a0`. The perf branch is untouched.

## Reproduction before implementation

The [new main fixture](../../../../workspaces/profiling-metrics/fixtures/program-shaped/run.csv)
uses exactly the requested columns: `elapsed_s`, `loop_ms_mean`, `loop_ms_p95`,
`loop_ms_p99`, `loop_ms_max`, `queue_us_p95`, `rx_kb_s`. Its
[companion](../../../../workspaces/profiling-metrics/fixtures/program-shaped/run-sections.csv)
uses `elapsed_s`, `recv`, `update`, `send`, `other`. Four valid rows include a
slow row at 2.25 seconds; companion rows deliberately have a different order.
This is a reproduction of the reported shape, not a claim to have inspected
the user's real program files.

Before production edits, a parser regression failed with `loop_ms_mean`:
actual `unitless`, expected `ms`. A disposable native Craidd instance on Xvfb
confirmed unitless statistic-named columns, no bulk controls and a worst table
containing only Row/value columns. The original binary SHA-256 was
`fbc60b11929a4414855b373830d171d37f727413cf373d052fc9c4258b1199f5`.
Both reported defects were therefore reproduced before their fixes.

## Unit and meaning suggestions

The importer recognizes an underscore-delimited unit immediately before one
final statistic suffix: **mean, avg, min, max, sum, total, p50, p90, p95, p99,
p999**. Existing trailing units and compound `kb_s` remain supported.
For example `loop_ms_p95` suggests ms/window statistic and `queue_us_p95`
suggests us/window statistic. An unambiguous statistic suffix without a known
unit can still suggest window statistic. No header is renamed or stripped.

Conflicting unit tokens and stacked statistic suffixes remain unknown, for
example `loop_ms_us_p95` and `loop_ms_p95_p99`. Unsupported suffixes such as
`p100` are not guessed. Header matching is ASCII case-insensitive while the
original spelling remains literal. Text storage does not acquire a window
statistic meaning from its name.

`unitSuggested` and `meaningSuggested` distinguish inferred interpretation from
explicit edits. The series picker, settings and row inspection label suggestions;
units and meanings remain editable. The backend prevents an edited value from
being falsely relabelled inferred. Old snapshot metadata defaults these flags
to false and is **not re-inferred** on reopening. This does not infer window
duration, stack overlapping columns or recompute percentile summaries.

## One bulk action

Interpretation settings now offer either **selected numeric columns** or **all
currently unitless numeric columns in this file group**. Enter one unit and
optionally one meaning; keeping meaning leaves each column's meaning intact.
One Apply bulk interpretation action commits the edit with one interpretation
revision. Text, unselected columns and already-unit-bearing columns in the
unitless-only mode are preserved. In the fixture, `elapsed_s` stays seconds
while the four section values become explicitly ms.

The native operation builds the whole edit before committing. Empty, duplicate,
non-numeric or out-of-range selections and invalid units/meanings are rejected.
Individual and bulk actions share the existing axis, toleranced-join and snapshot
validation; a rejected edit cannot partially update a group. Bulk uses the
committed interpretation, not unsaved individual draft edits, as stated beside
the controls. Existing snapshot files are never rewritten and snapshot bulk
controls are disabled; native edits to snapshot data are also refused.

## Worst-row location context

Row N remains the clickable identity. Ranking code, tie-breaking, limits and
selection ranges are unchanged. A separate adjacent key column supplies context:

- A declared clock axis takes priority. Elapsed axes show their normalized
  seconds; wall-clock axes show ISO 8601. Raw original cells remain inspectable.
- Without an axis, the user can choose one literal column. Auto chooses the first
  numeric seconds/ms/us column or an underscore-delimited elapsed/time/timestamp
  name. A key does not declare or align clocks. Without a suitable column, it
  says No key selected until the user picks one.
- The key choice survives source/editor navigation in the existing bounded
  per-file view state. It changes display only, not ranking or snapshot data.

The fixture's p99 ranking remains **Row 3, Row 4, Row 2, Row 1**. Its first entry
now shows **2.25 s**, both using the default key without an axis and the declared
elapsed axis. Choosing `rx_kb_s` instead displays 128 for that row. Clicking Row 3
inspects it and joins the companion's **Row 4** on exact `elapsed_s=2.25`, exposing
`update=60 ms`; position is not used as a join rule.

## Evidence and acceptance gates

Machine `sk27`, AMD Ryzen 9 9950X3D, Linux `7.2.11-arch1-1`, Node **24.21.0**.
The fixed desktop run uses an embedded **debug** Tauri build on the ordinary
`:0` display, X11/XWayland under the Wayland desktop (`GDK_BACKEND=x11`), with a
disposable solution and isolated app settings. It never automates the user's
existing IDE window or program. Fixed binary SHA-256:
`940110e12580b3f6c67d69caca0ba51286d7417c6487bbf3a3ecab4eca1b9047`.

| Gate | Result | Evidence |
| --- | --- | --- |
| Original parser and desktop defects reproduced first | PASS | Expected parser failure and unchanged-build desktop reproduction |
| Unit/statistic interpretation | PASS | 18 production-parser fixture tests, including every requested suffix, compound units, ambiguity and old-metadata defaults |
| Bulk selection, atomic edits, joins and snapshot guards | PASS | Parser tests plus 4 application command tests; one revision per successful bulk action |
| Worst-row key precedence and formatting | PASS | 3 Node cases for declared axes, chosen/default keys, raw cells, missing values and wall clock |
| Requested real desktop flow | PASS | Actual import, Suggested labels, bulk companion ms, fallback/declared elapsed keys, clickable ranked row and shuffled companion join |
| Saved snapshot and producer integrity | PASS | Before-bulk snapshot reopens with original unitless sections; its hash and both CSV hashes stay unchanged |
| Existing editor UX regression | PASS | Existing keyboard/navigation, retained state, widths and interpretation-error retry harness passed |
| Frontend/embedded desktop build | PASS | TypeScript/Vite and native debug build complete |
| Native file chooser, new million-row release measurements | NOT TESTED | This pass uses the existing import-by-path UI; previous performance evidence is not relabelled current |
| Layout redesign / human public-release acceptance | NOT TESTED | Remain outside these fixes and on hold |

The first fixed-build desktop attempt stopped on a screenshot-selector quoting
error in the test driver after its initial assertions; correcting that driver
required no product change. The complete subsequent pass succeeded. Screenshots
were inspected, including the original/companion values and suggestion labels.

[Evidence JSON](../../../../workspaces/profiling-metrics/evidence-2026-10-23-program-defects.json)
contains both binary hashes, original/fixed metadata, source/fixture hashes,
ranked identities, joined row, reopened snapshot, test commands/log hashes and
local screenshot paths. Images and detailed harness logs stay under the recorded
ignored test-results directory; the fixture set, tests and bounded JSON are
committed locally. Reproduction commands are in the [fixture README](../../../../workspaces/profiling-metrics/README.md).
The two pre-existing dirty M1 result/usability records are preserved and excluded.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
