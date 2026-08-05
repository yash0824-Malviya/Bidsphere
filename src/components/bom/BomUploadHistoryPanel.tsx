import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Download,
  Eye,
  FileSpreadsheet,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
} from "lucide-react";

import type { BomHistoryRow, BomParsedRow } from "../../api/uploadedBom";
import { parseBomHistoryMeta } from "../../api/uploadedBom";
import { getFullFileUrl } from "../../api/legalDocsStorage";
import { formatDate } from "../../utils/format";

export type BomHistoryStatus =
  | "Uploading"
  | "Parsing"
  | "Validating"
  | "Preview Ready"
  | "RFQ Created"
  | "Completed"
  | "Processing"
  | "Failed"
  | "Cancelled";

export interface BomHistoryDisplayRow {
  id: string;
  bomName: string;
  project: string;
  program?: string;
  department?: string;
  uploadedBy: string;
  uploadDate: string;
  totalItems: number;
  status: BomHistoryStatus;
  progress: number;
  rfqCreated: boolean;
  rfq?: string;
  tempItems?: number;
  validationResult?: string;
  originalFile?: string;
  isActive?: boolean;
  source: "erp" | "session";
}

const STATUS_BADGE: Record<
  BomHistoryStatus,
  { className: string; tone: "blue" | "amber" | "green" | "red" | "gray" }
> = {
  Uploading: { className: "bg-[#EEF3FA] text-[#1F3A6D] ring-[#CBD5E1]", tone: "blue" },
  Parsing: { className: "bg-[#EEF3FA] text-[#1F3A6D] ring-[#CBD5E1]", tone: "blue" },
  Validating: { className: "bg-amber-50 text-amber-800 ring-amber-200", tone: "amber" },
  "Preview Ready": { className: "bg-amber-50 text-amber-800 ring-amber-200", tone: "amber" },
  Processing: { className: "bg-amber-50 text-amber-800 ring-amber-200", tone: "amber" },
  "RFQ Created": { className: "bg-emerald-50 text-emerald-800 ring-emerald-200", tone: "green" },
  Completed: { className: "bg-emerald-50 text-emerald-800 ring-emerald-200", tone: "green" },
  Failed: { className: "bg-rose-50 text-rose-800 ring-rose-200", tone: "red" },
  Cancelled: { className: "bg-slate-100 text-slate-600 ring-slate-200", tone: "gray" },
};

function inferProject(remarks: string): string {
  const trimmed = remarks.trim();
  if (!trimmed) return "—";
  const projectMatch = /project\s*[:=]\s*([^\n,;]+)/i.exec(trimmed);
  if (projectMatch?.[1]) return projectMatch[1].trim();
  if (trimmed.length <= 32 && !trimmed.includes(".")) return trimmed;
  return "—";
}

function inferBomName(row: BomHistoryRow): string {
  const remarks = row.remarks?.trim() ?? "";
  if (/\.xlsx?$/i.test(remarks)) return remarks;
  if (row.original_file) {
    const base = row.original_file.split("/").pop();
    if (base) return base;
  }
  return row.bom_number || row.name;
}

export function normalizeHistoryStatus(
  raw: string,
  hasRfq: boolean,
): BomHistoryStatus {
  const s = raw.trim();
  if (/fail/i.test(s)) return "Failed";
  if (/cancel/i.test(s)) return "Cancelled";
  if (/upload/i.test(s)) return "Uploading";
  if (/pars/i.test(s)) return "Parsing";
  if (/valid/i.test(s)) return "Validating";
  if (/preview/i.test(s)) return "Preview Ready";
  if (/process/i.test(s)) return "Processing";
  if (/rfq/i.test(s)) return hasRfq ? "Completed" : "RFQ Created";
  if (/complete/i.test(s)) return "Completed";
  if (hasRfq) return "Completed";
  if (!s) return "Processing";
  return "Preview Ready";
}

function statusProgress(status: BomHistoryStatus): number {
  switch (status) {
    case "Uploading":
      return 15;
    case "Parsing":
      return 35;
    case "Validating":
      return 55;
    case "Preview Ready":
      return 65;
    case "Processing":
      return 72;
    case "RFQ Created":
      return 92;
    case "Completed":
      return 100;
    case "Failed":
      return 0;
    case "Cancelled":
      return 0;
    default:
      return 0;
  }
}

export function mapHistoryRow(row: BomHistoryRow): BomHistoryDisplayRow {
  const hasRfq = !!row.rfq?.trim();
  const meta = parseBomHistoryMeta(row.remarks || "");
  const hasMr = !!meta.materialRequest;
  const status = normalizeHistoryStatus(row.status, hasRfq || hasMr);
  return {
    id: row.name,
    bomName: inferBomName(row),
    project: meta.project || inferProject(row.remarks),
    program: meta.program,
    department: meta.department,
    uploadedBy: row.uploaded_by || "—",
    uploadDate: row.upload_date || "",
    totalItems: row.total_items ?? 0,
    status,
    progress: statusProgress(status),
    rfqCreated: hasRfq || hasMr,
    rfq: meta.materialRequest || row.rfq || undefined,
    tempItems: meta.tempItems,
    validationResult: row.status || undefined,
    originalFile: row.original_file || undefined,
    source: "erp",
  };
}

export function buildSessionHistoryRow(input: {
  id: string;
  fileName: string;
  uploadedBy: string;
  totalItems: number;
  status: BomHistoryStatus;
  rfq?: string;
}): BomHistoryDisplayRow {
  const hasRfq = !!input.rfq;
  const status = input.rfq ? "Completed" : input.status;
  return {
    id: input.id,
    bomName: input.fileName,
    project: "—",
    uploadedBy: input.uploadedBy,
    uploadDate: new Date().toISOString().slice(0, 10),
    totalItems: input.totalItems,
    status,
    progress: statusProgress(status),
    rfqCreated: hasRfq,
    rfq: input.rfq,
    isActive: !hasRfq,
    source: "session",
  };
}

export function downloadValidationReportCsv(
  rows: BomParsedRow[],
  fileName: string,
): void {
  const header = [
    "Row",
    "Item Code",
    "Item Name",
    "Qty",
    "UOM",
    "Status",
    "Errors",
  ];
  const lines = rows.map((r) =>
    [
      r.row_number,
      r.item_code,
      r.item_name,
      r.qty,
      r.uom,
      r.status_label,
      (r.errors ?? []).join("; "),
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName.replace(/\.[^.]+$/, "")}_validation_report.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface SummaryProps {
  rows: BomHistoryDisplayRow[];
}

export function BomUploadSummaryCards({ rows }: SummaryProps) {
  const stats = useMemo(() => {
    let processing = 0;
    let completed = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.status === "Failed") failed += 1;
      else if (r.status === "Completed" || r.status === "RFQ Created") completed += 1;
      else if (r.status !== "Cancelled") processing += 1;
    }
    return { total: rows.length, processing, completed, failed };
  }, [rows]);

  const cards = [
    { label: "Total BOM Uploads", value: stats.total, tone: "text-[#1F3A6D] bg-[#EEF3FA]" },
    { label: "Processing", value: stats.processing, tone: "text-amber-700 bg-amber-50" },
    { label: "Completed", value: stats.completed, tone: "text-emerald-700 bg-emerald-50" },
    { label: "Failed", value: stats.failed, tone: "text-rose-700 bg-rose-50" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
            {c.label}
          </p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${c.tone.split(" ")[0]}`}>
            {c.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

interface HistoryPanelProps {
  rows: BomHistoryDisplayRow[];
  loading?: boolean;
  error?: boolean;
  sessionRows?: BomParsedRow[];
  sessionFileName?: string;
  variant?: "department" | "procurement";
  onUploadClick: () => void;
  onViewPreview: (row: BomHistoryDisplayRow) => void;
  onContinue: (row: BomHistoryDisplayRow) => void;
  onCreateRfq: (row: BomHistoryDisplayRow) => void;
  onRetry: () => void;
}

export default function BomUploadHistoryPanel({
  rows,
  loading,
  error,
  sessionRows,
  sessionFileName,
  variant = "procurement",
  onUploadClick,
  onViewPreview,
  onContinue,
  onCreateRfq,
  onRetry,
}: HistoryPanelProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const projects = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.project).filter((p) => p && p !== "—"))).sort(),
    [rows],
  );

  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.status))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (projectFilter && r.project !== projectFilter) return false;
      if (dateFrom && r.uploadDate && r.uploadDate < dateFrom) return false;
      if (dateTo && r.uploadDate && r.uploadDate > dateTo) return false;
      if (!q) return true;
      return (
        r.bomName.toLowerCase().includes(q) ||
        r.project.toLowerCase().includes(q) ||
        r.uploadedBy.toLowerCase().includes(q) ||
        (r.rfq ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, projectFilter, dateFrom, dateTo]);

  const isDepartment = variant === "department";

  return (
    <section
      id="bom-upload-history"
      className="rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
    >
      <div className="border-b border-[#EEF2F7] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-[#1E293B]">
              {isDepartment ? "Department Upload History" : "BOM Upload History"}
            </h2>
            <p className="mt-0.5 text-[13px] text-[#64748B]">
              {isDepartment
                ? "Uploaded Department BOMs, validation results, Material Requests, and Temporary Items"
                : "Previously uploaded BOMs, processing state, and RFQ outcomes"}
            </p>
          </div>
          <button
            type="button"
            onClick={onUploadClick}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1F3A6D] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-[#17315D]"
          >
            <Upload className="h-4 w-4" />
            Upload BOM
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative md:col-span-2 xl:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search BOM…"
              className="w-full rounded-xl border border-[#E2E8F0] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#1F3A6D] focus:ring-2 focus:ring-[#EEF3FA]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm outline-none focus:border-[#1F3A6D]"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {!isDepartment ? (
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="rounded-xl border border-[#E2E8F0] px-3 py-2 text-sm outline-none focus:border-[#1F3A6D]"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          ) : null}
          <div className="flex gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-[#E2E8F0] px-2 py-2 text-sm outline-none focus:border-[#1F3A6D]"
              aria-label="From date"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-[#E2E8F0] px-2 py-2 text-sm outline-none focus:border-[#1F3A6D]"
              aria-label="To date"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-[#F1F5F9]" />
          ))}
        </div>
      ) : error ? (
        <div className="px-6 py-10 text-center text-sm text-rose-600">
          Could not load BOM history. Run the Uploaded BOM DocType setup script if needed.
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#EEF3FA] text-[#1F3A6D]">
            <FileSpreadsheet className="h-8 w-8" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-[#1E293B]">No BOM uploads yet</h3>
          <p className="mt-1 max-w-md text-sm text-[#64748B]">
            {isDepartment
              ? "Upload your first Department BOM to validate parts and generate a Material Request."
              : "Upload your first BOM to generate RFQs."}
          </p>
          <button
            type="button"
            onClick={onUploadClick}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#1F3A6D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#17315D]"
          >
            <Upload className="h-4 w-4" />
            Upload BOM
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full text-left text-sm">
            <thead className="sticky top-0 z-[1] border-b border-[#EEF2F7] bg-[#F8FAFC] text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
              <tr>
                {isDepartment ? <th className="px-4 py-3">Upload ID</th> : null}
                <th className="px-4 py-3">{isDepartment ? "File" : "BOM Name"}</th>
                {!isDepartment ? <th className="px-3 py-3">Project</th> : null}
                {isDepartment ? <th className="px-3 py-3">Department</th> : null}
                <th className="px-3 py-3">Uploaded By</th>
                <th className="px-3 py-3">Upload Date</th>
                <th className="px-3 py-3 text-right">Items</th>
                <th className="px-3 py-3">Status</th>
                {!isDepartment ? (
                  <th className="px-3 py-3 min-w-[120px]">Progress</th>
                ) : null}
                {isDepartment ? <th className="px-3 py-3">Validation</th> : null}
                <th className="px-3 py-3">
                  {isDepartment ? "Material Request" : "RFQ"}
                </th>
                {isDepartment ? <th className="px-3 py-3 text-right">Temp Items</th> : null}
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[#F8FAFC] transition hover:bg-[#F8FAFC]"
                >
                  {isDepartment ? (
                    <td className="px-4 py-3 font-mono text-xs text-[#64748B]">{row.id}</td>
                  ) : null}
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#1E293B]">{row.bomName}</p>
                    {row.isActive ? (
                      <span className="text-[10px] font-medium text-[#1F3A6D]">Current session</span>
                    ) : null}
                  </td>
                  {!isDepartment ? (
                    <td className="px-3 py-3 text-[#475569]">{row.project}</td>
                  ) : null}
                  {isDepartment ? (
                    <td className="px-3 py-3 text-[#475569]">{row.department || "—"}</td>
                  ) : null}
                  <td className="px-3 py-3 text-[#475569]">{row.uploadedBy}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-[#64748B]">
                    {row.uploadDate ? formatDate(row.uploadDate) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium text-[#1E293B]">
                    {row.totalItems.toLocaleString()}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  {!isDepartment ? (
                    <td className="px-3 py-3">
                      <ProgressBar value={row.progress} status={row.status} />
                    </td>
                  ) : null}
                  {isDepartment ? (
                    <td className="px-3 py-3 text-[#64748B]">{row.validationResult || "—"}</td>
                  ) : null}
                  <td className="px-3 py-3">
                    {row.rfqCreated && row.rfq ? (
                      <Link
                        to={
                          isDepartment
                            ? `/material-requests/${encodeURIComponent(row.rfq)}`
                            : `/sourcing/rfq/${encodeURIComponent(row.rfq)}`
                        }
                        className="font-semibold text-[#1F3A6D] no-underline hover:underline"
                      >
                        {isDepartment ? row.rfq : "Yes"}
                      </Link>
                    ) : (
                      <span className="text-[#94A3B8]">{isDepartment ? "—" : "No"}</span>
                    )}
                  </td>
                  {isDepartment ? (
                    <td className="px-3 py-3 text-right tabular-nums text-[#475569]">
                      {row.tempItems ?? "—"}
                    </td>
                  ) : null}
                  <td className="relative px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMenu((m) => (m === row.id ? null : row.id))
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]"
                      aria-label="Row actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {openMenu === row.id ? (
                      <RowActionsMenu
                        row={row}
                        variant={variant}
                        sessionRows={row.isActive ? sessionRows : undefined}
                        sessionFileName={row.isActive ? sessionFileName : undefined}
                        onClose={() => setOpenMenu(null)}
                        onViewPreview={() => {
                          setOpenMenu(null);
                          onViewPreview(row);
                        }}
                        onContinue={() => {
                          setOpenMenu(null);
                          onContinue(row);
                        }}
                        onCreateRfq={() => {
                          setOpenMenu(null);
                          onCreateRfq(row);
                        }}
                        onRetry={() => {
                          setOpenMenu(null);
                          onRetry();
                        }}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: BomHistoryStatus }) {
  const meta = STATUS_BADGE[status];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${meta.className}`}
    >
      {status}
    </span>
  );
}

function ProgressBar({
  value,
  status,
}: {
  value: number;
  status: BomHistoryStatus;
}) {
  const color =
    status === "Failed"
      ? "bg-rose-500"
      : status === "Completed" || status === "RFQ Created"
        ? "bg-emerald-500"
        : "bg-[#1F3A6D]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 min-w-[72px] flex-1 overflow-hidden rounded-full bg-[#EEF2F7]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-[#64748B]">
        {value}%
      </span>
    </div>
  );
}

function RowActionsMenu({
  row,
  variant = "procurement",
  sessionRows,
  sessionFileName,
  onClose,
  onViewPreview,
  onContinue,
  onCreateRfq,
  onRetry,
}: {
  row: BomHistoryDisplayRow;
  variant?: "department" | "procurement";
  sessionRows?: BomParsedRow[];
  sessionFileName?: string;
  onClose: () => void;
  onViewPreview: () => void;
  onContinue: () => void;
  onCreateRfq: () => void;
  onRetry: () => void;
}) {
  const isDepartment = variant === "department";
  const canPreview = row.isActive || !!row.rfq;
  const canOriginal = !!row.originalFile;
  const canReport = !!sessionRows?.length && !!sessionFileName;
  const canRfq = row.isActive && !row.rfqCreated;
  const canContinue = row.isActive || row.status === "Processing" || row.status === "Preview Ready";
  const canRetry = row.status === "Failed" || row.isActive;

  const items: Array<{
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    disabled?: boolean;
  }> = [
    {
      label: "View Preview",
      icon: Eye,
      onClick: onViewPreview,
      disabled: !canPreview,
    },
    {
      label: "Download Original BOM",
      icon: Download,
      onClick: () => {
        onClose();
        if (row.originalFile) {
          window.open(getFullFileUrl(row.originalFile), "_blank", "noopener,noreferrer");
        }
      },
      disabled: !canOriginal,
    },
    {
      label: "Download Validation Report",
      icon: FileSpreadsheet,
      onClick: () => {
        onClose();
        if (sessionRows && sessionFileName) {
          downloadValidationReportCsv(sessionRows, sessionFileName);
        }
      },
      disabled: !canReport,
    },
    ...(isDepartment
      ? []
      : [
          {
            label: "Create RFQ",
            icon: Send,
            onClick: onCreateRfq,
            disabled: !canRfq,
          },
        ]),
    {
      label: "Continue Processing",
      icon: Play,
      onClick: onContinue,
      disabled: !canContinue,
    },
    {
      label: "Retry",
      icon: RefreshCw,
      onClick: onRetry,
      disabled: !canRetry,
    },
    {
      label: "Delete",
      icon: Trash2,
      onClick: () => {
        onClose();
        // UI-only — no delete API on Uploaded BOM records.
      },
      disabled: true,
    },
  ];

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[10]"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div className="absolute right-4 top-full z-[20] mt-1 w-56 overflow-hidden rounded-xl border border-[#E2E8F0] bg-white py-1 shadow-[0_12px_32px_rgba(15,23,42,0.12)]">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={item.onClick}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#334155] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <item.icon className="h-4 w-4 shrink-0 text-[#64748B]" />
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
