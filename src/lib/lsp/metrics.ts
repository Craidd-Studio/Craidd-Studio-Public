/**
 * Development-only, read-only measurement hooks for Stage 1b verification
 * (architect decisions A1–A3). In a production build every hook is a no-op
 * and nothing is installed, so LSP behaviour cannot depend on them.
 *
 * Read them from Output (Language Server source) as `[lsp:metrics] {json}`
 * lines, at most one per second and only when something changed, or call
 * `window.__craiddLspMetrics()` in the dev tools for the current snapshot.
 *
 * WebKitGTK exposes no long-task entries, so responsiveness is measured by
 * substitutes (decision A3): `frameGap` is the time between consecutive
 * animation frames, and `inputToPaint` is a key press to the next frame.
 */

const DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

interface Window { max: number; p95: number; count: number }
const summarise = (samples: number[]): Window => {
  if (samples.length === 0) return { max: 0, p95: 0, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return { max: Math.round(sorted[sorted.length - 1]), p95: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]), count: sorted.length };
};

const state = {
  channelMessages: 0,
  storeWrites: { push: 0, pull: 0 },
  frameWrites: 0,
  markerCalls: 0,
  stored: { push: 0, pull: 0 },
  arrivals: { push: 0, pull: 0 },
  /** `performance.now()` of the latest diagnostics reaching the store queue, per route. */
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

function snapshot(): Record<string, unknown> {
  const channelRate = state.channelMessages - lastChannelCount;
  return { t: Math.round(performance.now()), ...state, channelRatePerS: channelRate,
    frameGap: summarise(frameGaps), inputToPaint: summarise(inputToPaint), ...extra() };
}

export const metrics = {
  channelMessage() { if (DEV) state.channelMessages++; },
  arrival(route: "push" | "pull") { if (DEV) { state.arrivals[route]++; state.lastArrivalMs[route] = Math.round(performance.now()); } },
  storeWrite(route: "push" | "pull") { if (DEV) state.storeWrites[route]++; },
  frameWrite() { if (DEV) state.frameWrites++; },
  markerCall() { if (DEV) state.markerCalls++; },
  stored(push: number, pull: number) { if (DEV) state.stored = { push, pull }; },
  pullReport(kind: "full" | "unchanged") { if (DEV) state.reports[kind]++; },
  launchScheduled() { if (DEV) state.launchScheduledMs = Math.round(performance.now()); },
  launched(reason: "idle" | "timeout") {
    if (!DEV) return;
    state.launches[reason]++;
    emit?.(`[lsp:metrics] ${JSON.stringify({ event: "launch", reason, schedulingDelayMs: Math.round(performance.now()) - state.launchScheduledMs })}`);
  },
  /** Startup and restore finished; reported even with `CRAIDD_LSP=0`, for the G1 baseline. */
  startupInteractive() {
    if (!DEV || state.startupInteractiveMs !== null) return;
    state.startupInteractiveMs = Math.round(performance.now());
    console.info(`[lsp:metrics] startupInteractive ${state.startupInteractiveMs} ms`);
  },
  install(output: (line: string) => void, more: () => Record<string, unknown>) {
    if (!DEV || emit) return;
    emit = output;
    extra = more;
    output(`[lsp:metrics] ${JSON.stringify({ event: "startupInteractive", ms: state.startupInteractiveMs })}`);
    (window as unknown as { __craiddLspMetrics: () => Record<string, unknown> }).__craiddLspMetrics = snapshot;
    let last = performance.now();
    let keyAt: number | null = null;
    window.addEventListener("keydown", () => { keyAt ??= performance.now(); }, { capture: true });
    const frame = (now: number) => {
      frameGaps.push(now - last);
      last = now;
      if (keyAt !== null) { inputToPaint.push(now - keyAt); keyAt = null; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    window.setInterval(() => {
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
    }, 1000);
  },
};
