//! Pending-request table. A cancelled request still gets a reply from the
//! server, so cancellation keeps the entry (as `Cancelled`) until that reply,
//! eviction or expiry. Ids are monotonic and never reused in a session.
use std::collections::BTreeMap;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::time::{Duration, Instant};

use super::protocol::Outcome;

enum State {
    Awaiting(SyncSender<Outcome>),
    Cancelled { since: Instant },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct PendingStats {
    pub delivered: u64,
    pub dropped_cancelled: u64,
    pub unknown: u64,
    pub evicted: u64,
    pub expired: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Disposition { Delivered, DroppedCancelled, Unknown }

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Busy;

pub(crate) struct PendingTable {
    cap: usize,
    cancelled_expiry: Duration,
    next_id: i64,
    entries: BTreeMap<i64, State>,
    pub stats: PendingStats,
}

impl PendingTable {
    pub(crate) fn new(cap: usize, cancelled_expiry: Duration) -> Self {
        Self { cap, cancelled_expiry, next_id: 1, entries: BTreeMap::new(), stats: PendingStats::default() }
    }

    /// Reserve an id. At the cap the oldest `Cancelled` entry is evicted
    /// first; only a table of `Awaiting` entries refuses with `Busy`.
    pub(crate) fn admit(&mut self, now: Instant) -> Result<(i64, Receiver<Outcome>), Busy> {
        self.expire(now);
        if self.entries.len() >= self.cap {
            let oldest = self.entries.iter().find(|(_, state)| matches!(state, State::Cancelled { .. })).map(|(id, _)| *id);
            let Some(oldest) = oldest else { return Err(Busy); };
            self.entries.remove(&oldest);
            self.stats.evicted += 1;
        }
        let id = self.next_id;
        self.next_id += 1;
        let (sender, receiver) = sync_channel(1);
        self.entries.insert(id, State::Awaiting(sender));
        Ok((id, receiver))
    }

    /// The caller gave up. It is woken with no result; the entry stays until
    /// the server's reply. Returns whether `$/cancelRequest` should be sent.
    pub(crate) fn cancel(&mut self, id: i64, now: Instant) -> bool {
        match self.entries.get_mut(&id) {
            Some(state @ State::Awaiting(_)) => {
                if let State::Awaiting(waker) = std::mem::replace(state, State::Cancelled { since: now }) {
                    let _ = waker.try_send(Outcome::NoResult);
                }
                true
            }
            _ => false,
        }
    }

    /// The request never reached the server (for example the writer was
    /// full), so no reply will come: remove it outright.
    pub(crate) fn abandon(&mut self, id: i64) {
        if let Some(State::Awaiting(waker)) = self.entries.remove(&id) { let _ = waker.try_send(Outcome::NoResult); }
    }

    pub(crate) fn on_response(&mut self, id: Option<i64>, outcome: Outcome) -> Disposition {
        match id.and_then(|id| self.entries.remove(&id)) {
            Some(State::Awaiting(waker)) => { let _ = waker.try_send(outcome); self.stats.delivered += 1; Disposition::Delivered }
            Some(State::Cancelled { .. }) => { self.stats.dropped_cancelled += 1; Disposition::DroppedCancelled }
            None => { self.stats.unknown += 1; Disposition::Unknown }
        }
    }

    pub(crate) fn expire(&mut self, now: Instant) {
        let before = self.entries.len();
        let expiry = self.cancelled_expiry;
        self.entries.retain(|_, state| !matches!(state, State::Cancelled { since } if now.duration_since(*since) >= expiry));
        self.stats.expired += (before - self.entries.len()) as u64;
    }

    /// Terminal state: every entry, `Awaiting` and `Cancelled`, resolves.
    pub(crate) fn resolve_all(&mut self) {
        for (_, state) in std::mem::take(&mut self.entries) {
            if let State::Awaiting(waker) = state { let _ = waker.try_send(Outcome::NoResult); }
        }
    }

    pub(crate) fn len(&self) -> usize { self.entries.len() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cancel_keeps_the_entry_until_the_reply_and_drops_that_reply() {
        let now = Instant::now();
        let mut table = PendingTable::new(4, Duration::from_secs(30));
        let (id, waiting) = table.admit(now).unwrap();
        assert!(table.cancel(id, now));
        assert_eq!(waiting.try_recv().unwrap(), Outcome::NoResult, "the caller is not left waiting");
        assert_eq!(table.len(), 1);
        assert_eq!(table.on_response(Some(id), Outcome::Result(json!(1))), Disposition::DroppedCancelled);
        assert_eq!(table.len(), 0);
        assert!(!table.cancel(id, now));
    }

    #[test]
    fn replies_are_delivered_once_and_unknown_ids_are_ignored() {
        let now = Instant::now();
        let mut table = PendingTable::new(4, Duration::from_secs(30));
        let (id, waiting) = table.admit(now).unwrap();
        assert_eq!(table.on_response(Some(id), Outcome::Result(json!("x"))), Disposition::Delivered);
        assert_eq!(waiting.try_recv().unwrap(), Outcome::Result(json!("x")));
        assert_eq!(table.on_response(Some(id), Outcome::Result(json!("x"))), Disposition::Unknown);
        assert_eq!(table.on_response(None, Outcome::NoResult), Disposition::Unknown);
        assert_eq!(table.on_response(Some(999), Outcome::NoResult), Disposition::Unknown);
        assert_eq!(table.stats, PendingStats { delivered: 1, unknown: 3, ..Default::default() });
    }

    #[test]
    fn ids_are_monotonic_and_never_reused() {
        let now = Instant::now();
        let mut table = PendingTable::new(2, Duration::from_secs(30));
        let mut seen = vec![];
        for _ in 0..20 {
            let (id, _) = table.admit(now).unwrap();
            table.on_response(Some(id), Outcome::NoResult);
            seen.push(id);
        }
        assert!(seen.windows(2).all(|pair| pair[1] > pair[0]));
    }

    #[test]
    fn eviction_prefers_cancelled_and_busy_only_when_all_await() {
        let now = Instant::now();
        let mut table = PendingTable::new(2, Duration::from_secs(30));
        let (first, _a) = table.admit(now).unwrap();
        let (_second, _b) = table.admit(now).unwrap();
        assert_eq!(table.admit(now).err(), Some(Busy));
        table.cancel(first, now);
        let (_third, _c) = table.admit(now).unwrap();
        assert_eq!(table.stats.evicted, 1);
        assert_eq!(table.on_response(Some(first), Outcome::NoResult), Disposition::Unknown, "evicted reply is ignored");
    }

    #[test]
    fn cancelled_entries_expire_and_terminal_resolves_everything() {
        let start = Instant::now();
        let mut table = PendingTable::new(8, Duration::from_secs(30));
        let (cancelled, _) = table.admit(start).unwrap();
        table.cancel(cancelled, start);
        table.expire(start + Duration::from_secs(31));
        assert_eq!((table.len(), table.stats.expired), (0, 1));
        let receivers: Vec<_> = (0..3).map(|_| table.admit(start).unwrap()).collect();
        table.cancel(receivers[0].0, start);
        table.resolve_all();
        assert_eq!(table.len(), 0);
        for (_, waiting) in &receivers[1..] { assert_eq!(waiting.try_recv().unwrap(), Outcome::NoResult); }
    }
}
