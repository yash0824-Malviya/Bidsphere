import { useCallback, useEffect, useRef, useState } from "react";

const POSITION_KEY = "bidsphere-chat-fab-pos";
const FAB_SIZE = 60;

interface Position {
  x: number;
  y: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Position;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return {
        x: clamp(parsed.x, 0, window.innerWidth - FAB_SIZE),
        y: clamp(parsed.y, 0, window.innerHeight - FAB_SIZE),
      };
    }
  } catch { /* corrupted */ }
  return null;
}

function defaultPosition(): Position {
  return {
    x: window.innerWidth - FAB_SIZE - 24,
    y: window.innerHeight - FAB_SIZE - 24,
  };
}

/**
 * Makes the chatbot FAB draggable via mouse and touch.
 * Returns a ref to attach, current position, dragging state,
 * and a handler that distinguishes clicks from drags.
 */
export function useDraggable() {
  const [position, setPosition] = useState<Position>(() => loadPosition() ?? defaultPosition());
  const [isDragging, setIsDragging] = useState(false);

  const dragRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const movedRef = useRef(false);

  const persist = useCallback((pos: Position) => {
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(pos)); } catch { /* quota */ }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const el = dragRef.current;
    if (!el) return;

    el.setPointerCapture(e.pointerId);
    startRef.current = { sx: e.clientX, sy: e.clientY, px: position.x, py: position.y };
    movedRef.current = false;
    setIsDragging(true);
  }, [position]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;

    const dx = e.clientX - s.sx;
    const dy = e.clientY - s.sy;

    if (!movedRef.current && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    movedRef.current = true;

    const nx = clamp(s.px + dx, 0, window.innerWidth - FAB_SIZE);
    const ny = clamp(s.py + dy, 0, window.innerHeight - FAB_SIZE);
    setPosition({ x: nx, y: ny });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const el = dragRef.current;
    if (el) el.releasePointerCapture(e.pointerId);
    startRef.current = null;
    setIsDragging(false);
    setPosition((p) => { persist(p); return p; });
  }, [persist]);

  useEffect(() => {
    function onResize() {
      setPosition((p) => ({
        x: clamp(p.x, 0, window.innerWidth - FAB_SIZE),
        y: clamp(p.y, 0, window.innerHeight - FAB_SIZE),
      }));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const wasDrag = useCallback(() => movedRef.current, []);

  return {
    dragRef,
    position,
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    wasDrag,
  } as const;
}
