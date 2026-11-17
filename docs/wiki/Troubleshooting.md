# Troubleshooting

## A tool or language server is missing

Confirm the executable is installed and available on `PATH`, then review the
selected tool path in User Preferences. Rescan an old saved tool list or select
the executable explicitly. A language declaration does not supply its compiler,
debugger or LSP implementation. C# debugging requires the appropriate adapter,
not just a working `dotnet` command.

## Rust diagnostics seem stale

Check the status chip's root/session, indexing/check progress, dirty state and
whether the result comes from the language server or a saved-source compiler
check. External disk edits, dirty buffers and server input are different states.
Record the exact edit/save/focus sequence before restarting to clear evidence.
Some freshness and linked-window acceptance cases remain open.

## Disk conflicts or unsaved edits during Run

Review which copy is on disk and which is in the editor. Do not use Overwrite
until you intend to replace disk content. Pending-save/reload repairs preserve
newer typing; a launch can pause and ask you to review source rather than silently
build a different snapshot. These regression checks do not close every reported
external-change case.

## External source or a References preview is read-only

This is expected for navigation-only source. Check the lock/reason and open the
editable project source when available. Editing a shared SDK/package cache is
not the standard library-customization workflow. A proposed local-library-copy
feature is not implemented by the read-only tab.

## A profiling result is partial or a symbol unresolved

Inspect loss, rejected-event, disconnect, coverage and retention indicators.
Ordinary history eviction is different from source loss. Preserve raw capture,
target identity, options and diagnostic text when reporting a failure. Unresolved
symbols are not evidence that a sample never occurred.

## A build/test/package fails

Read the first actionable tool/dependency error. Missing display/socket access,
missing runtime/adapters and unsupported package environments need their own
resolution; do not turn a skipped test into a pass. The internal Debian debug
package is not clean-machine installation qualification.

Report a minimal reproduction through [GitHub Issues](https://github.com/Craidd-Studio/Craidd-Studio-Public/issues), with build
identity, OS/desktop, tools and expected/actual behavior. Redact private data and
credentials. Preserve user files before attempting cleanup.

---

*Last updated: 17 November 2026. Author(s): ShinkuKira21.*
*This document is a record.*
