import { useCallback, useRef } from "react";

type Orientation = "vertical" | "horizontal";

interface Props {
  orientation: Orientation;   // vertical = drag left/right, horizontal = drag up/down
  onDrag: (deltaPx: number) => void;
  className?: string;
}

/**
 * A 4px hit area with a 1px visible line. Cursor changes on hover.
 * We use pointer capture so drag works even when the pointer leaves the handle.
 */
export default function ResizeHandle({ orientation, onDrag, className = "" }: Props) {
  const draggingPointer = useRef<number | null>(null);
  const lastPos = useRef(0);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (draggingPointer.current !== e.pointerId) return;
    draggingPointer.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || e.isPrimary === false || draggingPointer.current !== null) return;
    draggingPointer.current = e.pointerId;
    lastPos.current = orientation === "vertical" ? e.clientX : e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [orientation]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (draggingPointer.current !== e.pointerId) return;
    if (!(e.buttons & 1)) { endDrag(e); return; }
    const pos = orientation === "vertical" ? e.clientX : e.clientY;
    const delta = pos - lastPos.current;
    lastPos.current = pos;
    if (delta) onDrag(delta);
  }, [orientation, onDrag, endDrag]);

  const isVertical = orientation === "vertical";

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      className={
        "group relative shrink-0 " +
        (isVertical
          ? "w-1 cursor-col-resize hover:bg-blue-500/40"
          : "h-1 cursor-row-resize hover:bg-blue-500/40") +
        " " + className
      }
      style={{ touchAction: "none" }}
    >
      <div
        className={
          "absolute bg-zinc-800 group-hover:bg-blue-500 transition-colors " +
          (isVertical
            ? "left-1/2 top-0 bottom-0 w-px -translate-x-1/2"
            : "top-1/2 left-0 right-0 h-px -translate-y-1/2")
        }
      />
    </div>
  );
}
