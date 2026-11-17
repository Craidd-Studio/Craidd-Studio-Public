<img src="public/CHeart.svg" alt="Craidd Studio logo" width="150">

# Craidd Studio

**Open-source · Linux-first · Polyglot IDE · Early Alpha**

## What is Craidd Studio?

Craidd Studio is a solution-first IDE for projects that span languages and
processes. A `.cln` solution brings projects together while each keeps its own
configuration, external tools and execution context. Linked IDE windows let you
work across a client, API and native library while keeping their sessions visible.

## Features

| Area | Capabilities | Documentation |
| --- | --- | --- |
| Projects & editing | Template wizard, existing-code projects, split editor and Markdown preview | [Project model](docs/craidd-cln-model.md) · [Docs browser](docs/feats/editor/docs-viewer/README.md) |
| Language intelligence | Rust diagnostics, completion, hover, symbols and navigation through `rust-analyzer` | [Rust LSP](docs/feats/editor/intellisense/design-lsp-stage-1-rust.md) |
| Debugging | C#/Rust/C++ adapters, threads, Watch and value hover | [Debugging lab](workspaces/mt-lab/README.md) |
| Linked windows & LDI | Independent sessions, coordinated launches and managed/native inspection | [Linked startup](docs/feats/linked-windows/linked-startup-guide.md) · [LDI](docs/feats/ldi-debugging/design-ldi-debugging.md) |
| Profiling & analysis | Process/Gold profiling, scopes, snapshots, CSV metrics and timed Linux `perf` | [Profiler](docs/feats/profiling/design-profiler-workspace-modes.md) · [Analysis](docs/feats/profiling/design-profiler-analysis-ui.md) |
| Unity experiments | Native discovery/profiling and experimental managed C# attach | [Unity documentation](docs/unity/README.md) |

## Getting Started

Install Rust/Cargo, Node.js/npm and the Linux development libraries required by
Tauri 2. Install the toolchains, language servers and debugger adapters for the
projects you want to use; Craidd discovers these external tools.

From the repository root:

```sh
npm install
npm run tauri dev
```

Choose **Create Project Wizard** on Getting Started, or open an existing folder
or `.cln` solution. See the [wiki](https://github.com/Craidd-Studio/Craidd-Studio-Public/wiki) for setup and workflow guides.

## Platform & Release Status

Linux is the current target. Development and desktop checks have used Arch
Linux with GNOME/Wayland, XWayland and isolated Xvfb displays. Other environments
need their own qualification; Windows and macOS are not supported alpha targets.

This is an early source alpha. Rust language intelligence and the profiling,
Unity and thread-control experiments retain documented limits. Human acceptance,
optimized performance and clean-machine package testing remain open; the local
debug package is an internal testing artifact.

## Documentation & Roadmap

- [Project wiki](https://github.com/Craidd-Studio/Craidd-Studio-Public/wiki) — user guides and workflows.
- [Technical documentation](docs/README.md) — architecture, designs, labs and evidence.
- [Roadmap](docs/roadmaps/Roadmap-v0.0.4A.md) — current work and future plans.
- [Release status](docs/releases/README.md) — tested scope and remaining gates.

## Contributing

Code, documentation, testing and design contributions are welcome. Use
[GitHub Issues](https://github.com/Craidd-Studio/Craidd-Studio-Public/issues) to
report bugs or discuss substantial changes. Include your build/commit, Linux
environment, tool versions and reproduction steps; redact private project data
and secrets from shared logs. See the [working protocol](docs/working-protocol.md)
for the project's collaboration approach.

Licensed under [Apache 2.0](LICENSE).
