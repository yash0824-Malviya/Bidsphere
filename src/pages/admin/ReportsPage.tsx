import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Ban,
  Briefcase,
  Calendar,
  Download,
  Factory,
  FileText,
  ShoppingCart,
  Truck,
  DollarSign,
} from "lucide-react";

import { getReportData } from "../../api/admin";
import type { ReportRow } from "../../api/admin";
import { fetchProcurementTypeKpis } from "../../api/materialRequestWorkflow";
import {
  getAllDeclineResponses,
  summarizeDeclineReasons,
} from "../../api/supplierRfqResponse";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatCurrencyCompact } from "../../utils/format";

type ReportType = "rfq" | "supplier" | "po" | "spend" | "decline";

const REPORT_TABS: Array<{ id: ReportType; label: string; icon: typeof FileText }> = [
  { id: "rfq", label: "RFQ Reports", icon: FileText },
  { id: "supplier", label: "Supplier Reports", icon: Truck },
  { id: "po", label: "PO Reports", icon: ShoppingCart },
  { id: "spend", label: "Spend Analysis", icon: DollarSign },
  { id: "decline", label: "Supplier Declines", icon: Ban },
];

const REPORT_COLUMNS: Record<ReportType, string[]> = {
  rfq: ["name", "transaction_date", "status", "supplier", "grand_total"],
  supplier: ["name", "supplier_name", "country", "disabled"],
  po: ["name", "supplier", "transaction_date", "grand_total", "status", "per_received", "per_billed"],
  spend: ["name", "supplier", "transaction_date", "grand_total", "status"],
  decline: ["rfq", "supplier_name", "decline_reason", "reason_details", "response_date"],
};

const COL_LABELS: Record<string, string> = {
  name: "ID",
  rfq: "RFQ",
  transaction_date: "Date",
  status: "Status",
  supplier: "Supplier",
  supplier_name: "Supplier Name",
  supplier_group: "Group",
  country: "Country",
  disabled: "Active",
  grand_total: "Amount",
  per_received: "Received %",
  per_billed: "Billed %",
  decline_reason: "Decline Reason",
  reason_details: "Details",
  response_date: "Declined On",
};

export default function ReportsPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ReportType>("rfq");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: typeKpis } = useQuery({
    queryKey: ["procurement-type-kpis"],
    queryFn: fetchProcurementTypeKpis,
    staleTime: 60_000,
  });

  const { data: rows = [], isLoading } = useQuery<ReportRow[]>({
    queryKey: ["admin-report", activeTab, dateFrom, dateTo],
    queryFn: async () => {
      if (activeTab === "decline") {
        const responses = await getAllDeclineResponses({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        });
        return responses as unknown as ReportRow[];
      }
      return getReportData(activeTab, dateFrom || undefined, dateTo || undefined);
    },
    staleTime: 30_000,
  });

  const declineStats =
    activeTab === "decline"
      ? summarizeDeclineReasons(rows as unknown as Parameters<typeof summarizeDeclineReasons>[0])
      : [];

  const columns = REPORT_COLUMNS[activeTab];

  function exportCSV(data: ReportRow[]) {
    if (data.length === 0) return;
    const header = columns.map((c) => COL_LABELS[c] ?? c).join(",");
    const csvRows = data.map((row) =>
      columns.map((c) => {
        const val = row[c];
        if (val === null || val === undefined) return "";
        return typeof val === "string" && val.includes(",") ? `"${val}"` : String(val);
      }).join(",")
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `netlink-procurement-${activeTab}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
            <BarChart3 className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-900">Reports & Analytics</h1>
            <p className="text-[11px] text-neutral-500">Generate and export procurement reports</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => exportCSV(rows)}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50 disabled:opacity-50 cursor-pointer border-none"
        >
          <Download className="h-3 w-3" /> Export CSV
        </button>
      </div>

      {/* Direct vs Indirect procurement KPIs */}
      <div className="mb-4">
        <h2 className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">
          {t("reports.procurementTypeBreakdown")}
        </h2>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          <TypeKpi
            icon={Factory}
            color="text-blue-600"
            iconBg="bg-blue-100"
            label={t("reports.totalDirect")}
            value={typeKpis?.directCount ?? 0}
          />
          <TypeKpi
            icon={Briefcase}
            color="text-orange-600"
            iconBg="bg-orange-100"
            label={t("reports.totalIndirect")}
            value={typeKpis?.indirectCount ?? 0}
          />
          <TypeKpi
            icon={DollarSign}
            color="text-blue-600"
            iconBg="bg-blue-100"
            label={t("reports.directSpend")}
            value={formatCurrencyCompact(typeKpis?.directSpend ?? 0)}
          />
          <TypeKpi
            icon={DollarSign}
            color="text-orange-600"
            iconBg="bg-orange-100"
            label={t("reports.indirectSpend")}
            value={formatCurrencyCompact(typeKpis?.indirectSpend ?? 0)}
          />
          <TypeKpi
            icon={ShoppingCart}
            color="text-blue-600"
            iconBg="bg-blue-100"
            label={t("reports.directPurchaseOrders")}
            value={typeKpis?.directPurchaseOrders ?? 0}
          />
          <TypeKpi
            icon={ShoppingCart}
            color="text-orange-600"
            iconBg="bg-orange-100"
            label={t("reports.indirectPurchaseOrders")}
            value={typeKpis?.indirectPurchaseOrders ?? 0}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-3 flex items-center gap-1 border-b border-neutral-200">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-semibold transition cursor-pointer bg-transparent border-l-0 border-r-0 border-t-0 ${
              activeTab === tab.id
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-neutral-500 hover:text-neutral-700"
            }`}
          >
            <tab.icon className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date Filters */}
      <div className="mb-3 flex items-center gap-2">
        <Calendar className="h-3.5 w-3.5 text-neutral-400" />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
          placeholder="From"
        />
        <span className="text-xs text-neutral-400">to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded border border-neutral-200 px-2 py-1 text-xs focus:border-primary-400 focus:outline-none"
          placeholder="To"
        />
        {(dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => { setDateFrom(""); setDateTo(""); }}
            className="text-[11px] text-neutral-500 hover:text-neutral-700 cursor-pointer bg-transparent border-none"
          >
            Clear
          </button>
        )}
      </div>

      {/* Most Common Decline Reasons */}
      {activeTab === "decline" && declineStats.length > 0 && (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Most Common Decline Reasons · {rows.length} total
          </h2>
          <div className="space-y-2">
            {declineStats.map((stat) => (
              <div key={stat.reason} className="flex items-center gap-3">
                <span className="w-52 shrink-0 truncate text-xs font-medium text-neutral-700">
                  {stat.reason}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full bg-warning-500"
                    style={{ width: `${stat.pct}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                  {stat.count} ({stat.pct}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Table */}
      {isLoading ? (
        <div className="space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-9 rounded" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white py-16 text-center shadow-sm">
          <BarChart3 className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">No data found</p>
          <p className="mt-0.5 text-xs text-neutral-500">Adjust date range or report type.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-50 z-10">
                <tr className="border-b border-neutral-200">
                  {columns.map((col) => (
                    <th key={col} className="px-3 py-2 text-left font-semibold text-neutral-500 whitespace-nowrap">
                      {COL_LABELS[col] ?? col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/60 transition-colors">
                    {columns.map((col) => (
                      <td key={col} className="px-3 py-2 text-neutral-700 whitespace-nowrap">
                        <CellValue colName={col} value={row[col]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-neutral-200 px-3 py-2">
            <p className="text-[11px] text-neutral-500">{rows.length} records</p>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeKpi({
  icon: Icon,
  color,
  iconBg,
  label,
  value,
}: {
  icon: typeof Factory;
  color: string;
  iconBg: string;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5 shadow-sm">
      <div className={`mb-1.5 flex h-6 w-6 items-center justify-center rounded-md ${iconBg}`}>
        <Icon className={`h-3 w-3 ${color}`} />
      </div>
      <p className="text-lg font-bold tabular-nums leading-tight text-neutral-900">
        {value}
      </p>
      <p className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </p>
    </div>
  );
}

function CellValue({ colName, value }: { colName: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-neutral-400">—</span>;

  if (colName === "name") {
    return <span className="font-mono text-[11px] font-medium text-primary-600">{String(value)}</span>;
  }

  if (colName === "status") {
    const statusColors: Record<string, string> = {
      Draft: "bg-neutral-100 text-neutral-600",
      Submitted: "bg-blue-50 text-blue-700",
      Completed: "bg-emerald-50 text-emerald-700",
      Cancelled: "bg-red-50 text-red-700",
      Ordered: "bg-indigo-50 text-indigo-700",
    };
    const s = String(value);
    return (
      <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${statusColors[s] ?? "bg-neutral-100 text-neutral-600"}`}>
        {s}
      </span>
    );
  }

  if (colName === "disabled") {
    return value === 0 || value === "0" ? (
      <span className="text-emerald-600 font-semibold">Yes</span>
    ) : (
      <span className="text-red-600 font-semibold">No</span>
    );
  }

  if (colName === "grand_total" || colName === "per_received" || colName === "per_billed") {
    const num = typeof value === "number" ? value : parseFloat(String(value));
    if (isNaN(num)) return <span>{String(value)}</span>;
    if (colName === "grand_total") {
      return <span className="tabular-nums font-medium">{num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
    }
    return <span className="tabular-nums">{num.toFixed(1)}%</span>;
  }

  return <span>{String(value)}</span>;
}
