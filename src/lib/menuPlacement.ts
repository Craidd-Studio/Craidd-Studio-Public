// Keep a click-positioned menu inside the window (R3, docs/uiux/design-public-release-sweep.md §8).

const MARGIN = 4;

/** Open at the click point; flip left/up when the menu would cross the edge; clamp to the margin. */
export function placeMenu(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  let left = x + width + MARGIN > viewportWidth ? x - width : x;
  let top = y + height + MARGIN > viewportHeight ? y - height : y;
  left = Math.max(MARGIN, Math.min(left, viewportWidth - width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, viewportHeight - height - MARGIN));
  return { left, top, maxHeight: viewportHeight - 2 * MARGIN };
}
