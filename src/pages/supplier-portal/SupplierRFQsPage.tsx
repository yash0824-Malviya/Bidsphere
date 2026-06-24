import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Inbox } from "lucide-react";

import {
  getSupplierQuotations,
  getSupplierRFQs,
} from "../../api/supplierPortal";
import { getSupplierQuotation } from "../../api/sourcing";
import type { SupplierQuotation } from "../../types/erpnext";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import { TableSkeleton } from "../../components/Skeleton";
import { formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

type RfqDisplayStatus = {
  label: string;
  tone: "info" | "warning" | "success" | "neutral";
};

/**
 * Collapse the supplier's RFQ state into a single status badge:
 *  - Quotation Submitted (blue) — the supplier has already quoted.
 *  - RFQ Closed (green)        — the RFQ is closed/cancelled.
 *  - Expired (gray)            — the RFQ window has lapsed.
 *  - Awaiting Quotation (amber)— open and waiting for the supplier to quote.
 */
function deriveRfqStatus(
  rfqStatus: string | undefined,
  alreadyQuoted: boolean
): RfqDisplayStatus {
  if (alreadyQuoted) {
    return { label: "Quotation Submitted", tone: "info" };
  }
  const status = (rfqStatus ?? "").toLowerCase();
  if (status === "expired") {
    return { label: "Expired", tone: "neutral" };
  }
  if (status === "cancelled" || status === "closed") {
    return { label: "RFQ Closed", tone: "success" };
  }
  return { label: "Awaiting Quotation", tone: "warning" };
}

export default function SupplierRFQsPage() {
  const { supplierName, isReady } = useSupplierSession();

  // Debug: log supplier identity so we can verify session → query matching
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[SupplierRFQsPage] Session ready:", isReady, "| Supplier:", supplierName || "(empty)");
  }, [supplierName, isReady]);

  const rfqsQuery = useQuery({
    queryKey: ["supplier-portal-rfqs", supplierName],
    enabled: !!supplierName,
    queryFn: () => getSupplierRFQs(supplierName),
  });

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

  const quotedRfqNames = useMemo(() => {
    const set = new Set<string>();
    for (const sq of sqDetailsQuery.data ?? []) {
      for (const item of sq.items ?? []) {
        const link = (item as { request_for_quotation?: string })
          .request_for_quotation;
        if (link) set.add(link);
      }
    }
    return set;
  }, [sqDetailsQuery.data]);

  const openCount = useMemo(() => {
    return (rfqsQuery.data ?? []).filter(
      (r) => r.status !== "Cancelled" && !quotedRfqNames.has(r.name)
    ).length;
  }, [rfqsQuery.data, quotedRfqNames]);

  const isLoading =
    rfqsQuery.isLoading || sqsQuery.isLoading || sqDetailsQuery.isLoading;
  const rows = rfqsQuery.data ?? [];

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
        title="My RFQs"
        description="Requests for quotation invited to your company. Submit quotations on open RFQs."
      />

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">All RFQs</h2>
          </div>
          <span className="text-xs text-neutral-500">
            {openCount} awaiting quotation · {rows.length} total
          </span>
        </div>

        {isLoading ? (
          <TableSkeleton rows={5} columns={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No RFQs yet"
            description="You haven't been invited to any RFQs. Netlink procurement will notify you when one is ready."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">RFQ No</th>
                  <th className="px-4 py-3">Last Updated</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((rfq) => {
                  const alreadyQuoted = quotedRfqNames.has(rfq.name);
                  const status = deriveRfqStatus(rfq.status, alreadyQuoted);
                  return (
                    <tr key={rfq.name} className="hover:bg-accent-50/40">
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        <Link
                          to={`/supplier/rfq/${encodeURIComponent(rfq.name)}`}
                          className="text-accent-700 hover:underline"
                        >
                          {rfq.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                        {rfq.modified ? formatDate(rfq.modified) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={status.label} tone={status.tone} />
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
