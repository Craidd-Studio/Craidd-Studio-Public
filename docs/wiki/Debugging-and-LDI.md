# Debugging and LDI

## Ordinary debugging

Install the language's toolchain and a compatible external debugger adapter.
The included C# labs use .NET 10 and `netcoredbg`; native Rust/C++ workflows use
`lldb-dap`. Select the owning project and a Debug configuration, set a source
breakpoint and start White Debug. Inspect the selected frame's stack, locals and
Watch expressions. Source hover values require an appropriate stopped context.

Start with [the C#/Rust/C++ MT lab](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/workspaces/mt-lab/README.md).
Select a basic console case before adding GUI or linked-native complexity.

## Threads

The Threads control selects an inspection/step target. It does not guarantee
that an adapter freezes every other thread. Ordinary step behavior depends on
the adapter and runtime, including waiting/blocked threads.

The separate [Step by Thread experiments](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/experiments/README.md)
record bounded native LLDB and patched-netcoredbg routes. The C# experiment
needs its explicitly selected experimental adapter; the ordinary installed
adapter did not establish the same control. Experimental binaries are not
selected automatically as the standard debugger.

## Live Driver Injection

In managed-to-native LDI, a blue call-site breakpoint in C# window A holds that
origin while a native driver reproduces a supported call under a debugger in
window B. A red C++ breakpoint can choose the native stop. After reproduction,
A makes its own original call: B's result is not substituted into A's program.

Use [the LDI GUI lab](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/workspaces/ldi-gui-lab/README.md) first.
The [interop playground](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/workspaces/ldi-interop-playground/README.md)
adds scalar/packet cases. Declared-origin handling supports duplicated managed
windows without guessing an origin from focus/order; review prompts before
moving an origin that owns blue breakpoints.

The [Rust/C++ route](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/workspaces/ldi-rust-native-playground/README.md)
inspects Rust's original process in one LLDB session. It does not create a second
managed-style driver process.

Pointer ownership, arbitrary calls and concurrent LDI origins are not generally
qualified. Unity managed attach is a separate experiment, not Unity LDI support.

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
