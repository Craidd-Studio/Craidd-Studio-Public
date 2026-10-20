import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { resolveDocumentLink } from "../../lib/documentLinks";
import { formatMarkdownSelection, markdownFormatKey, markdownTextEdit, rehypeDocumentBlocks, type MarkdownFormat } from "../../lib/markdownPreview";
import { markdownSelectionRange, restoreMarkdownSelection } from "../../lib/markdownSelection";
import { isMarkdown } from "../../lib/docsDiscovery";
import { openWorkspaceFile } from "../../lib/openWorkspaceFile";
import { useMarkdown } from "../../store/markdownStore";
import "./markdown.css";

type Edit = { start: number; end: number; originalEnd: number; snapshot: string; expected: string; value: string };
interface PreviewContext {
  file: string; root: string | null; content: string; editing: Edit | null; ready: boolean;
  begin: (start: number, end: number) => void;
  change: (value: string) => void;
  finish: () => void;
  open: (href: string) => void;
  undo: (redo?: boolean) => void;
}
const Context = createContext<PreviewContext>(null!);

function PreviewBlock({ node, children }: ComponentProps<"div"> & ExtraProps) {
  const context = useContext(Context);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const touch = useRef<{ down?: { x: number; y: number; at: number }; tap?: { x: number; y: number; at: number }; editOnClick?: boolean }>({});
  const format = (kind: MarkdownFormat) => {
    const input = textarea.current;
    if (!input) return;
    const next = formatMarkdownSelection(input.value, input.selectionStart, input.selectionEnd, kind);
    context.change(next.value);
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next.start, next.end); });
  };
  const renderedStart = Number(node?.properties["data-md-start"]);
  const renderedEnd = Number(node?.properties["data-md-end"]);
  // Other blocks still come from the frozen render snapshot. Edits before a
  // clicked block can change its live offsets; translate before switching.
  const shift = context.editing && renderedStart !== context.editing.start && renderedStart >= context.editing.originalEnd
    ? context.content.length - context.editing.snapshot.length : 0;
  const start = renderedStart + shift;
  const end = renderedEnd + shift;
  const beginFromText = (target: EventTarget | null, block: HTMLElement) => {
    if (!context.ready || !(target instanceof Element)
      || target.closest("a, button, input, textarea, select, label, img, [role=button]")) return false;
    const selection = markdownSelectionRange(block, window.getSelection(), context.content);
    context.begin(start, end);
    if (selection && selection.start >= start && selection.end <= end) {
      const from = context.content.slice(start, selection.start).replace(/\r\n/g, "\n").length;
      const to = context.content.slice(start, selection.end).replace(/\r\n/g, "\n").length;
      requestAnimationFrame(() => textarea.current?.setSelectionRange(from, to));
    }
    return true;
  };
  if (!Number.isFinite(start) || !Number.isFinite(end)) return <div>{children}</div>;
  if (context.editing?.start === start) return <div className="md-block-editor">
    <label className="md-edit-label">Edit Markdown block · changes update your document</label>
    <div role="toolbar" aria-label="Format Markdown block" className="md-format-bar">
      {([ ["bold", "Bold", "Ctrl+B"], ["italic", "Italic", "Ctrl+I"], ["code", "Code", ""], ["link", "Link", "Ctrl+K"] ] as const).map(([kind, label, shortcut]) =>
        <button key={kind} type="button" title={`${label}${shortcut ? ` (${shortcut})` : ""}`} aria-label={label} aria-keyshortcuts={shortcut || undefined}
          onMouseDown={(event) => event.preventDefault()} onClick={() => format(kind)}>{label}</button>)}
    </div>
    <textarea ref={textarea} data-markdown-edit autoFocus aria-label="Edit Markdown block" value={context.editing.value.replace(/\r\n/g, "\n")}
      rows={Math.min(24, Math.max(3, context.editing.value.split("\n").length + 1))}
      onChange={(event) => context.change(event.target.value)} onKeyDown={(event) => {
        const kind = markdownFormatKey(event);
        if (kind) {
          event.preventDefault(); event.stopPropagation(); format(kind);
        } else if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
          event.preventDefault(); context.undo(event.key.toLowerCase() === "y" || event.shiftKey);
        } else if (event.key === "Escape" || ((event.ctrlKey || event.metaKey) && event.key === "Enter")) {
          event.preventDefault(); context.finish();
        }
      }} />
    <button type="button" onClick={context.finish}>Done</button>
  </div>;
  return <div className="md-block" data-md-block-start={start} data-md-block-end={end}
    onDoubleClick={(event) => {
      if (event.button === 0 && beginFromText(event.target, event.currentTarget)) event.preventDefault();
    }}
    onClick={(event) => {
      if (!touch.current.editOnClick) return;
      touch.current = {};
      // Open after the touch-generated click reaches the original text. Opening
      // on pointerup can retarget that click to a newly mounted format button.
      if (beginFromText(event.target, event.currentTarget)) event.preventDefault();
    }}
    onPointerDown={(event) => {
      if (event.pointerType === "touch" && event.isPrimary) touch.current.down = { x: event.clientX, y: event.clientY, at: Date.now() };
    }}
    onPointerCancel={() => { touch.current = {}; }}
    onPointerUp={(event) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      const { down, tap } = touch.current;
      const now = Date.now();
      if (!down || now - down.at > 350 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 12) { touch.current = {}; return; }
      if (tap && now - tap.at <= 350 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 24) {
        touch.current = { editOnClick: true };
      } else touch.current = { tap: { x: event.clientX, y: event.clientY, at: now } };
    }}>
    {children}
    <button type="button" className="md-edit-block" disabled={!context.ready}
      aria-label={`Edit block at line ${context.content.slice(0, start).split("\n").length}`}
      title="Edit this Markdown block" onClick={() => context.begin(start, end)}>Edit</button>
  </div>;
}

function LocalImage({ src, alt, title }: ComponentProps<"img">) {
  const { file, root } = useContext(Context);
  const [state, setState] = useState<{ key: string; url?: string; error?: string } | null>(null);
  const key = `${file}\u0000${root}\u0000${src}`;
  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    void (async () => {
      try {
        if (!root || typeof src !== "string") throw new Error("No local image path available.");
        const target = resolveDocumentLink(file, root, src);
        if (target.kind !== "local") throw new Error("Remote images are disabled. Open the image link externally to view it.");
        const bytes = await invoke<ArrayBuffer>("read_document_image", { root, path: target.path });
        if (cancelled) return;
        const extension = target.path.split(".").pop()?.toLowerCase();
        const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "ico" ? "image/x-icon" : `image/${extension}`;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({ key, url });
      } catch (failure) { if (!cancelled) setState({ key, error: String(failure) }); }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file, root, src, key]);
  if (state?.key !== key || !state.url) return <span className="md-image-fallback" role="img" aria-label={alt || "Image"}
    title={state?.key === key ? state.error : "Loading image…"}>[{alt || "Image"}: {state?.key === key && state.error ? "unavailable" : "loading…"}]</span>;
  return <img src={state.url} alt={alt || ""} title={title} onError={() => setState({ key, error: "Could not decode this image." })} />;
}

function DocumentAnchor({ href, children, title, id }: ComponentProps<"a">) {
  const { open } = useContext(Context);
  return <a href={href || "#"} id={id} title={title} onClick={(event) => { event.preventDefault(); open(href || ""); }}>{children}</a>;
}
const components: Components = { div: PreviewBlock, a: DocumentAnchor, img: LocalImage };
const remarkPlugins = [remarkGfm];
const rehypePlugins = [[rehypeHighlight, { detect: false }], rehypeDocumentBlocks] as ComponentProps<typeof Markdown>["rehypePlugins"];

export default function MarkdownPreview({ file, root, content, ready, replace, boundary, undo, onFocus }: {
  file: string; root: string | null; content: string; ready: boolean;
  replace: (start: number, end: number, replacement: string, expected: string) => string;
  boundary: () => void; undo: (redo?: boolean) => void; onFocus: () => void;
}) {
  const [editing, setEditing] = useState<Edit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const fragment = useMarkdown((s) => s.fragment);
  const finish = () => { boundary(); setEditing(null); };
  // A source/side-editor edit, disk reload or menu undo invalidates old offsets.
  useEffect(() => { if (editing && content !== editing.expected) setEditing(null); }, [content, editing]);
  const scrollToFragment = (value: string) => {
    const target = Array.from(container.current?.querySelectorAll<HTMLElement>("[id]") ?? [])
      .find((element) => element.id === `craidd-md-${value}` || element.id === value);
    if (!value) container.current?.scrollTo({ top: 0 });
    else if (target) { target.scrollIntoView({ block: "start" }); target.tabIndex = -1; target.focus({ preventScroll: true }); }
    else setError(`Heading not found: ${value}`);
  };
  useEffect(() => {
    if (fragment?.file === file) scrollToFragment(fragment.value);
  }, [fragment, file]); // Content edits must not repeatedly steal the reading position.
  const open = async (href: string) => {
    try {
      setError(null);
      const target = resolveDocumentLink(file, root, href);
      if (target.kind === "external") { await openUrl(target.url); return; }
      if (target.path === file) { scrollToFragment(target.fragment); return; }
      if (!isMarkdown(target.path)) throw new Error("This preview opens Markdown links. Use File Discovery for other file formats.");
      await invoke("resolve_document_path", { root, path: target.path });
      await openWorkspaceFile(target.path);
      useMarkdown.getState().navigate(target.path, target.fragment);
    } catch (failure) { setError(String(failure)); }
  };
  const context: PreviewContext = {
    file, root, content, editing, ready, open: (href) => { void open(href); },
    begin: (start, end) => { setError(null); boundary(); setEditing({ start, end, originalEnd: end, snapshot: content, expected: content, value: content.slice(start, end) }); },
    change: (value) => {
      if (!editing) return;
      try {
        // Native textareas use LF. Retain this block's/document's CRLF convention.
        const eol = editing.value.includes("\r\n") || content.includes("\r\n") ? "\r\n" : "\n";
        const replacement = value.replace(/\r?\n/g, eol);
        const expected = replace(editing.start, editing.end, replacement, editing.expected);
        setEditing({ ...editing, end: editing.start + replacement.length, value: replacement, expected });
      } catch (failure) { setError(String(failure)); setEditing(null); }
    },
    finish, undo: (redo) => { finish(); undo(redo); },
  };
  // Freeze only the rendered layout during block editing; the shared document
  // receives each keystroke. Reference definitions remain in the full parse.
  const rendered = editing?.snapshot ?? content;
  const markdown: ReactNode = useMemo(() => <Markdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
    components={components}>{rendered}</Markdown>, [rendered]);
  return <Context.Provider value={context}>
    <div ref={container} tabIndex={0} aria-label="Markdown preview" className="markdown-preview scroll-thin" onFocusCapture={onFocus}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        const kind = markdownFormatKey(event);
        if (kind && kind !== "link") {
          event.preventDefault(); event.stopPropagation();
          const element = container.current;
          const selection = element && markdownSelectionRange(element, window.getSelection(), content);
          if (!ready || !element || !selection) {
            setError("Select text within a paragraph to format it, or use Edit / View Source for more control.");
            return;
          }
          try {
            const result = formatMarkdownSelection(content, selection.start, selection.end, kind);
            const edit = markdownTextEdit(content, result.value);
            boundary(); replace(edit.start, edit.end, edit.text, content); boundary();
            setError(null);
            requestAnimationFrame(() => {
              element.focus({ preventScroll: true });
              restoreMarkdownSelection(element, result.start, result.end);
            });
          } catch (failure) { setError(String(failure)); }
          return;
        }
        if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
          event.preventDefault(); finish(); undo(event.key.toLowerCase() === "y" || event.shiftKey);
        }
      }}>
      {error && <div role="alert" className="md-error">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
      <article className="markdown-body">{rendered.trim() ? markdown : <PreviewBlock node={{ type: "element", tagName: "div",
        properties: { "data-md-start": 0, "data-md-end": rendered.length }, children: [] }} />}</article>
      {!content.trim() && !editing && <button type="button" disabled={!ready} onClick={() => context.begin(0, content.length)}>Write Markdown…</button>}
      <p className="md-preview-note">Double-click or double-tap text to edit a block, or use Edit. Raw HTML and remote images are disabled.</p>
    </div>
  </Context.Provider>;
}
