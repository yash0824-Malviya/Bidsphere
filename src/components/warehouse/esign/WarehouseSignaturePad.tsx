import { useEffect, useRef, useState } from "react";
import { Eraser, Redo2, Save, Undo2 } from "lucide-react";

interface Props {
  disabled?: boolean;
  onSaved: (dataUrl: string) => void;
  /** Label for the save action (default "Save"). */
  saveLabel?: string;
}

/**
 * Draw-signature canvas with undo / redo / clear / save.
 */
export default function WarehouseSignaturePad({
  disabled,
  onSaved,
  saveLabel = "Save signature",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [strokes, setStrokes] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.2;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  function snapshot(): ImageData | null {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function restore(data: ImageData) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.putImageData(data, 0, 0);
  }

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const snap = snapshot();
    if (snap) {
      setStrokes((prev) => [...prev, snap]);
      setRedoStack([]);
    }
    drawing.current = true;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDirty(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const snap = snapshot();
    if (snap) setStrokes((prev) => [...prev, snap]);
    setRedoStack([]);
    const rect = canvas.getBoundingClientRect();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    // Re-apply white in CSS pixel space after scale
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setDirty(false);
  }

  function handleUndo() {
    const prev = strokes[strokes.length - 1];
    if (!prev) return;
    const current = snapshot();
    if (current) setRedoStack((r) => [...r, current]);
    setStrokes((s) => s.slice(0, -1));
    restore(prev);
    setDirty(strokes.length > 1);
  }

  function handleRedo() {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    const current = snapshot();
    if (current) setStrokes((s) => [...s, current]);
    setRedoStack((r) => r.slice(0, -1));
    restore(next);
    setDirty(true);
  }

  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas || !dirty) return;
    onSaved(canvas.toDataURL("image/png"));
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <canvas
          ref={canvasRef}
          className="h-44 w-full touch-none cursor-crosshair bg-white"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || strokes.length === 0}
          onClick={handleUndo}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo
        </button>
        <button
          type="button"
          disabled={disabled || redoStack.length === 0}
          onClick={handleRedo}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
        >
          <Redo2 className="h-3.5 w-3.5" />
          Redo
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={handleClear}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" />
          Clear
        </button>
        <button
          type="button"
          disabled={disabled || !dirty}
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" />
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
