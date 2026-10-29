import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Channel, invoke } from "@tauri-apps/api/core";
import { projectFolderAbs, useSolution } from "../../store/solutionStore";
import { useSplit } from "../../store/splitStore";
import { appendLspOutput, serverName, useLsp, type LspSessionView } from "../../store/lspStore";
import { LANGUAGES } from "../languages";
import { DocumentTracker, type Binding, type DocTransport } from "./documents";
import { DiagnosticsModel, type Route } from "./diagnostics";
import { PullScheduler, type PullReply, type PullReport } from "./pulls";
import { fileUri, isTerminal, uriToPath, toMonacoRange, type Batch, type ContentChange, type DocView, type LspDiagnostic, type StatusRecord } from "./protocol";
import { metrics } from "./metrics";

/**
 * Wires Monaco models, the solution store and the backend together
 * (design: "Architecture"). Registration follows the tab and observes the
 * model; views are never consulted. Nothing here starts a server before
 * startup and session restore have finished.
 */

/** Extensions some adapter treats as documents; a cheap pre-filter, routing still decides. */
const DOCUMENT_EXTENSIONS = ["rs"];
/** ◇ The deferred launch's maximum wait for idle time (design: "Launch trigger"). */
export const LAUNCH_MAX_WAIT_MS = 1500;

interface AttachRouted {
  kind: "routed"; session: number; uri: string; canonical: string; languageId: string; projectId: string; projectName: string;
  launched: boolean; server: string; version: string; root: string; notes: string[]; status: StatusRecord;
}
type AttachReply = AttachRouted | { kind: "notRouted" | "skipped" | "unavailable"; reason: string } | { kind: "disabled" };

let monacoRef: Monaco | null = null;
let startupDone = false;
let launchTimer: { cancel(): void } | null = null;
let solutionKey: string | null = null;
const lastStatus = new Map<number, StatusRecord>();
const schedulers = new Map<number, PullScheduler>();
const awaitingReady = new Map<number, Set<string>>();
const diagnostics = new DiagnosticsModel();

const transport: DocTransport = {
  open: (session, uri, languageId, text) => invoke<DocView>("lsp_open", { session, uri, languageId, text }),
  change: (session, uri, epoch, changes: ContentChange[]) => invoke<DocView>("lsp_change", { session, uri, epoch, changes }),
  markDesynced: (session, uri, reason) => invoke<DocView>("lsp_mark_desynced", { session, uri, reason }),
  resync: (session, uri, text) => invoke<DocView>("lsp_resync", { session, uri, text }),
  save: (session, uri, text) => invoke<DocView>("lsp_save", { session, uri, text }),
  close: (session, uri) => invoke<void>("lsp_close", { session, uri }),
};

function modelFor(fileId: string): editor.ITextModel | null {
  const monaco = monacoRef;
  if (!monaco) return null;
  const model = monaco.editor.getModel(monaco.Uri.parse(fileId));
  return model && !model.isDisposed() ? model : null;
}

/** The tab a model belongs to; a model with no tab (a diff, say) is never registered. */
function fileIdOf(model: editor.ITextModel): string | null {
  const monaco = monacoRef;
  if (!monaco) return null;
  const key = model.uri.toString();
  return useSolution.getState().tabs.find((tab) => monaco.Uri.parse(tab.fileId).toString() === key)?.fileId ?? null;
}

const tracker = new DocumentTracker(transport, modelFor, {
  opened: (fileId, binding) => { refreshDocInfo(fileId); pullFor(binding.session, fileId, "open"); },
  edited: (fileId, binding) => schedulers.get(binding.session)?.edited(fileId),
  resynced: (fileId, binding) => { refreshDocInfo(fileId); schedulers.get(binding.session)?.resynced(fileId); },
  saved: (fileId, binding) => schedulers.get(binding.session)?.saved(fileId),
  closed: (fileId, binding) => {
    schedulers.get(binding.session)?.closed(fileId);
    awaitingReady.get(binding.session)?.delete(fileId);
    queueDiagnostics(binding.session, binding.uri, "pull", null);
  },
  failed: (fileId, error) => console.warn("[lsp] document operation failed:", fileId, error),
});

function pullFor(session: number, fileId: string, why: "open"): void {
  const status = lastStatus.get(session);
  if (status?.workspaceReady === false) { awaitingReady.get(session)?.add(fileId) ?? awaitingReady.set(session, new Set([fileId])); return; }
  if (why === "open") schedulers.get(session)?.opened(fileId);
}

function activeFiles(): string[] {
  const active = useSolution.getState().activeFileId;
  const side = useSplit.getState().sideFileId;
  return [...new Set([active, side].filter((f): f is string => Boolean(f)))];
}

// ---- Diagnostics: one store write per frame, markers only for changed open models ----

type Pending = { session: number; uri: string; route: Route; items: LspDiagnostic[] | null };
const pendingDiagnostics = new Map<string, Pending>();
let frameQueued = false;

function queueDiagnostics(session: number, uri: string, route: Route, items: LspDiagnostic[] | null): void {
  pendingDiagnostics.set(`${session}\u0000${route}\u0000${uri}`, { session, uri, route, items });
  metrics.arrival(route);
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(flushDiagnostics);
}

function attribution(uri: string): { projectId: string | null; projectName: string | null } {
  const fileId = useSolution.getState().tabs.find((tab) => fileUri(tab.fileId) === uri)?.fileId;
  const binding = fileId ? tracker.binding(fileId) : null;
  if (binding) return { projectId: binding.projectId, projectName: binding.projectName };
  // Unopened files: the deepest project folder containing the path, else external.
  const solution = useSolution.getState().solution;
  const path = uriToPath(uri);
  const project = solution?.projects.map((p) => ({ p, folder: projectFolderAbs(solution.root, p) }))
    .filter(({ folder }) => path.startsWith(`${folder}/`)).sort((a, b) => b.folder.length - a.folder.length)[0]?.p;
  return project ? { projectId: project.id, projectName: project.name } : { projectId: null, projectName: null };
}

function isOpenUri(uri: string): boolean {
  return useSolution.getState().tabs.some((tab) => fileUri(tab.fileId) === uri && modelFor(tab.fileId) !== null);
}

function flushDiagnostics(): void {
  frameQueued = false;
  const changed: Pending[] = [];
  for (const update of pendingDiagnostics.values()) {
    const wrote = update.items === null
      ? diagnostics.clearPull(update.session, update.uri)
      : diagnostics.apply(update.session, update.uri, update.route, update.items, attribution(update.uri), isOpenUri);
    if (wrote) { changed.push(update); metrics.storeWrite(update.route); }
  }
  pendingDiagnostics.clear();
  if (changed.length === 0) return;
  publishProblems();
  for (const update of changed) setMarkers(update.session, update.uri, update.route);
}

function publishProblems(): void {
  metrics.frameWrite();
  useLsp.setState({ problems: diagnostics.problems(), evictedFiles: diagnostics.evictedFiles(), notRetained: diagnostics.notRetained() });
  metrics.stored(diagnostics.storedCount("push"), diagnostics.storedCount("pull"));
}

const MARKER_SEVERITY = [8, 8, 4, 2, 1];

function setMarkers(session: number, uri: string, route: Route): void {
  const monaco = monacoRef;
  const fileId = useSolution.getState().tabs.find((tab) => fileUri(tab.fileId) === uri)?.fileId;
  const model = fileId ? modelFor(fileId) : null;
  if (!monaco || !model) return;
  metrics.markerCall();
  monaco.editor.setModelMarkers(model, `lsp:${session}:${route}`, diagnostics.get(session, uri, route).map((item) => ({
    ...toMonacoRange(item.range),
    severity: MARKER_SEVERITY[item.severity ?? 1] ?? 8,
    message: item.message,
    source: item.source,
    code: typeof item.code === "object" ? String(item.code.value) : item.code === undefined ? undefined : String(item.code),
    tags: item.tags?.filter((t) => t === 1 || t === 2),
    relatedInformation: item.relatedInformation?.map((r) => ({ resource: monaco.Uri.parse(r.location.uri), message: r.message, ...toMonacoRange(r.location.range) })),
  })));
}

/** A recreated model gets its markers back from the store. */
function restoreMarkers(fileId: string): void {
  const binding = tracker.binding(fileId);
  const uri = fileUri(fileId);
  for (const session of binding ? [binding.session] : [...lastStatus.keys()]) {
    setMarkers(session, uri, "push");
    setMarkers(session, uri, "pull");
  }
}

function clearSessionDiagnostics(session: number): void {
  const monaco = monacoRef;
  const uris = diagnostics.clearSession(session);
  publishProblems();
  if (!monaco) return;
  for (const uri of uris) {
    const fileId = useSolution.getState().tabs.find((tab) => fileUri(tab.fileId) === uri)?.fileId;
    const model = fileId ? modelFor(fileId) : null;
    if (model) for (const route of ["push", "pull"]) monaco.editor.setModelMarkers(model, `lsp:${session}:${route}`, []);
  }
}

// ---- Sessions ----

function updateSession(generation: number, patch: Partial<LspSessionView>): void {
  useLsp.setState((state) => {
    const current = state.sessions[generation];
    if (!current && !patch.status) return state;
    return { sessions: { ...state.sessions, [generation]: { ...(current as LspSessionView), ...patch } } };
  });
}

function onStatus(generation: number, status: StatusRecord): void {
  const previous = lastStatus.get(generation);
  lastStatus.set(generation, status);
  updateSession(generation, { status });
  if (isTerminal(status.phase)) {
    if (previous && isTerminal(previous.phase)) return;
    schedulers.get(generation)?.stop();
    schedulers.delete(generation);
    awaitingReady.delete(generation);
    for (const fileId of tracker.sessionEnded(generation)) refreshDocInfo(fileId);
    clearSessionDiagnostics(generation);
    return;
  }
  if (status.phase === "ready" && status.caps) {
    if (!schedulers.has(generation) && status.caps.pull) {
      schedulers.set(generation, new PullScheduler(generation, status.caps.pull.interFileDependencies, pullTransport, pullHost(generation)));
    }
    if (previous?.phase !== "ready") for (const fileId of activeFiles()) void activateBound(fileId);
  }
  const scheduler = schedulers.get(generation);
  if (previous && status.refresh !== previous.refresh) scheduler?.refresh();
  if (previous && status.writerRoom !== previous.writerRoom) {
    void tracker.retryResyncs(useSolution.getState().activeFileId);
    scheduler?.writerRoom();
    for (const fileId of tracker.pendingBound(generation)) if (activeFiles().includes(fileId)) void activateBound(fileId);
  }
  if (status.workspaceReady === true && previous?.workspaceReady === false) {
    const waiting = awaitingReady.get(generation) ?? new Set();
    awaitingReady.delete(generation);
    for (const fileId of waiting) scheduler?.opened(fileId);
  }
}

function onBatch(generation: number, batch: Batch): void {
  metrics.channelMessage();
  if (batch.status) onStatus(generation, batch.status);
  for (const event of batch.events) {
    if (event.kind === "diagnostics") queueDiagnostics(generation, event.uri, "push", event.diagnostics);
    else if (event.kind === "progressBegin" || event.kind === "progressReport") {
      const title = "title" in event.value ? event.value.title : undefined;
      const view = useLsp.getState().sessions[generation];
      if (view) updateSession(generation, { progress: { ...view.progress, [event.token]: title ?? view.progress[event.token] ?? "working" } });
    } else {
      const view = useLsp.getState().sessions[generation];
      if (view && event.token in view.progress) {
        const progress = { ...view.progress };
        delete progress[event.token];
        updateSession(generation, { progress });
      }
    }
  }
  const view = useLsp.getState().sessions[generation];
  const name = view ? serverName(view) : "lsp";
  appendLspOutput(batch.logs.map((line) => ({ session: generation, severity: line.severity, text: `[lsp:${name}] ${line.text}` })), batch.droppedLogs);
  void invoke("lsp_ack", { session: generation }).catch(() => {});
}

const pullTransport = {
  async pull(session: number, uri: string, previousResultId: string | null): Promise<PullReply> {
    const reply = await invoke<{ kind: string; report?: PullReport; code?: number; message?: string }>("lsp_pull", { session, uri, previousResultId });
    if (reply.kind === "notReady") {
      const fileId = useSolution.getState().tabs.find((tab) => fileUri(tab.fileId) === uri)?.fileId;
      if (fileId) awaitingReady.get(session)?.add(fileId) ?? awaitingReady.set(session, new Set([fileId]));
      return { kind: "noResult" };
    }
    return reply as PullReply;
  },
  cancel: (session: number, uri: string) => invoke<void>("lsp_cancel_pull", { session, uri }).catch(() => {}),
};

function pullHost(session: number) {
  return {
    openDocs: () => tracker.openDocs(session),
    visible: activeFiles,
    recency: (fileId: string) => tracker.lastActivated(fileId),
    uri: (fileId: string) => tracker.binding(fileId)?.uri ?? null,
    stamp: (fileId: string) => {
      const model = modelFor(fileId);
      return model && tracker.state(fileId) === "open" ? { epoch: tracker.epoch(fileId), versionId: model.getVersionId() } : null;
    },
    flush: (fileId: string) => tracker.flush(fileId),
    accept: (fileId: string, report: PullReport) => {
      metrics.pullReport(report.kind);
      if (report.kind === "full") queueDiagnostics(session, tracker.binding(fileId)!.uri, "pull", report.items);
    },
    degraded: (message: string | null) => {
      if (useLsp.getState().sessions[session]?.pullDegraded !== message) updateSession(session, { pullDegraded: message });
    },
  };
}

// ---- Documents and the deferred launch ----

function refreshDocInfo(fileId: string): void {
  const binding = tracker.binding(fileId);
  if (!binding) return;
  useLsp.setState((state) => ({ docs: { ...state.docs, [fileId]: {
    kind: "bound", session: binding.session, alias: tracker.aliasOf(fileId), state: tracker.state(fileId) ?? "pending" } } }));
}

async function activateBound(fileId: string): Promise<void> {
  const binding = tracker.binding(fileId);
  if (!binding || lastStatus.get(binding.session)?.phase !== "ready") return;
  const caps = lastStatus.get(binding.session)?.caps;
  if (caps?.syncUnusable) return;
  binding.syncKind = caps?.sync === "full" ? "full" : "incremental";
  await tracker.activate(fileId);
  refreshDocInfo(fileId);
  for (const scheduler of schedulers.values()) scheduler.activated(fileId);
}

/** The visible, active document changed (or startup finished): bound documents activate; others schedule the deferred launch. */
function onActive(): void {
  const fileId = useSolution.getState().activeFileId;
  if (!startupDone || !fileId || !useLsp.getState().enabled) return;
  if (!DOCUMENT_EXTENSIONS.some((ext) => fileId.toLowerCase().endsWith(`.${ext}`))) return;
  const binding = tracker.binding(fileId);
  if (binding && !isTerminal(lastStatus.get(binding.session)?.phase ?? "exited")) { void activateBound(fileId); return; }
  if (useLsp.getState().docs[fileId]?.kind === "notRouted") return;
  scheduleLaunch();
}

function scheduleLaunch(): void {
  launchTimer?.cancel();
  const fire = (reason: "idle" | "timeout") => { launchTimer = null; void attachActive(reason); };
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback((deadline) => fire(deadline.didTimeout ? "timeout" : "idle"), { timeout: LAUNCH_MAX_WAIT_MS });
    launchTimer = { cancel: () => window.cancelIdleCallback(handle) };
  } else {
    // WebKitGTK may not expose idle callbacks: the bound is then the whole deferral.
    const handle = window.setTimeout(() => fire("timeout"), LAUNCH_MAX_WAIT_MS);
    launchTimer = { cancel: () => window.clearTimeout(handle) };
  }
  metrics.launchScheduled();
}

/** Revalidate, then route and get-or-start. A failed revalidation is silent: simply no launch. */
async function attachActive(reason: "idle" | "timeout"): Promise<void> {
  const { activeFileId: fileId, solution, tabs } = useSolution.getState();
  if (!startupDone || !fileId || !solution || !tabs.some((t) => t.fileId === fileId)) return;
  const key = solutionKey;
  useLsp.setState((state) => ({ docs: { ...state.docs, [fileId]: { kind: "waiting" } } }));
  const languages = Object.fromEntries(LANGUAGES.map((l) => [l.id, { extensions: [...l.extensions, ...l.interopExtensions], wellKnown: l.wellKnownFiles }]));
  let reply: AttachReply;
  try { reply = await invoke<AttachReply>("lsp_attach", { file: fileId, solution, languages, reason }); }
  catch (error) { console.warn("[lsp] attach failed:", error); return; }
  // Revalidate after the await: same solution, tab still open.
  if (key !== solutionKey || !useSolution.getState().tabs.some((t) => t.fileId === fileId)) return;
  if (reply.kind === "disabled") return;
  if (reply.kind !== "routed") {
    const info = reply.kind === "skipped" ? { kind: "none" as const } : { kind: reply.kind, reason: reply.reason };
    useLsp.setState((state) => ({ docs: { ...state.docs, [fileId]: info } }));
    return;
  }
  if (reply.launched) metrics.launched(reason);
  if (!useLsp.getState().sessions[reply.session]) {
    updateSession(reply.session, { generation: reply.session, status: reply.status, server: reply.server, version: reply.version,
      root: reply.root, notes: reply.notes, progress: {}, pullDegraded: null });
  }
  const binding: Binding = { session: reply.session, uri: reply.uri, canonical: reply.canonical, languageId: reply.languageId,
    projectId: reply.projectId, projectName: reply.projectName, syncKind: "incremental" };
  tracker.bind(fileId, binding);
  refreshDocInfo(fileId);
  if (!lastStatus.has(reply.session)) onStatus(reply.session, reply.status);
  else void activateBound(fileId);
  // The user moved on while this attached: re-run for the new active document.
  if (useSolution.getState().activeFileId !== fileId) onActive();
}

function closeSolution(): void {
  launchTimer?.cancel();
  for (const scheduler of schedulers.values()) scheduler.stop();
  schedulers.clear();
  awaitingReady.clear();
  for (const generation of lastStatus.keys()) diagnostics.clearSession(generation);
  lastStatus.clear();
  tracker.forgetAll();
  useLsp.setState({ sessions: {}, docs: {}, problems: [], evictedFiles: 0, notRetained: 0 });
  void invoke("lsp_close_solution").catch(() => {});
}

// ---- Wiring ----

let wired = false;

/** Called with Monaco once an editor has mounted. Idempotent. */
export function attachMonaco(monaco: Monaco): void {
  if (monacoRef) return;
  monacoRef = monaco;
  const watch = (model: editor.ITextModel) => {
    const fileId = fileIdOf(model);
    if (fileId) {
      tracker.modelCreated(fileId);
      restoreMarkers(fileId);
      // A bound document waiting for its model (the editor mounted after the attach).
      if (activeFiles().includes(fileId)) void activateBound(fileId);
    }
    model.onDidChangeContent((event) => {
      const id = fileIdOf(model);
      if (id) tracker.modelChanged(id, { changes: event.changes, isFlush: event.isFlush, eol: event.eol });
    });
    model.onWillDispose(() => { const id = fileIdOf(model); if (id) tracker.modelWillDispose(id); });
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
}

/** Startup and session restore have finished; launches may now be scheduled. */
export async function startupComplete(): Promise<void> {
  metrics.startupInteractive();
  if (wired) return;
  wired = true;
  metrics.install((line) => appendLspOutput([{ session: 0, severity: 4, text: line }]),
    () => ({ pullNeeded: [...schedulers.values()].reduce((n, s) => n + s.flagged().length, 0) }));
  let enabled = false;
  try { enabled = await invoke<boolean>("lsp_enabled"); } catch { return; }
  useLsp.setState({ enabled });
  if (!enabled) return;
  const channel = new Channel<{ session: number; batch: Batch }>();
  channel.onmessage = (event) => onBatch(event.session, event.batch);
  await invoke("lsp_subscribe", { channel });
  solutionKey = useSolution.getState().clnPath ?? useSolution.getState().rootPath;
  useSolution.subscribe((state, previous) => {
    const key = state.clnPath ?? state.rootPath;
    if (key !== solutionKey) { solutionKey = key; closeSolution(); }
    if (state.tabs !== previous.tabs) {
      const open = new Set(state.tabs.map((t) => t.fileId));
      for (const tab of previous.tabs) if (!open.has(tab.fileId)) void tracker.close(tab.fileId);
    }
    if (state.activeFileId !== previous.activeFileId) onActive();
  });
  useSplit.subscribe((state, previous) => { if (state.sideFileId !== previous.sideFileId && state.sideFileId) void activateBound(state.sideFileId); });
  window.addEventListener("craidd:file-saved", (event) => {
    const fileId = (event as CustomEvent<string>).detail;
    void tracker.saved(fileId);
    if (fileId.endsWith("/Cargo.toml")) void invoke("lsp_check_manifests").catch(() => {});
  });
  window.addEventListener("focus", () => {
    for (const scheduler of schedulers.values()) scheduler.focused();
    void invoke("lsp_check_manifests").catch(() => {});
  });
  onActive();
}

/** The user's restart action: the old session stops; the active document attaches a fresh one. */
export async function restartSession(generation: number): Promise<void> {
  await invoke("lsp_restart", { session: generation });
  for (const fileId of tracker.sessionEnded(generation)) refreshDocInfo(fileId);
  useLsp.setState((state) => {
    const docs = { ...state.docs };
    for (const [fileId, info] of Object.entries(docs)) if (info.kind === "bound" && info.session === generation) delete docs[fileId];
    return { docs };
  });
  scheduleLaunch();
}

export function showLspOutput(): void { window.dispatchEvent(new CustomEvent("craidd:show-output", { detail: "lsp" })); }
