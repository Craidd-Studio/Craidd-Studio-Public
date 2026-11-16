/**
 * Editor model → store routing (critical buffer-identity repair, 2026-11-16).
 *
 * A change is routed by the identity of the MODEL that changed, never by a file id captured when some editor
 * rendered. A model belongs to the tab whose path it was created for; a change to a model whose tab is read-only is
 * reverted, whichever editor made it (an embedded peek preview included); anything programmatic that leaves the
 * model equal to the store is an echo and writes nothing.
 */

export interface TabLike { fileId: string; content: string; readOnly?: boolean }
export interface ModelLike { uri: { toString(): string }; getValue(): string; setValue(value: string): void; isDisposed(): boolean }

export interface RoutingDeps {
  tabs(): TabLike[];
  /** The model uri string a tab's path produces (Monaco's `Uri.parse(path).toString()`). */
  uriOf(fileId: string): string;
  /** The store's content update for an editable tab. */
  update(fileId: string, content: string): void;
}

export type Routed = "ignored" | "echo" | "stored" | "reverted";

const reverting = new WeakSet<object>();

export function routeModelChange(model: ModelLike, deps: RoutingDeps): Routed {
  if (model.isDisposed() || reverting.has(model)) return "ignored";
  const key = model.uri.toString();
  const tab = deps.tabs().find((candidate) => deps.uriOf(candidate.fileId) === key);
  if (!tab) return "ignored"; // a model no tab owns (a scratch or widget model): nothing to route
  const text = model.getValue();
  if (text === tab.content) return "echo";
  if (tab.readOnly) {
    // A read-only tab's model must always equal its stored content. setValue also drops the undo history the edit
    // recorded, so nothing is left for an Undo to replay; the listener sees its own echo and ignores it.
    reverting.add(model);
    try { model.setValue(tab.content); } finally { reverting.delete(model); }
    return "reverted";
  }
  deps.update(tab.fileId, text);
  return "stored";
}

/** The disposable surface of a Monaco editor that `markEmbeddedReadOnly` needs. */
export interface EditorLike { updateOptions(options: Record<string, unknown>): void }
export interface MonacoLike {
  editor: {
    getModels(): ModelLike[] & { onDidChangeContent?: never }[];
    onDidCreateModel(listener: (model: any) => void): { dispose(): void };
    onDidCreateEditor(listener: (editor: any) => void): { dispose(): void };
  };
}

const craiddEditors = new WeakSet<object>();
/** Craidd's own main and side editors register themselves; every other editor is an embedded widget. */
export function markCraiddEditor(editor: object): void { craiddEditors.add(editor); }

let attached: WeakSet<object> | null = null;

/**
 * Once per Monaco: route every model's changes (existing and future) through `routeModelChange`, and make every
 * editor Craidd did not create (the References / Peek preview and other embedded widgets) read-only. Editors are
 * created before their creator can register them, so the check runs a microtask later.
 */
export function attachEditorSync(monaco: MonacoLike, deps: RoutingDeps, readOnlyMessage = "Read-only preview"): void {
  attached ??= new WeakSet();
  if (attached.has(monaco)) return;
  attached.add(monaco);
  const watch = (model: any) => { model.onDidChangeContent(() => { routeModelChange(model, deps); }); };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
  monaco.editor.onDidCreateEditor((editor: EditorLike) => {
    queueMicrotask(() => {
      if (craiddEditors.has(editor)) return;
      editor.updateOptions({ readOnly: true, readOnlyMessage: { value: readOnlyMessage } });
    });
  });
}
