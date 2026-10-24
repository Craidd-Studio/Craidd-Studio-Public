# Guided human acceptance rounds

**Status:** Agreed testing direction requested by the user, 24 October 2026. Individual human results remain NOT TESTED until observed and reported. This divides the [M1 checklist](gr-001-m1-human-acceptance.md) into short sessions; it does not replace its coverage.

Each round starts with a known release binary, disposable solution and copied fixtures. The assistant opens the relevant area, starts a silent recording of only that owned Craidd window, and gives one small goal with at most three actions. The human drives the acceptance actions. Automation does not click through the task for them.

The final action is **close this test window**, explicitly distinguished from closing the Profiling tab or quitting another IDE window. Closing ends the video. The assistant saves the recording and observational checklist, then records the human's **smooth / hesitated / stuck** feedback before preparing the next round. A closed window alone is not a PASS. A stuck report stops the round without requiring closure and is a finding to investigate before giving rescue instructions. Findings distinguish product behaviour, interface wording and ambiguous test instructions; assistance and any subsequent retry are recorded separately.

Record binary hash, machine/session, setup and supplied instructions, video times, automatic observations, human feedback, findings, help given, and PASS / FAIL / PARTIAL / NOT TESTED per round. Raw recordings and fixture paths stay in disposable local session folders; do not automatically commit or publish them. No whole-desktop recording, microphone recording or typed-key logging. A native file chooser may be a separate surface outside the window recording; human feedback and its qualification remain explicit.

## Recorded findings

Round 1: **FAIL**, [HA-METRIC-001](metric-source-transition-crash.md), a product render crash after changing CSV source. The recording and original failure are preserved locally. Opening the other CSV is a supported action. A retry is a separate result and must not overwrite this finding. The controller stops and records FAIL automatically if it observes the render boundary.

## Planned rounds

1. **First import:** start in an empty metric editor; open a clean CSV, look at the graph and close the test window.
2. **Explore:** start with interpreted data; focus on a spike, inspect its original value and close.
3. **Choose what to see:** change visible columns and the viewed range; return to the full file and close.
4. **Interpretation:** preview/change time or units, cancel a draft, and close.
5. **Companions:** assign companion units and declare a named-key join; inspect a matching row and close. Split this into two rounds if setup feels burdensome.
6. **Issues and recovery:** understand a deliberately imperfect file, recover from a missing path, and close.
7. **Snapshot save:** save a snapshot, change the import and close.
8. **Snapshot reopen:** reopen after the assistant moves only its copied CSVs; inspect the saved interpretation and close.
9. **Remaining coverage:** source-view state, large-file interaction/cancellation, native chooser, display scaling and accessibility as separate small sessions. Do not force a human to beat a sub-two-second import to prove an already automated close race.

Perf acceptance gets its own later rounds: select a Profile-only target and capture; explore self/caller coverage; inspect symbol provenance; then experimental Mono launch. Existing limitations and separate backend gates remain unchanged.

The first round is a low-effort orientation check, not a promise of overall public-release readiness. Short rounds make progress visible without turning hesitation into a hidden pass.

---

*Last updated: 24 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
