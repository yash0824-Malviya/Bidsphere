import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Package,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import type { RFQApprovalState } from "../../types/erpnext";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { SortableTableHeader } from "../../components/ui";
import { useListSort } from "../../hooks/useListSort";
import type { SortState } from "../../components/ui";
import { formatCurrency, formatDate } from "../../utils/format";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ApprovedRFQRow {
  rfq: string;
  supplier: string;
  approved_value: number;
  approval_date: string;
  submitted_by: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function getApprovedRFQs(): ApprovedRFQRow[] {
  const items: ApprovedRFQRow[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("rfq_approval_")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const s = JSON.parse(raw) as RFQApprovalState;
        if (
          s.legal_status === "Approved" &&
          s.finance_status === "Budget Approved" &&
          s.workflow_step !== "PO Created"
        ) {
          items.push({
            rfq: s.rfq,
            supplier: s.selected_supplier || "—",
            approved_value: s.selected_supplier_total ?? 0,
            approval_date: s.finance_review_date ?? s.legal_review_date ?? s.submitted_at ?? "",
            submitted_by: s.submitted_by ?? "—",
          });
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* ignore storage errors */ }

  items.sort((a, b) => (b.approval_date ?? "").localeCompare(a.approval_date ?? ""));
  return items;
}

/* -------------------------------------------------------------------------- */
/*  Sort config                                                                */
/* -------------------------------------------------------------------------- */

const DEFAULT_SORT: SortState = { key: "approval_date", direction: "desc" };

const COMPARATORS = {
  rfq: (a: ApprovedRFQRow, b: ApprovedRFQRow, dir: "asc" | "desc") => {
    const cmp = a.rfq.localeCompare(b.rfq);
    return dir === "asc" ? cmp : -cmp;
  },
  supplier: (a: ApprovedRFQRow, b: ApprovedRFQRow, dir: "asc" | "desc") => {
    const cmp = a.supplier.localeCompare(b.supplier);
    return dir === "asc" ? cmp : -cmp;
  },
  approved_value: (a: ApprovedRFQRow, b: ApprovedRFQRow, dir: "asc" | "desc") => {
    const diff = a.approved_value - b.approved_value;
    return dir === "asc" ? diff : -diff;
  },
  approval_date: (a: ApprovedRFQRow, b: ApprovedRFQRow, dir: "asc" | "desc") => {
    const cmp = (a.approval_date ?? "").localeCompare(b.approval_date ?? "");
    return dir === "asc" ? cmp : -cmp;
  },
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function NewPOQueuePage() {
  const navigate = useNavigate();
  const [refreshKey] = useState(0);

  const rows = useMemo(
    () => getApprovedRFQs(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshKey]
  );

  const { sort, setSort, sortedRows } = useListSort(rows, DEFAULT_SORT, COMPARATORS);

  const totalValue = useMemo(
    () => rows.reduce((sum, r) => sum + r.approved_value, 0),
    [rows]
  );

  return (
    <div>
      <PageHeader
        title="New Purchase Order"
        description="Create Purchase Orders from approved RFQs. Only RFQs that have passed Legal and Finance review appear here."
      />

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard icon={Package} label="Ready for PO" value={rows.length} tone="success" />
        <KpiCard icon={Wallet} label="Total Value" value={formatCurrency(totalValue)} tone="primary" />
        <KpiCard icon={ShieldCheck} label="Fully Approved" value={rows.length} tone="neutral" />
      </div>

      {/* Table */}
      <div className="table-shell">
        {sortedRows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No RFQs awaiting PO creation"
            description="All approved RFQs have been converted to Purchase Orders, or no RFQs have completed the full approval workflow yet."
          />
        ) : (
          <>
            {/* Mobile card view */}
            <div className="data-card-list">
              {sortedRows.map((row) => (
                <div key={row.rfq} className="data-card-row">
                  <div className="data-card-field">
                    <span className="data-card-label">RFQ Number</span>
                    <button
                      type="button"
                      onClick={() => navigate(`/sourcing/rfq/${encodeURIComponent(row.rfq)}`)}
                      className="table-link cursor-pointer bg-transparent border-none p-0 text-left text-sm"
                    >
                      {row.rfq}
                    </button>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Supplier</span>
                    <span className="data-card-value">{row.supplier}</span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Approved Value</span>
                    <span className="data-card-value font-semibold">
                      {formatCurrency(row.approved_value)}
                    </span>
                  </div>
                  <div className="data-card-field">
                    <span className="data-card-label">Approval Date</span>
                    <span className="data-card-value">
                      {row.approval_date ? formatDate(row.approval_date) : "—"}
                    </span>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/p2p/purchase-orders/convert/${encodeURIComponent(row.rfq)}`)
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-success-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-success-700 cursor-pointer border-none"
                    >
                      Create PO
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortableTableHeader label="RFQ Number" sortKey="rfq" sort={sort} onSort={setSort} />
                    <SortableTableHeader label="Supplier" sortKey="supplier" sort={sort} onSort={setSort} />
                    <SortableTableHeader label="Approved Value" sortKey="approved_value" sort={sort} onSort={setSort} className="text-right" />
                    <SortableTableHeader label="Approval Date" sortKey="approval_date" sort={sort} onSort={setSort} />
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.rfq} className="group">
                      <td>
                        <button
                          type="button"
                          onClick={() => navigate(`/sourcing/rfq/${encodeURIComponent(row.rfq)}`)}
                          className="table-link cursor-pointer bg-transparent border-none p-0 text-left"
                        >
                          {row.rfq}
                        </button>
                      </td>
                      <td className="text-neutral-700">{row.supplier}</td>
                      <td className="text-right tabular-nums font-semibold text-neutral-900">
                        {formatCurrency(row.approved_value)}
                      </td>
                      <td className="text-neutral-600">
                        {row.approval_date ? formatDate(row.approval_date) : "—"}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Approved
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(`/p2p/purchase-orders/convert/${encodeURIComponent(row.rfq)}`)
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-success-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-success-700 cursor-pointer border-none"
                        >
                          Create PO
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function KpiCard({
  icon: Icon, label, value, tone,
}: {
  icon: typeof Package; label: string; value: number | string;
  tone: "neutral" | "success" | "primary";
}) {
  const iconTones = {
    neutral: "bg-neutral-100 text-neutral-500",
    success: "bg-success-50 text-success-600",
    primary: "bg-primary-50 text-primary-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3.5 shadow-sm">
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${iconTones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold tabular-nums text-neutral-900">{value}</p>
        <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      </div>
    </div>
  );
}
