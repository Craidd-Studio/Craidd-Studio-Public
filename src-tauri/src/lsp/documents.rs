//! The per-session document table: which documents are open on the
//! server, their versions and sync epochs, and the deterministic desync
//! protocol (design: "Desynchronisation and writer-queue overflow").
//!
//! The Monaco model is the only text authority. The table holds no text:
//! every `didOpen` and resync carries text the frontend read from the model
//! at that moment, so nothing is ever reconstructed or replayed.
use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use super::framing::encode;
use super::protocol::notification_body;

/// Admits packets all or none. The session's sink writes through its
/// writer; tests script capacity.
pub(crate) trait Sink {
    fn admit(&mut self, packets: Vec<Vec<u8>>) -> Result<(), Refused>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refused { Full, Closed }

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub(crate) enum DocState {
    Synced,
    /// Further edits only set `changed`; nothing is queued until the resync.
    Desynced { reason: String, changed: bool },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocView { pub uri: String, pub version: i64, pub epoch: u64, pub sync: DocState }

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum DocError {
    NotOpen,
    Closed,
    /// The session's validated sync is unusable; documents are not opened.
    Unsupported { reason: String },
    /// The writer could not take a `didOpen`; the document stays unopened.
    Busy,
}

struct Doc { language_id: String, version: i64, epoch: u64, sync: DocState, desynced_at: Option<Instant> }

#[derive(Default)]
pub(crate) struct DocTable { docs: HashMap<String, Doc>, pub stats: DocStats }

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocStats { pub changes_sent: u64, pub desyncs: u64, pub resyncs: u64, pub stale_epoch_changes: u64 }

fn did_open(uri: &str, language_id: &str, version: i64, text: &str) -> Vec<u8> {
    encode(&notification_body("textDocument/didOpen", json!({
        "textDocument": { "uri": uri, "languageId": language_id, "version": version, "text": text },
    })))
}

fn did_close(uri: &str) -> Vec<u8> {
    encode(&notification_body("textDocument/didClose", json!({ "textDocument": { "uri": uri } })))
}

impl Doc {
    fn view(&self, uri: &str) -> DocView { DocView { uri: uri.into(), version: self.version, epoch: self.epoch, sync: self.sync.clone() } }
}

impl DocTable {
    pub(crate) fn is_open(&self, uri: &str) -> bool { self.docs.contains_key(uri) }
    pub(crate) fn len(&self) -> usize { self.docs.len() }
    pub(crate) fn view(&self, uri: &str) -> Option<DocView> { self.docs.get(uri).map(|doc| doc.view(uri)) }
    pub(crate) fn version(&self, uri: &str) -> Option<i64> { self.docs.get(uri).map(|doc| doc.version) }

    /// Idempotent: re-activation of an open document sends nothing.
    pub(crate) fn open(&mut self, sink: &mut dyn Sink, uri: &str, language_id: &str, text: &str) -> Result<DocView, DocError> {
        if let Some(doc) = self.docs.get(uri) { return Ok(doc.view(uri)); }
        match sink.admit(vec![did_open(uri, language_id, 1, text)]) {
            Ok(()) => {}
            Err(Refused::Full) => return Err(DocError::Busy),
            Err(Refused::Closed) => return Err(DocError::Closed),
        }
        let doc = Doc { language_id: language_id.into(), version: 1, epoch: 1, sync: DocState::Synced, desynced_at: None };
        let view = doc.view(uri);
        self.docs.insert(uri.into(), doc);
        Ok(view)
    }

    /// One `didChange` carrying the batched `contentChanges` in order. A
    /// change the writer cannot take, or one sent against an older epoch,
    /// desyncs the document: the change is discarded and never replayed.
    pub(crate) fn change(&mut self, sink: &mut dyn Sink, uri: &str, epoch: u64, changes: Vec<Value>, now: Instant) -> Result<DocView, DocError> {
        let Some(doc) = self.docs.get_mut(uri) else { return Err(DocError::NotOpen); };
        if let DocState::Desynced { changed, .. } = &mut doc.sync { *changed = true; return Ok(doc.view(uri)); }
        if epoch != doc.epoch {
            self.stats.stale_epoch_changes += 1;
            Self::desync(doc, &mut self.stats, "a change arrived for an older epoch", now);
            return Ok(doc.view(uri));
        }
        let version = doc.version + 1;
        let packet = encode(&notification_body("textDocument/didChange", json!({
            "textDocument": { "uri": uri, "version": version }, "contentChanges": changes,
        })));
        match sink.admit(vec![packet]) {
            Ok(()) => { doc.version = version; self.stats.changes_sent += 1; }
            Err(Refused::Closed) => return Err(DocError::Closed),
            Err(Refused::Full) => Self::desync(doc, &mut self.stats, "the writer queue was full", now),
        }
        Ok(doc.view(uri))
    }

    fn desync(doc: &mut Doc, stats: &mut DocStats, reason: &str, now: Instant) {
        doc.epoch += 1;
        doc.sync = DocState::Desynced { reason: reason.into(), changed: false };
        doc.desynced_at = Some(now);
        stats.desyncs += 1;
    }

    /// A desync detected by the frontend (EOL change, model replaced, a
    /// resume whose text hash differs).
    pub(crate) fn mark_desynced(&mut self, uri: &str, reason: &str, now: Instant) -> Result<DocView, DocError> {
        let Some(doc) = self.docs.get_mut(uri) else { return Err(DocError::NotOpen); };
        if !matches!(doc.sync, DocState::Desynced { .. }) { Self::desync(doc, &mut self.stats, reason, now); }
        Ok(doc.view(uri))
    }

    /// `didClose` + `didOpen` as one unit, with the model's text read at
    /// this moment. On admission the document is synced at its new epoch.
    pub(crate) fn resync(&mut self, sink: &mut dyn Sink, uri: &str, text: &str) -> Result<DocView, DocError> {
        let Some(doc) = self.docs.get_mut(uri) else { return Err(DocError::NotOpen); };
        if doc.sync == DocState::Synced { return Ok(doc.view(uri)); }
        let version = doc.version + 1;
        match sink.admit(vec![did_close(uri), did_open(uri, &doc.language_id, version, text)]) {
            Ok(()) => {
                doc.version = version;
                doc.sync = DocState::Synced;
                doc.desynced_at = None;
                self.stats.resyncs += 1;
                Ok(doc.view(uri))
            }
            Err(Refused::Closed) => Err(DocError::Closed),
            Err(Refused::Full) => Ok(doc.view(uri)),
        }
    }

    /// `didSave` after a successful save, never for a desynced document
    /// (its resync carries the text). `text` only when the server asked.
    pub(crate) fn save(&mut self, sink: &mut dyn Sink, uri: &str, text: Option<&str>) -> Result<DocView, DocError> {
        let Some(doc) = self.docs.get(uri) else { return Err(DocError::NotOpen); };
        if doc.sync != DocState::Synced { return Ok(doc.view(uri)); }
        let mut params = json!({ "textDocument": { "uri": uri } });
        if let Some(text) = text { params["text"] = Value::String(text.into()); }
        match sink.admit(vec![encode(&notification_body("textDocument/didSave", params))]) {
            Err(Refused::Closed) => Err(DocError::Closed),
            // A save notification is advisory: a full queue drops it and the
            // next save or change covers it. It is never retried later.
            Ok(()) | Err(Refused::Full) => Ok(doc.view(uri)),
        }
    }

    /// `didClose`. The entry is removed even if the writer is full, so a
    /// later `didOpen` is sent; the server then sees open-over-open (not
    /// verified against rust-analyzer) rather than a document with no text.
    pub(crate) fn close(&mut self, sink: &mut dyn Sink, uri: &str) -> Result<(), DocError> {
        if self.docs.remove(uri).is_none() { return Err(DocError::NotOpen); }
        match sink.admit(vec![did_close(uri)]) { Err(Refused::Closed) => Err(DocError::Closed), _ => Ok(()) }
    }

    /// Documents that need a resync, most recent desync last.
    pub(crate) fn desynced(&self) -> Vec<String> {
        let mut list: Vec<(&String, Instant)> = self.docs.iter().filter_map(|(uri, doc)| doc.desynced_at.map(|at| (uri, at))).collect();
        list.sort_by_key(|(_, at)| *at);
        list.into_iter().map(|(uri, _)| uri.clone()).collect()
    }

    /// True when some document has waited longer than `bound` for a resync.
    pub(crate) fn overdue(&self, now: Instant, bound: Duration) -> bool {
        self.docs.values().any(|doc| doc.desynced_at.is_some_and(|at| now.duration_since(at) >= bound))
    }

    /// Terminal session: every document leaves the table; nothing is sent.
    pub(crate) fn clear(&mut self) { self.docs.clear(); }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scripted capacity, and a server-side text model rebuilt from what
    /// was actually admitted, to prove nothing is lost or applied twice.
    #[derive(Default)]
    struct Script { room: usize, admitted: Vec<Value>, server: HashMap<String, String> }

    impl Sink for Script {
        fn admit(&mut self, packets: Vec<Vec<u8>>) -> Result<(), Refused> {
            if packets.len() > self.room { return Err(Refused::Full); }
            self.room -= packets.len();
            for packet in packets {
                let text = String::from_utf8(packet).unwrap();
                let body: Value = serde_json::from_str(text.split("\r\n\r\n").nth(1).unwrap()).unwrap();
                let uri = body["params"]["textDocument"]["uri"].as_str().unwrap().to_string();
                match body["method"].as_str().unwrap() {
                    "textDocument/didOpen" => { self.server.insert(uri, body["params"]["textDocument"]["text"].as_str().unwrap().into()); }
                    "textDocument/didClose" => { self.server.remove(&uri); }
                    "textDocument/didChange" => {
                        let text = self.server.get_mut(&uri).expect("change for an open document");
                        // Whole-text changes are enough to check ordering and duplication.
                        for change in body["params"]["contentChanges"].as_array().unwrap() { *text = change["text"].as_str().unwrap().into(); }
                    }
                    _ => {}
                }
                self.admitted.push(body);
            }
            Ok(())
        }
    }

    fn full(text: &str) -> Vec<Value> { vec![json!({ "text": text })] }
    const URI: &str = "file:///ws/src/main.rs";

    #[test]
    fn open_is_idempotent_and_versions_are_monotonic() {
        let (mut table, mut sink, now) = (DocTable::default(), Script { room: 10, ..Script::default() }, Instant::now());
        let opened = table.open(&mut sink, URI, "rust", "a").unwrap();
        assert_eq!((opened.version, opened.epoch), (1, 1));
        table.open(&mut sink, URI, "rust", "ignored").unwrap();
        assert_eq!(sink.admitted.len(), 1, "re-activation sends nothing");
        let changed = table.change(&mut sink, URI, 1, full("ab"), now).unwrap();
        assert_eq!(changed.version, 2);
        assert_eq!(sink.server[URI], "ab");
    }

    #[test]
    fn overflow_desyncs_discards_and_resyncs_without_replay() {
        let (mut table, mut sink, now) = (DocTable::default(), Script { room: 2, ..Script::default() }, Instant::now());
        table.open(&mut sink, URI, "rust", "a").unwrap();
        table.change(&mut sink, URI, 1, full("ab"), now).unwrap();
        // The writer is full: the change is refused and never sent later.
        let desynced = table.change(&mut sink, URI, 1, full("abc"), now).unwrap();
        assert!(matches!(desynced.sync, DocState::Desynced { changed: false, .. }));
        assert_eq!(desynced.epoch, 2, "results from epoch 1 are now stale");
        // Edits while desynced only set the flag.
        let flagged = table.change(&mut sink, URI, 2, full("abcd"), now).unwrap();
        assert!(matches!(flagged.sync, DocState::Desynced { changed: true, .. }));
        assert_eq!(table.desynced(), vec![URI.to_string()]);
        // One free slot is not enough for the pair: both or neither.
        sink.room = 1;
        assert!(matches!(table.resync(&mut sink, URI, "abcde").unwrap().sync, DocState::Desynced { .. }));
        assert_eq!(sink.admitted.len(), 2, "nothing of the pair was admitted");
        sink.room = 2;
        let synced = table.resync(&mut sink, URI, "abcde").unwrap();
        assert_eq!((synced.sync, synced.epoch, synced.version), (DocState::Synced, 2, 3));
        let methods: Vec<&str> = sink.admitted.iter().map(|m| m["method"].as_str().unwrap()).collect();
        assert_eq!(methods, ["textDocument/didOpen", "textDocument/didChange", "textDocument/didClose", "textDocument/didOpen"]);
        assert_eq!(sink.server[URI], "abcde", "the server's text equals the model's; no edit applied twice");
        assert!(table.desynced().is_empty());
        sink.room = 1;
        table.change(&mut sink, URI, 2, full("abcdef"), now).unwrap();
        assert_eq!(sink.server[URI], "abcdef", "normal queuing resumes at the new epoch");
    }

    #[test]
    fn a_change_for_an_older_epoch_is_an_order_loss() {
        let (mut table, mut sink, now) = (DocTable::default(), Script { room: 10, ..Script::default() }, Instant::now());
        table.open(&mut sink, URI, "rust", "a").unwrap();
        let view = table.change(&mut sink, URI, 0, full("x"), now).unwrap();
        assert!(matches!(view.sync, DocState::Desynced { .. }));
        assert_eq!(sink.server[URI], "a");
        assert_eq!(table.stats.stale_epoch_changes, 1);
    }

    #[test]
    fn the_unresponsive_bound_and_closing() {
        let (mut table, mut sink, start) = (DocTable::default(), Script { room: 1, ..Script::default() }, Instant::now());
        table.open(&mut sink, URI, "rust", "a").unwrap();
        table.change(&mut sink, URI, 1, full("b"), start).unwrap();
        assert!(!table.overdue(start + Duration::from_secs(9), Duration::from_secs(10)));
        assert!(table.overdue(start + Duration::from_secs(10), Duration::from_secs(10)));
        table.save(&mut sink, URI, None).unwrap();
        assert_eq!(sink.admitted.len(), 1, "no didSave for a desynced document");
        sink.room = 1;
        table.close(&mut sink, URI).unwrap();
        assert!(!table.is_open(URI) && !table.overdue(start + Duration::from_secs(60), Duration::from_secs(10)));
        assert_eq!(table.change(&mut sink, URI, 2, full("c"), start), Err(DocError::NotOpen));
    }

    #[test]
    fn a_full_writer_never_records_an_unsent_open() {
        let (mut table, mut sink) = (DocTable::default(), Script::default());
        assert_eq!(table.open(&mut sink, URI, "rust", "a"), Err(DocError::Busy));
        assert!(!table.is_open(URI));
    }
}
