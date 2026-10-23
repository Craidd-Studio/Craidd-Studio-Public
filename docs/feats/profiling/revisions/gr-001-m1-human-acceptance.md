# GR-001 M1 human acceptance

**Roadmap track:** Phase 3.5 profiling.
**Status:** NOT TESTED by a human. Run before push/merge/public-release sign-off.

Record `git rev-parse HEAD`, binary/build, machine, desktop session, date and
PASS / FAIL / PARTIAL with notes. Use copied fixtures, not valuable producer files.
The [results](gr-001-m1-results.md) describe supported CSV syntax and limits.

1. Build/open the feature branch's embedded **release** app. Open a disposable
   solution. From the standard sidebar Profiler choose **Open metric imports**.
   CSV inspection must open in the **Profiling editor tab**, never the sidebar.
2. Copy [run.csv](../../../../workspaces/profiling-metrics/fixtures/run.csv) and
   [run-sections.csv](../../../../workspaces/profiling-metrics/fixtures/run-sections.csv)
   into a disposable folder. Use **Import CSV files…** to select both. Check
   picker, keyboard focus, source label and progress/error clarity.
3. Check main coverage: **5 retained rows, 2 invalid records, 1 unsupported
   multiline record and 1 empty cell**. Open **Import issues**. Continuation text must
   never become the fake `999` row. Companion coverage is 3 retained rows.
4. In the Columns pane, select `p99_ms` to plot it. The axis initially says **ordinal**, and duration is unknown.
   Inspect retained row 2: `elapsed_s=1`, `p99_ms=70`, `objects=44`, `note=slow`.
   Row 5 preserves the quoted text `last, quoted`.
5. In **Column meanings** (also reachable through **Interpretation and joins**), choose elapsed time using `elapsed_s`.
   Leave duration blank first; spacing must not declare a window. Set duration
   to 1 second and `p99_ms` meaning to **window statistic**, then apply. Check
   readable axis/units and declared-window display.
6. Declare an exact companion join: main `elapsed_s` ↔ companion `time_s`.
   Inspect row 2: companion `section_ms=60`. Inspect row 3: companion is unjoined.
   The different physical row order must not pair files by position.
7. Open **Largest values**, rank by `p99_ms`, and use **Find worst windows / largest values**. The highest percentile is 70;
   jump to that row. Pan, zoom, switch series and inspect another row. Check
   labels, responsiveness and keyboard focus at your normal display scale.
8. Open source/text code, then return using **Open metric imports**. The selected
   range, series and inspected row should survive. Standard Process/Gold remains
   available in both sidebar and editor modes; source switching starts no collector.
9. With a numeric join tolerance declared, try incompatible units on one key.
   The edit must fail clearly without altering the saved rule. Correct it and
   retry; the error must clear. Also try a missing import path, then a valid one.
10. Check the snapshot scope in **File details**. Save a **new** `.crmetrics` artifact with
    the native chooser. Change an import unit afterwards; the saved snapshot
    must keep the old interpretation. Producer CSV bytes must remain unchanged.
11. Close Craidd. Move the **copied** CSV fixtures elsewhere. Restart and use
    **Open metric snapshot…**: values, units, coverage and joins must reopen
    without those original paths; snapshot interpretation must be immutable.
12. Generate the million-row fixture using the [fixture guide](../../../../workspaces/profiling-metrics/README.md).
    Import it and check progress, normal interaction and cancellation. In a
    separate attempt close its owning window during load; the surviving IDE
    should remain usable. Record any problem and the relevant step/screenshot.

Native picker, screen-reader behaviour (if used), visual clarity and your actual
project CSVs need human judgement. Automated latency and memory evidence does
not sign off those aspects. M2/M3 and perf are outside this checklist.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
