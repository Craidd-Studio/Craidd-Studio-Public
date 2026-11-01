# Craidd Studio documentation

**Roadmap track:** Documentation index, reviewed during Phase 3.x. See the [current roadmap](roadmaps/Roadmap-v0.0.4A.md).

Start here for the project model and working conventions:

- [Working protocol](working-protocol.md) — how the user and assistant collaborate.
- [`.craidd` and `.cln` model](craidd-cln-model.md) — the project and solution contract.
- [Current place](roadmaps/Roadmap-Current_Place_Roadmap-v0.0.4A.md) — a map of the codebase.
- [Current roadmap](roadmaps/Roadmap-v0.0.4A.md) — phase meanings, delivery order and acceptance gates.
- [Public-release readiness](releases/README.md) — current cross-branch assessment, fresh checks, failed/unrun gates and the remaining work.
- [Playground direction](roadmaps/playground/Playground-direction.md) — real linked-debugging acceptance.
- [Documentation conventions](../AGENT.md) — reading order, document footers and contributor attribution.
- [Roadmap archive](roadmaps/archive/README.md) — original historical phase snapshots.

The [Unity, attach and profiling collection](unity/README.md) distinguishes
native attach, future Unity C# / LDI qualification, non-stopping Gold capture
and runtime lifecycle. Start with the [Gold capture contract](feats/profiling/design-gold-capture.md)
for the single solo, paired ranges and Profiler result rules. The experimental
implementation includes process gauges and prepared native hooks; complete
Unity fixture qualification and remaining usability gates are recorded in the
[UI/UX harness checklist](uiux/unity-profiling-harness-checklist.md) and
[repair report](bugs/16-10-2026/unity-profiling-final-report.md), following the
[initial findings](bugs/16-10-2026/unity-profiling-uiux-report.md) and
[Opus review handoff](handoffs/handoff-unity-profiling-uiux-2026-10-16.md).

The [unified scope contract](feats/profiling/design-profiler-scopes.md) and
[Phase 2 report](bugs/17-10-2026/profiler-scopes-report.md) cover shared
Gold/Solo windows, separate manual snapshot history and subsequent verification.
Human baseline acceptance remains separately attributed in that report.

The [generic profiling revisions](feats/profiling/revisions/README.md) retain
[GR-001: metric CSV import and live follow](feats/profiling/revisions/gr-001-metric-csv-import.md)
and [GR-002: external PID sampling with perf](feats/profiling/revisions/gr-002-external-pid-sampling-perf.md).
They apply beyond Unity and retain baseline `8bac01e`. The
[accepted decisions](feats/profiling/revisions/implementation-decisions.md) stage
delivery: [GR-001 M1 results](feats/profiling/revisions/gr-001-m1-results.md)
pass automated release gates and await [human acceptance](feats/profiling/revisions/gr-001-m1-human-acceptance.md);
[perf qualification](feats/profiling/revisions/perf-qualification-results.md) now
records the installed native timed checkpoint. In-IDE perf remains proposed;
M2 then M3 wait behind that delivery. Neither full revision is delivered.

The [detailed Unity UI/UX acceptance runbook](uiux/unity-profiling-manual-acceptance-checklist.md)
starts a fresh joint review of native profiling and the Profiling editor tab.
The [language extension plan](uiux/profiling-language-extension-plan.md) describes
C++/C#/Rust, MT and distinct managed-LDI/live-native gates for a later reviewed
`feat/profiling` checkpoint. These are unexecuted plans, not new acceptance results.

The rest of the docs are grouped by purpose:

| Folder | Contents |
| --- | --- |
| [roadmaps/](roadmaps/README.md) | Current roadmap, source map, phase plans and archive |
| [bugs/](bugs/README.md) | Review findings, fixes and remaining runtime acceptance |
| [releases/](releases/README.md) | Dated release assessments, quality gates and portable evidence |
| [feats/](feats/) | Feature designs, including [multi-thread debugging](feats/mt-debugging/design-multi-thread-debugging-implementation.md), [LDI debugging](feats/ldi-debugging/), [linked windows](feats/linked-windows/), and the proposed [Git workspaces architecture](feats/version-control/git-workspaces/design-worktree-workspaces.md) |
| [uiux/](uiux/design-public-release-sweep.md) | UI/UX designs that justify interface changes, starting with the public-release sweep |
| [philosophies/](philosophies/README.md) | Design principles and reasoning, including the proposed [Git workspaces philosophy](philosophies/version-control/git-workspaces/philosophy-workspaces.md) |
| [future/](future/) | Deferred ideas and language considerations |
| [handoffs/](handoffs/) | Historical session handoffs and prompts |
| [forks/](forks/) | Contributor design forks |

The philosophy documents are grouped by topic. Start with the [philosophy index](philosophies/README.md); feature designs live under `feats/`. The Git workspaces documents are proposals, not implemented behavior.

The [future MT debugging investigations](feats/mt-debugging/future/README.md) cover Python/CPython, Java/JNI, assembly/disassembly, and maintenance of the optional patched Samsung netcoredbg experiment. They do not expand the current support claim.

The [Docs viewer collection](feats/editor/docs-viewer/README.md) now includes an
[initial Markdown / Docs implementation record](feats/editor/docs-viewer/implementation-markdown-docs.md):
a Docs sidebar, View Source / View Preview, source-preserving block editing and
formatting shortcuts. Automated/browser checks are recorded separately from
remaining native desktop acceptance. Full rich text editing, docs-as-project,
and HTML/PDF viewers remain future work. Session context is in the
[Markdown / Docs handoff](handoffs/handoff-markdown-docs.md).

---

*Last updated: Phase 3.x / 3.5 release checkpoint, 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
