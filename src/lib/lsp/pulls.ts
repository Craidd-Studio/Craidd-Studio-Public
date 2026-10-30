import type { LspDiagnostic } from "./protocol.ts";

/**
 * Pull diagnostics scheduling for one session (design: "Pull and push
 * diagnostics" and "Cross-document refresh"). Every trigger only adds
 * documents to one scheduler, the wave. There is no polling: the only
 * timers are the change debounce and the wait for the minimum wave
 * spacing after an event has already started a wave.
 */

/**
 * ◇ Provisional bounds. The design sets them from V26, G3 and G5, none of
 * which is measured yet; see the Stage 1b record for where each came from.
 */
export const PULL_LIMITS = {
  /** Debounce applied to the pull after a change; never to `didChange`. */
  debounceMs: 300,
  /** Pulls in flight across documents of one session. */
  concurrency: 4,
  /** Documents per wave; the rest are flagged pull-needed. */
  perWave: 12,
  /** Minimum time between the starts of two waves. */
  waveSpacingMs: 250,
  /** Window focus seeds at most once per interval. */
  focusIntervalMs: 2000,
  /** Consecutive `retriggerRequest` re-arms before giving up until the next trigger. */
  retriggerMax: 3,
  /** Consecutive pull failures before the status says pull is degraded. */
  failureMax: 5,
};
export type PullLimits = typeof PULL_LIMITS;

export type PullReport = { kind: "full"; resultId?: string; items: LspDiagnostic[] } | { kind: "unchanged"; resultId?: string };
export type PullReply =
  | { kind: "report"; report: PullReport }
  | { kind: "noResult" } | { kind: "retrigger" } | { kind: "busy" } | { kind: "notSynced" } | { kind: "disabled" }
  | { kind: "error"; code: number; message: string };

export interface PullTransport {
  pull(session: number, uri: string, previousResultId: string | null): Promise<PullReply>;
  /** Cancels the document's in-flight pull, if any. */
  cancel(session: number, uri: string): Promise<void>;
}

export interface Stamp { epoch: number; versionId: number }

export interface PullHost {
  /** Open, registered documents of this session. */
  openDocs(): string[];
  /** Visible documents: the active document of each view. */
  visible(): string[];
  recency(fileId: string): number;
  uri(fileId: string): string | null;
  /** The document's `(epoch, versionId)` now, or null if it is not Open. */
  stamp(fileId: string): Stamp | null;
  flush(fileId: string): Promise<void>;
  /** An accepted full report replaces the pull set; `unchanged` keeps it. */
  accept(fileId: string, report: PullReport): void;
  degraded(message: string | null): void;
}

/**
 * Decisions 20, 31 and 33: did the readiness gate just open? It opens on a
 * not-ready → ready report (the first load, or the next one after a reload
 * re-armed the gate) and when the status-less fallback fires. That moment
 * seeds a wave over every Open document; nothing else here does.
 */
export function gateOpened(previous: { workspaceReady: boolean | null; readyFallback: boolean } | undefined,
  status: { workspaceReady: boolean | null; readyFallback: boolean }): boolean {
  if (!previous) return false;
  return (status.workspaceReady === true && previous.workspaceReady === false) || (status.readyFallback && !previous.readyFallback);
}

export interface Timers { now(): number; set(run: () => void, ms: number): unknown; clear(handle: unknown): void }
export const realTimers: Timers = { now: () => performance.now(), set: (run, ms) => setTimeout(run, ms), clear: (h) => clearTimeout(h as number) };

export type Trigger = "open" | "change" | "save" | "refresh" | "focus" | "cross" | "activate" | "capacity" | "retrigger" | "resync" | "ready";

export interface PullStats {
  waves: number; pulls: number; full: number; unchanged: number; stale: number; busy: number; retriggers: number;
  errors: number; flagged: number; noResult: number; seeds: Record<Trigger, number>;
}

interface Seed { cross: boolean }

export class PullScheduler {
  private pending = new Map<string, Seed>();
  private running: { fileId: string; seed: Seed }[] = [];
  private active = 0;
  private inWave = false;
  private lastWaveAt = -Infinity;
  private spacingTimer: unknown = null;
  private debounce = new Map<string, unknown>();
  private latest = new Map<string, number>();
  private resultIds = new Map<string, string>();
  private pullNeeded = new Set<string>();
  private busy = new Set<string>();
  private retriggers = new Map<string, number>();
  private failures = 0;
  private lastFocus = -Infinity;
  private token = 0;
  private stopped = false;
  readonly stats: PullStats = { waves: 0, pulls: 0, full: 0, unchanged: 0, stale: 0, busy: 0, retriggers: 0, errors: 0, flagged: 0, noResult: 0,
    seeds: { open: 0, change: 0, save: 0, refresh: 0, focus: 0, cross: 0, activate: 0, capacity: 0, retrigger: 0, resync: 0, ready: 0 } };

  private session: number;
  private interFile: boolean;
  private transport: PullTransport;
  private host: PullHost;
  private timers: Timers;
  private limits: PullLimits;

  constructor(session: number, interFile: boolean, transport: PullTransport, host: PullHost,
    timers: Timers = realTimers, limits: PullLimits = PULL_LIMITS) {
    this.session = session;
    this.interFile = interFile;
    this.transport = transport;
    this.host = host;
    this.timers = timers;
    this.limits = limits;
  }

  /** Documents waiting for a later wave or for their next visibility. */
  flagged(): string[] { return [...this.pullNeeded]; }
  hasResultId(fileId: string): boolean { return this.resultIds.has(fileId); }

  private seed(fileIds: string[], trigger: Trigger, cross = false): void {
    if (this.stopped) return;
    for (const fileId of fileIds) {
      this.stats.seeds[trigger]++;
      const seed = this.pending.get(fileId);
      this.pending.set(fileId, { cross: cross || (seed?.cross ?? false) });
      this.pullNeeded.delete(fileId);
    }
    this.startWave();
  }

  /** Visible open documents join a wave; the rest are flagged pull-needed. */
  private seedVisible(trigger: Trigger, except?: string, cross = false): void {
    const visible = new Set(this.host.visible());
    const open = this.host.openDocs().filter((f) => f !== except);
    for (const fileId of open) if (!visible.has(fileId) && !this.pending.has(fileId)) { this.pullNeeded.add(fileId); this.stats.flagged++; }
    this.seed(open.filter((f) => visible.has(f)), trigger, cross);
  }

  opened(fileId: string): void { this.seed([fileId], "open"); }

  /**
   * Decision 20: the workspace became ready (again). Reports of pulls sent
   * before now are dropped; every Open document joins a wave, visible first.
   */
  ready(): void { this.latest.clear(); this.seed(this.host.openDocs(), "ready"); }
  resynced(fileId: string): void { this.resultIds.delete(fileId); this.seed([fileId], "resync"); }

  /** A change restarts the debounce and cancels the document's in-flight pull. */
  edited(fileId: string): void {
    if (this.stopped) return;
    const uri = this.host.uri(fileId);
    if (this.latest.has(fileId) && uri) { this.latest.delete(fileId); void this.transport.cancel(this.session, uri); }
    this.pending.delete(fileId);
    this.retriggers.delete(fileId);
    this.arm(fileId, "change", true);
  }

  private arm(fileId: string, trigger: Trigger, cross: boolean): void {
    const previous = this.debounce.get(fileId);
    if (previous !== undefined) this.timers.clear(previous);
    this.debounce.set(fileId, this.timers.set(() => { this.debounce.delete(fileId); this.seed([fileId], trigger, cross); }, this.limits.debounceMs));
  }

  /** After `didSave`: the saved document, and the cross-document seed when its pull settles. */
  saved(fileId: string): void { this.seed([fileId], "save", true); }

  /** The status record's refresh counter moved (any number of times). */
  refresh(): void { this.seedVisible("refresh"); }

  focused(): void {
    const now = this.timers.now();
    if (now - this.lastFocus < this.limits.focusIntervalMs) return;
    this.lastFocus = now;
    this.seedVisible("focus");
  }

  /** Activating a pull-needed document sends one pull; any other sends nothing. */
  activated(fileId: string): void { if (this.pullNeeded.has(fileId)) this.seed([fileId], "activate"); }

  /** The writer drained: re-issue pulls that were not admitted. */
  writerRoom(): void { const waiting = [...this.busy]; this.busy.clear(); if (waiting.length) this.seed(waiting, "capacity"); }

  /** Closing clears the pull state: its pull set is cleared by the caller (decision 18). */
  closed(fileId: string): void {
    const timer = this.debounce.get(fileId);
    if (timer !== undefined) this.timers.clear(timer);
    for (const map of [this.debounce, this.latest, this.resultIds, this.retriggers]) map.delete(fileId);
    this.pending.delete(fileId);
    this.pullNeeded.delete(fileId);
    this.busy.delete(fileId);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.debounce.values()) this.timers.clear(timer);
    if (this.spacingTimer !== null) this.timers.clear(this.spacingTimer);
    this.debounce.clear();
    this.pending.clear();
  }

  private startWave(): void {
    if (this.inWave || this.pending.size === 0 || this.stopped || this.spacingTimer !== null) return;
    const wait = this.lastWaveAt + this.limits.waveSpacingMs - this.timers.now();
    if (wait > 0) { this.spacingTimer = this.timers.set(() => { this.spacingTimer = null; this.startWave(); }, wait); return; }
    const visible = new Set(this.host.visible());
    const ordered = [...this.pending.entries()].sort(([a], [b]) =>
      Number(visible.has(b)) - Number(visible.has(a)) || this.host.recency(b) - this.host.recency(a));
    this.pending.clear();
    const wave = ordered.slice(0, this.limits.perWave);
    for (const [fileId] of ordered.slice(this.limits.perWave)) { this.pullNeeded.add(fileId); this.stats.flagged++; }
    if (wave.length === 0) return;
    this.inWave = true;
    this.lastWaveAt = this.timers.now();
    this.stats.waves++;
    this.running = wave.map(([fileId, seed]) => ({ fileId, seed }));
    this.pump();
  }

  private pump(): void {
    while (this.active < this.limits.concurrency && this.running.length > 0) {
      const { fileId, seed } = this.running.shift()!;
      this.active++;
      void this.pullOne(fileId, seed).finally(() => {
        this.active--;
        this.pump();
        if (this.active === 0 && this.running.length === 0) { this.inWave = false; this.startWave(); }
      });
    }
  }

  private async pullOne(fileId: string, seed: Seed): Promise<void> {
    const uri = this.host.uri(fileId);
    if (!uri || !this.host.stamp(fileId)) return;
    await this.host.flush(fileId);
    const sent = this.host.stamp(fileId);
    if (!sent) return;
    const token = ++this.token;
    this.latest.set(fileId, token);
    this.stats.pulls++;
    const reply = await this.transport.pull(this.session, uri, this.resultIds.get(fileId) ?? null)
      .catch((error): PullReply => ({ kind: "error", code: 0, message: String(error) }));
    const newest = this.latest.get(fileId) === token;
    if (newest) this.latest.delete(fileId);
    if (this.stopped) return;
    switch (reply.kind) {
      case "report": {
        const now = this.host.stamp(fileId);
        // Applied only for the same (epoch, versionId) and only if newest; a dropped report records no resultId.
        if (!newest || !now || now.epoch !== sent.epoch || now.versionId !== sent.versionId) { this.stats.stale++; return; }
        this.failures = 0;
        this.retriggers.delete(fileId);
        if (reply.report.resultId) this.resultIds.set(fileId, reply.report.resultId); else this.resultIds.delete(fileId);
        if (reply.report.kind === "full") this.stats.full++; else this.stats.unchanged++;
        this.host.degraded(null);
        this.host.accept(fileId, reply.report);
        if (seed.cross && this.interFile) this.seedVisible("cross", fileId);
        return;
      }
      case "retrigger": {
        this.stats.retriggers++;
        const count = (this.retriggers.get(fileId) ?? 0) + 1;
        this.retriggers.set(fileId, count);
        if (count <= this.limits.retriggerMax) this.arm(fileId, "retrigger", seed.cross);
        return;
      }
      case "busy": this.stats.busy++; this.busy.add(fileId); return;
      case "error":
        this.stats.errors++;
        if (++this.failures >= this.limits.failureMax) this.host.degraded(`pull diagnostics are failing: ${reply.message}`);
        return;
      default: this.stats.noResult++; return;
    }
  }
}
