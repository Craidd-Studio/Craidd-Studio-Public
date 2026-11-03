/**
 * The start-up gate and the deferred launch (design: "Launch trigger").
 * Nothing is scheduled until startup and session restore have completed;
 * after that, only the visible, active document of a language some adapter
 * serves schedules one bounded, idle-deferred launch. A newer request
 * replaces a pending one, so at most one launch is ever waiting.
 */

export type LaunchReason = "idle" | "timeout";
export type ScheduleLaunch = (fire: (reason: LaunchReason) => void) => { cancel(): void };
export type ActiveOutcome = "none" | "activate" | "scheduled";

export interface ActiveContext {
  enabled: boolean;
  /** The document is bound to a session that has not ended: activate it, no launch. */
  boundToLiveSession: boolean;
  /** Routing already said this file has no language server. */
  notRouted: boolean;
}

export class LaunchGate {
  private started = false;
  private pending: { cancel(): void } | null = null;
  private schedule: ScheduleLaunch;
  private launch: (reason: LaunchReason) => void;
  private extensions: string[];

  constructor(schedule: ScheduleLaunch, launch: (reason: LaunchReason) => void, extensions: string[]) {
    this.schedule = schedule;
    this.launch = launch;
    this.extensions = extensions;
  }

  get startupDone(): boolean { return this.started; }

  /** Startup and session restore have finished, and the LSP subsystem is enabled and wired. */
  complete(): void { this.started = true; }

  /** The visible, active document changed (or startup finished). */
  onActive(fileId: string | null, context: ActiveContext): ActiveOutcome {
    if (!this.started || !fileId || !context.enabled) return "none";
    if (!this.extensions.some((ext) => fileId.toLowerCase().endsWith(`.${ext}`))) return "none";
    if (context.boundToLiveSession) return "activate";
    if (context.notRouted) return "none";
    this.scheduleLaunch();
    return "scheduled";
  }

  /** Schedule (or reschedule) the one deferred launch. */
  scheduleLaunch(): void {
    if (!this.started) return;
    this.pending?.cancel();
    this.pending = this.schedule((reason) => { this.pending = null; this.launch(reason); });
  }

  cancel(): void { this.pending?.cancel(); this.pending = null; }
}
