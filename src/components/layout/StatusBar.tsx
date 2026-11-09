import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";
import { useBuild } from "../../store/buildStore";
import { chipLabel, chipState, restartOffered, serverName, useLsp } from "../../store/lspStore";
import { restartSession, showLspOutput } from "../../lib/lsp/bridge";
import ChipBoundary from "./ChipBoundary";

/**
 * The language-server status chip (design: "User-visible surfaces"). Click
 * opens the server log in Output; hover gives binary, version, root and
 * the server's own health message. Restart appears once a session ended or
 * went unresponsive, and while its health is "error" (decision 38).
 */
function LanguageServerChip({ fileId }: { fileId: string | null }) {
  const info = useLsp((s) => (fileId ? s.docs[fileId] : undefined));
  const view = useLsp((s) => (info?.kind === "bound" ? s.sessions[info.session] : undefined));
  if (!info || info.kind === "none" || info.kind === "notRouted") return null;
  if (info.kind === "waiting") return <span className="text-zinc-500">language server…</span>;
  if (info.kind === "unavailable") {
    return <button type="button" onClick={showLspOutput} title={info.reason} className="text-amber-400 hover:text-amber-300">
      language server unavailable
    </button>;
  }
  if (!view) return null;
  const state = chipState(view);
  const name = serverName(view);
  const health = view.status.health;
  const warn = health && health.health !== "ok" ? health : null;
  const watcher = view.status.watcherWarning;
  const colour = state === "crashed" || state === "failed" || warn?.health === "error" ? "text-red-400"
    : state === "unresponsive" || warn || watcher || view.pullDegraded ? "text-amber-400"
    : state === "ready" ? "text-zinc-400" : "text-blue-400";
  const detail = [
    // Absent until the attach reply is merged (see `viewWithStatus`): show the phase only.
    view.server ? `${view.server} (${view.version})` : `Phase: ${view.status.phase}`, view.root ? `Root: ${view.root}` : null,
    view.status.phase === "ready" ? (watcher ? `File watching failed (changes on disk may be missed): ${watcher}` : "File watching: server-side") : null,
    view.status.terminalReason ? `Ended: ${view.status.terminalReason}` : null,
    view.status.readyFallback ? "The server reports no workspace status; diagnostics are pulled without waiting for it" : null,
    warn ? `Server ${warn.health}: ${warn.message ?? ""}` : null,
    view.pullDegraded, info.alias ? `Also open as ${info.alias}: language features are off in this tab` : null,
    ...(view.notes ?? []), ...Object.values(view.progress).map((title) => `Working: ${title}`),
  ].filter(Boolean).join("\n");
  return <span className="flex items-center gap-1">
    <button type="button" onClick={showLspOutput} title={detail} className={`${colour} hover:text-zinc-200`}>
      {info.alias ? `${name}: alias` : chipLabel(state, name)}{view.status.readyFallback ? " (no status)" : ""}{warn || watcher ? " ⚠" : ""}
    </button>
    {restartOffered(state, health?.health, watcher) && <button type="button" title={`Restart ${name}`} aria-label={`Restart ${name}`}
      onClick={() => void restartSession(info.session).catch((error) => console.warn("[lsp] restart failed:", error))}
      className="text-zinc-400 hover:text-zinc-100">↻ Restart</button>}
  </span>;
}

export default function StatusBar() {
  const solution = useSolution((s) => s.solution);
  const tabs = useSolution((s) => s.tabs);
  const activeFileId = useSolution((s) => s.activeFileId);
  const active = tabs.find((t) => t.fileId === activeFileId);
  const wordWrap = usePreferences((s) => s.wordWrap);
  const fontSize = usePreferences((s) => s.fontSize);
  const buildProblems = useBuild((s) => s.problems);
  const lspProblems = useLsp((s) => s.problems);
  // Counts include every source and may count one error more than once (no dedup in Stage 1).
  const errors = buildProblems.filter((p) => p.severity === "error").length + lspProblems.filter((p) => p.severity === "error").length;
  const warnings = buildProblems.filter((p) => p.severity === "warning").length + lspProblems.filter((p) => p.severity === "warning").length;

  return (
    <div className="h-6 bg-zinc-900 border-t border-zinc-800 flex items-center px-3 gap-3 text-[11px] text-zinc-500 shrink-0">
      <span className="text-zinc-400 truncate max-w-[240px]">
        {solution ? solution.name : "No solution"}
      </span>
      <span className="text-zinc-700">|</span>
      <span>{active?.language ?? "—"}</span>
      <span className="text-zinc-700">|</span>
      <span>{active ? active.name : "—"}</span>
      {wordWrap && (
        <>
          <span className="text-zinc-700">|</span>
          <span className="text-blue-400">Wrap</span>
        </>
      )}
      <span className="text-zinc-700">|</span>
      <span>{Math.round(fontSize)}px</span>
      <div className="ml-auto flex items-center gap-3">
        <ChipBoundary key={activeFileId ?? ""}><LanguageServerChip fileId={activeFileId} /></ChipBoundary>
        <span className="text-yellow-400" title="Warnings from the last build and the language server">⚠ {warnings}</span>
        <span className="text-red-400" title="Errors from the last build and the language server">✕ {errors}</span>
      </div>
    </div>
  );
}
