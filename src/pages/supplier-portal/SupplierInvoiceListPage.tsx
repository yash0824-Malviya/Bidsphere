import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileText, Receipt } from "lucide-react";

import {
  getInvoicesForSupplier,
  getVoucherById,
  getVouchersForSupplier,
} from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import PdfActions from "../../components/PdfActions";
import { buildVoucherInvoicePdf } from "../../utils/pdf/voucherDocPdf";
import EmptyState from "../../components/EmptyState";
import InvoiceStatusBadge from "../../components/InvoiceStatusBadge";
import PageHeader from "../../components/PageHeader";
import { formatCurrency, formatDate } from "../../utils/format";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

export default function SupplierInvoiceListPage() {
  const { supplierName, isReady } = useSupplierSession();
  const syncVersion = useVoucherSyncStore((s) => s.version);

  const invoices = useMemo(
    () => (supplierName ? getInvoicesForSupplier(supplierName) : []),
    [supplierName, syncVersion]
  );

  const pendingVouchers = useMemo(
    () =>
      supplierName
        ? getVouchersForSupplier(supplierName).filter(
            (v) =>
              v.status === "sent" ||
              v.status === "viewed" ||
              v.status === "invoice_rejected"
          )
        : [],
    [supplierName, syncVersion]
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
        title="Invoices"
        description="Invoices you've created against vouchers — track review and payment status."
      />

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">
              All Invoices
            </h2>
          </div>
          <span className="text-xs text-neutral-500">
            {invoices.length} total
          </span>
        </div>

        {invoices.length === 0 && pendingVouchers.length > 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
              <Receipt className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-neutral-900">
                Pending vouchers awaiting supplier action
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                You have {pendingVouchers.length} voucher
                {pendingVouchers.length === 1 ? "" : "s"} from Netlink. Open a
                voucher and create an invoice to begin billing.
              </p>
            </div>
            <Link
              to="/supplier/vouchers"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
            >
              View Vouchers
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            description="Invoices you create from vouchers will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Invoice No</th>
                  <th className="px-4 py-3">Voucher / PO</th>
                  <th className="px-4 py-3">Invoice Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">PDF</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {invoices.map((inv) => (
                  <tr key={inv.voucher_id} className="hover:bg-accent-50/40">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {inv.invoice_number}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      <span className="font-medium text-neutral-700">
                        {inv.voucher_id}
                      </span>
                      {inv.po_reference ? ` · ${inv.po_reference}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {inv.raised_at ? formatDate(inv.raised_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                      {formatCurrency(inv.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PdfActions
                        variant="compact"
                        filename={
                          inv.invoice_number.toUpperCase().startsWith("INV")
                            ? `${inv.invoice_number}.pdf`
                            : `INV-${inv.invoice_number}.pdf`
                        }
                        build={async () => {
                          const v = getVoucherById(inv.voucher_id);
                          if (!v) throw new Error("Voucher not found");
                          return buildVoucherInvoicePdf(v);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/supplier/vouchers/${encodeURIComponent(
                          inv.voucher_id
                        )}`}
                        className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"
                      >
                        Track
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
