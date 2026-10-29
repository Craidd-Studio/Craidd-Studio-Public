//! Server-to-frontend delivery for classes S, L and T. R and Q never pass
//! through here, so a stalled consumer cannot delay a response or leave a
//! server request unanswered.
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};

use serde::Serialize;
use serde_json::Value;

use super::caps::NegotiatedCaps;
use super::protocol::{Health, LogLine, ProgressKind, Snapshot};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase { Spawning, Initializing, Ready, ShuttingDown, Exited, Failed, Crashed }

impl Phase {
    pub(crate) fn is_terminal(self) -> bool { matches!(self, Self::Exited | Self::Failed | Self::Crashed) }
}

/// Class T: a fixed-size record, not a queue. Latest state wins; the
/// terminal phase is absorbing.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusRecord {
    pub generation: u64,
    pub phase: Phase,
    pub terminal_reason: Option<String>,
    /// Set once, when the session becomes Ready.
    pub caps: Option<NegotiatedCaps>,
    /// Documents needing resynchronisation, bounded by the open documents.
    pub resync: BTreeSet<String>,
    /// Incremented when the backend answers `workspace/diagnostic/refresh`
    /// with pull enabled. One re-pull covers any number of increments.
    pub refresh: u64,
    /// Incremented when the writer drains below its low-water mark, so the
    /// frontend retries resyncs and pulls that were not admitted. Event-driven.
    pub writer_room: u64,
    /// A resync could not be admitted within the bound: the server is not reading.
    pub unresponsive: bool,
    /// The server's latest health report; separate from the phase.
    pub health: Option<Health>,
    /// Decision 20 (V24): `None` when the server reports no workspace
    /// status; otherwise false until it reports `quiescent: true` with
    /// health other than `error`, and false again after a workspace reload.
    /// Pulls wait for it, because an earlier empty report proves nothing.
    pub workspace_ready: Option<bool>,
    /// Decision 20 fallback: the server declared status notifications but
    /// sent no ready report within the bound, so pulls proceed. Until real
    /// readiness, an empty report is not proof of zero diagnostics.
    pub ready_fallback: bool,
    /// `rust-analyzer/reloadWorkspace` requests sent (decision on V27).
    pub reloads: u64,
    /// V2: the latest server line that reports a file-watcher failure, raw.
    /// A warning on the chip; the line itself stays in Output.
    pub watcher_warning: Option<String>,
    /// Bumped on every change, so a delivery task sends only changed records.
    pub revision: u64,
}

impl StatusRecord {
    pub(crate) fn new(generation: u64) -> Self {
        Self { generation, phase: Phase::Spawning, terminal_reason: None, caps: None, resync: BTreeSet::new(),
            refresh: 0, writer_room: 0, unresponsive: false, health: None, workspace_ready: None, ready_fallback: false, reloads: 0, watcher_warning: None, revision: 0 }
    }

    /// Any non-phase field change goes through here so the revision moves.
    pub(crate) fn touch(&mut self, change: impl FnOnce(&mut Self)) {
        if self.phase.is_terminal() { return; }
        change(self);
        self.revision += 1;
    }

    /// A non-terminal transition. Refused once terminal.
    pub(crate) fn advance(&mut self, phase: Phase) -> bool {
        if self.phase.is_terminal() || phase.is_terminal() { return false; }
        self.phase = phase;
        self.revision += 1;
        true
    }

    /// Compare-and-set into a terminal phase: first cause wins. Only
    /// `Session::terminate` calls this.
    pub(crate) fn set_terminal(&mut self, phase: Phase, reason: &str) -> bool {
        if self.phase.is_terminal() || !phase.is_terminal() { return false; }
        self.phase = phase;
        self.terminal_reason = Some(reason.into());
        self.resync.clear();
        self.unresponsive = false;
        self.revision += 1;
        true
    }

    pub(crate) fn set_ready(&mut self, caps: NegotiatedCaps) -> bool {
        if self.phase != Phase::Initializing { return false; }
        self.caps = Some(caps);
        self.advance(Phase::Ready)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum Delivered {
    Diagnostics { uri: String, version: Option<i64>, diagnostics: Vec<Value> },
    ProgressBegin { token: String, value: Value },
    ProgressReport { token: String, value: Value },
    ProgressEnd { token: String, value: Value },
    /// `begin` and `end` both arrived before a delivery: one record, so a
    /// status can never be left saying "indexing".
    ProgressCompleted { token: String, begin: Value, end: Value },
}

#[derive(Default)]
struct Progress { begin: Option<Value>, latest: Option<Value>, end: Option<Value>, begin_delivered: bool }

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct CoalesceStats { pub superseded: u64, pub skipped_equal: u64, pub delivered: u64, pub discarded: u64 }

/// Class S: latest-wins per key, bounded by the number of distinct keys.
#[derive(Default)]
pub(crate) struct Coalescer {
    diagnostics: BTreeMap<String, (Option<i64>, Vec<Value>, usize)>,
    delivered: HashMap<String, u64>,
    progress: BTreeMap<String, Progress>,
    awaiting_ack: bool,
    pub stats: CoalesceStats,
}

fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf29ce484222325, |hash, byte| (hash ^ byte as u64).wrapping_mul(0x100000001b3))
}

impl Coalescer {
    pub(crate) fn push(&mut self, snapshot: Snapshot) {
        match snapshot {
            Snapshot::Diagnostics { uri, version, diagnostics } => {
                let bytes = diagnostics.iter().map(|d| d.to_string().len()).sum::<usize>() + uri.len();
                if self.diagnostics.insert(uri, (version, diagnostics, bytes)).is_some() { self.stats.superseded += 1; }
            }
            Snapshot::Progress { token, kind, value } => {
                let record = self.progress.entry(token).or_default();
                match kind {
                    ProgressKind::Begin => {
                        if record.begin.is_some() || record.latest.is_some() { self.stats.superseded += 1; }
                        *record = Progress { begin: Some(value), ..Progress::default() };
                    }
                    ProgressKind::Report if record.end.is_some() => self.stats.superseded += 1,
                    ProgressKind::Report => { if record.latest.replace(value).is_some() { self.stats.superseded += 1; } }
                    ProgressKind::End => {
                        if record.latest.take().is_some() { self.stats.superseded += 1; }
                        record.end = Some(value);
                    }
                }
            }
        }
    }

    pub(crate) fn keys(&self) -> usize { self.diagnostics.len() + self.progress.len() }

    /// The next batch, bounded by count and bytes. `None` while the previous
    /// batch is unacknowledged; entries keep coalescing meanwhile.
    pub(crate) fn take_batch(&mut self, max_count: usize, max_bytes: usize) -> Option<Vec<Delivered>> {
        if self.awaiting_ack { return None; }
        let mut out = vec![];
        let mut bytes = 0;
        let uris: Vec<String> = self.diagnostics.keys().cloned().collect();
        for uri in uris {
            if out.len() >= max_count || (bytes > 0 && bytes + self.diagnostics[&uri].2 > max_bytes) { break; }
            let (version, diagnostics, size) = self.diagnostics.remove(&uri).unwrap();
            let hash = fnv(&Value::Array(diagnostics.clone()).to_string());
            // An empty set is a real update; only a set equal to the last delivered one is skipped.
            if self.delivered.get(&uri) == Some(&hash) { self.stats.skipped_equal += 1; continue; }
            self.delivered.insert(uri.clone(), hash);
            bytes += size;
            out.push(Delivered::Diagnostics { uri, version, diagnostics });
        }
        let tokens: Vec<String> = self.progress.keys().cloned().collect();
        for token in tokens {
            if out.len() >= max_count { break; }
            let record = self.progress.get_mut(&token).unwrap();
            if !record.begin_delivered {
                if record.begin.is_some() && record.end.is_some() {
                    let (begin, end) = (record.begin.take().unwrap(), record.end.take().unwrap());
                    out.push(Delivered::ProgressCompleted { token: token.clone(), begin, end });
                    self.progress.remove(&token);
                    continue;
                }
                if let Some(value) = record.begin.take() {
                    record.begin_delivered = true;
                    out.push(Delivered::ProgressBegin { token: token.clone(), value });
                    continue;
                }
            }
            if let Some(value) = record.latest.take() {
                record.begin_delivered = true;
                out.push(Delivered::ProgressReport { token: token.clone(), value });
            } else if let Some(value) = record.end.take() {
                out.push(Delivered::ProgressEnd { token: token.clone(), value });
                self.progress.remove(&token);
            }
        }
        if out.is_empty() { return Some(out); }
        self.stats.delivered += out.len() as u64;
        self.awaiting_ack = true;
        Some(out)
    }

    pub(crate) fn has_pending(&self) -> bool {
        !self.diagnostics.is_empty() || self.progress.values().any(|p| p.begin.is_some() || p.latest.is_some() || p.end.is_some())
    }

    pub(crate) fn ack(&mut self) { self.awaiting_ack = false; }
    /// A batch that carried only status or log lines is acknowledged the same way.
    pub(crate) fn hold_until_ack(&mut self) { self.awaiting_ack = true; }
    pub(crate) fn awaiting_ack(&self) -> bool { self.awaiting_ack }

    /// Terminal session: pending S entries are discarded, like diagnostics
    /// from a dead session.
    pub(crate) fn discard_all(&mut self) {
        self.stats.discarded += (self.diagnostics.len() + self.progress.len()) as u64;
        self.diagnostics.clear();
        self.progress.clear();
        self.delivered.clear();
    }
}

/// Class L: lossy by declaration, oldest first, errors kept in preference.
/// Lines carry a sequence number so delivery can send only what is new.
pub(crate) struct LogRing { cap: usize, lines: VecDeque<(u64, LogLine)>, next: u64, pub dropped: u64 }

impl LogRing {
    pub(crate) fn new(cap: usize) -> Self { Self { cap, lines: VecDeque::new(), next: 0, dropped: 0 } }

    pub(crate) fn push(&mut self, line: LogLine) {
        self.next += 1;
        if self.cap == 0 { self.dropped += 1; return; }
        if self.lines.len() >= self.cap {
            let victim = self.lines.iter().position(|(_, l)| l.severity > 1).unwrap_or(0);
            self.lines.remove(victim);
            self.dropped += 1;
        }
        self.lines.push_back((self.next, line));
    }

    pub(crate) fn lines(&self) -> Vec<LogLine> { self.lines.iter().map(|(_, l)| l.clone()).collect() }

    /// Up to `max` lines after sequence `after`, and the last sequence
    /// number covered (lines dropped before delivery are skipped silently
    /// here; the `dropped` counter reports them).
    pub(crate) fn since(&self, after: u64, max: usize) -> (Vec<LogLine>, u64) {
        let lines: Vec<&(u64, LogLine)> = self.lines.iter().filter(|(seq, _)| *seq > after).take(max).collect();
        let last = lines.last().map(|(seq, _)| *seq).unwrap_or(if self.lines.is_empty() { self.next } else { after });
        (lines.into_iter().map(|(_, l)| l.clone()).collect(), last.max(after))
    }

    pub(crate) fn tail(&self, count: usize) -> Vec<String> {
        self.lines.iter().skip(self.lines.len().saturating_sub(count)).map(|(_, l)| l.text.clone()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp::protocol::LogSource;
    use serde_json::json;

    fn diags(uri: &str, items: Vec<Value>) -> Snapshot { Snapshot::Diagnostics { uri: uri.into(), version: None, diagnostics: items } }
    fn progress(token: &str, kind: ProgressKind) -> Snapshot { Snapshot::Progress { token: token.into(), kind, value: json!({"t": format!("{kind:?}")}) } }

    #[test]
    fn terminal_phase_is_absorbing_and_first_cause_wins() {
        let mut status = StatusRecord::new(1);
        assert!(status.advance(Phase::Initializing));
        assert!(!status.advance(Phase::Exited), "advance cannot enter a terminal phase");
        assert!(status.set_terminal(Phase::Crashed, "first"));
        assert!(!status.set_terminal(Phase::Failed, "second"));
        assert!(!status.advance(Phase::Ready));
        assert_eq!((status.phase, status.terminal_reason.as_deref()), (Phase::Crashed, Some("first")));
    }

    #[test]
    fn diagnostics_latest_wins_and_empty_sets_clear() {
        let mut s = Coalescer::default();
        s.push(diags("a", vec![json!(1)]));
        s.push(diags("a", vec![json!(2)]));
        let batch = s.take_batch(10, 1 << 20).unwrap();
        assert_eq!(batch, vec![Delivered::Diagnostics { uri: "a".into(), version: None, diagnostics: vec![json!(2)] }]);
        s.ack();
        s.push(diags("a", vec![]));
        assert_eq!(s.take_batch(10, 1 << 20).unwrap().len(), 1, "an empty clearing set is delivered");
        s.ack();
        s.push(diags("a", vec![]));
        assert!(s.take_batch(10, 1 << 20).unwrap().is_empty(), "equal to the last delivered set");
        assert_eq!(s.stats.skipped_equal, 1);
    }

    #[test]
    fn unacknowledged_batches_hold_and_keys_bound_memory() {
        let mut s = Coalescer::default();
        s.push(diags("a", vec![json!(1)]));
        assert_eq!(s.take_batch(10, 1 << 20).unwrap().len(), 1);
        for n in 0..10_000 { s.push(diags(if n % 2 == 0 { "a" } else { "b" }, vec![json!(n)])); }
        assert!(s.take_batch(10, 1 << 20).is_none(), "stalled consumer");
        assert_eq!(s.keys(), 2);
        s.ack();
        let batch = s.take_batch(10, 1 << 20).unwrap();
        assert!(batch.contains(&Delivered::Diagnostics { uri: "b".into(), version: None, diagnostics: vec![json!(9999)] }));
    }

    #[test]
    fn batches_are_bounded_by_count_and_bytes() {
        let mut s = Coalescer::default();
        for n in 0..5 { s.push(diags(&format!("u{n}"), vec![json!("x".repeat(100))])); }
        assert_eq!(s.take_batch(2, 1 << 20).unwrap().len(), 2);
        s.ack();
        assert_eq!(s.take_batch(10, 150).unwrap().len(), 1, "always progresses by at least one");
        s.ack();
        assert_eq!(s.take_batch(10, 1 << 20).unwrap().len(), 2);
    }

    #[test]
    fn progress_end_is_never_dropped() {
        let mut s = Coalescer::default();
        s.push(progress("t", ProgressKind::Begin));
        s.push(progress("t", ProgressKind::Report));
        s.push(progress("t", ProgressKind::End));
        s.push(progress("t", ProgressKind::Report));
        let first = s.take_batch(10, 1 << 20).unwrap();
        assert!(matches!(first.as_slice(), [Delivered::ProgressCompleted { .. }]), "{first:?}");
        s.ack();
        s.push(progress("u", ProgressKind::Begin));
        let second = s.take_batch(10, 1 << 20).unwrap();
        assert!(matches!(second.as_slice(), [Delivered::ProgressBegin { .. }]), "{second:?}");
        s.ack();
        s.push(progress("u", ProgressKind::Report));
        s.push(progress("u", ProgressKind::End));
        assert!(matches!(s.take_batch(10, 1 << 20).unwrap().as_slice(), [Delivered::ProgressEnd { .. }]));
        s.ack();
        assert!(!s.has_pending() && s.keys() == 0);
    }

    #[test]
    fn log_ring_counts_drops_and_keeps_errors() {
        let mut ring = LogRing::new(3);
        let line = |severity: u8, text: &str| LogLine { source: LogSource::Log, severity, text: text.into() };
        ring.push(line(1, "error"));
        for n in 0..5 { ring.push(line(4, &format!("log {n}"))); }
        assert_eq!(ring.dropped, 3);
        assert_eq!(ring.tail(3), vec!["error", "log 3", "log 4"]);
        let (lines, last) = ring.since(0, 2);
        assert_eq!((lines.len(), last), (2, 5));
        let (lines, last) = ring.since(last, 10);
        assert_eq!((lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), last), (vec!["log 4"], 6));
        assert_eq!(ring.since(6, 10), (vec![], 6));
    }
}
