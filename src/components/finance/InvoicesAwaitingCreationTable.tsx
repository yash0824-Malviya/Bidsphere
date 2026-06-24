import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Inbox } from "lucide-react";

import { getGRNsAwaitingInvoice } from "../../api/financeWorkflow";
import { excludeVoucheredGRNs } from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import { Skeleton } from "../Skeleton";
import { formatCurrency, formatDate } from "../../utils/format";

interface Props {
  /** Cap the number of rows shown (e.g. dashboard preview). */
  limit?: number;
}

/**
 * "Vouchers Awaiting Creation" — the Finance queue of submitted GRNs that have
 * been received but not yet turned into a voucher. Each row links to the GRN
 * detail page, where Finance issues the supplier voucher.
 */
export default function InvoicesAwaitingCreationTable({ limit }: Props) {
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["grns-awaiting-invoice"],
    queryFn: () => getGRNsAwaitingInvoice(),
    staleTime: 60_000,
    retry: false,
  });

  // Exclude GRNs that already have a voucher — ERPNext's "To Bill" status does
  // not clear when a (localStorage) voucher is created, so we filter here.
  const syncVersion = useVoucherSyncStore((s) => s.version);
  const available = useMemo(
    () => excludeVoucheredGRNs(data),
    [data, syncVersion]
  );
  const rows = useMemo(
    () => (limit ? available.slice(0, limit) : available),
    [available, limit]
  );

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-50 text-primary-600">
            <Inbox className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Vouchers Awaiting Creation
            </h2>
            <p className="text-xs text-neutral-500">
              Goods received and ready for Finance to issue a voucher
            </p>
          </div>
        </div>
        {!isLoading && !isError && available.length > 0 && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            {available.length} pending
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-sm text-neutral-600">
            Could not load the voucher queue.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Inbox className="h-7 w-7 text-neutral-300" />
          <p className="text-sm font-medium text-neutral-700">
            No vouchers awaiting creation
          </p>
          <p className="text-xs text-neutral-500">
            Submitted goods receipts will appear here for voucher issuance.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">GRN Number</th>
                <th className="px-4 py-2.5">Supplier</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5">GRN Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rows.map((g) => (
                <tr key={g.name} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-medium text-neutral-900">
                    <Link
                      to={`/p2p/grn/${encodeURIComponent(g.name)}`}
                      className="text-primary-600 hover:underline"
                    >
                      {g.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
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
                    <Link
                      to={`/p2p/grn/${encodeURIComponent(g.name)}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-600"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Create Voucher
                    </Link>
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
