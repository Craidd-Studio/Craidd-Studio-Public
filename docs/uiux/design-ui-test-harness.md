# UI test harness

**Roadmap track:** Phase 3.x tooling, supporting the UI/UX sweep and the wider Linux IDE gate. See the [current roadmap](../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal, 9 October 2026. Not implemented.

**Purpose:** Let an agent, or a contributor, run Craidd Studio, drive its UI
and collect evidence: screenshots, window titles and state. It covers the
[UI/UX sweep](design-public-release-sweep.md) checks without the user
clicking through each one. It is for checking work before the user tests,
not a replacement for the user's desktop testing.

---

## What can and cannot be automated

| Can | Cannot (the user still checks these) |
| --- | --- |
| Run the real Tauri app with the real backend and debug adapters (`netcoredbg`, `lldb-dap`). | GNOME's top bar, dock, Alt+Tab and the ChromeOS shelf. These show the shell's view of the window, which WebDriver cannot see. |
| Click, type and press keys in the webview, including Monaco and the menus. | Native dialogs: file pickers and GTK message boxes. |
| Read each window's title through the Tauri window API, and its DOM state. | Pixel-level look of the native title bar and window decorations. |
| Take screenshots of each window's web content. | Behaviour that depends on the user's real desktop session, focus stealing, or two monitors. |
| Open several windows (duplicate, hide/show) and switch between them by WebDriver window handle. | |

The harness's screenshots show the web content. A title check reads the
title text and makes no claim about how the shell displays it.

## Shape

- **Driver:** [`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/)
  in front of the installed `WebKitWebDriver` (`/usr/bin/WebKitWebDriver`,
  from `webkit2gtk-4.1`). `tauri-driver` is a discovered tool: a contributor
  installs it with `cargo install tauri-driver`, and Craidd does not bundle it.
- **Client:** a small W3C WebDriver client in `tests/ui/` using Node's
  `fetch`, with no new npm dependency. Scenarios are plain `node --test`
  files, run with `npm run test:ui`. They are not part of `npm run test:*`
  by default, because they need a display and a debug build.
- **Isolation:** each run uses a scratch `HOME` (with `CARGO_HOME` and
  `RUSTUP_HOME` passed through). It never reads or writes the user's
  `~/.craidd-studio`. Solutions open through a seeded `recent.toml`
  `last_session`, not through the file picker.
- **Labs:** scenarios open the existing `workspaces/*.cln` labs (MT Lab,
  Polyglot Lab, the LDI labs) in place. They write nothing inside the labs
  except build output that the labs already ignore.
- **Evidence:** screenshots and a JSON record per scenario in
  `test-results/ui/<timestamp>/`, which is gitignored. A failing step
  records its last screenshot.
- **Display:** the app runs on the user's session (`WAYLAND_DISPLAY`). Its
  windows appear on screen while a run is in progress. A headless compositor
  is a later option and is not part of this proposal.

## First scenarios

1. **Titles (R2 and the §1 acceptance table):**
   - open the MT Lab, then read the title after registration;
   - duplicate the window and read both titles;
   - change the configuration and read the title again;
   - pause at a breakpoint with the window unfocused, change the
     configuration, focus the window, and read the title.

   This also runs the R2 diagnosis.
2. **Context menus (R3):** right-click near each edge of a small window and
   check that the menu's bounding box stays inside the viewport. Then
   screenshot the menu.
3. **Debug keys (§5):** in the MT Lab C# console, press F9 on the `BREAK_`
   line, F5, F10, F11, Shift+F11 and F5, checking the paused line and the
   status after each key. Repeat for the Rust console.
4. **Watch and hover (§2, R1):** add a Watch expression, step, and check that
   the value changes. Hover a local and check that the hover shows its value.
5. **Exit (§6):** with a hidden window and a Gold run active, run Exit → This
   Application. Check that the app process ends and that no supervised child
   process is left.

## Trade-offs

- **Speed:** each scenario starts a debug build of the app, which takes
  seconds. Adapter-backed scenarios take longer. It is for checking a
  slice, not a tight edit loop.
- **Flakiness:** debugger timing varies. Steps wait on observable state (a
  paused line, a status label) with timeouts, never on fixed sleeps.
- **Disturbance:** windows open on the user's screen during a run, so runs
  start only as H2 allows.

## Decisions

Settled by the user on 9 October 2026.

- **H1.** The agent may install `tauri-driver` with `cargo install tauri-driver`.
- **H2.** Runs happen only when the user asks, or when the work has reached
  its testing stage. The user still checks results with their own eyes. No
  background or routine runs.
- **H3.** The harness lives in `tests/ui/` for all contributors. The
  reference environment is Arch Linux with GNOME on Wayland.

---

*Last updated: Phase 3.x, 9 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
