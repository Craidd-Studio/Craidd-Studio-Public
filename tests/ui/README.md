# Real Tauri and Unity UI/UX harness

The shared W3C WebDriver client, launcher and four original scenarios were
imported deliberately from `uiux/ui-harness` at `280b1d8`. Current source and
binary come from `feat/unity/profiling-a-to-p`; unrelated branch changes were
not merged. `tauri-driver` and `WebKitWebDriver` are discovered installed tools.
This is Linux desktop testing; it needs a display, Node, Rust, CMake and an
installed Unity Editor matching `workspaces/unity/ProjectSettings/ProjectVersion.txt`.
Set `UNITY_EDITOR` if the executable is outside the usual Unity Hub directory.

```sh
npm run test:ui:build
npm run test:ui:profiling
npm run test:ui:profiling:long
```

The targeted suite has five tests:

- Profiler SVG icons, cold/no file and with Monaco open, in the real webview.
- Diagnostic overlay in a separate graphical Unity copy, with a Game capture.
- Batch-mode Unity at 60 fps: UI Attach, Play, native menu Allocate/Clear,
  immutable snapshots staying Live, 288/360/420 px layouts, keyboard focus,
  thread/batch inspection, Record again/late free, repeat Play and safe Stop.
- The same batch-mode native profiling flow uncapped, past 2,000 raw hits.
  The long command additionally runs through the real 2,400-sample window.
- Forced source disconnect, pinned late free, abrupt death of the verified
  harness-owned host, artifact cleanup, and reconnection to a replacement host
  without restarting the disposable Editor.

Unity cases are opt-in with `CRAIDD_TEST_UNITY=1`, supplied by the targeted
package scripts. `npm run test:ui` also runs the four original scenarios and
skips Unity cases unless opted in. Two general-UI baseline cases currently
fail (hover value and explorer edge placement); see the report. Do not report
that entire suite as green because the targeted profiling suite passes.

Every launch has scratch HOME/config/cache/data, an explicit profiling
namespace, and separate intermediary/native WebDriver ports. Unity projects
are copied from tracked fixture sources into `/tmp/cui-*`; no original
Library, plugin binary, user settings or untracked files are copied. A fresh
native plugin is built there. The user's live Editor is never selected,
attached, clicked, restarted or used for commands. The intentional SIGKILL
requires namespace, process birth, executable and driver-ancestry proof.

Evidence goes to ignored `test-results/ui/<timestamp>/<scenario>/`: screenshots,
record.json, native build output, source/plugin hashes, Unity logs and file
signals. The final state is captured on cleanup, including failures. Large
caches are removed only from the harness's exited disposable copy. Raw engine
logs may contain machine details; share selected redacted evidence, not a home
or credential export. Original workspace plugin builds are left to the user
when they choose to close/reload their Editor.

A development URL binary can be selected with `CRAIDD_UI_APP`; the default is
the embedded debug executable. CSP is never relaxed by this harness. The
[Monaco CSP proposal](../../docs/uiux/proposal-monaco-csp-styles.md) still needs
user approval.

The [Unity checklist](../../docs/uiux/unity-profiling-harness-checklist.md)
records acceptance; the [repair report](../../docs/bugs/16-10-2026/unity-profiling-final-report.md)
records exact commands, results and remaining limits.

## Separate synthetic fixture

`npm run dev -- --host 127.0.0.1` exposes `/tests/ui/profiling.html`.
That browser-only fixture mounts production components with synthetic data and
mocked IPC. It is useful for presentation changes and cannot certify Unity
allocation, process ownership, lifecycle or embedded CSP behavior.
