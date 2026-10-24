# Metric inspection: completing the approved interface

**Roadmap track:** Phase 3.5 profiling.
**Status:** Implementation authorized 24 October 2026 against the supplied reference and [editor design](design-metric-inspection-editor.md). The earlier reduced UI is a checkpoint, not the completion target.

Deliver the balanced sources/chart/inspector/table layout inside the typed Profiling editor: a real full-file overview with viewport handles; a persistent selected range distinct from the viewport; exact nearest-row hover values and a separate committed row; explicit line/point/window display; a source overview, selected-range details and Median / Q1–Q3 / Maximum of original row values; a bounded virtual row table with a resizable dock; and interpretation preview / Apply / Cancel. Preserve mixed-unit tracks, unknown window duration, named-key companions, immutable snapshots and visible integrity.

Use actual first/extreme/last original vertices for reduced line display, break at missing/rejected data and label connecting lines as a visual guide. Never draw a fabricated average bucket value. Hover resolves one original row, not a bucket's extrema. Summary quantiles describe retained values of each literal column, including per-window percentiles; they do not reconstruct a run percentile. Window duration is declared independently of time spacing. Overview viewport and committed selection are separate states, with keyboard alternatives.

Keep rows and summaries in bounded native queries. Row virtualization never transfers a whole file into JavaScript; long text is flagged as preview and original inspection stays complete. Summary work copies only selected numeric columns, releases the dataset lock before quantile computation and allows one such job per source. User-entered threshold lines are per-column, validated and immutable in reopened snapshots.

An explicit Focus analysis action temporarily hides surrounding solution/output panels only while the Profiling tab is active. It does not overwrite panel preferences; returning to code restores normal hosts. At smaller editor heights, collapse the row dock into its Rows view rather than shrinking both chart and rows beyond usability. Source and inspector panes remain independently collapsible. No replacement IDE shell or outer navigation rail.

Verify real desktop layout/interaction at normal sizes and focus mode, range/hover/row coherence, exact summary and snapshot behavior, keyboard operation, scaled text, and the million-row release fixture with measured gates. Record remaining limits honestly; do not declare omitted design requirements delivered. Keep pre-existing dirty evidence documents unchanged, and use local commits only.

After this UI pass, delivery order is the newly accepted GR-002 leaf-preservation correctness fix, then GR-003 backend symbol locations/settings, then GR-004 experimental launch-only Mono helper. Their qualification and evidence remain separate.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
