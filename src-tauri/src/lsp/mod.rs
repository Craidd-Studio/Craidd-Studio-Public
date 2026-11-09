//! Language-server client (Phase 3, Stage 1: transport, sessions, documents
//! and diagnostics). See docs/feats/editor/intellisense/design-lsp-stage-1-rust.md.
//! Some pieces (navigation bindings, completion resolve) serve Stage 1c and
//! are reached only from tests until then.
#![allow(dead_code)]
pub(crate) mod framing;
pub(crate) mod protocol;
pub(crate) mod pending;
pub(crate) mod caps;
pub(crate) mod delivery;
pub(crate) mod documents;
pub(crate) mod session;
pub(crate) mod adapter;
pub(crate) mod router;
pub(crate) mod registry;
pub(crate) mod providers;
pub(crate) mod commands;
#[cfg(test)]
mod fake_server;
#[cfg(test)]
mod tests;
pub(crate) mod rust_adapter;
