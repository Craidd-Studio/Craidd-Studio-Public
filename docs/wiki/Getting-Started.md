# Getting Started

## Prerequisites

Use Linux with Rust/Cargo, Node.js/npm and the Linux development libraries
needed to build Tauri 2. Read the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your distribution rather than copying another distribution's package list.

Install the tools for the projects you intend to open:

| Workflow | External tools |
| --- | --- |
| Rust build/run | Rust compiler and Cargo |
| Rust language intelligence | `rust-analyzer`; `rust-src` for standard-library source navigation |
| Rust/C++ debugging | A compatible `lldb-dap` installation |
| C++ examples | C++17 compiler and CMake; the MT GUI fixture also needs GTK4 development files |
| C# examples | .NET 10 SDK and `netcoredbg`; GUI examples may need their own package restore |
| Tauri + React projects | Node.js/npm, Rust/Cargo and Tauri Linux prerequisites |
| Timed CPU sampling | Linux `perf` and permission to profile the selected target |

Craidd discovers installed tools and lets you select paths in User Preferences.
It does not silently install a missing compiler, adapter or language server.

## Launch from source

```sh
git clone https://github.com/Craidd-Studio/Craidd-Studio-Public.git
cd Craidd-Studio-Public
npm install
npm run tauri dev
```

From an existing checkout, run the last two commands at the repository root.
To check the frontend separately, run `npm run build`.

## Your first project

1. On Getting Started, choose **Create Project Wizard**.
2. Start with **Rust → Console Application** and choose **Next**.
3. Set a project name and parent location. The destination must be new or empty.
4. Review the proposed files/configurations, then choose **Create project**.
5. Select an appropriate Build, Run or Debug configuration in the toolbar.

Alternatively, use **Open Folder** for existing code or **Open Solution** for a
`.cln`. Continue with [Solutions and Projects](Solutions-and-Projects).

The Rust console wizard has an automated native create/build/run smoke result.
That result does not qualify every template or language workflow. See
[Release Status and Roadmap](Release-Status-and-Roadmap) before distributing a build.

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
