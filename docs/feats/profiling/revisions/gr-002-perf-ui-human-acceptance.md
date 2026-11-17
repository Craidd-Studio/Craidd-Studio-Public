# Timed perf interface: human acceptance

**Roadmap track:** Phase 3.5 profiling.
**Status:** NOT TESTED by a human. Local branch only; no push, merge or public-release sign-off.

Record machine, desktop scale, source commit, binary hash/build, installed perf version and notes per step. Use a disposable native fixture; keep its normal stop input available. No debugger may be attached to the capture target.

1. Open a saved disposable solution. Open Profiler → **CPU sampling** in the sidebar, then **Open in Editor Panel**. Both presentations should be readable; imported CSV remains editor-only.
2. Choose a target through **Choose target…** → **Profile only**. Confirm the process name/PID is the intended fixture. This does not launch a debugger.
3. Review 99 Hz (approximately 10 ms per on-CPU thread), 10 seconds, FP. Read the missing-caller warning. Change to DWARF 8,192 and **Review capture**; inspect estimated output, existing-thread coverage and the 512 MiB cap before starting.
4. Start. The recording state and **Stop capture** must remain reachable. Stop before the duration ends; confirm PARTIAL says **Stopped by user**, with retained output, and the target continues doing work.
5. Find a known hot function in **Bottom-up**. Expand its callers; switch to **Top-down** and expand callees. Unresolved module/address frames must remain visible. Percentages are sampled-event shares, not exact function time.
6. Choose a particular named worker/TID, then a shared thread-name filter; choose its module. Check that the module lens retains full calling context. Filter an elapsed range and reset it. Capture time stays separate from process/CSV clocks.
7. Select a frame with verified source inside the solution and **Open source**. Return to the Profiling tab. Capture, filters, result view and setup visibility should survive navigation.
8. In **Coverage & details**, inspect LOST and LOST_SAMPLES separately, loss-scan completion, omitted samples/stacks, gained threads and polling caveat, raw size, symbol checks and reasons. Map-origin names remain distinct; .NET naming is a recorded limitation.
9. Pin the capture and reopen its raw data. Restart the IDE, open the same solution and reopen it from capture history. Pins survive; ordinary retention is 10 unpinned per solution.
10. On another disposable capture, try FP / 999 Hz and close the owning window while recording. The target must survive and raw partial output must remain available when the solution is reopened. Repeat at your normal window size and desktop scale; record clipped controls, confusing states or focus problems.

Missing-perf, permission refusal, target exit, cap/loss injection and LLDB refusal have separate automated/backend gates. This checklist does not replace those records or certify screen-reader support or large-load release performance.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
