# FUTURE: LSP recovery for a member project under a broken workspace root

**Roadmap track:** Phase 3 language intelligence, after Stage 1. Unscheduled. See the [current roadmap](../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Known limitation, accepted for Stage 1b ([decision 38](../feats/editor/intellisense/design-lsp-stage-1-rust.md#open-decisions-for-review)). The fix below is a direction, not a design. No stage is assigned.

**Applies to:** The Rust adapter's workspace reload ([design: Workspace reload](../feats/editor/intellisense/design-lsp-stage-1-rust.md#workspace-reload-decision-21)).

---

## The limitation

A member project does not recover by itself when its Cargo workspace's root
`Cargo.toml` was already broken when the session started.

Example: a workspace `fx-ws/` with a member crate `fx-ws/alpha/`.

1. The user opens a file in `alpha` while `fx-ws/Cargo.toml` is broken.
2. The Rust adapter runs `cargo metadata --no-deps` to find the workspace
   root. It fails, because the root manifest is broken.
3. The adapter falls back to the project folder, `fx-ws/alpha/`, as the
   session root.
4. The user fixes `fx-ws/Cargo.toml` and saves it.
5. A reload is sent only for an *affected* manifest (decision 33): the
   session's root manifest, or a member listed by the last successful
   `cargo metadata`. There never was a successful result, and the session
   root is `alpha/Cargo.toml`, so `fx-ws/Cargo.toml` is not affected. No
   reload is sent.
6. `rust-analyzer` stays in `error`. The status chip keeps its warning.

**Measured** (Verification lane, rust-analyzer 1 (9074e9b4c6 2026-09-06)):
the server stayed in `error` 45 s after the fix. One explicit
`rust-analyzer/reloadWorkspace` recovered it. Evidence is in
[results-lsp-stage-1.md](../feats/editor/intellisense/results-lsp-stage-1.md),
"Decision 33 follow-up verification", on `feat/lsp-stage-1b`.

**Recovery today:** press **↻ Restart** next to the status chip. The
restarted session runs `cargo metadata` again, which now succeeds and finds
the real workspace root.

**Why it was accepted:** decision 33 already accepts manual restart when
membership is unknown. This is the same gap, in the common case of opening a
member project, so it is named rather than fixed in Stage 1b.

---

## Possible future fix

Treat the **nearest ancestor `Cargo.toml`** above the fallback root as a
root candidate. A successful save of that manifest would then count as
affected for a session that fell back to its project folder.

This is a direction only. Questions to answer before it is designed:

- **Reload or restart.** Once the ancestor is fixed, the real root is
  `fx-ws/`, not `alpha/`. Under A1 a changed root is a new server identity,
  and decision 33 says a changed identity means a clean restart, not a
  reload. The fix is therefore probably an automatic restart under the new
  identity, which would also let `alpha` and its sibling members share one
  server as A1 intends. A `reloadWorkspace` recovers health but leaves the
  session on the wrong identity.
- **Which ancestor.** The nearest ancestor `Cargo.toml` may not be a
  workspace, or may be a separate crate that does not list the project as a
  member. The candidate should be confirmed by a successful `cargo metadata`
  that lists the project before the session changes identity.
- **Bounds.** How far up to look, and that `target/` and vendored
  directories are never candidates (decision 33).
- **Supervision.** `cargo metadata` stays supervised and never writes
  `Cargo.lock` (V8).
- **Evidence.** A real-server check, like U5 step 6b, that fixing the root
  restores health with no manual restart, and a negative check that a
  non-workspace ancestor does nothing.

Until then, the manual restart remains the documented recovery.

---

*Last updated: Phase 3 (Stage 1b, decision 38). Author: ShinkuKira21.*
*This document is a record.*
