# Profiler UI checks

Unity profiling's master checkbox and review cases are in
[the Unity UI/UX harness checklist](../../docs/uiux/unity-profiling-harness-checklist.md).
The [review handoff](../../docs/handoffs/handoff-unity-profiling-uiux-2026-10-16.md)
and [initial findings](../../docs/bugs/16-10-2026/unity-profiling-uiux-report.md)
record the user's current failures and required evidence.

This branch currently provides the browser-only `profiling.html` fixture:

```sh
npm run dev -- --host 127.0.0.1
```

Open the printed local URL followed by `/tests/ui/profiling.html`. It mounts
production components with synthetic data and mocked IPC. It can check layout,
benchmark selection and collapsibles. It cannot prove Unity attach, native
allocation events, real process ownership or Tauri font/asset behavior.

The real Tauri WebDriver harness found in another checkout at `280b1d8` has not
been integrated here. This branch does not yet provide `npm run test:ui` or a
real-app `unity-profiling.test.mjs` scenario. Adding those and running against
this branch's binary is U00; do not claim the historical harness results cover
this profiling implementation.
