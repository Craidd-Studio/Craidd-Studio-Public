//! Provider request kinds (Stage 1c, decisions 40 and 41).
//!
//! One typed kind per LSP request; the frontend cannot ask a session for a
//! method the capability table did not validate, and there is no generic
//! "send any method" command. Timeouts and per-kind pending shares are ◇
//! initial values, set from G3 and G4 results; none is a budget.

use std::time::Duration;

use super::caps::NegotiatedCaps;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderKind { Hover, Definition, References, DocumentSymbol }

impl ProviderKind {
    pub(crate) fn method(self) -> &'static str {
        match self {
            ProviderKind::Hover => "textDocument/hover",
            ProviderKind::Definition => "textDocument/definition",
            ProviderKind::References => "textDocument/references",
            ProviderKind::DocumentSymbol => "textDocument/documentSymbol",
        }
    }

    /// Whether the validated capabilities allow asking for this kind.
    pub(crate) fn enabled(self, caps: &NegotiatedCaps) -> bool {
        caps.sync_unusable.is_none() && match self {
            ProviderKind::Hover => caps.hover,
            ProviderKind::Definition => caps.definition,
            ProviderKind::References => caps.references,
            ProviderKind::DocumentSymbol => caps.document_symbol,
        }
    }

    /// ◇ A timeout is "no result" and cancels the request.
    pub(crate) fn timeout(self) -> Duration {
        Duration::from_secs(match self {
            ProviderKind::Hover => 5,
            ProviderKind::Definition | ProviderKind::DocumentSymbol => 10,
            ProviderKind::References => 30,
        })
    }

    /// ◇ Most requests of this kind in flight across documents of one session,
    /// so references cannot starve the quick kinds of pending-table room.
    pub(crate) fn share(self) -> usize {
        match self {
            ProviderKind::References => 2,
            _ => 6,
        }
    }
}
