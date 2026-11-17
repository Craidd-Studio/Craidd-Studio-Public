# IntelliSense human checklist: Alpha findings

> Checkpoint, 17 November 2026: the original findings below predate repair
> `e6927b4`. Its independent re-check is recorded in `f22844e` in the
> [results record](results-lsp-stage-1.md#re-check-of-the-buffer-identity-repair-fixlsp-buffer-identity-at-e6927b4-2026-11-16-harness-observed-pending-user-review).
> The reproduction no longer occurred in the automated runs; human re-check
> and Stage 1 acceptance remain open. See the
> [Phase 3 checkpoint](checkpoint-phase-3-stage-1-2026-11-17.md) for current status.

Date: 16 November 2026
Branch under test, as reported: feat/intellisense-ws
Evidence: user reports and screenshots in this chat. Originally drafted outside the checkout to avoid triggering a Tauri rebuild during testing; copied into docs with explicit user authorisation at session handoff. No fixes were implemented for these findings.

## 1. External disk changes can leave diagnostics stale

Fixture: fx-small, src/main.rs calls util::ok() and imported ok().

The user changed util.rs externally to require x: u32 and observed argument errors in main.rs. When the signature was restored externally to pub fn ok(), the displayed editor text showed the restored signature with no dirty dot, but Problems retained two rust-analyzer “expected 1 argument, found 0” errors. The user reported the count reset to zero upon selecting main.rs.

Evidence: codex-clipboard-75567c03-6288-4918-a998-f1065760d4a2.png and the subsequent report “reset to 0 when went to main.rs”.

Assessment: external-change diagnostic clearing did not occur until a tab activation in this run. G7.2 did not satisfy the intended no-tab-switch behaviour. The exact 30-second interval was not independently measured. The earlier dirty-buffer conflict makes the overall sequence more complex than a clean closed-file reproduction; repeat under controlled clean and dirty buffer conditions before assigning a root cause.

A later external edit to require an argument did not produce the expected diagnostics, including after selecting main.rs, according to the user. The util.rs screenshot still showed pub fn ok() and a yellow dirty dot. The origin of that dirty state was not established.

Evidence: codex-clipboard-65508bf7-bff2-410f-9a96-5d65670c956d.png and subsequent user reports.

Assessment: G7.3 is not passed. The clean-tab reload case remains unverified; the observed dirty-buffer case exposes an unresolved disk/editor/diagnostics consistency concern. Do not infer that the server must discard unsaved text to analyse disk. Determine which document snapshot the server received and whether watcher, model sync, diagnostic refresh, or presentation failed.

User concern: a build using the disk version could fail while the editor displays zero diagnostics. This is a credible consequence, not a separately established build failure in this record.

## 2. Run reportedly replaces an unsaved editor buffer silently

The user reports that after an external editor changed util.rs on disk while Craidd retained an older dirty buffer, invoking cargo run replaced Craidd's buffer with the disk version without asking. The user also explicitly flagged an unexplained dirty-state issue during these tests.

Assessment: reported silent loss/replacement of editor state; investigate as an Alpha blocker candidate. The supplied Play-button crop identifies the action but does not independently demonstrate the before/after replacement. Exact launch/reload implementation responsible is unknown.

Required behaviour, explicitly requested by the user:

- A run that uses the disk version must preserve the unsaved editor text and its dirty state.
- Notify the user that util.rs has unsaved/older editor content and the run is using the disk version; do not claim that the buffer was saved.
- Do not implicitly reload, discard, or overwrite the editor buffer during cargo run, build preparation, or subsequent file refresh.
- Replace or save the buffer only through explicit user choice. Ctrl+S remains a save request; if disk changed since the buffer baseline, preserve conflict resolution rather than silently overwriting either version.
- Keep disk, editor-buffer, language-server and build-source identities clear. A dirty buffer can legitimately differ from disk; that difference must be visible and must not cause silent data loss.

Suggested verification: preserve distinct known contents for disk and dirty buffer; invoke Run; compare editor text and dirty status before/after, capture the notice and the content the build actually used. Repeat with a clean buffer, a dirty buffer, and a disk conflict. Confirm explicit Load Latest/Discard and Ctrl+S conflict handling remain deliberate actions.

## 3. Problems refresh on save and count differences

The user observed delayed Problems/counter updates and recounting on each save. Fx-many remained usable while the list was capped: the user reported “showing 500 of 7314 errors” and typing/tab switching “Seems fine.” Later screenshots showed “LINKED SOLUTION · 3 WINDOWS”, live totals of 2440 errors with “showing 500 of 7360”, and separate window status counts of 2440 and 2435.

Assessment: functional cap/responsiveness check G5.3 passed by human report for fx-many. Refresh latency, aggregate/source semantics and differing window counts remain unresolved; no measured performance conclusion or confirmed counting defect.

Proposed investigation: measure edit/save → server diagnostics → state aggregation → rendering. Consider retaining existing results with an updating indicator, incremental per-file aggregates and cached unchanged diagnostic sets. Invalidate by relevant document version, server session and lifecycle changes; reject stale responses. Do not suppress necessary compiler checks merely because the text did not change. These are proposals, not implemented fixes.

## 4. Closing the last solution needs a starter window

File → Exit → This Solution closed the solution's three linked windows and did not reopen Getting Started. Subsequent process output contained only the previously identified VS Code rust-analyzer and its two helpers, supporting the G6.1 cleanup pass; exact shutdown latency was not measured.

The user explicitly identified the missing starter as a Public Release Alpha UX flaw:

- After successfully closing the last solution, show or focus one Getting Started window.
- If another solution remains, preserve it without opening a redundant starter.
- Exit → This Application should quit and must not reopen Getting Started.
- Respect save/cancel flows and verify linked-window cleanup.

This requirement was already added to docs/uiux/design-public-release-sweep.md on the active branch. No implementation is claimed.

## Test interference and evidence limits

- The user established that the attempted window-observation method caused an input blocker. Do not attribute that blocker to Craidd or reuse that capture method for this acceptance run.
- Editing the release documentation during testing triggered a Tauri rebuild, interrupting the test. The earlier apparent crash is not a confirmed Craidd crash. A subsequent retry did not crash.
- No further checkout edits should occur while the user is actively testing. This report is deliberately outside the checkout; integrate it into project documentation after testing is finished.
- G6.2 stale markers before reconnection remained unverified; a settled screenshot cannot establish when markers appeared.
- G1 linked-window launch/park/restore checks remain open. Seeing linked windows alone does not pass those checks.
- G5.2 unsaved undo clearing was confirmed. G5.1 unsaved cross-file propagation was observed, but half-second timing and split-view behaviour remain unverified.

## Next investigation priorities

1. Preserve dirty buffers during Run and identify what silently replaced the reported buffer.
2. Reproduce external-change sync separately for clean, dirty and closed tabs, recording exact disk/model/server versions and diagnostic timing.
3. Investigate save-time recount and cross-window count semantics.
4. Implement and test the last-solution Getting Started UX requirement.

## 5. G7.4: diagnostics fail to clear after correcting typed/pasted errors

During the normal-editing exercise in fx-small/src/main.rs, the user typed
`let count: u32 = "hello";` and pasted `let message: u32 = "test";` within
main(). Both intentional type errors produced red markers and Problems rows
saying “expected u32, found &'static str”. The user reported errors appeared
instantly, Ctrl+Z followed by Ctrl+Shift+Z worked, and “IntelliSense feels fast!”
This is qualitative feedback, not a latency measurement.

After replacing the strings with numeric values, the user reports
“replacing doesn't update”. Screenshots show `let count: u32 = 7;` and
`let message: u32 = 23;`, while red squiggles remain visible. The larger
screenshot also shows a squiggle under the first println! call. The code
visible in the screenshots no longer contains the intentional string/number
mismatches. The exact remaining diagnostic messages, elapsed time, save state
and language-server document version have not yet been captured. Do not infer
the precise cause or assume every remaining underline is the same stale error.

Evidence:
- Before correction: codex-clipboard-bbb17978-c934-4769-9d19-9023981113f1.png,
  codex-clipboard-1e639246-e839-40c0-96cc-6e52ef504e44.png,
  codex-clipboard-5887ea82-6b1e-4c2f-8cfb-cbfb17365323.png.
- After correction: codex-clipboard-a4e91995-3878-420e-b253-18b259a27a10.png,
  codex-clipboard-de46e892-2060-4eee-b99e-8757fec3c50d.png.

Assessment: G7.4 is not passed; the user reports a diagnostic update failure
after correcting ordinary in-editor edits. Undo/redo and initial error arrival
worked in this exercise. No “desynced” message was reported, which is not proof
that none occurred. Preserve current buffers and inspect the remaining Problems
messages before any save, tab switch or server restart changes the evidence.

## 6. Multiline paste indentation issue

During the same exercise, the pasted println! line appeared at the left margin
while the preceding let statement remained indented inside main(). The user
reported “Formatting of tabs didn't stay?” and identified it as a text editor
issue. Screenshots show inconsistent indentation after the supplied multiline
paste. This should be investigated as paste/indentation behaviour; responsibility
has not been established between clipboard whitespace, paste settings, editor
integration, or Monaco itself. Formatting on paste is not assumed to be enabled.

This is a separate UX finding from language-server correctness. No fix has been
implemented and no checkout files were edited to record these additions.

### G7.4 follow-up: remaining diagnostics are compiler-sourced

The user supplied the remaining Problems text after correcting the editor buffer:

- Header: Build (last build): 0 errors, 0 warnings; Language server (live):
  3 errors, 0 warnings.
- All displayed entries are labelled LIVE · RUSTC.
- E0308 at main.rs:8:22: mismatched types, expected u32, found &str;
  accompanying “expected due to this” at 8:16.
- E0423 at main.rs:10:5: cannot find function println; a macro named println
  exists in another namespace; accompanying suggestion to use ! at 10:12.
- E0308 at main.rs:14:24: mismatched types, expected u32, found &str;
  accompanying “expected due to this” at 14:18.

The most recent supplied screenshot shows numeric values at lines 8 and 14,
and println! at line 10. The messages therefore do not describe that visible
buffer. Earlier intentional type errors were labelled LIVE · RUST-ANALYZER;
no such entries are present in the user's latest supplied list.

Refinement: do not attribute this evidence indiscriminately to rust-analyzer's
edit-sync path. The remaining compiler-sourced results could reflect an older
saved disk snapshot or stale compiler output; the saved contents and analysis
version have not been verified. A language-server client can receive compiler
check diagnostics through rust-analyzer, so the source label alone does not
prove which transport or state layer is responsible. G7.4 remains unresolved/
not passed pending a save-refresh check, rather than a proven failure of all
in-memory language-server diagnostic updates. The three primary errors plus
related explanatory rows do not by themselves prove a counting defect.

Next check: explicitly save main.rs, respecting any disk-conflict prompt, wait
for checks to finish, and compare the remaining source-labelled diagnostics.
No checkout edits were made by the assistant.

### G7.4 save-refresh result

The user explicitly reports “saving removed stales.” The accompanying screenshot
(codex-clipboard-0d0c51aa-373f-4afd-bd71-2ef7d904bb8b.png) shows saved main.rs,
numeric initialisers for count/message and no prior red error squiggles. A yellow
underline remains on doubled, consistent with a possible unused-variable warning;
its diagnostic text was not supplied, so that interpretation is unconfirmed.

This supports that the outdated LIVE · RUSTC results refreshed after an explicit
save. It does not establish a broken rust-analyzer in-memory text sync path.
Refine the UX finding to compiler diagnostics remaining visible against a changed
unsaved buffer without a sufficiently clear freshness distinction: LIVE alone
can imply that the messages describe the currently visible text. Investigate
source/version freshness presentation and invalidation, preserving useful saved-
snapshot diagnostics where appropriate rather than blindly suppressing them.

G7.4 evidence: initial in-memory errors arrived quickly by user report; undo/redo
worked; compiler-sourced older errors persisted through corrections and cleared
after save. The strict “nothing stale” expectation was not satisfied from the
user's perspective; record a qualified result with this source-specific limitation,
not an unconditional failure of all diagnostic synchronisation. No desynced
message was reported. The separate external-change/dirty-buffer issues remain
open; this save result does not resolve them.

## 7. Agreed editor, disk, diagnostics and build policy

The user proposed the following policy and explicitly agreed to the additional
conflict handling described below. This supersedes the earlier proposal that
Run would always use disk while leaving ordinary dirty buffers unsaved.

| State | Diagnostics | Build / Run |
| --- | --- | --- |
| Dirty buffer; disk unchanged since the buffer baseline | Analyse the latest editor buffer. | Save the buffer, then build that content. Stop if saving fails. |
| Clean buffer matching disk | Analyse current content. | Build from disk. |
| Disk changed externally; editor retains older content | Analyse latest disk content. | Do not save the older buffer. Build disk and tell the user that the editor version is out of date. |
| Dirty buffer plus external disk changes | Preserve both versions and expose the conflict; do not silently choose a destructive resolution. | Do not automatically overwrite disk under the ordinary dirty-buffer rule. Offer explicit conflict resolution; building the disk version may remain available with clear notice. |

For the externally changed case, preserve in-memory text until an explicit user
choice resolves it. Clearly identify disk-based diagnostics because their
locations may not match the older buffer displayed in the editor. An explicit
save encountering a changed disk baseline must retain conflict handling.
Never silently discard a dirty buffer during launch or refresh. These are
agreed requirements, not implemented behaviour or a verified fix.

## 8. IntelliSense documentation in the existing Documentation Browser

The user proposed an “Open in Documentation Browser” action for code/symbol
documentation, reusing the existing Markdown documentation browser. They also
suggested a dedicated pane/window, similar to Pascal/Delphi documentation
browsing. Screenshots show a populated HashMap hover and the existing Docs
sidebar, whose project Markdown list is empty in this fixture.

Recommended direction discussed (proposal; not an implemented or fully agreed
feature specification):

- Keep hover as a quick preview and offer Open in Documentation Browser.
- Open persistent, read-only symbol documentation with signature, prose and
  code examples, using the existing Markdown renderer where appropriate.
- Keep language-server symbol documents separate from the project's .md file
  list; opening symbol docs must not create project Markdown files implicitly.
- Offer Back/Forward history, Pin, Go to Definition, documentation links and
  an optional split pane beside code.
- Label the source and symbol clearly, for example rust-analyzer · HashMap.
- Use language-server supplied documentation generically. Do not promise a full
  API/manual index or richer navigation when the server does not expose it.

Evidence: codex-clipboard-e7d776f9-4ede-44a1-a8b3-90f7043e7119.png,
codex-clipboard-ada929f9-931c-41a4-887d-7197ef158210.png,
codex-clipboard-20057940-00ea-4704-af2c-ac00578ca3c2.png.

C.1 observation: HashMap hover displays its Rust signature and rendered
explanatory documentation without obvious raw HTML in the screenshot. This
supports rendering behaviour; user readability/visual acceptance has not been
explicitly ratified. The documentation-browser idea is a UX proposal, not a
reason to silently mark unrelated checklist items passed.

## Historical mid-session handoff (superseded by final status below)

Next action: C.2, open fx-1c/src/shapes.rs and invoke Ctrl+Shift+O. Verify that
the outline displays the symbols with their proper nesting. Linked-window
startup/park/restore, workspace server-count checks, and the remaining Stage 1c
items are still open. Continue recording outside the checkout until the user
ends testing; do not restart window capture or edit watched repository files.

## 9. Stage 1c outline and definition-navigation observations

C.2: screenshot codex-clipboard-f0b3032a-01d7-4e3a-8ca8-7bb19a162c4b.png
shows nine symbols in shapes.rs, with parent-context labels such as Area geometry,
area Area, radius Circle, and circumference impl Circle. The user confirmed
selecting circumference and pressing Enter navigated to it, and additionally
reported that arrow-key navigation highlights/previews different methods.
Record C.2 as passed in this UI presentation; hierarchy appears through parent
labels rather than an indented tree.

C.3 partial: F12 on shared_value opened shared.rs at its definition; repeating
from main.rs focused the existing tab, as confirmed by the user. The user
clarified Circle behaviour: F12 on its use at shapes.rs line 11 navigates to
pub struct Circle at line 7; F12 on the struct declaration itself opens
References (4). Do not record this as references opening unexpectedly on a
single use-site definition request. The external HashMap read-only source-tab
check has not yet been performed/verified.

## 10. Agreed References preview UX proposal

The user demonstrated that the project-source References preview is currently
editable: typing aa after the radius field in shapes.rs changed the preview and
the underlying editor view (codex-clipboard-6ddb6666-bf89-4d47-9bfa-aa5f38a2aa40.png).
This is project source, not the HashMap external-source read-only test. The
assistant instructed undoing the test edit; undo completion is not confirmed.

The user proposed making this preview read-only and showing a clickable message
near the cursor when typing is attempted, then explicitly agreed to:

“Read-only preview · Open editable source”

Clicking the action should open the project source at the corresponding location
in the main editor, focusing an existing tab when present. Attempted typing in
the preview should not modify source. For an external source that is genuinely
read-only, explain the restriction instead of promising an editable version.
This is an agreed UX direction, not implemented behaviour; scope here is the
References preview discussed during testing, not an automatic policy change
for every editor or preview in the IDE.

## 11. Critical report: cross-document content replacement and dirty read-only source

During C.4 preparation, the user reports main.rs was replaced with HashMap/map.rs
source, says this has happened more than once, and reproduced the issue again
around editing and Shift+F12. Exact event order is not yet established.

The supplied pasted contents are 95,115 characters beginning with #[cfg(test)]
mod tests; and hashbrown imports, consistent with the external HashMap source.
A preserved copy remains at /tmp/craidd-human-checklist-findings/reported-main-rs-replacement.txt; it is not copied into project docs. This
is user-supplied alleged replacement content; it does not prove main.rs on disk
was overwritten.

Screenshot codex-clipboard-57df0fbd-de84-4c5c-81a3-4b47ca571922.png shows a dirty
dot on main.rs, and a lock glyph plus dirty dot on map.rs. A native save conflict
dialog says map.rs was modified on disk since opening and offers Overwrite.
Whether map.rs on disk changed, or its recorded baseline/identity was wrong, is
unverified. Do not infer a real SDK disk change from the dialog alone.

Treat as potential buffer corruption/data-loss and read-only enforcement failure.
C.3's earlier one-character typing rejection passed at that moment, but is not
sufficient for overall read-only acceptance after navigation/references. Reopen
that lifecycle portion. C.4 remains blocked/unverified.

The assistant has not reproduced the bug and has not edited application source.
Initial read-only inspection found CodeView supplies active.fileId as Monaco path,
active.content as controlled value, and a content-change callback writing to its
captured activeFileId. Model identity/callback timing during navigation is an
investigation lead, not a proven cause. No tests or checkout edits were run to
reproduce this during the live acceptance session.

Immediate guidance: do not Save, Overwrite, close affected tabs, restart or build.
Cancel the conflict dialog and preserve the buffers and visible source paths.
Inspect main.rs contents and read-only model lifecycle before further tests.

## Final recovery and handoff status — 16 November 2026

**Critical: potential cross-document buffer corruption and data loss. Testing
paused, not completed.** User explicitly authorised integrating these notes and
ticking verified results before handing off to Claude.

A subsequent screenshot conclusively shows the main.rs tab and breadcrumb
displaying HashMap implementation source. One Ctrl+Z restored the fixture
program, with stray aaxc remaining after its final println! and a dirty tab.
The final supplied screenshot shows that stray text removed and no dirty dot.
This establishes visible buffer replacement and undo recovery. It does not
prove the SDK source or main.rs on disk was overwritten, nor establish the
exact triggering sequence or mechanism. The user suspects the editable
Shift+F12 References viewer; treat that as a hypothesis.

C.3's initial typing-rejection result is superseded for lifecycle acceptance
by this blocker. C.4 and later navigation/reference tests remain incomplete.
A preview-only readOnly flag is not sufficient evidence that model identity,
change routing, tab content, save paths and backend write protection are safe.

Final checked items: **5.2, 5.3, 6.1, C.2**, with scope and timing caveats in
the [human checklist](human-checklist.md). All other items remain unchecked
with explicit partial/failure/not-tested notes. Do not certify Stage 1 complete.

### Preserved screenshots

- [Locked/dirty map.rs and conflict dialog](evidence/human-2026-11-16/locked-dirty-map-conflict.png).
- [HashMap content displayed as main.rs](evidence/human-2026-11-16/main-replaced.png).
- [One undo restores fixture with stray text](evidence/human-2026-11-16/undo-recovery.png).
- [Final visible fixture with no dirty dot](evidence/human-2026-11-16/final-visible-recovery.png).
- [Initial read-only source tooltip](evidence/human-2026-11-16/initial-readonly-tooltip.png).
- [Outline with parent labels](evidence/human-2026-11-16/outline.png).
- [Restored signature with old diagnostics](evidence/human-2026-11-16/external-revert-stale.png).
- [Corrected buffer after save clears errors](evidence/human-2026-11-16/save-clears-errors.png).

Earlier screenshot filenames in this chronological record refer to attachments
in the original chat; the selected evidence above is copied into the repository
so the critical handoff does not depend solely on temporary attachments.

### Related future design

[Editable library copies / dependency overrides](../../../future/future-library-source-customisation.md)
is a proposal, separate from the critical repair. Standard-library HashMap is
not replaceable through an ordinary package override. The agreed documentation
browser and read-only References preview proposals remain recorded above.

*Last updated: Phase 3 / Public Release Alpha human testing, 16 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
