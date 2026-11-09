/**
 * Development-only, read-only measurement hooks for Stage 1b verification
 * (architect decisions A1–A3). In a production build every hook is a no-op
 * and nothing is installed, so LSP behaviour cannot depend on them. Hooks
 * only count: they return nothing, and nothing in the client reads them.
 *
 * Read them from Output (Language Server source) as `[lsp:metrics] {json}`
 * lines, at most one per second and only when something changed, or call
 * `window.__craiddLspMetrics()` in the dev tools for the current snapshot.
 *
 * WebKitGTK exposes no long-task entries, so responsiveness is measured by
 * substitutes (decision 24): `frameGap` is the time between consecutive
 * animation frames, and `inputToPaint` is a key press to the second
 * animation frame after it. The first callback runs before the frame that
 * shows the edit is painted; the second runs after that paint, so it bounds
 * the visible update from above by at most one frame.
 */

export interface Window { max: number; p95: number; count: number }
const summarise = (samples: number[]): Window => {
  if (samples.length === 0) return { max: 0, p95: 0, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return { max: Math.round(sorted[sorted.length - 1]), p95: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]), count: sorted.length };
};

/** What the hooks need from the page; tests pass a scripted one. */
export interface MetricsHost {
  now(): number;
  frame(run: (now: number) => void): void;
  onKey(run: () => void): void;
  every(ms: number, run: () => void): void;
  expose(snapshot: () => Record<string, unknown>): void;
}

const browserHost = (): MetricsHost => ({
  now: () => performance.now(),
  frame: (run) => { requestAnimationFrame(run); },
  onKey: (run) => window.addEventListener("keydown", run, { capture: true }),
  every: (ms, run) => { window.setInterval(run, ms); },
  expose: (snapshot) => { (window as unknown as { __craiddLspMetrics: () => Record<string, unknown> }).__craiddLspMetrics = snapshot; },
});

export function createMetrics(dev: boolean, hostFactory: () => MetricsHost = browserHost) {
  let host: MetricsHost | null = null;
  const now = () => (host ? host.now() : typeof performance !== "undefined" ? performance.now() : 0);
  const state = {
    channelMessages: 0,
    storeWrites: { push: 0, pull: 0 },
    frameWrites: 0,
    markerCalls: 0,
    stored: { push: 0, pull: 0 },
    arrivals: { push: 0, pull: 0 },
    /** Clock time of the latest diagnostics reaching the store queue, per route. */
    lastArrivalMs: { push: 0, pull: 0 },
    reports: { full: 0, unchanged: 0 },
    launches: { idle: 0, timeout: 0 },
    launchScheduledMs: 0,
    startupInteractiveMs: null as number | null,
  };
  let frameGaps: number[] = [];
  let inputToPaint: number[] = [];
  let lastChannelCount = 0;
  let lastLine = "";
  let extra: () => Record<string, unknown> = () => ({});
  let emit: ((line: string) => void) | null = null;

  const snapshot = (): Record<string, unknown> => ({ t: Math.round(now()), ...state, channelRatePerS: state.channelMessages - lastChannelCount,
    frameGap: summarise(frameGaps), inputToPaint: summarise(inputToPaint), ...extra() });

  return {
    channelMessage(): void { if (dev) state.channelMessages++; },
    arrival(route: "push" | "pull"): void { if (dev) { state.arrivals[route]++; state.lastArrivalMs[route] = Math.round(now()); } },
    storeWrite(route: "push" | "pull"): void { if (dev) state.storeWrites[route]++; },
    frameWrite(): void { if (dev) state.frameWrites++; },
    markerCall(): void { if (dev) state.markerCalls++; },
    stored(push: number, pull: number): void { if (dev) state.stored = { push, pull }; },
    pullReport(kind: "full" | "unchanged"): void { if (dev) state.reports[kind]++; },
    launchScheduled(): void { if (dev) state.launchScheduledMs = Math.round(now()); },
    launched(reason: "idle" | "timeout"): void {
      if (!dev) return;
      state.launches[reason]++;
      emit?.(`[lsp:metrics] ${JSON.stringify({ event: "launch", reason, schedulingDelayMs: Math.round(now()) - state.launchScheduledMs })}`);
    },
    /** Startup and restore finished; reported even with `CRAIDD_LSP=0`, for the G1 baseline. */
    startupInteractive(): void {
      if (!dev || state.startupInteractiveMs !== null) return;
      state.startupInteractiveMs = Math.round(now());
    },
    snapshot(): Record<string, unknown> | null { return dev ? snapshot() : null; },
    install(output: (line: string) => void, more: () => Record<string, unknown>): void {
      if (!dev || emit) return;
      host = hostFactory();
      const page = host;
      emit = output;
      extra = more;
      output(`[lsp:metrics] ${JSON.stringify({ event: "startupInteractive", ms: state.startupInteractiveMs })}`);
      page.expose(snapshot);
      let last = page.now();
      let keyAt: number | null = null;
      let framesSinceKey = 0;
      page.onKey(() => { if (keyAt === null) { keyAt = page.now(); framesSinceKey = 0; } });
      const frame = (at: number) => {
        frameGaps.push(at - last);
        last = at;
        // The second frame after the key press: the edit has been painted.
        if (keyAt !== null && ++framesSinceKey === 2) { inputToPaint.push(at - keyAt); keyAt = null; }
        page.frame(frame);
      };
      page.frame(frame);
      page.every(1000, () => {
        const current = snapshot();
        const { t: _t, frameGap, inputToPaint: typing, channelRatePerS: _rate, ...counters } = current as Record<string, unknown> & { frameGap: Window; inputToPaint: Window };
        const comparable = JSON.stringify(counters);
        // Frame statistics alone are reported only while typing or when a frame stalled (◇ 50 ms).
        if (comparable !== lastLine || typing.count > 0 || frameGap.max > 50) {
          lastLine = comparable;
          output(`[lsp:metrics] ${JSON.stringify(current)}`);
        }
        lastChannelCount = state.channelMessages;
        frameGaps = [];
        inputToPaint = [];
      });
    },
  };
}

export type Metrics = ReturnType<typeof createMetrics>;

export const metrics: Metrics = createMetrics(Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV));
