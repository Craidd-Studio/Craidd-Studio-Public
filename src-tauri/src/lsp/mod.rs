//! Language-server client (Phase 3, Stage 1a: transport and session
//! foundation). See docs/feats/editor/intellisense/design-lsp-stage-1-rust.md.
//! Nothing here starts a server yet: the editor bridge and the Tauri
//! commands that call `LspRegistry::revalidate_and_ensure` arrive in Stage 1b,
//! so until then most of this module is only reached from tests.
#![allow(dead_code)]
pub(crate) mod framing;
pub(crate) mod protocol;
pub(crate) mod pending;
pub(crate) mod caps;
pub(crate) mod delivery;
pub(crate) mod session;
pub(crate) mod adapter;
pub(crate) mod router;
pub(crate) mod registry;
#[cfg(test)]
mod fake_server;
#[cfg(test)]
mod tests;
pub(crate) mod rust_adapter;
