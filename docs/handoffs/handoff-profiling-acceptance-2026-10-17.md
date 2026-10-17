# Handoff — Unity profiling acceptance before the language extension

**Roadmap track:** Phase 3.5 profiling and Phase 3.x debugger composition.
**Status:** Documentation prepared, 17 October 2026. No new runtime acceptance.

## Context and checkpoint

Craidd Studio is a Linux polyglot IDE. Profiling should remain a usable part of
its normal editor/debugger workflow, with process/capture ownership and measured
coverage visible. The user requested a detailed Unity UI/UX checklist first,
then a reviewed extension for C++, C#, C# with LDI, Rust and Rust/native, including
MT and Red/Gold/Blue composition.

The application baseline is `f520203` on `feat/unity/profiling-a-to-p`, containing
the merged Profiling editor workspace milestone A. This handoff adds plans only;
it creates no `feat/profiling` branch and does not implement linked-view B/C.

## Deliverables and locked decisions

- [Unity acceptance runbook](../uiux/unity-profiling-manual-acceptance-checklist.md):
  182 uniquely identified, initially unchecked tasks, independent evidence lanes,
  deterministic fixture prerequisites, a first user journey, detailed UI/data/
  breakpoint/lifecycle/load checks and a report form.
- [Language extension plan](../uiux/profiling-language-extension-plan.md):
  47 initially unchecked preparation/scenario/integration tasks, plus parameterised
  language and breakpoint matrices. Proposed work is not current SDK support.
- Existing historical [harness evidence](../uiux/unity-profiling-harness-checklist.md),
  [scope report](../bugs/17-10-2026/profiler-scopes-report.md) and
  [workspace milestone A record](handoff-phase-3-5-profiler-workspace-a.md)
  retain their own dates, revisions and qualification boundaries.

Keep separate snapshot/scope selectors, active-at-capture associations, immutable
manual moments, stable Recording→Recorded windows and bounded reviewed-view
retention. Sidebar/editor host switches preserve inspection and the normal IDE.
Gold markers do not stop execution; Red does. Blue's execution provider matters:
C# LDI has held A plus reproduced B; Rust→C++ live-native uses the original process
and one LLDB session. Selection does not by itself isolate thread execution.

The current C++ exporter does not provide a C#/Rust Gold SDK. Unity managed
adapter/LDI, heap/GC and GPU support require separate qualification. Shared
Profiler sessions and Hide/Show restoration remain deferred B/C scope, not
requirements silently added to native milestone A.

## Work and verification in this documentation session

The new task IDs, unchecked status, links, document footers and referenced npm
script names were validated. No application or fixture code was changed. No
Unity, debugger, build or UI test was run. Existing test passes were not copied
into new checkboxes. The untracked Unity PackageManagerSettings file was preserved.

## Next execution

Start with preparation and UP-JNY-01–10, then scope/snapshot/host pointer and
keyboard checks. Use disposable Unity copies for automation/faults and preserve
all unrelated workspace state. Never attach to, click in, signal, rebuild the
plugin of, or restart the user's live Editor.

Retest source loss (15 events in the earlier ten-minute uncapped run), actual
pointer history-return selection and human Stop Play → Play again without
reattaching. Keep Monaco/menu/hover and snapshot-label issues visible. Save
counters before assertions/cleanup; classify harness/environment/product failures
with evidence. Managed/Blue cases lacking prerequisites stay BLOCKED.

Publish a dated run report with manual/real-automation/source evidence separately.
Review the result and exact checkpoint with the user before creating
`feat/profiling` or commissioning missing language providers. Ordinary MT precedes
MT with LDI; ordered calls do not prove arbitrary concurrent held origins.

## Opening prompt

```text
Continue feat/unity/profiling-a-to-p from its current reviewed checkpoint.
Read AGENT.md and its required documents, then the 17 October acceptance handoff,
detailed Unity acceptance runbook, scope contract and workspace milestone A.
Preserve all dirty/untracked work. Never control my live Unity Editor or rebuild
its loaded plugin; use disposable copies for automation and fault tests.
Start with UP-RUN and UP-JNY. Record M/A/D evidence separately and do not tick
unsupported or unexecuted cases. Diagnose failures before patching; preserve
before evidence. Keep the source-loss, pointer-navigation and human Play-restart
checks explicit. Review the Unity result before creating feat/profiling or
starting the language/provider extension. Do not implement shared Profiler B/C.
```

---

*Last updated: Phase 3.5 / 3.x, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
