# Language Intelligence

## Current language-server scope

Rust is the integrated external language-server slice. Other project languages
can have build/debug configurations without having an integrated LSP provider.
The integrated terminal and additional language-server implementations are
separate work.

## Set up Rust

Install `rust-analyzer`, plus Rust source (`rust-src`) when you want navigation
into the standard library. Review the detected/selected tool in User Preferences;
rescan or select the executable explicitly when an old saved scan misses it.

Open a Rust file belonging to a declared project in a `.cln` solution. A server
is launched for an active eligible document, with server identity/root shown in
the language-server status chip. Initial indexing/checking can take longer than
a settled edit; first-run build work is not a fixed completion-latency promise.

## Available providers

| Action | Feature |
| --- | --- |
| Hover a symbol | Signature and documentation |
| Ctrl+Shift+O | Document symbols/outline |
| F12 | Go to Definition |
| Shift+F12 | References |
| Type a prefix and use the suggestion list | Completion, including supported auto-import acceptance |
| Problems panel and source markers | Server diagnostics |

Craidd-owned auto-import acceptance is designed to apply the primary edit and
additional edits together. Owned completion items are suppressed with multiple
cursors; plain word suggestions are a different source of completions.

## External source and symlinks

Definition/navigation can open returned SDK/library source in a read-only tab,
with a lock/reason. Restarting the server does not make that source writable.
A disconnected tab can require navigation from a live session to reconnect.
Symlink/vendor routing distinguishes aliases and canonical holders without
silently changing project ownership.

Freshness after external disk edits and linked-window/human acceptance remain
open. A compiler result about saved disk content can differ from an unsaved
buffer. See [Troubleshooting](Troubleshooting) and
[the Stage 1 checkpoint](https://github.com/Craidd-Studio/Craidd-Studio-Public/blob/master/docs/feats/editor/intellisense/checkpoint-phase-3-stage-1-2026-11-17.md).

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
