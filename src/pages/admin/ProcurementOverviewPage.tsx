import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";

import { apiGet, buildResourceUrl, buildListConfig, withSilent } from "../../api/erpnext";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatCurrencyCompact } from "../../utils/format";

interface ProcStats {
  totalRFQs: number;
  draftRFQs: number;
  submittedRFQs: number;
  totalPOs: number;
  draftPOs: number;
  submittedPOs: number;
  recentRFQs: Array<{ name: string; status: string; transaction_date: string; grand_total: number }>;
  recentPOs: Array<{ name: string; status: string; supplier: string; grand_total: number; transaction_date: string }>;
}

async function fetchProcStats(): Promise<ProcStats> {
  const safeGet = async <T,>(url: string, cfg: object): Promise<T[]> => {
    try { return (await apiGet<T[]>(url, { ...cfg, ...withSilent() })) ?? []; }
    catch { return []; }
  };

  const [rfqs, pos, recentRFQs, recentPOs] = await Promise.all([
    safeGet<{ name: string; docstatus: number }>(
      buildResourceUrl("Request for Quotation"),
      buildListConfig({ fields: ["name", "docstatus"], limit_page_length: 0 })
    ),
    safeGet<{ name: string; docstatus: number }>(
      buildResourceUrl("Purchase Order"),
      buildListConfig({ fields: ["name", "docstatus"], limit_page_length: 0 })
    ),
    safeGet<{ name: string; status: string; transaction_date: string; grand_total: number }>(
      buildResourceUrl("Request for Quotation"),
      buildListConfig({ fields: ["name", "status", "transaction_date", "grand_total"], order_by: "creation desc", limit_page_length: 6 })
    ),
    safeGet<{ name: string; status: string; supplier: string; grand_total: number; transaction_date: string }>(
      buildResourceUrl("Purchase Order"),
      buildListConfig({ fields: ["name", "status", "supplier", "grand_total", "transaction_date"], order_by: "creation desc", limit_page_length: 6 })
    ),
  ]);

  return {
    totalRFQs: rfqs.length,
    draftRFQs: rfqs.filter((r) => r.docstatus === 0).length,
    submittedRFQs: rfqs.filter((r) => r.docstatus === 1).length,
    totalPOs: pos.length,
    draftPOs: pos.filter((p) => p.docstatus === 0).length,
    submittedPOs: pos.filter((p) => p.docstatus === 1).length,
    recentRFQs,
    recentPOs,
  };
}

export default function ProcurementOverviewPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-proc-overview"],
    queryFn: fetchProcStats,
    staleTime: 60_000,
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-50">
          <TrendingUp className="h-4 w-4 text-cyan-600" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">Procurement Overview</h1>
          <p className="text-[11px] text-neutral-500">Monitor RFQ and Purchase Order pipeline</p>
        </div>
      </div>

      {/* KPIs */}
      {isLoading ? (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-[72px] rounded-lg" />)}
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          <Stat icon={FileText} bg="bg-blue-50" color="text-blue-600" label="Total RFQs" value={data?.totalRFQs ?? 0} />
          <Stat icon={Clock} bg="bg-amber-50" color="text-amber-600" label="Draft RFQs" value={data?.draftRFQs ?? 0} />
          <Stat icon={CheckCircle2} bg="bg-emerald-50" color="text-emerald-600" label="Submitted RFQs" value={data?.submittedRFQs ?? 0} />
          <Stat icon={ShoppingCart} bg="bg-violet-50" color="text-violet-600" label="Total POs" value={data?.totalPOs ?? 0} />
          <Stat icon={AlertTriangle} bg="bg-orange-50" color="text-orange-600" label="Draft POs" value={data?.draftPOs ?? 0} />
          <Stat icon={CheckCircle2} bg="bg-green-50" color="text-green-600" label="Submitted POs" value={data?.submittedPOs ?? 0} />
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Recent RFQs */}
        <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-3 py-2.5">
            <h3 className="text-xs font-bold text-neutral-900">Recent RFQs</h3>
          </div>
          {isLoading ? (
            <div className="p-3 space-y-1">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
          ) : (data?.recentRFQs ?? []).length === 0 ? (
            <p className="p-4 text-center text-xs text-neutral-500">No RFQs found</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr className="border-b border-neutral-200">
                  <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">RFQ</th>
                  <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Date</th>
                  <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Status</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-neutral-500">Value</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recentRFQs ?? []).map((r) => (
                  <tr key={r.name} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2 font-mono text-[11px] font-medium text-primary-600">{r.name}</td>
                    <td className="px-3 py-2 text-neutral-500 tabular-nums">{r.transaction_date}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrencyCompact(r.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent POs */}
        <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-100 px-3 py-2.5">
            <h3 className="text-xs font-bold text-neutral-900">Recent Purchase Orders</h3>
          </div>
          {isLoading ? (
            <div className="p-3 space-y-1">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
          ) : (data?.recentPOs ?? []).length === 0 ? (
            <p className="p-4 text-center text-xs text-neutral-500">No POs found</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr className="border-b border-neutral-200">
                  <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">PO</th>
                  <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Supplier</th>
                  <th className="px-3 py-1.5 text-left font-semibold text-neutral-500">Status</th>
                  <th className="px-3 py-1.5 text-right font-semibold text-neutral-500">Value</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recentPOs ?? []).map((p) => (
                  <tr key={p.name} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2 font-mono text-[11px] font-medium text-primary-600">{p.name}</td>
                    <td className="px-3 py-2 text-neutral-700 truncate max-w-[140px]">{p.supplier}</td>
                    <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrencyCompact(p.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, bg, color, label, value }: { icon: typeof FileText; bg: string; color: string; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
      <div className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
        <Icon className={`h-3.5 w-3.5 ${color}`} />
      </div>
      <p className="text-lg font-bold tabular-nums text-neutral-900">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Draft: "bg-neutral-100 text-neutral-600",
    Submitted: "bg-blue-50 text-blue-700",
    Completed: "bg-emerald-50 text-emerald-700",
    Cancelled: "bg-red-50 text-red-700",
    Ordered: "bg-indigo-50 text-indigo-700",
    "To Receive and Bill": "bg-amber-50 text-amber-700",
  };
  return (
    <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${map[status] ?? "bg-neutral-100 text-neutral-600"}`}>
      {status}
    </span>
  );
}
