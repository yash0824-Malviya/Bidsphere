import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Download,
  Eye,
  FileCheck2,
} from "lucide-react";
import type { PurchaseOrder } from "../../types/erpnext";
import { formatCurrency, formatDate } from "../../utils/format";
import StatusBadge from "../StatusBadge";
import { downloadPurchaseOrderPdf } from "../../utils/pdf";
import { getPurchaseOrder } from "../../api/purchasing";
import toast from "react-hot-toast";

interface Props {
  purchaseOrders?: PurchaseOrder[];
  loading?: boolean;
}

export default function PurchaseOrdersMonitoringSection({
  purchaseOrders = [],
  loading = false,
}: Props) {
  const stats = useMemo(() => {
    let completed = 0;
    let inExecution = 0;
    let drafts = 0;
    let totalValue = 0;

    for (const po of purchaseOrders) {
      const status = (po.status || "").toLowerCase();
      const val = po.grand_total || po.total || 0;
      totalValue += val;

      if (status === "completed" || status === "closed") {
        completed += 1;
      } else if (status === "draft" || status === "on hold") {
        drafts += 1;
      } else {
        inExecution += 1;
      }
    }

    return {
      total: purchaseOrders.length,
      completed,
      inExecution,
      drafts,
      totalValue,
    };
  }, [purchaseOrders]);

  const recentOrders = useMemo(() => {
    return purchaseOrders.slice(0, 6);
  }, [purchaseOrders]);

  const handleDownloadPdf = async (e: React.MouseEvent, poName: string) => {
    e.stopPropagation();
    try {
      const fullPo = await getPurchaseOrder(poName);
      await downloadPurchaseOrderPdf(fullPo);
    } catch (err) {
      console.error("[Download PO PDF]", err);
      toast.error("Could not download Purchase Order PDF.");
    }
  };

  return (
    <section className="w-full rounded-[10px] border border-[#E2E8F0] bg-white shadow-sm overflow-hidden">
      {/* Section Header */}
      <div className="flex flex-col gap-3 border-b border-[#E2E8F0] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold uppercase tracking-tight text-[#12213F]">
              Purchase Orders (Monitoring)
            </h2>
            <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-bold text-[#475569]">
              {loading ? "…" : `${stats.total} Saved Orders`}
            </span>
            <span className="rounded bg-[#EFF6FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#2563EB]">
              Read-Only
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[#64748B]">
            Read-only tracking of saved purchase orders, supplier fulfillment, and procurement commitments
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/p2p/purchase-orders"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1554D1] hover:underline"
          >
            <span>View All Purchase Orders</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3 sm:grid-cols-4 gap-2 text-center text-[12px]">
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Saved POs</span>
          <span className="text-[16px] font-bold text-[#12213F]">{stats.total}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">In Execution</span>
          <span className="text-[16px] font-bold text-[#2563EB]">{stats.inExecution}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Completed</span>
          <span className="text-[16px] font-bold text-[#059669]">{stats.completed}</span>
        </div>
        <div className="rounded-md border border-[#E2E8F0] bg-white p-2">
          <span className="text-[#64748B] block text-[11px]">Committed Value</span>
          <span className="text-[16px] font-bold text-[#12213F]">
            {formatCurrency(stats.totalValue)}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="w-full max-w-full min-w-0 overflow-x-auto">
        <table className="w-full max-w-full border-collapse text-left text-[13px]">
          <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-bold uppercase tracking-[0.06em] text-[#64748B]">
            <tr>
              <th className="py-2.5 pl-4 pr-2">PO Number</th>
              <th className="py-2.5 px-2">Supplier</th>
              <th className="py-2.5 px-2">Date</th>
              <th className="py-2.5 px-2">Total Value</th>
              <th className="py-2.5 px-2">Status</th>
              <th className="py-2.5 px-2">Fulfillment</th>
              <th className="py-2.5 pl-2 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading && purchaseOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-[#64748B]">
                  Loading purchase orders...
                </td>
              </tr>
            ) : recentOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-[#64748B]">
                  No saved purchase orders currently in the system.
                </td>
              </tr>
            ) : (
              recentOrders.map((po) => {
                const detailUrl = `/p2p/purchase-orders/${encodeURIComponent(po.name)}`;
                const receivedPct = Math.round(po.per_received || 0);

                return (
                  <tr key={po.name} className="transition-colors hover:bg-[#F8FAFC]">
                    <td className="py-3 pl-4 pr-2 font-semibold text-[#1554D1]">
                      <Link
                        to={detailUrl}
                        className="hover:underline flex items-center gap-1.5"
                        title={po.name}
                      >
                        <FileCheck2 className="h-3.5 w-3.5 text-[#1554D1]" />
                        <span>{po.name}</span>
                      </Link>
                    </td>
                    <td className="py-3 px-2 text-[#475569] font-medium max-w-[200px] truncate" title={po.supplier_name || po.supplier}>
                      {po.supplier_name || po.supplier}
                    </td>
                    <td className="py-3 px-2 text-[#64748B]">
                      {po.transaction_date ? formatDate(po.transaction_date) : "—"}
                    </td>
                    <td className="py-3 px-2 font-semibold text-[#12213F]">
                      {formatCurrency(po.grand_total || po.total || 0)}
                    </td>
                    <td className="py-3 px-2">
                      <StatusBadge status={po.status || "Draft"} />
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-[#E2E8F0] overflow-hidden">
                          <div
                            className={`h-full ${
                              receivedPct >= 100
                                ? "bg-[#059669]"
                                : receivedPct > 0
                                ? "bg-[#2563EB]"
                                : "bg-[#94A3B8]"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, receivedPct))}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-[#64748B] tabular-nums">
                          {receivedPct}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pl-2 pr-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <Link
                          to={detailUrl}
                          className="inline-flex items-center gap-1 rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-medium text-[#12213F] hover:bg-[#F1F5F9]"
                          title="View PO Details"
                        >
                          <Eye className="h-3 w-3 text-[#64748B]" />
                          <span>View</span>
                        </Link>
                        <button
                          type="button"
                          onClick={(e) => handleDownloadPdf(e, po.name)}
                          className="inline-flex items-center gap-1 rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-medium text-[#12213F] hover:bg-[#F1F5F9]"
                          title="Download PDF"
                        >
                          <Download className="h-3 w-3 text-[#64748B]" />
                          <span>PDF</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
