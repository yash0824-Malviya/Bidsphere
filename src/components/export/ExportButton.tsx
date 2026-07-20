import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Table2,
} from "lucide-react";

import {
  recordExportActivity,
  runListExport,
  type ExportColumn,
  type ExportFormat,
} from "../../utils/export";
import { useAuthStore } from "../../store/authStore";

interface Props<T> {
  module: string;
  filenamePrefix: string;
  columns: ExportColumn<T>[];
  /** Filtered / sorted rows currently in view (not the unfiltered source). */
  rows: T[];
  title?: string;
  disabled?: boolean;
  className?: string;
}

const FORMATS: Array<{
  id: ExportFormat;
  label: string;
  hint: string;
  Icon: typeof FileSpreadsheet;
}> = [
  {
    id: "xlsx",
    label: "Excel (.xlsx)",
    hint: "Spreadsheet for analysis",
    Icon: FileSpreadsheet,
  },
  {
    id: "pdf",
    label: "PDF",
    hint: "Printable report",
    Icon: FileText,
  },
  {
    id: "csv",
    label: "CSV",
    hint: "Plain comma-separated",
    Icon: Table2,
  },
];

/**
 * Consistent Export control for list pages: format picker + column selection.
 * Does not alter list data — only exports the `rows` prop as provided.
 */
export default function ExportButton<T>({
  module,
  filenamePrefix,
  columns,
  rows,
  title,
  disabled,
  className = "",
}: Props<T>) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"menu" | "columns">("menu");
  const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(
      columns
        .filter((c) => c.defaultSelected !== false)
        .map((c) => c.id),
    ),
  );
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(
      new Set(
        columns
          .filter((c) => c.defaultSelected !== false)
          .map((c) => c.id),
      ),
    );
  }, [columns]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPanel("menu");
        setPendingFormat(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPanel("menu");
        setPendingFormat(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedColumns = useMemo(
    () => columns.filter((c) => selected.has(c.id)),
    [columns, selected],
  );

  function toggleColumn(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(columns.map((c) => c.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function runExport(format: ExportFormat) {
    if (selectedColumns.length === 0) {
      toast.error("Select at least one column to export.");
      return;
    }
    if (rows.length === 0) {
      toast.error("No records to export with the current filters.");
      return;
    }

    setBusy(true);
    try {
      const result = await runListExport({
        module,
        filenamePrefix,
        format,
        columns: selectedColumns,
        rows,
        title: title || module,
      });

      const actor =
        user?.email || user?.full_name || user?.name || "Unknown User";
      void recordExportActivity({
        user: actor,
        module,
        format: result.format,
        filename: result.filename,
        rowCount: result.rowCount,
      });

      toast.success(
        `Exported ${result.rowCount} record${result.rowCount === 1 ? "" : "s"} as ${result.filename}`,
      );
      setOpen(false);
      setPanel("menu");
      setPendingFormat(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  function chooseFormat(format: ExportFormat) {
    setPendingFormat(format);
    setPanel("columns");
  }

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          setOpen((v) => !v);
          setPanel("menu");
          setPendingFormat(null);
        }}
        className="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-50"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        Export
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-72 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg"
        >
          {panel === "menu" ? (
            <div className="p-1.5">
              <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Export format · {rows.length} record
                {rows.length === 1 ? "" : "s"}
              </p>
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => chooseFormat(f.id)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-neutral-50"
                >
                  <f.Icon className="mt-0.5 h-4 w-4 text-primary-600" />
                  <span>
                    <span className="block text-sm font-semibold text-neutral-800">
                      {f.label}
                    </span>
                    <span className="block text-[11px] text-neutral-500">
                      {f.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-neutral-800">
                  Columns · {pendingFormat?.toUpperCase()}
                </p>
                <div className="flex gap-2 text-[11px] font-semibold">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-primary-600 hover:underline"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={selectNone}
                    className="text-neutral-500 hover:underline"
                  >
                    None
                  </button>
                </div>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {columns.map((col) => {
                  const on = selected.has(col.id);
                  return (
                    <li key={col.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
                        <span
                          className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                            on
                              ? "border-primary-600 bg-primary-600 text-white"
                              : "border-neutral-300 bg-white"
                          }`}
                        >
                          {on ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={() => toggleColumn(col.id)}
                        />
                        {col.label}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPanel("menu");
                    setPendingFormat(null);
                  }}
                  className="btn-secondary flex-1 justify-center py-1.5 text-xs"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy || !pendingFormat}
                  onClick={() => pendingFormat && void runExport(pendingFormat)}
                  className="btn-primary flex-1 justify-center py-1.5 text-xs"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Download"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
