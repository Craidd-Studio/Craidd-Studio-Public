import { ProviderRequests, type ProviderReply } from "./requests.ts";
import { ProviderRegistrations, providerAvailable, triggerCharacters, withNotice } from "./providers.ts";
import { ACCEPT_COMMAND, guardMultiCursor, hasSeveralCursors, registerAcceptCommand, type Entry } from "./completionAccept.ts";
import { contextToLsp, listToMonaco, type LspItem } from "./completion.ts";
import { hoverToMonaco } from "./hover.ts";
import { symbolsToMonaco } from "./symbols.ts";
import { locationsToTargets, openTarget, referencesToTargets, type NavigationDeps, type Selection, type Target } from "./navigation.ts";
import type { Monaco } from "@monaco-editor/react";
import type { editor, languages, Position, CancellationToken, Uri, IRange, IPosition } from "monaco-editor";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useSolution } from "../../store/solutionStore";
import { useSplit } from "../../store/splitStore";
import { appendLspOutput, endedDocs, isNavigationOnly, serverName, useLsp, viewWithAttach, viewWithStatus, type LspSessionView } from "../../store/lspStore";
import { LANGUAGES } from "../languages";
import { DocumentTracker, type Binding, type DocTransport } from "./documents";
import { DiagnosticsModel, gateOpen, isAuthoritative, type Attribution, type Route } from "./diagnostics";
import { gateOpened, PullScheduler, type PullReply, type PullReport } from "./pulls";
import { fileUri, isTerminal, uriToPath, toMonacoRange, toLspPosition, type Batch, type ContentChange, type DocView, type LspDiagnostic, type NegotiatedCaps, type StatusRecord } from "./protocol";
import { metrics } from "./metrics";
import { LaunchGate } from "./launch";

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
  opened: (fileId, binding) => { refreshDocInfo(fileId); pullFor(binding.session, fileId, "open"); publishUnknown(); },
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

type Pending = { session: number; uri: string; route: Route; items: LspDiagnostic[] | null; authoritative: boolean };
const pendingDiagnostics = new Map<string, Pending>();
let frameQueued = false;

function queueDiagnostics(session: number, uri: string, route: Route, items: LspDiagnostic[] | null, authoritative = true): void {
  pendingDiagnostics.set(`${session}\u0000${route}\u0000${uri}`, { session, uri, route, items, authoritative });
  metrics.arrival(route);
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(flushDiagnostics);
}

const languageTable = () => Object.fromEntries(LANGUAGES.map((l) => [l.id, { extensions: [...l.extensions, ...l.interopExtensions], wellKnown: l.wellKnownFiles }]));

/** Attributions resolved by the backend's ownership resolver, per uri, for the current solution. */
const attributions = new Map<string, Attribution>();
const resolving = new Set<string>();
let attributedFor: unknown = null;

function tabBinding(uri: string): Binding | null {
  const fileId = useSolution.getState().tabs.find((tab) => fileUri(tab.fileId) === uri)?.fileId;
  return fileId ? tracker.binding(fileId) : null;
}

/** Open documents carry their routed project; every other file asks the single resolver. Never guessed from folders. */
function attributionOf(uri: string): Attribution | null {
  const solution = useSolution.getState().solution;
  if (solution !== attributedFor) { attributions.clear(); attributedFor = solution; }
  const binding = tabBinding(uri);
  if (binding) return { projectId: binding.projectId, projectName: binding.projectName };
  return attributions.get(uri) ?? null;
}

function resolveAttributions(): void {
  const solution = useSolution.getState().solution;
  if (!solution) return;
  const missing = diagnostics.uris().filter((uri) => !tabBinding(uri) && !attributions.has(uri) && !resolving.has(uri));
  if (missing.length === 0) return;
  for (const uri of missing) resolving.add(uri);
  void invoke<{ projectId: string | null; projectName: string | null; ambiguous: string[] }[]>("lsp_attribute",
    { paths: missing.map(uriToPath), solution, languages: languageTable() })
    .then((list) => {
      if (useSolution.getState().solution !== solution) return;
      list.forEach((who, index) => attributions.set(missing[index], who));
      publishProblems();
    })
    .catch((error) => console.warn("[lsp] attribution failed:", error))
    .finally(() => { for (const uri of missing) resolving.delete(uri); });
}

function isOpenUri(uri: string): boolean {
  return useSolution.getState().tabs.some((tab) => fileUri(tab.fileId) === uri && modelFor(tab.fileId) !== null);
}

function flushDiagnostics(): void {
  frameQueued = false;
  const changed: Pending[] = [];
  for (const update of pendingDiagnostics.values()) {
    const knownBefore = diagnostics.isKnown(update.session, update.uri);
    const wrote = update.items === null
      ? diagnostics.clearPull(update.session, update.uri)
      : diagnostics.apply(update.session, update.uri, update.route, update.items, isOpenUri);
    if (update.route === "pull" && update.items !== null) {
      if (update.authoritative) diagnostics.markKnown(update.session, update.uri);
      else diagnostics.clearKnown(update.session, update.uri);
    }
    if (wrote) { changed.push(update); metrics.storeWrite(update.route); }
    else if (knownBefore !== diagnostics.isKnown(update.session, update.uri)) publishUnknown();
  }
  pendingDiagnostics.clear();
  if (changed.length === 0) return;
  publishProblems();
  for (const update of changed) setMarkers(update.session, update.uri, update.route);
}

/** Open, registered documents of pull-enabled sessions without an accepted pull report yet. */
function unknownCount(): number {
  let unknown = 0;
  for (const session of schedulers.keys()) {
    for (const fileId of tracker.openDocs(session)) if (!diagnostics.isKnown(session, tracker.binding(fileId)!.uri)) unknown++;
  }
  return unknown;
}

function publishUnknown(): void {
  const pullUnknown = unknownCount();
  if (useLsp.getState().pullUnknown !== pullUnknown) useLsp.setState({ pullUnknown });
}

function publishProblems(): void {
  metrics.frameWrite();
  useLsp.setState({ problems: diagnostics.problems(attributionOf), evictedFiles: diagnostics.evictedFiles(), notRetained: diagnostics.notRetained(),
    pullUnknown: unknownCount() });
  metrics.stored(diagnostics.storedCount("push"), diagnostics.storedCount("pull"));
  resolveAttributions();
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

/** Read-only tabs of an ended session say so; every other affected document is refreshed as before. */
function markEnded(affected: string[], generation: number): void {
  const ended = endedDocs(affected, useSolution.getState().tabs, generation);
  if (Object.keys(ended).length > 0) useLsp.setState((state) => ({ docs: { ...state.docs, ...ended } }));
  for (const fileId of affected) if (!(fileId in ended)) refreshDocInfo(fileId);
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
    if (!current) return state;
    return { sessions: { ...state.sessions, [generation]: { ...current, ...patch } } };
  });
}

function onStatus(generation: number, status: StatusRecord): void {
  const previous = lastStatus.get(generation);
  lastStatus.set(generation, status);
  useLsp.setState((state) => ({ sessions: { ...state.sessions, [generation]: viewWithStatus(state.sessions[generation], generation, status) } }));
  if (isTerminal(status.phase)) {
    if (previous && isTerminal(previous.phase)) return;
    schedulers.get(generation)?.stop();
    schedulers.delete(generation);
    awaitingReady.delete(generation);
    markEnded(tracker.sessionEnded(generation), generation);
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
  // Decision 20: not ready → ready (first load, or after a reload), or the bounded fallback, seeds every Open document.
  if (gateOpened(previous, status)) {
    awaitingReady.delete(generation);
    scheduler?.ready();
  }
}

function onBatch(generation: number, batch: Batch): void {
  metrics.channelMessage();
  if (metrics.enabled) metrics.channelBytes(JSON.stringify(batch).length);
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

/** Was the readiness gate open when the latest pull for (session, uri) was sent? */
const sentOpen = new Map<string, boolean>();

const pullTransport = {
  async pull(session: number, uri: string, previousResultId: string | null): Promise<PullReply> {
    sentOpen.set(`${session}\u0000${uri}`, gateOpen(lastStatus.get(session)));
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
      if (report.kind === "full") {
        const uri = tracker.binding(fileId)!.uri;
        const authoritative = isAuthoritative(sentOpen.get(`${session}\u0000${uri}`) ?? false, report.items.length);
        // An earlier empty report is discarded: the stored set and the unknown state stay as they were.
        if (authoritative || report.items.length > 0) queueDiagnostics(session, uri, "pull", report.items, authoritative);
      }
    },
    degraded: (message: string | null) => {
      if (useLsp.getState().sessions[session]?.pullDegraded !== message) updateSession(session, { pullDegraded: message });
    },
  };
}

/** Provider requests (Stage 1c): flush, capture, supersede, cancel and stale rejection live in `requests.ts`. */
export const providerRequests = new ProviderRequests({
  binding: (fileId) => { const binding = tracker.binding(fileId); return binding ? { session: binding.session, uri: binding.uri } : null; },
  stamp: (fileId) => {
    const model = modelFor(fileId);
    return model && tracker.state(fileId) === "open" ? { epoch: tracker.epoch(fileId), versionId: model.getVersionId() } : null;
  },
  flush: (fileId) => tracker.flush(fileId),
  call: (command, args) => invoke<ProviderReply>(command, args),
  cancel: (session, uri, kind) => invoke<void>("lsp_cancel_provider", { session, uri, kind }),
}, (kind, outcome, ms) => metrics.provider(kind, outcome, ms));

// ---- Monaco providers (once per language; capability-checked per call) ----

const registrations = new ProviderRegistrations();

function sessionCaps(fileId: string) {
  const binding = tracker.binding(fileId);
  return binding && tracker.state(fileId) === "open" ? lastStatus.get(binding.session)?.caps ?? null : null;
}

function registerProviders(monaco: Monaco): void {
  for (const language of LANGUAGES) {
    registrations.ensure(language.id, "hover", "", () => monaco.languages.registerHoverProvider(language.id, {
      async provideHover(model: editor.ITextModel, position: Position, token: CancellationToken) {
        const fileId = fileIdOf(model);
        if (!fileId || !providerAvailable(sessionCaps(fileId), "hover")) return null;
        const { line, character } = toLspPosition(position.lineNumber, position.column);
        return hoverToMonaco(await providerRequests.request("hover", fileId, { line, character }, token)) as languages.Hover | null;
      },
    }));
    registrations.ensure(language.id, "documentSymbol", "", () => monaco.languages.registerDocumentSymbolProvider(language.id, {
      async provideDocumentSymbols(model: editor.ITextModel, token: CancellationToken) {
        const fileId = fileIdOf(model);
        if (!fileId || !providerAvailable(sessionCaps(fileId), "documentSymbol")) return null;
        const { symbols, dropped } = symbolsToMonaco(await providerRequests.request("documentSymbol", fileId, {}, token));
        // Visible beyond the Output tab: the chip detail names the truncation until a complete result replaces it.
        chipNotice(fileId, "Outline ", dropped > 0 ? `Outline limited to ${symbols.length} symbols; +${dropped} more not shown` : null);
        return symbols as unknown as languages.DocumentSymbol[];
      },
    }));
    registrations.ensure(language.id, "definition", "", () => monaco.languages.registerDefinitionProvider(language.id, {
      async provideDefinition(model: editor.ITextModel, position: Position, token: CancellationToken) {
        const fileId = fileIdOf(model);
        if (!fileId || !providerAvailable(sessionCaps(fileId), "definition")) return null;
        const { line, character } = toLspPosition(position.lineNumber, position.column);
        return asLocations(monaco, locationsToTargets(await providerRequests.request("definition", fileId, { line, character }, token)));
      },
    }));
    registrations.ensure(language.id, "references", "", () => monaco.languages.registerReferenceProvider(language.id, {
      async provideReferences(model: editor.ITextModel, position: Position, context: languages.ReferenceContext, token: CancellationToken) {
        const fileId = fileIdOf(model);
        if (!fileId || !providerAvailable(sessionCaps(fileId), "references")) return null;
        const { line, character } = toLspPosition(position.lineNumber, position.column);
        const { targets, dropped } = referencesToTargets(await providerRequests.request("references", fileId,
          { line, character, includeDeclaration: context.includeDeclaration }, token));
        chipNotice(fileId, "References ", dropped > 0 ? `References limited to ${targets.length}; +${dropped} more not shown` : null);
        return asLocations(monaco, targets);
      },
    }));
  }
  // Decision 46: Monaco never creates a model for a navigation target itself; Craidd's tab logic opens it.
  // attachMonaco runs once, so this registers once.
  monaco.editor.registerEditorOpener({
    async openCodeEditor(source: editor.ICodeEditor, resource: Uri, selectionOrPosition?: IRange | IPosition) {
      const sourceModel = source?.getModel?.();
      const origin = sourceModel ? fileIdOf(sourceModel) : null;
      const result = await openTarget(navigationDeps(), resource.scheme, resource.path, selectionOrPosition as Selection | undefined, origin);
      return result !== "ignored";
    },
  });
}

function asLocations(monaco: Monaco, targets: Target[]): languages.Location[] {
  return targets.map((target) => ({ uri: monaco.Uri.file(target.path), range: target.range }));
}

/** Ownership comes from the single backend resolver (`lsp_attribute`); the store opens or focuses the tab. */
function navigationDeps(): NavigationDeps {
  return {
    isOpen: (path) => useSolution.getState().tabs.some((tab) => tab.fileId === path),
    isReadOnly: (path) => useSolution.getState().tabs.find((tab) => tab.fileId === path)?.readOnly === true,
    owner: async (path) => {
      const solution = useSolution.getState().solution;
      if (!solution) return null;
      const [who] = await invoke<{ projectId: string | null; ambiguous: string[] }[]>("lsp_attribute", { paths: [path], solution, languages: languageTable() });
      return who && !who.ambiguous?.length ? { projectId: who.projectId } : null;
    },
    reveal: (path, line, column) => useSolution.getState().revealFile(path, line, column),
    // Decisions 49-51: a path the originating session returned is read once (text only, size-capped), shown
    // as a read-only tab, and bound to that session with its canonical-path URI. Anything else is refused.
    unowned: async (path, line, column, origin) => {
      const binding = origin ? tracker.binding(origin) : null;
      const held = tracker.binding(path);
      // Already open here and held by the navigating session (and not ended): focus it, nothing to rebind.
      if (binding && held?.session === binding.session && useSolution.getState().tabs.some((tab) => tab.fileId === path)) {
        await useSolution.getState().revealFile(path, line, column);
        return;
      }
      if (!binding) {
        // No live session to read or bind through: an already-open read-only tab is still focused (its `ended` note stays).
        if (useSolution.getState().tabs.some((tab) => tab.fileId === path)) await useSolution.getState().revealFile(path, line, column);
        else appendLspOutput([{ session: 0, severity: 3, text: `[lsp] ${path} is outside the solution's projects and there is no language-server session to read it through` }]);
        return;
      }
      try {
        const target = await invoke<{ path: string; text: string }>("lsp_read_target", { session: binding.session, path });
        useSolution.getState().revealReadOnly(target.path, target.text, line, column);
        tracker.bind(target.path, { ...binding, uri: fileUri(target.path), canonical: target.path, syncKind: "incremental" });
        refreshDocInfo(target.path);
        void activateBound(target.path);
      } catch (error) {
        appendLspOutput([{ session: binding.session, severity: 2, text: `[lsp] could not open ${path}: ${String(error)}` }]);
      }
    },
  };
}

// ---- Completion (F3: Craidd-owned acceptance, DA-15) ----

const completionEntries = new Map<string, Entry>();
let acceptRegistered = false;

/** A notice on existing surfaces only (decision 44): an Output line (when `text` is set) and the chip's detail. */
function chipNotice(fileId: string, prefix: string, text: string | null, output = true): void {
  const session = tracker.binding(fileId)?.session;
  if (text !== null && output) appendLspOutput([{ session: session ?? 0, severity: 2, text: `[lsp] ${text}` }]);
  const view = session === undefined ? undefined : useLsp.getState().sessions[session];
  if (session !== undefined && view) {
    const notes = withNotice(view.notes, prefix, text);
    if (notes.length !== (view.notes ?? []).length || notes.some((n, i) => n !== view.notes?.[i])) updateSession(session, { notes });
  }
}
const multiCursorNoted = new Set<number>();
/** Once per session, not per keystroke. */
function noteMultiCursor(fileId: string): void {
  const session = tracker.binding(fileId)?.session ?? 0;
  if (multiCursorNoted.has(session)) return;
  multiCursorNoted.add(session);
  appendLspOutput([{ session, severity: 3, text: "[lsp] completion that needs the language server to finish it is not offered while several cursors are active" }]);
}
const completionNotice = (fileId: string, text: string) => chipNotice(fileId, "Completion ", text);

/**
 * Registered once per language when its first ready session reports the trigger characters (never hardcoded);
 * re-registered only if a later session reports different ones.
 */
function ensureCompletion(monaco: Monaco, languageId: string, caps: NegotiatedCaps | null): void {
  if (!providerAvailable(caps, "completion")) return;
  if (!acceptRegistered) {
    acceptRegistered = true;
    guardMultiCursor(monaco, (model) => { const id = fileIdOf(model as editor.ITextModel); return Boolean(id) && [...completionEntries.values()].some((e) => e.fileId === id); });
    registerAcceptCommand(monaco, {
      entry: (id) => completionEntries.get(id),
      resolve: async (id) => {
        const entry = completionEntries.get(id);
        if (!entry) return null;
        return await providerRequests.request("completionResolve", entry.fileId, { item: entry.item }) as LspItem | null;
      },
      notice: completionNotice,
    });
  }
  const chars = triggerCharacters(caps);
  registrations.ensure(languageId, "completion", chars.join("\u0000"), () => monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: chars,
    async provideCompletionItems(model: editor.ITextModel, position: Position, context: languages.CompletionContext, token: CancellationToken) {
      const fileId = fileIdOf(model);
      const live = fileId ? sessionCaps(fileId) : null;
      if (!fileId || !providerAvailable(live, "completion")) return { suggestions: [] };
      const { line, character } = toLspPosition(position.lineNumber, position.column);
      const { triggerKind, triggerCharacter } = contextToLsp(context);
      const result = await providerRequests.request("completion", fileId, { line, character, triggerKind, triggerCharacter }, token);
      for (const key of [...completionEntries.keys()]) if (completionEntries.get(key)!.fileId === fileId) completionEntries.delete(key);
      const word = model.getWordUntilPosition(position);
      const focused = monaco.editor.getEditors().find((e: editor.ICodeEditor) => e.getModel() === model);
      const several = hasSeveralCursors(monaco, model);
      if (several) noteMultiCursor(fileId);
      const mode = focused?.getOption(monaco.editor.EditorOption.suggest).insertMode === "replace" ? "replace" : "insert";
      return listToMonaco(result, {
        word: { lineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn,
          text: model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: word.endColumn }) },
        resolveProvider: live?.completion?.resolve === true, mode, ownedCommand: ACCEPT_COMMAND, allowOwned: !several,
        register: (id, item) => { const key = `${fileId}\u0000${id}`; completionEntries.set(key, { item, fileId, position: { line: line, character } }); return key; },
      }) as unknown as languages.CompletionList;
    },
  }));
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
  if (monacoRef) ensureCompletion(monacoRef, binding.languageId, caps ?? null);
  refreshDocInfo(fileId);
  for (const scheduler of schedulers.values()) scheduler.activated(fileId);
}

/** Idle-deferred with a bound; WebKitGTK may not expose idle callbacks, and then the bound is the whole deferral. */
const scheduleIdle = (fire: (reason: "idle" | "timeout") => void) => {
  metrics.launchScheduled();
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback((deadline) => fire(deadline.didTimeout ? "timeout" : "idle"), { timeout: LAUNCH_MAX_WAIT_MS });
    return { cancel: () => window.cancelIdleCallback(handle) };
  }
  const handle = window.setTimeout(() => fire("timeout"), LAUNCH_MAX_WAIT_MS);
  return { cancel: () => window.clearTimeout(handle) };
};

const gate = new LaunchGate(scheduleIdle, (reason) => void attachActive(reason), DOCUMENT_EXTENSIONS);

/** The visible, active document changed (or startup finished): bound documents activate; others schedule the deferred launch. */
function onActive(): void {
  const fileId = useSolution.getState().activeFileId;
  // A read-only navigation tab is bound only by navigation from a live session (decision 51), never by routing.
  if (fileId && isNavigationOnly(useSolution.getState().tabs, fileId)) return;
  const binding = fileId ? tracker.binding(fileId) : null;
  const outcome = gate.onActive(fileId, {
    enabled: useLsp.getState().enabled,
    boundToLiveSession: Boolean(binding && !isTerminal(lastStatus.get(binding.session)?.phase ?? "exited")),
    notRouted: fileId !== null && useLsp.getState().docs[fileId]?.kind === "notRouted",
  });
  if (outcome === "activate" && fileId) void activateBound(fileId);
}

/** Revalidate, then route and get-or-start. A failed revalidation is silent: simply no launch. */
async function attachActive(reason: "idle" | "timeout"): Promise<void> {
  const { activeFileId: fileId, solution, tabs } = useSolution.getState();
  if (!gate.startupDone || !fileId || !solution || !tabs.some((t) => t.fileId === fileId)) return;
  // A read-only navigation tab is bound only by navigation from a live session (decision 51). Routing it would answer
  // "not routed" and overwrite its `ended` note, so an attach (for example after a restart) leaves it alone.
  if (isNavigationOnly(tabs, fileId)) return;
  const key = solutionKey;
  useLsp.setState((state) => ({ docs: { ...state.docs, [fileId]: { kind: "waiting" } } }));
  const languages = languageTable();
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
  // The Channel's first status batch can arrive before this reply and create the view: merge, never skip.
  useLsp.setState((state) => ({ sessions: { ...state.sessions, [reply.session]: viewWithAttach(state.sessions[reply.session], {
    generation: reply.session, server: reply.server, version: reply.version, root: reply.root, notes: reply.notes, status: reply.status }) } }));
  const binding: Binding = { session: reply.session, uri: reply.uri, canonical: reply.canonical, languageId: reply.languageId,
    projectId: reply.projectId, projectName: reply.projectName, syncKind: "incremental" };
  tracker.bind(fileId, binding);
  refreshDocInfo(fileId);
  if (!lastStatus.has(reply.session)) onStatus(reply.session, reply.status);
  else void activateBound(fileId);
  // The user moved on while this attached: re-run for the new active document.
  if (useSolution.getState().activeFileId !== fileId) onActive();
}

/**
 * A session's markers on every model, whether or not a tab still maps to the uri: closing the solution replaces the
 * tabs, so the uri lookup `clearSessionDiagnostics` uses can come up empty while the old model still shows the markers
 * (design: markers are cleared whenever a session ends).
 */
function clearSessionMarkers(generation: number): void {
  const monaco = monacoRef;
  if (!monaco) return;
  for (const model of monaco.editor.getModels()) {
    if (model.isDisposed()) continue;
    for (const route of ["push", "pull"]) monaco.editor.setModelMarkers(model, `lsp:${generation}:${route}`, []);
  }
}

function closeSolution(): void {
  gate.cancel();
  for (const scheduler of schedulers.values()) scheduler.stop();
  schedulers.clear();
  awaitingReady.clear();
  for (const generation of lastStatus.keys()) { diagnostics.clearSession(generation); clearSessionMarkers(generation); }
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
  registerProviders(monaco);
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
  window.addEventListener("craidd:file-saved", (event) => { void tracker.saved((event as CustomEvent<string>).detail); });
  window.addEventListener("focus", () => { for (const scheduler of schedulers.values()) scheduler.focused(); });
  // Decision 21: a manifest Craidd saved or reloaded from disk (its saved content changed).
  useSolution.subscribe((state, previous) => {
    for (const tab of state.tabs) {
      if (!tab.fileId.endsWith("/Cargo.toml")) continue;
      const before = previous.tabs.find((t) => t.fileId === tab.fileId);
      if (before && before.originalContent !== tab.originalContent) {
        void invoke<{ reloaded: number[]; restarted: number[] }>("lsp_manifest_changed", { path: tab.fileId })
          // Decision 33: a moved workspace root is a new identity; the backend stopped the old session.
          .then((reply) => { for (const generation of reply.restarted) afterRestart(generation); })
          .catch(() => {});
      }
    }
  });
  // Wiring is complete: launches may now be scheduled. With CRAIDD_LSP=0 this is never reached.
  gate.complete();
  onActive();
}

/** The user's restart action: the old session stops; the active document attaches a fresh one. */
export async function restartSession(generation: number): Promise<void> {
  await invoke("lsp_restart", { session: generation });
  afterRestart(generation);
}

/** The old session is stopping: unbind its documents and attach the active one afresh. */
function afterRestart(generation: number): void {
  const affected = tracker.sessionEnded(generation);
  useLsp.setState((state) => {
    const docs = { ...state.docs };
    for (const [fileId, info] of Object.entries(docs)) if (info.kind === "bound" && info.session === generation) delete docs[fileId];
    return { docs: { ...docs, ...endedDocs(affected, useSolution.getState().tabs, generation) } };
  });
  gate.scheduleLaunch();
}

export function showLspOutput(): void { window.dispatchEvent(new CustomEvent("craidd:show-output", { detail: "lsp" })); }
