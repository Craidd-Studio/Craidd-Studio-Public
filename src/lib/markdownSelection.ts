/** Map a browser text selection through literal-text spans emitted by the
 * renderer. Never guess offsets from a repeated word or rewrite hidden syntax. */
export function markdownSelectionRange(container: HTMLElement, selection: Selection | null, source: string): { start: number; end: number } | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const offset = (node: Node, local: number) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const span = element?.closest<HTMLElement>("[data-md-text-start]");
    if (!span || !container.contains(span)) return null;
    const prefix = document.createRange(); prefix.selectNodeContents(span); prefix.setEnd(node, local);
    return Number(span.dataset.mdTextStart) + prefix.toString().length;
  };
  const start = offset(range.startContainer, range.startOffset), end = offset(range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end || source.slice(start, end) !== selection.toString()) return null;
  const startBlock = range.startContainer.parentElement?.closest(".md-block");
  const endBlock = range.endContainer.parentElement?.closest(".md-block");
  return startBlock && startBlock === endBlock ? { start, end } : null;
}

export function restoreMarkdownSelection(container: HTMLElement, start: number, end: number): void {
  const spans = Array.from(container.querySelectorAll<HTMLElement>("[data-md-text-start]"));
  const point = (offset: number) => {
    const span = spans.find((element) => {
      const base = Number(element.dataset.mdTextStart);
      return offset >= base && offset <= base + (element.textContent?.length ?? 0);
    });
    return span?.firstChild ? { node: span.firstChild, offset: offset - Number(span.dataset.mdTextStart) } : null;
  };
  const from = point(start), to = point(end);
  if (!from || !to) return;
  const range = document.createRange(); range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
