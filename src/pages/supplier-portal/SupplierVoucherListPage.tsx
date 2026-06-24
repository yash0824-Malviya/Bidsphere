import { Link } from "react-router-dom";
import { ArrowRight, FileText } from "lucide-react";

import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import VoucherStatusBadge from "../../components/VoucherStatusBadge";
import {
  getVouchersForSupplier,
  supplierVoucherStatusLabel,
} from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import { formatCurrency, formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

export default function SupplierVoucherListPage() {
  const { supplierName, isReady } = useSupplierSession();
  // Re-render when the shared store syncs so newly-sent vouchers appear.
  useVoucherSyncStore((s) => s.version);

  if (!isReady) {
    return (
      <SupplierPortalLayout>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      </SupplierPortalLayout>
    );
  }

  const vouchers = getVouchersForSupplier(supplierName);

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <PageHeader
        title="Vouchers"
        description="Vouchers issued to your company by Netlink. Review and raise an invoice."
      />

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">
              All Vouchers
            </h2>
          </div>
          <span className="text-xs text-neutral-500">
            {vouchers.length} total
          </span>
        </div>

        {vouchers.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No vouchers yet"
            description="Vouchers sent to your company by Netlink will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Voucher ID</th>
                  <th className="px-4 py-3">PO Reference</th>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {vouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-accent-50/40">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {v.id}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {v.po_reference || "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {formatDate(v.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                      {formatCurrency(v.invoice?.total ?? v.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <VoucherStatusBadge
                        status={v.status}
                        label={supplierVoucherStatusLabel(v.status)}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/supplier/vouchers/${encodeURIComponent(v.id)}`}
                        className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"
                      >
                        View
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SupplierPortalLayout>
  );
}
