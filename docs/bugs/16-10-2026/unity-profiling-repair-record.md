# Unity profiling repair record

**Roadmap track:** Phase 3.x / 3.5, usable native Unity profiling.

**Status:** Work in progress, 16 October 2026. Continuation of `d00d19d`.

The user supplied an independent Claude Opus 5.5 review after the initial
local report. Its runtime findings confirm the embedded CSP style failures,
a working disposable-Editor 60 fps flow, and uncapped-provider disconnects.
The live Editor's missing action logs are session-specific. Source findings
identify mixed retention/error counters, lossy Play end, snapshot view freezing,
shared hard-coded discovery paths and abrupt-exit artifacts. Those findings
are received review evidence; the final report will distinguish our reruns.

Implementation order is SVG controls, diagnostic Game overlay, Solo recovery,
pinned/fair capture retention, separate counters, durable Play generations,
Live-preserving snapshots, backend throughput, discovery isolation, and real
harness integration/acceptance. All Unity execution tests use disposable copies;
the user's live Editor is never attached, clicked, restarted or driven.

The initial worktree had only an untracked
`workspaces/unity/ProjectSettings/PackageManagerSettings.asset`. Its SHA-256 and
the original Git status are saved in `/tmp/craidd-unity-repair-20261016/baseline.json`.
It must remain untouched and uncommitted.

The [Monaco CSP proposal](../../uiux/proposal-monaco-csp-styles.md) is separate
from the font-independent SVG control fix. No CSP change is approved or applied.

---

*Last updated: Phase 3.x / 3.5, 16 October 2026. Author: ShinkuKira21.*
*This document is a record.*
