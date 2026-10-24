# Metric editor quality checkpoint

The approved layout is implemented in the Profiling editor tab: multi-series unit tracks, full-file overview, persistent selection independent of zoom, exact original-row hover, source/selection inspector, retained-column Median / Q1–Q3 / Maximum, virtual original rows, keyboard viewport controls, resizable row dock, interpretation preview / Apply / Cancel, and explicit saved threshold lines. Focus analysis temporarily gives the editor space without changing panel preferences. Smaller heights use the Rows tab; a requested inspector becomes an overlay at smaller widths.

This is a tested quality checkpoint, pending human acceptance and renewed release-scale measurements. It is not a declaration of public-release readiness. CSV interpretation, ordinal identity, unknown duration, named-key joins and snapshot immutability retain their distinct semantics.

| Gate | Result | Evidence / scope |
| --- | --- | --- |
| Type checking / embedded application build | PASS | Production frontend; native debug desktop executable |
| Native command / interpretation regression | PASS | Five metric-command tests, including atomic preview/apply failure, stale revisions, quantiles/missing values, gap vertices, threshold snapshot preservation and immutable reopening |
| Workspace hosts / row keys / perf presentation | PASS | Existing host and presentation checks |
| Ordinary desktop | PASS | 20,000-row deterministic fixture, two files, reversed companion order; explicit elapsed axis, bulk ms, joined original row, brush without zoom, exact hover, virtual scroll, cancel draft, keyboard viewport and dock controls |
| Xvfb desktop | PASS | Same scenario and executable hash |
| Responsive layout | PASS | 1920×1080, 1280×800, 900×800; chart geometry and editor overflow checked on both displays; CSV absent from sidebar |
| Scaled text | PARTIAL | 125% zoom screenshot inspected; no complete accessibility audit |
| Million-row release performance / incremental memory | NOT TESTED | Must rerun on this layout; historical M1 distributions do not qualify the new summary/plot queries |
| Updated layout close-during-import recovery | NOT TESTED | Historical native owner-close gate retained; not rerun for this checkpoint |
| Human usability / public release | NOT TESTED | User review required |

Machine `sk27`, Linux `7.2.11-arch1-1`. Executable SHA-256 `a5ece8389e0a1ef199acb5054d7f480b620442869b1d5936bb035177587e0862`. Machine-readable records and actual desktop screenshots: [editor-quality-2026-10-24](../../../../workspaces/profiling-metrics/editor-quality-2026-10-24/). The fixture generator is [editor-fixture.py](../../../../workspaces/profiling-metrics/editor-fixture.py). Native summaries copy at most eight requested numeric slices, calculate outside the dataset mutex, and permit one summary per source. Their transient memory and latency require the renewed release gate.

Inspect the full editor, select a range, hover several rows, inspect the known slow row 12000 with its reversed-order companion, use overview handles and keyboard alternatives, visit Rows at a smaller size, and preview/cancel an interpretation edit. Report whether the everyday workflow is understandable without this checklist. Existing dirty M1 result/UIUX documents were preserved byte-for-byte and excluded from this change.

Next work follows the approved order: GR-002 sampled-leaf correctness, GR-003 explicit symbol locations, GR-004 experimental launch helper. No push or merge.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
