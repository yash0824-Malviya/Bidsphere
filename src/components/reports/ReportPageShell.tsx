import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";

import ExportButton from "../export/ExportButton";
import type { ExportColumn } from "../../utils/export";
import { formatDateTime } from "../../utils/format";

interface Props<T> {
  title: string;
  subtitle: string;
  badge?: string;
  lastUpdated?: Date | string | null;
  loading?: boolean;
  onRefresh: () => void;
  exportModule: string;
  exportFilename: string;
  exportColumns: ExportColumn<T>[];
  exportRows: T[];
  filters?: ReactNode;
  kpis?: ReactNode;
  charts?: ReactNode;
  children: ReactNode;
}

export default function ReportPageShell<T>({
  title,
  subtitle,
  badge,
  lastUpdated,
  loading,
  onRefresh,
  exportModule,
  exportFilename,
  exportColumns,
  exportRows,
  filters,
  kpis,
  charts,
  children,
}: Props<T>) {
  const updatedLabel = lastUpdated
    ? formatDateTime(
        typeof lastUpdated === "string"
          ? lastUpdated
          : lastUpdated.toISOString(),
      )
    : "—";

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            to="/reports/operations"
            className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary-600 no-underline hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Operational Reports
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
              {title}
            </h1>
            {badge ? (
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 ring-1 ring-neutral-200">
                {badge}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#64748B]">
            {subtitle}
          </p>
          <p className="mt-2 text-[11px] text-neutral-400">
            Last updated {updatedLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E8EDF5] bg-white px-3 py-2 text-[12px] font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <ExportButton
            module={exportModule}
            filenamePrefix={exportFilename}
            columns={exportColumns}
            rows={exportRows}
            title={title}
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E8EDF5] bg-white px-3 py-2 text-[12px] font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </button>
        </div>
      </div>

      {kpis}
      {filters}
      {charts}
      {children}
    </div>
  );
}
