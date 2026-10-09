import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { placeMenu } from "../lib/menuPlacement";

/**
 * Keep a click-positioned menu inside the viewport. It is measured before paint
 * and again whenever its size changes (items that load late, such as Open in
 * VS Code). `open` is the menu's state object; a new object re-places the menu.
 */
export function useMenuPlacement<T extends HTMLElement = HTMLDivElement>(x: number, y: number, open: unknown) {
  const ref = useRef<T>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: x, top: y });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const placed = placeMenu(x, y, width, height, window.innerWidth, window.innerHeight);
      setStyle({ left: placed.left, top: placed.top, maxHeight: placed.maxHeight, overflowY: "auto" });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [x, y, open]);
  return { ref, style };
}
