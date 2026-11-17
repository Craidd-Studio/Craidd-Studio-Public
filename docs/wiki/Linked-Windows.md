# Linked Windows

A solution can contain a client, API and native library. Use **File → Duplicate
Window** to give another project or instance its own IDE window. Windows for the
same solution form a linked group while retaining their selected configurations,
output and debugger sessions.

## White and Gold controls

**White** Build/Run/Debug/Stop controls address an individual session.
**Gold** controls coordinate eligible linked windows. Declared startup order and
readiness checks can start an API before its client; these are explicit solution
configuration, not guesses based on window order.

Follow [the linked startup guide](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/feats/linked-windows/linked-startup-guide.md)
for configuration syntax and the API/client example.

## Window tray

Use the tray to navigate windows and inspect their execution/debug contexts.
**Hide** parks an IDE viewport while its backend session can continue; **Show**
restores it. **Close** ends that window's instance. The application's own GUI
window is separate from its Craidd IDE window.

A viewed remote session is not permission to overwrite another window's dirty
buffer. Use the owning window to resolve edits/conflicts. Shared editing and
lifecycle behavior retain their recorded limits.

## Profiling ownership

Duplicating a window does not create a shared profiler-view session. The current
Profiler workspace is owned by its window; opening/closing its editor tab changes
presentation and does not itself stop collection. Do not assume a parked or
duplicated window is a second live viewer of another window's retained captures.

See [Profiling and Analysis](Profiling-and-Analysis) for collection and history,
and [Debugging and LDI](Debugging-and-LDI) for managed/native coordination.

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
