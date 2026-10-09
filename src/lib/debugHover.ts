import type { Monaco } from "@monaco-editor/react";
import type { editor, IRange, languages, Position } from "monaco-editor";
import { useDebug } from "../store/debugStore";
import { useLinkedWindows } from "../store/linkedWindowsStore";
import { useNativeDebug } from "../store/nativeDebugStore";
import { evaluateExpression, inspectVariables } from "./debugInspect";
import { expressionAt } from "./hoverExpression";

// Hover evaluation while paused (§2 item 3, R1 in docs/uiux/design-public-release-sweep.md).

/** The session that owns the displayed frames, matching the debug sidebar. */
export function inspectionContext(): { targetLabel: string | undefined; frameId: number | undefined; paused: boolean; stopKey: string } {
  const linked = useLinkedWindows.getState();
  const remote = linked.windows.find((item) => item.windowLabel === linked.viewedWindowLabel && item.windowLabel !== linked.ownWindowLabel);
  const native = !remote ? useNativeDebug.getState().context : null;
  const debug = useDebug.getState();
  const frames = native?.frames ?? remote?.debugFrames ?? debug.frames;
  const variables = native?.variables ?? remote?.debugVariables ?? debug.variables;
  const status = native?.status ?? (remote ? remote.status : debug.status);
  const targetLabel = native ? native.originLabel : remote?.windowLabel;
  return {
    targetLabel, frameId: frames[0]?.id, paused: status === "paused",
    stopKey: `${targetLabel ?? "own"}:${JSON.stringify([frames.map((frame) => [frame.id, frame.line]),
      (variables as { name: string; value: string }[]).map((variable) => [variable.name, variable.value])])}`,
  };
}

const MAX_MEMBERS = 20;
const cache = new Map<string, Promise<languages.Hover | null>>();
let registered = false;

function escape(text: string): string { return text.replace(/[\\`*_{}[\]()#+!|<>]/g, "\\$&"); }

async function evaluateHover(expression: string, range: IRange): Promise<languages.Hover | null> {
  const context = inspectionContext();
  try {
    const value = await evaluateExpression(context.targetLabel, expression, context.frameId, "hover");
    const lines = [`\`${escape(expression)}\`${value.type ? ` : *${escape(value.type)}*` : ""}`, "", `\`\`\`\n${value.value}\n\`\`\``];
    if (value.variablesReference > 0) {
      const members = await inspectVariables(context.targetLabel, value.variablesReference).catch(() => []);
      if (members.length) {
        lines.push(members.slice(0, MAX_MEMBERS).map((member) => `- \`${escape(member.name)}\` = ${escape(member.value)}`).join("\n"));
        if (members.length > MAX_MEMBERS) lines.push(`…and ${members.length - MAX_MEMBERS} more (see Variables or Watch)`);
      }
    }
    return { range, contents: lines.map((line) => ({ value: line })) };
  } catch {
    // Not every word is an expression the adapter can evaluate; show nothing rather than an error.
    return null;
  }
}

/** Register once for every language. Hovers appear only while paused, cached per stop. */
export function registerDebugHover(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  monaco.languages.registerHoverProvider("*", {
    provideHover(model: editor.ITextModel, position: Position) {
      const context = inspectionContext();
      if (!context.paused) { cache.clear(); return null; }
      const found = expressionAt(model.getLineContent(position.lineNumber), position.column);
      if (!found) return null;
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: found.start, endColumn: found.end };
      const key = `${context.stopKey}\u0000${found.expression}`;
      let hover = cache.get(key);
      if (!hover) {
        if (cache.size > 200) cache.clear();
        hover = evaluateHover(found.expression, range);
        cache.set(key, hover);
      }
      return hover;
    },
  });
}
