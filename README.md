# Craidd Studio

**Source alpha · Linux polyglot IDE**

Craidd Studio brings the projects in a solution into one place while letting
each running program have its own IDE window. Edit source, choose a project
configuration, build or debug it, then link windows when the work crosses
process or language boundaries. The interesting case is a client, an API and a
native library that you want to see *together*, without losing track of which
process owns which debugger.

This is an early alpha. The debugger and window workflows are useful to try,
but [acceptance work is still in progress](docs/roadmaps/Roadmap-v0.0.4A.md).
Expect to install the language toolchains and debugger adapters used by the
projects you open; Craidd discovers external tools rather than bundling them.

## Current feature set

The source tree integrates the following work. Feature availability and public
release acceptance are tracked separately in the [current release status](docs/releases/README.md).

| Area | Included in source |
| --- | --- |
| Projects | Template wizard for Rust, C#, C++, Tauri + React and ASP.NET Core; existing-code declarations and editable build/run/debug configurations |
| Editing | Source editor, split view, Markdown Docs browser and editable preview |
| Rust language intelligence | External `rust-analyzer`: diagnostics, hover, symbols, definition, references and completion; read-only external-source navigation |
| Debugging | External C#/Rust/C++ adapters, threads, Watch, value hover and linked-window workflows |
| Native profiling | Process attachment, Gold ranges, recording scopes, snapshots and an expanded Profiling editor tab |
| Analysis | Finished CSV metric inspection, timed Linux `perf` capture, call trees and symbol-location support |
| Unity experiments | Native target discovery and Play lifecycle profiling; explicit experimental managed C# attach through DotRush Mono |

Language intelligence currently has a Rust implementation; declaring another
project language does not imply its language server is integrated. Unity managed
attach, Mono naming and thread-control experiments retain their documented limits.
Craidd does not install or bundle your compilers, language servers or debugger adapters.

## Release status

The integrated source is available for early testing. The current local Debian
package is an **internal debug build**, not a qualified public binary release.
Human buffer-safety/usability acceptance, optimized performance and clean-machine
installation checks remain open. The integrated terminal, CSV live follow and
cross-session comparison are future work.

See the [17 November integration record](docs/handoffs/handoff-phase-3-prerelease-integration.md)
for exact tested revisions and remaining gates. A passing automated scenario is
scoped evidence; it does not establish acceptance of every language or workflow.

## Platform and prerequisites

- **Target:** Linux. Windows may be considered later; it is not a supported
  alpha platform.
- **Reported test environments:** Arch Linux with **GNOME 51.0 on Wayland**,
  and **ChromeOS** (version not recorded). Other distributions, desktops and
  display servers have not been confirmed by this project.
- **To run Craidd Studio from source:** Rust and Cargo, Node.js and npm, and
  the Linux development libraries needed to build a Tauri 2 application.
  Both `cargo` and `npm` need to be available on your `PATH`.
- **For Rust language intelligence:** install `rust-analyzer`; external standard-library source navigation also needs Rust source (`rust-src`). Select or rescan external tools in User Preferences.
- **For timed CPU sampling:** install Linux `perf` and use a system policy that permits profiling the selected target. Craidd does not change that policy.
- **To try the included debug labs:** install their own toolchains and
  adapters. The C# examples use the .NET 10 SDK and `netcoredbg`; Rust and
  C++ debugging use `lldb-dap`. Native examples also need CMake and a C++17
  compiler. The C++ GUI in the MT lab needs GTK4 development files.

From the repository root:

```sh
npm install
npm run tauri dev
```

`npm run build` checks and builds the frontend; `cargo test --lib` from
`src-tauri/` runs the Rust library tests. The labs can require their own first
package restore, such as NuGet packages for the Avalonia GUI or npm packages
for the Rust Tauri GUI. See each lab's README before starting it.

## Create a project

From Getting Started, choose **Create Project Wizard**:

1. Choose a language and an available template. Entries labelled **Planned**
   are visible design directions and cannot be created yet.
2. Set the project name and parent location. The destination must be new or
   empty. Keep **Set up build, run, and debug configurations** enabled when
   you want generated Power configurations.
3. Choose **Review project** to inspect the proposed files, configurations and
   tool requirements, then **Create project** to write and open it.

Available templates include Rust Empty/Console and Tauri v2 + React;
C# Empty/Console and ASP.NET Core Web API; and C++ Empty/Console. Creating a
framework scaffold does not install its dependencies or qualify every debug path.
The integrated native smoke currently covers the Rust console creation/build/run
journey; the other template acceptance cases remain separate.

**From a folder that already has code:**

1. **File → Open Folder…** to the folder that contains the code. If Craidd
   doesn't find a `.cln`, the Solution Explorer again shows the "No solution"
   banner — but you don't need the dialog this time.
2. In **File Discovery** (the lower sidebar), right-click the folder you want
   to declare and choose **Make This a Project…**.
3. `MakeProjectDialog` opens with language detection already filled in from
   the folder contents (e.g. *"Suggested Rust: 3 .rs files"*). Confirm or
   change it, optionally attach a Config facet or Fine Tune after creation,
   and click **Create Project**. A `.craidd` is written into that folder and
   the solution is created or updated to reference it.

**After the project exists:**

- The Solution Explorer shows it with a language-filtered tree. Files that
  don't match the declared language won't appear there — use File Discovery
  if you need to see everything on disk.
- The Configurations dialog (**Configurations chip → Add / Edit
  Configurations…**) lists anything inferred from the project's manifests and
  lets you add your own named Build / Run / Debug entries.
- To add more projects to the same solution, repeat either path — the "No
  solution" banner is gone once a `.cln` exists, so use File Discovery's
  right-click menu, or **Project → Add → New Blank Project…** from the
  menu bar if you want the dialog again.

A `.craidd` marker is small on purpose — name, language, root, optional
config facet, optional membership overrides. Everything else about the
project (what it builds, how it builds, what dependencies it has) is read
from the ecosystem's own manifest at build time, never duplicated into the
marker. See [the `.craidd` and `.cln` model](docs/craidd-cln-model.md) for
the reasoning.

## Why Linked Windows?

A `.cln` solution can contain several projects. Open it with **File → Open
Solution…**, then use **File → Duplicate Window** to give another project or
another instance its own Craidd IDE window. Windows on the same solution form
a linked group, while each keeps its selected project, configuration, output
and debugger session.

The **white** Build, Run, Debug and Stop controls address one session at a
time. The **gold** controls coordinate eligible windows in the group: for
example, start an API, wait for its health endpoint, then start a client.
The [linked startup guide](docs/feats/linked-windows/linked-startup-guide.md)
shows how to set the order and readiness check.

The window tray at the upper right shows the group's IDE windows. You can
see which instance is running or paused, inspect another window's debug
context, or **Hide** an IDE window while its backend session keeps running.
**Show** brings it back; **Close** ends that instance. A program's own GUI
window is separate from these IDE windows. Shared writable editing across
window views is still being developed, so treat the window tray primarily as
a way to navigate and inspect live sessions. Read more in the
[Linked Windows design](docs/feats/linked-windows/design-linked-window-manager.md).

## Try Live Driver Injection (LDI)

LDI makes a managed-to-native call visible across linked IDE windows. A
**blue Native Debugging Breakpoint** marks the C# call site in window A. When
you start **Gold Linked Debug** and that call is reached, A holds while a
native driver reproduces the call under the debugger in window B. A **red**
breakpoint in C++ can choose where B lands. After B finishes, A makes its own
original call; B's result is not substituted into A's process.

| Start with | Open this solution | Windows and first action |
| --- | --- | --- |
| [LDI GUI Lab](workspaces/ldi-gui-lab/README.md) | [`workspaces/ldi-gui-lab/ldi-gui-lab.cln`](workspaces/ldi-gui-lab/ldi-gui-lab.cln) | A: **GUI · Local**. Duplicate the IDE window for B: **Native · LDI**. Set blue at the `NativeMath.Add` call, then use **Gold Linked Debug** and click **Call C++** in the app. The lab README gives the exact source line and optional red stop. |
| [LDI Interop Playground](workspaces/ldi-interop-playground/README.md) | [`workspaces/ldi-interop-playground/ldi-interop-playground.cln`](workspaces/ldi-interop-playground/ldi-interop-playground.cln) | A: **GUI · Local**; B: **Native · Scalar LDI**; C: **Native · Packet LDI**. Try scalar and UTF-8 packet calls, with automatic native entry or a matching red breakpoint. |
| [Rust + C++ native playground](workspaces/ldi-rust-native-playground/README.md) | [`workspaces/ldi-rust-native-playground/ldi-rust-native-playground.cln`](workspaces/ldi-rust-native-playground/ldi-rust-native-playground.cln) | A: **Rust · Local**; B: **Native · Scalar**. Use **White Debug** in A. This pairing inspects Rust's original process under one LLDB session; it does not create a second driver process. |

The playgrounds explain their own prerequisites and supported call shapes.
LDI does not replay arbitrary pointer ownership or every native call. Begin
with the GUI lab if this is your first linked debug session.

## Try multi-thread (MT) debugging

Open [`workspaces/mt-lab/mt-lab.cln`](workspaces/mt-lab/mt-lab.cln) and follow
the [Multi-Thread Lab guide](workspaces/mt-lab/README.md). It contains C#,
Rust and C++ console and GUI programs with basic, burst, handoff and native
call scenarios. Choose a console **Debug Basic** configuration, place a breakpoint
at a `BREAK_` comment, and use **Threads** beside Continue to inspect each
worker's stack, locals and source.

For MT together with managed LDI, use **C# GUI · MT + LDI** in window A and
**Native · LDI** in a linked window B. The lab guide walks through the native
worker variant and the ordered seven-caller scenario. Those seven callers
take turns; the example does not run seven independent LDI reproductions at
once. Selecting a thread chooses what to inspect and where to send Step, but
the debugger adapter may resume other threads too.

### Step by Thread experiments

Start with the [Step by Thread experiment guide](experiments/README.md) for
the two debugger routes, exact `.cln` solutions, counter checks, linked-window
ownership and recovery steps.

The ⇥ control requests **one Step Over on the selected thread** from an
all-thread stop at a source line. Ordinary ↷, ↓, ↑ and Continue keep their
debugger-dependent scope. A waiting thread can still block progress, so Pause,
the experiment recovery controls, and Stop remain important.

**Rust, C and C++:** The [native thread-control experiment](experiments/lldb-native-thread-control/README.md)
uses the installed `lldb-dap` and LLDB's built-in scripting API. It needs no
custom debugger build. Direct two-worker probes passed, and the user reported
working thread switching and stepping in the Craidd desktop lab on Linux with
LLDB-DAP 23.1.1. This is a bounded experiment, not a guarantee for every
program or LLDB version. The C fixture currently uses Craidd's CMake/C++
project route.

**Craidd Studio — C# Step by Thread:** The C# experiment works with an
experiment-specific build of [Samsung's netcoredbg](https://github.com/Samsung/netcoredbg)
made from a pinned upstream revision and the tracked Craidd experiment patch.
The ordinary installed `netcoredbg` did not provide this control in our tests.
The source checkout includes a [patched Linux x64 experiment build](experiments/netcoredbg-thread-control/debugger/linux-x64/BUILD.md)
beside the patch and fixtures. Craidd does not select it by default or put it
in the app bundle. To test C# ⇥, select its `netcoredbg` executable in
**File → User Preferences → Toolchain → C# → Debugger**. The
[C# experiment guide](experiments/netcoredbg-thread-control/README.md)
has the exact path, rebuild steps and recovery procedure. The C# managed
desktop A/B counter check still needs a fresh run. This build is bounded to
the pinned Samsung revision and Linux x64; a future standard debugger
capability could remove the need for the patch.

The [per-thread execution design](docs/feats/mt-debugging/design-per-thread-execution-control.md)
records the control boundaries and remaining validation work.

## What to expect from this alpha

Use the included labs and disposable projects to explore the supported paths.
When reporting a problem, include the commit or build identifier, Linux distro
and desktop, tool/adapter versions, solution and configuration, reproduction
steps, and expected versus observed behavior. Redact private paths, tokens and
project content before sharing logs or screenshots.

Start with the [documentation index](docs/README.md) for the project model,
feature designs and current plans.

## Existing clones after the repository move

If your public clone still points to the old repository location, update its
remote URL. A separate staging clone can retain its staging `origin` and use
`public` for this repository.

```bash
git remote set-url origin git@github.com:Craidd-Studio/Craidd-Studio-Public.git
git remote -v
```
