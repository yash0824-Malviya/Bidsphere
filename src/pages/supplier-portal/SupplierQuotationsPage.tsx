import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowRight, Clock, Receipt } from "lucide-react";

import { getSupplierQuotations } from "../../api/supplierPortal";
import { apiGet, apiPut } from "../../api/erpnext";
import { getSupplierQuotation } from "../../api/sourcing";
import type { SupplierQuotation } from "../../types/erpnext";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import { SortableTableHeader } from "../../components/ui";
import { useListSort } from "../../hooks/useListSort";
import { formatCurrency, formatDate } from "../../utils/format";
import {
  SQ_DEFAULT_SORT,
  sortNewestFirst,
  supplierQuotationComparators,
} from "../../utils/listSort";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import { getLegalDocs } from "../../api/legalDocs";
import SupplierPortalLayout from "./SupplierPortalLayout";

const SQ_COMPARATORS = supplierQuotationComparators<{
  name: string;
  transaction_date?: string;
  modified?: string;
  grand_total?: number;
  status?: string;
}>();

export default function SupplierQuotationsPage() {
  const { supplierName, isReady } = useSupplierSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submittingDraft, setSubmittingDraft] = useState<string | null>(null);

  const sqsQuery = useQuery({
    queryKey: ["supplier-portal-quotations", supplierName],
    enabled: !!supplierName,
    queryFn: () => getSupplierQuotations(supplierName),
  });

  const sqDetailsQuery = useQuery<SupplierQuotation[]>({
    queryKey: [
      "supplier-portal-quotations-details",
      (sqsQuery.data ?? []).map((s) => s.name).join("|"),
    ],
    enabled: (sqsQuery.data ?? []).length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        (sqsQuery.data ?? []).map((sq) => getSupplierQuotation(sq.name))
      );
      return results
        .filter(
          (r): r is PromiseFulfilledResult<SupplierQuotation> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value);
    },
  });

  async function submitDraftQuotation(docName: string) {
    setSubmittingDraft(docName);
    try {
      const fresh = await apiGet<{ modified?: string; data?: { modified?: string } }>(
        `/api/resource/Supplier%20Quotation/${encodeURIComponent(docName)}`
      );
      const modified =
        (fresh as { modified?: string }).modified ??
        (fresh as { data?: { modified?: string } }).data?.modified;

      const body: Record<string, unknown> = { docstatus: 1 };
      if (modified) body.modified = modified;

      await apiPut(
        `/api/resource/Supplier%20Quotation/${encodeURIComponent(docName)}`,
        body
      );

      toast.success(`✅ ${docName} submitted!`);
      void queryClient.invalidateQueries({
        queryKey: ["supplier-portal-quotations", supplierName],
      });
      void queryClient.invalidateQueries({
        queryKey: ["supplier-portal-quotations-details"],
      });
    } catch (err) {
      toast.error(
        `Submit failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { duration: 6_000 }
      );
    } finally {
      setSubmittingDraft(null);
    }
  }

  const rows = sqsQuery.data ?? [];
  const isLoading = sqsQuery.isLoading || sqDetailsQuery.isLoading;

  const sqDetailsMap = useMemo(() => {
    const map = new Map<string, SupplierQuotation>();
    for (const sq of sqDetailsQuery.data ?? []) {
      map.set(sq.name, sq);
    }
    return map;
  }, [sqDetailsQuery.data]);

  const normalizedRows = useMemo(
    () =>
      sortNewestFirst(rows, {
        date: (sq) => sq.transaction_date ?? sq.modified,
        name: (sq) => sq.name,
      }),
    [rows]
  );

  const { sort, setSort, sortedRows } = useListSort(
    normalizedRows,
    SQ_DEFAULT_SORT,
    SQ_COMPARATORS
  );

  if (!isReady) {
    return (
      <SupplierPortalLayout>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      </SupplierPortalLayout>
    );
  }

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <PageHeader
        title="Submitted Quotations"
        description="Quotations you have created against Netlink RFQs."
      />

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">
              My Quotations
            </h2>
          </div>
          <span className="text-xs text-neutral-500">{sortedRows.length} total</span>
        </div>

        {isLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No quotations yet"
            description="Once you submit a quotation against an RFQ it will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <SortableTableHeader label="Quote No" sortKey="name" sort={sort} onSort={setSort} />
                  <th className="px-4 py-3">RFQ Ref</th>
                  <SortableTableHeader label="Date" sortKey="date" sort={sort} onSort={setSort} />
                  <SortableTableHeader label="Total Value" sortKey="total" sort={sort} onSort={setSort} className="text-right" />
                  <SortableTableHeader label="Status" sortKey="status" sort={sort} onSort={setSort} />
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {sortedRows.map((sq) => {
                  const total = sq.grand_total ?? 0;
                  const hydrated = sqDetailsMap.get(sq.name);
                  const itemWithRfqLink = (hydrated?.items ?? []).find(
                    (it) =>
                      (it as { request_for_quotation?: string })
                        .request_for_quotation
                  ) as { request_for_quotation?: string } | undefined;
                  const rfqLink = itemWithRfqLink?.request_for_quotation;

                  const detailUrl = `/supplier/quotations/${encodeURIComponent(sq.name)}`;
                  const legalDocs = getLegalDocs(sq.name);
                  const hasLegalDocs = !!(
                    legalDocs?.terms_pdf_key &&
                    legalDocs?.warranty_pdf_key &&
                    legalDocs?.insurance_pdf_key
                  );

                  return (
                    <tr
                      key={sq.name}
                      onClick={() => navigate(detailUrl)}
                      className="cursor-pointer hover:bg-accent-50/40"
                    >
                      <td className="px-4 py-3 font-medium text-accent-700">
                        {sq.name}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {rfqLink ? (
                          <Link
                            to={`/supplier/rfq/${encodeURIComponent(rfqLink)}`}
                            className="text-accent-700 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {rfqLink}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {sq.transaction_date
                          ? formatDate(sq.transaction_date)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                        {total > 0 ? formatCurrency(total) : "—"}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {sq.status === "Draft" ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-warning-100 px-2.5 py-0.5 text-xs font-medium text-warning-800">
                              Draft
                            </span>
                            <button
                              type="button"
                              onClick={() => void submitDraftQuotation(sq.name)}
                              disabled={submittingDraft === sq.name}
                              className="rounded-md bg-accent-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
                            >
                              {submittingDraft === sq.name
                                ? "Submitting…"
                                : "Submit Now"}
                            </button>
                          </div>
                        ) : (
                          <StatusBadge status={sq.status ?? "Submitted"} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          {sq.status !== "Draft" && (
                            <Link
                              to={`/supplier/quotation/${encodeURIComponent(sq.name)}/legal-docs`}
                              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-sm border transition-colors ${
                                hasLegalDocs
                                  ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                                  : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 animate-pulse"
                              }`}
                            >
                              📋 {hasLegalDocs ? "View Legal Docs" : "Add Legal Docs"}
                            </Link>
                          )}
                          <Link
                            to={detailUrl}
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50"
                          >
                            View Details
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SupplierPortalLayout>
  );
}
