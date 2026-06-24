import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Eye, FileText, Plus, Search } from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import VoucherStatusBadge from "../../components/VoucherStatusBadge";
import { getAllVouchers, getVoucheredGRNRefs } from "../../api/vouchers";
import { canManageVouchers } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import {
  getGRNsAwaitingInvoice,
  type AwaitingInvoiceGRN,
} from "../../api/financeWorkflow";
import { formatCurrency, formatDate } from "../../utils/format";

type StateFilter = "all" | "awaiting" | "created";

const STATE_TABS: { id: StateFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "awaiting", label: "Awaiting Creation" },
  { id: "created", label: "Voucher Created" },
];

/**
 * Finance Voucher module.
 *
 * Shares its data source with the Finance Dashboard so the two always agree:
 *  - State A "Awaiting Voucher Creation" — submitted GRNs from the same
 *    `getGRNsAwaitingInvoice()` queue the dashboard widget/KPI uses.
 *  - State B "Voucher Created" — vouchers persisted via `getAllVouchers()`.
 *
 * GRNs that already have a voucher are removed from State A so a record never
 * appears in both lists.
 */
export default function VouchersPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const canManage = canManageVouchers(role);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");

  // Re-read whenever the shared store syncs (load/focus) or a local mutation
  // bumps the version, so created vouchers / awaiting rows never go stale.
  const syncVersion = useVoucherSyncStore((s) => s.version);

  // Created vouchers (localStorage-backed).
  const vouchers = useMemo(() => getAllVouchers(), [syncVersion]);

  // Same queue the Finance dashboard reads — keeps both views consistent.
  const {
    data: awaitingGRNs = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["grns-awaiting-invoice"],
    queryFn: () => getGRNsAwaitingInvoice(),
    staleTime: 60_000,
  });

  // Exclude GRNs that already have a voucher so nothing shows twice.
  const voucheredGRNs = useMemo(
    () => getVoucheredGRNRefs(),
    [vouchers, syncVersion]
  );

  const awaiting = useMemo(
    () => awaitingGRNs.filter((g) => !voucheredGRNs.has(g.name)),
    [awaitingGRNs, voucheredGRNs]
  );

  const q = query.trim().toLowerCase();

  const filteredAwaiting = useMemo(() => {
    if (!q) return awaiting;
    return awaiting.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.supplier_name ?? g.supplier ?? "").toLowerCase().includes(q)
    );
  }, [awaiting, q]);

  const filteredVouchers = useMemo(() => {
    if (!q) return vouchers;
    return vouchers.filter(
      (v) =>
        v.id.toLowerCase().includes(q) ||
        v.supplier_name.toLowerCase().includes(q) ||
        v.po_reference.toLowerCase().includes(q) ||
        v.grn_reference.toLowerCase().includes(q)
    );
  }, [vouchers, q]);

  const showAwaiting = stateFilter !== "created";
  const showCreated = stateFilter !== "awaiting";

  const awaitingVisible = showAwaiting ? filteredAwaiting : [];
  const createdVisible = showCreated ? filteredVouchers : [];
  const nothingToShow =
    !isLoading && awaitingVisible.length === 0 && createdVisible.length === 0;

  return (
    <div>
      <PageHeader
        title="Vouchers"
        description="Finance vouchers issued to suppliers — from goods receipt through payment settlement."
        actions={
          canManage ? (
            <Link
              to="/p2p/vouchers/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
            >
              <Plus className="h-4 w-4" />
              Create Voucher
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-500 ring-1 ring-inset ring-neutral-200">
              <Eye className="h-3.5 w-3.5" />
              Read Only
            </span>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 sm:max-w-sm sm:flex-1">
          <Search className="h-4 w-4 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by GRN, voucher ID, supplier or PO…"
            className="w-full text-sm focus:outline-none"
          />
        </div>

        <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
          {STATE_TABS.map((tab) => {
            const active = stateFilter === tab.id;
            const count =
              tab.id === "awaiting"
                ? filteredAwaiting.length
                : tab.id === "created"
                ? filteredVouchers.length
                : filteredAwaiting.length + filteredVouchers.length;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStateFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-white text-primary-700 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 tabular-nums text-neutral-400">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="table-shell">
          <TableSkeleton rows={5} columns={6} />
        </div>
      ) : nothingToShow ? (
        <div className="card">
          <EmptyState
            icon={FileText}
            title="No vouchers available"
            description={
              isError
                ? "Could not load the goods-receipt queue. Please try again later."
                : "No voucher records found. Create a voucher from a Purchase Order or Goods Receipt to get started."
            }
          />
          {canManage && (
            <div className="flex justify-center pb-6">
              <Link
                to="/p2p/vouchers/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
              >
                <Plus className="h-4 w-4" />
                Create Voucher
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* State A — GRNs awaiting voucher creation */}
          {showAwaiting && awaitingVisible.length > 0 && (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                    <Clock className="h-4 w-4" />
                  </span>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Awaiting Voucher Creation
                  </h2>
                </div>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  {awaitingVisible.length} pending
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200 text-sm">
                  <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">GRN Number</th>
                      <th className="px-4 py-3">Supplier</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">GRN Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {awaitingVisible.map((g: AwaitingInvoiceGRN) => (
                      <tr key={g.name} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-medium text-neutral-900">
                          <Link
                            to={`/p2p/grn/${encodeURIComponent(g.name)}`}
                            className="text-primary-600 hover:underline"
                          >
                            {g.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {g.supplier_name ?? g.supplier ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-neutral-900">
                          {formatCurrency(g.grand_total)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                          {g.posting_date ? formatDate(g.posting_date) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                            Awaiting Voucher Creation
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canManage ? (
                            <Link
                              to={`/p2p/grn/${encodeURIComponent(g.name)}`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-600"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              Create Voucher
                            </Link>
                          ) : (
                            <Link
                              to={`/p2p/grn/${encodeURIComponent(g.name)}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                            >
                              View
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* State B — created vouchers */}
          {showCreated && createdVisible.length > 0 && (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                    <FileText className="h-4 w-4" />
                  </span>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Vouchers
                  </h2>
                </div>
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">
                  {createdVisible.length} total
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200 text-sm">
                  <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">Voucher ID</th>
                      <th className="px-4 py-3">Supplier</th>
                      <th className="px-4 py-3">Linked GRN / PO</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {createdVisible.map((v) => (
                      <tr
                        key={v.id}
                        onClick={() =>
                          navigate(`/p2p/vouchers/${encodeURIComponent(v.id)}`)
                        }
                        className="cursor-pointer hover:bg-neutral-50"
                      >
                        <td className="px-4 py-3 font-semibold text-primary-700">
                          {v.id}
                        </td>
                        <td className="px-4 py-3 text-neutral-900">
                          {v.supplier_name}
                        </td>
                        <td className="px-4 py-3 text-xs text-neutral-500">
                          {v.grn_reference || "—"}
                          {v.po_reference ? ` · ${v.po_reference}` : ""}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          {formatCurrency(v.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <VoucherStatusBadge status={v.status} />
                        </td>
                        <td className="px-4 py-3 text-neutral-600">
                          {formatDate(v.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
