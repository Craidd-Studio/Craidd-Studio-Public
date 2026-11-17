# Phase 3.5 handoff: two M1 import defects

**Roadmap track:** Phase 3.5 profiling.
**Status:** Local M1 defect-fix checkpoint, 23 October 2026. No push or merge.

Craidd Studio is a Linux IDE. Imported CSV inspection belongs in its existing
Profiling editor tab; process/Gold profiling still supports both hosts. Separate
fixture, automated, desktop and human evidence; the layout redesign stays on hold.

## Branch and scope

Current branch is `codex/profiling-metric-csv-m1`, with changes based on `5039abf`.
The perf branch remains at `464e407` and has not received these fixes. No merge
or cherry-pick was performed. Two pre-existing dirty records, `gr-001-m1-results.md`
and `gr-001-m1-uiux.md` under profiling/revisions, remain unmodified and excluded
from this checkpoint.

Read the [fix record](../feats/profiling/revisions/gr-001-m1-program-import-fixes.md)
and [fixture README](../../workspaces/profiling-metrics/README.md). Both defects
were reproduced before editing production code using a new program-shaped set:
unit-before-statistic headers and suffixless section columns; ranking originally
showed only Row N. The companion order is shuffled to prove named-key joining.

Units/statistic meanings now carry editable Suggested labels. Ambiguous headers
stay literal/unknown. Bulk edits target selected numeric or all unitless numeric
columns in one group, commit atomically through the normal guards, and preserve
saved snapshots. Old snapshot metadata is not re-inferred. Worst rows retain
Row N and gain the declared axis value or a chosen/default literal key. Ranking
and clock semantics are unchanged.

## Evidence and remaining work

18 parser/interpretation tests, 4 application-command tests and 3 row-key cases
pass. A real ordinary-desktop debug Tauri pass imports, bulk-sets section units,
shows 2.25 seconds beside the slow Row 3, and inspects its exact-key companion
Row 4. Snapshot and producer hashes remain unchanged. Existing metric UX
navigation/retry/width regression also passes. Full commands, binaries and
machine are recorded in the linked JSON.

No layout redesign, new file-chooser qualification or new million-row release
performance measurement was done. Prior human usability findings are not closed
by these functional fixes. M2/M3 and perf priorities remain governed by the
user's decisions. Before adopting the M1 fix on another branch, obtain the
appropriate integration authorization; do not assume it is already there.

## Opening prompt

> Continue on codex/profiling-metric-csv-m1. Read AGENT.md, working-protocol,
> roadmap/model and the M1 program-import fix record. Preserve the two dirty M1
> usability/result documents. The two targeted functional fixes have automated
> and ordinary-desktop evidence; UI redesign and human release acceptance stay
> on hold. Do not push or merge, and do not assume the perf branch has the fix.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
