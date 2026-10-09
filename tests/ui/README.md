# UI harness

Drives the real Craidd Studio app through `tauri-driver` and collects evidence.
Design and decisions: [docs/uiux/design-ui-test-harness.md](../../docs/uiux/design-ui-test-harness.md).

Run it only when you mean to: Craidd windows open on your desktop during a run.

## Setup (once)

- Linux with WebKitGTK's `WebKitWebDriver` (Arch: part of `webkit2gtk-4.1`).
- `cargo install tauri-driver --locked`
- The labs' own toolchains for debugger scenarios (`dotnet`, `netcoredbg`, `lldb-dap`).

## Run

```sh
npm run test:ui:build   # debug build with the frontend embedded
npm run test:ui         # all scenarios, one at a time
node --test tests/ui/titles.test.mjs   # one scenario
```

Each run writes `test-results/ui/<timestamp>/<scenario>/` (gitignored):
screenshots, `record.json` (steps and the app's stderr), and the scratch
`home/` the app used. Your own `~/.craidd-studio` is never read or written.

## Writing a scenario

- `launch(name)` from `lib/harness.mjs` starts the app on Get Started.
- `app.invoke(command, args)` calls a Tauri command from the current window.
  Linked-window commands must come from a window in that solution: switch
  with `app.wd.switchTo(handle)` first.
- Wait on observable state with `app.waitFor`, never on fixed sleeps.
- Screenshots show web content only. The shell's title bar, dock and
  Alt+Tab are checked by eye.
