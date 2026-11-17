# Release Status and Roadmap

**Snapshot: 17 November 2026. Early source alpha.**

The combined source was integrated into `master`. A local embedded debug build
and Debian package were prepared for internal testing. Publishing source does
not establish that a public binary release has passed its acceptance gates.

## Recorded integration evidence

- Production frontend build and 37 Node test files passed.
- Rust library checks recorded 341 passes, 13 ignored tests and one known
  installed-debugger failure; native cleanup recorded seven passes and one ignored.
- Seven native smoke scenarios passed on both the final standalone executable
  and the extracted Debian-package payload on the same host/private display.
- A 634-second uncapped Unity run crossed the 2,400-sample retention window with
  zero reported source gaps, rejected events, disconnects or dropped events;
  its post-rollover snapshot/free/Play-restart tail passed.

These are bounded results on recorded revisions. The final Save/Save As-only
follow-up received the native smoke; the long Unity gate was not repeated on that
last save-only binary. Historical intermittent loss remains in the evidence.

## Before a public binary prerelease

Finish human editor/navigation/conflict and metric-usability acceptance; optimized
performance checks; supported-language journeys; and clean-machine package/startup
checks. Native chooser, scaling/accessibility, last-solution Getting Started
behavior and experimental adapter limits retain their own open items.

Keep the current debug package internal. A future approved Alpha should be marked
as a **prerelease**, with an exact tested commit, supported environment, checksums,
installation/prerequisites, known issues and feedback instructions. Do not label
an unqualified build as stable or claim broad Linux distribution support.

## Roadmap tracks

| Track | Direction |
| --- | --- |
| Phase 3 | External language intelligence; Rust slice integrated, acceptance open |
| Phase 3.x | Debugger reliability, threads and bounded linked-native workflows |
| Phase 3.5 | Profiling/analysis implementations and qualification |
| Phase 3.y | Integrated terminal, deferred |
| Phase 4 | Find and Replace Batch, separate future plan |

Phase labels are work tracks, not a completion percentage or release promise.

[Current release index](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/releases/README.md) ·
[Exact integration record](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/handoffs/handoff-phase-3-prerelease-integration.md) ·
[Roadmap](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/roadmaps/Roadmap-v0.0.4A.md)

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
