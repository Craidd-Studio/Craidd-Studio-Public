import { contentChanges, textHash, type ContentChange, type DocView, type ModelChange } from "./protocol.ts";

/**
 * Document registration, owned by the tab and observing the model
 * (design: "Three lifetimes: tab, model, view"). Views never open or close
 * anything. The model is the only text authority: every open and resync
 * reads it at that moment; nothing is reconstructed or replayed.
 *
 * Operations on one document run in order on a per-document chain, so a
 * change never reaches the backend ahead of the open it depends on, and
 * edits made while a call is in flight batch into the next `didChange`.
 */

export interface DocTransport {
  open(session: number, uri: string, languageId: string, text: string): Promise<DocView>;
  change(session: number, uri: string, epoch: number, changes: ContentChange[]): Promise<DocView>;
  markDesynced(session: number, uri: string, reason: string): Promise<DocView>;
  resync(session: number, uri: string, text: string): Promise<DocView>;
  save(session: number, uri: string, text: string): Promise<DocView>;
  close(session: number, uri: string): Promise<void>;
}

export interface TextModel { getValue(): string; getVersionId(): number; getEOL(): string }

export interface Binding {
  session: number;
  uri: string;
  /** Filesystem identity, LSP-only (design: "File identity: three questions"). */
  canonical: string;
  languageId: string;
  projectId: string;
  projectName: string;
  syncKind: "full" | "incremental";
}

export type DocState = "pending" | "open" | "suspended" | "desynced" | "alias";

interface Doc {
  fileId: string;
  binding: Binding | null;
  state: DocState;
  epoch: number;
  queue: ContentChange[];
  flushQueued: boolean;
  chain: Promise<unknown>;
  hash: string | null;
  eol: string | null;
  activatedAt: number;
  /** While desynced or suspended: the model changed and a resync is owed. */
  dirtySinceDesync: boolean;
}

export interface TrackerEvents {
  opened(fileId: string, binding: Binding): void;
  edited(fileId: string, binding: Binding): void;
  /** Synced again at a new epoch after a resync or a resume that resynced. */
  resynced(fileId: string, binding: Binding): void;
  saved(fileId: string, binding: Binding): void;
  closed(fileId: string, binding: Binding): void;
  failed(fileId: string, error: unknown): void;
}

function errorKind(error: unknown): string | null {
  return typeof error === "object" && error !== null && "kind" in error ? String((error as { kind: unknown }).kind) : null;
}

export class DocumentTracker {
  private docs = new Map<string, Doc>();
  private clock = 0;
  readonly stats = { opens: 0, changes: 0, resyncs: 0, desyncs: 0, aliases: 0 };

  private transport: DocTransport;
  private models: (fileId: string) => TextModel | null;
  private events: TrackerEvents;
  private schedule: (flush: () => void) => void;

  constructor(transport: DocTransport, models: (fileId: string) => TextModel | null,
    events: TrackerEvents, schedule: (flush: () => void) => void = (run) => queueMicrotask(run)) {
    // Not `= queueMicrotask`: it is called as `this.schedule(...)`, and a browser's
    // `queueMicrotask` throws "Illegal invocation" when `this` is not the window.
    this.transport = transport;
    this.models = models;
    this.events = events;
    this.schedule = schedule;
  }

  private doc(fileId: string): Doc {
    let doc = this.docs.get(fileId);
    if (!doc) {
      doc = { fileId, binding: null, state: "pending", epoch: 0, queue: [], flushQueued: false, chain: Promise.resolve(),
        hash: null, eol: null, activatedAt: 0, dirtySinceDesync: false };
      this.docs.set(fileId, doc);
    }
    return doc;
  }

  /** Chained after the document's previous operation; never rejects (failures are reported). */
  private run(doc: Doc, op: () => Promise<void>): Promise<void> {
    const next = doc.chain.then(op).catch((error) => this.events.failed(doc.fileId, error));
    doc.chain = next;
    return next;
  }

  state(fileId: string): DocState | null { return this.docs.get(fileId)?.state ?? null; }
  binding(fileId: string): Binding | null { return this.docs.get(fileId)?.binding ?? null; }
  epoch(fileId: string): number { return this.docs.get(fileId)?.epoch ?? 0; }
  lastActivated(fileId: string): number { return this.docs.get(fileId)?.activatedAt ?? 0; }

  /** Open documents of a session (Pending, Suspended and aliases excluded). */
  openDocs(session: number): string[] {
    return [...this.docs.values()].filter((d) => d.binding?.session === session && d.state === "open").map((d) => d.fileId);
  }

  /** The tab that holds the registration for a filesystem identity, in any session (navigation focuses it, rule 3). */
  holderTab(canonical: string): string | null {
    return [...this.docs.values()].find((d) => d.binding?.canonical === canonical && d.state !== "alias" && d.state !== "pending")?.fileId ?? null;
  }

  /** The tab holding the registration for a filesystem identity, if any. */
  holderOf(canonical: string, session: number, except?: string): Doc | undefined {
    return [...this.docs.values()].find((d) => d.fileId !== except && d.binding?.session === session
      && d.binding.canonical === canonical && d.state !== "alias" && d.state !== "pending");
  }

  aliasOf(fileId: string): string | null {
    const doc = this.docs.get(fileId);
    if (doc?.state !== "alias" || !doc.binding) return null;
    return this.holderOf(doc.binding.canonical, doc.binding.session, fileId)?.fileId ?? null;
  }

  /** Routing result for a tab. A changed binding closes the old registration first. */
  bind(fileId: string, binding: Binding): void {
    const doc = this.doc(fileId);
    if (doc.binding && doc.binding.session === binding.session && doc.binding.uri === binding.uri) return;
    if (doc.binding && doc.state !== "pending" && doc.state !== "alias") void this.close(fileId, false);
    const fresh = this.doc(fileId);
    fresh.binding = binding;
    fresh.state = "pending";
  }

  /**
   * The tab became the visible, active document and its session is Ready.
   * An Open document sends nothing (no close and reopen on tab switch).
   */
  activate(fileId: string): Promise<void> {
    const doc = this.doc(fileId);
    doc.activatedAt = ++this.clock;
    const binding = doc.binding;
    if (!binding || doc.state !== "pending") return Promise.resolve();
    if (this.holderOf(binding.canonical, binding.session, fileId)) {
      doc.state = "alias";
      this.stats.aliases++;
      return Promise.resolve();
    }
    const model = this.models(fileId);
    if (!model) return Promise.resolve();
    doc.state = "open";
    doc.eol = model.getEOL();
    return this.run(doc, async () => {
      try {
        const view = await this.transport.open(binding.session, binding.uri, binding.languageId, model.getValue());
        if (doc.binding !== binding) return;
        doc.epoch = view.epoch;
        doc.queue = [];
        this.stats.opens++;
        this.events.opened(fileId, binding);
      } catch (error) {
        // Busy or closed: stay Pending; the next activation or capacity event retries.
        if (doc.binding === binding) doc.state = "pending";
        throw error;
      }
    });
  }

  /** Model content events, in order. Edits while desynced only mark the debt. */
  modelChanged(fileId: string, event: { changes: ModelChange[]; isFlush: boolean; eol: string }): void {
    const doc = this.docs.get(fileId);
    if (!doc?.binding) return;
    if (doc.state === "desynced" || doc.state === "suspended") { doc.dirtySinceDesync = true; return; }
    if (doc.state !== "open") return;
    const model = this.models(fileId);
    if (!model) return;
    if (doc.eol !== null && event.eol !== doc.eol) {
      // An EOL change is a full resync of the document.
      doc.eol = event.eol;
      void this.desync(doc, "EOL changed");
      return;
    }
    if (event.isFlush || doc.binding.syncKind === "full") doc.queue = [{ text: model.getValue() }];
    else doc.queue.push(...contentChanges(event.changes));
    this.events.edited(fileId, doc.binding);
    if (!doc.flushQueued) {
      doc.flushQueued = true;
      try { this.schedule(() => { doc.flushQueued = false; void this.flush(fileId); }); }
      catch (error) { doc.flushQueued = false; throw error; }
    }
  }

  /** Send queued changes as one `didChange`. Called before every dependent request, save, close and resync. */
  flush(fileId: string): Promise<void> {
    const doc = this.docs.get(fileId);
    if (!doc?.binding) return Promise.resolve();
    const binding = doc.binding;
    return this.run(doc, async () => {
      // A suspended document still owes the edits made before its model went away.
      if ((doc.state !== "open" && doc.state !== "suspended") || doc.queue.length === 0 || doc.binding !== binding) return;
      const changes = doc.queue;
      doc.queue = [];
      const view = await this.transport.change(binding.session, binding.uri, doc.epoch, changes).catch((error) => {
        if (errorKind(error) === "notOpen") { doc.state = "pending"; void this.activate(fileId); return null; }
        throw error;
      });
      if (!view) return;
      this.stats.changes++;
      if (view.sync.state === "desynced") this.enterDesync(doc, view);
    });
  }

  private enterDesync(doc: Doc, view: DocView): void {
    doc.state = "desynced";
    doc.epoch = view.epoch;
    doc.queue = [];
    doc.dirtySinceDesync = false;
    this.stats.desyncs++;
  }

  private desync(doc: Doc, reason: string): Promise<void> {
    const binding = doc.binding!;
    doc.queue = [];
    return this.run(doc, async () => {
      const view = await this.transport.markDesynced(binding.session, binding.uri, reason);
      this.enterDesync(doc, view);
    }).then(() => this.resync(doc.fileId));
  }

  /** The atomic `didClose` + `didOpen`, with the model's text read now. Not admitted → stays desynced. */
  resync(fileId: string): Promise<void> {
    const doc = this.docs.get(fileId);
    if (!doc?.binding || doc.state !== "desynced") return Promise.resolve();
    const binding = doc.binding;
    return this.run(doc, async () => {
      const model = this.models(fileId);
      if (!model || doc.state !== "desynced" || doc.binding !== binding) return;
      const view = await this.transport.resync(binding.session, binding.uri, model.getValue());
      if (view.sync.state !== "synced") return;
      doc.state = "open";
      doc.epoch = view.epoch;
      doc.eol = model.getEOL();
      doc.dirtySinceDesync = false;
      this.stats.resyncs++;
      this.events.resynced(fileId, binding);
    });
  }

  /** Writer room came back: resync the active document first, then the most recently active. */
  retryResyncs(activeFileId: string | null): Promise<void> {
    const waiting = [...this.docs.values()].filter((d) => d.state === "desynced")
      .sort((a, b) => (b.fileId === activeFileId ? 1 : 0) - (a.fileId === activeFileId ? 1 : 0) || b.activatedAt - a.activatedAt);
    return waiting.reduce((done, doc) => done.then(() => this.resync(doc.fileId)), Promise.resolve());
  }

  /** The model is about to be disposed while its tab remains: flush, remember the text hash, suspend. */
  modelWillDispose(fileId: string): void {
    const doc = this.docs.get(fileId);
    const model = this.models(fileId);
    if (!doc || !model || (doc.state !== "open" && doc.state !== "desynced")) return;
    void this.flush(fileId);
    doc.hash = textHash(model.getValue());
    if (doc.state === "open") doc.state = "suspended";
  }

  /** A model for a suspended document exists again: same text → Open, silently; different → resync. */
  modelCreated(fileId: string): void {
    const doc = this.docs.get(fileId);
    const model = this.models(fileId);
    if (!doc?.binding || !model) return;
    if (doc.state === "desynced") { void this.resync(fileId); return; }
    if (doc.state !== "suspended") return;
    const same = doc.hash === textHash(model.getValue()) && !doc.dirtySinceDesync;
    doc.hash = null;
    doc.state = "open";
    if (!same) void this.desync(doc, "the model was recreated with different text");
  }

  /** After Craidd's successful save only. */
  saved(fileId: string): Promise<void> {
    const doc = this.docs.get(fileId);
    if (!doc?.binding || doc.state !== "open") return Promise.resolve();
    const binding = doc.binding;
    void this.flush(fileId);
    return this.run(doc, async () => {
      const model = this.models(fileId);
      if (doc.state !== "open" || doc.binding !== binding) return;
      await this.transport.save(binding.session, binding.uri, model?.getValue() ?? "");
      this.events.saved(fileId, binding);
    });
  }

  /**
   * The tab closed (or its binding changed). One `didClose` while the
   * session is alive; the best remaining alias is promoted to Pending.
   */
  close(fileId: string, forget = true): Promise<void> {
    const doc = this.docs.get(fileId);
    if (!doc) return Promise.resolve();
    const binding = doc.binding;
    const registered = doc.state === "open" || doc.state === "desynced" || doc.state === "suspended";
    if (forget) this.docs.delete(fileId);
    if (!binding) return Promise.resolve();
    // Edits still queued for a closing registration are irrelevant to the server.
    doc.queue = [];
    doc.state = "pending";
    if (forget) doc.binding = null;
    const done = registered ? this.run(doc, () => this.transport.close(binding.session, binding.uri).catch(() => {})) : Promise.resolve();
    if (registered) {
      const alias = [...this.docs.values()].filter((d) => d.state === "alias" && d.binding?.canonical === binding.canonical
        && d.binding.session === binding.session).sort((a, b) => a.activatedAt - b.activatedAt)[0];
      if (alias) alias.state = "pending";
    }
    this.events.closed(fileId, binding);
    return done;
  }

  /** The session ended: documents return to Pending and are unbound; nothing is sent. */
  sessionEnded(session: number): string[] {
    const affected: string[] = [];
    for (const doc of this.docs.values()) {
      if (doc.binding?.session !== session) continue;
      doc.binding = null;
      doc.state = "pending";
      doc.queue = [];
      affected.push(doc.fileId);
    }
    return affected;
  }

  /** Pending documents with a binding whose open was refused (writer busy) or not yet sent. */
  pendingBound(session: number): string[] {
    return [...this.docs.values()].filter((d) => d.binding?.session === session && d.state === "pending").map((d) => d.fileId);
  }

  forgetAll(): void { this.docs.clear(); }
}
