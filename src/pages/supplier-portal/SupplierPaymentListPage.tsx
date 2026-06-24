import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CreditCard } from "lucide-react";

import { getSupplierPaymentSummaries } from "../../api/supplierPortal";
import { getPaymentsForSupplier, getVoucherById } from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import EmptyState from "../../components/EmptyState";
import PdfActions from "../../components/PdfActions";
import { buildVoucherPaymentPdf } from "../../utils/pdf/voucherDocPdf";
import PageHeader from "../../components/PageHeader";
import { TableSkeleton } from "../../components/Skeleton";
import { formatCurrency, formatDate } from "../../utils/format";
import { getPaymentModeLabel } from "../../utils/usPaymentMethods";
import { useSupplierSession } from "../../hooks/useSupplierSession";
import SupplierPortalLayout from "./SupplierPortalLayout";

/** Unified shape so workflow + ERPNext payments render in one ledger. */
interface PaymentRow {
  id: string;
  voucher?: string;
  invoice?: string;
  po?: string;
  date?: string;
  method?: string;
  reference?: string;
  amount: number;
  status: string;
  to: string;
  workflow: boolean;
}

export default function SupplierPaymentListPage() {
  const { supplierName, isReady } = useSupplierSession();
  // Refresh when the shared voucher store syncs so released payments appear.
  const syncVersion = useVoucherSyncStore((s) => s.version);

  // ── Voucher-workflow payments (single source of truth) ────────────────────
  const workflowRows = useMemo<PaymentRow[]>(() => {
    if (!supplierName) return [];
    return getPaymentsForSupplier(supplierName).map((p) => ({
      id: p.payment_id,
      voucher: p.voucher_id,
      invoice: p.invoice_number,
      po: p.po_reference,
      date: p.paid_date,
      method: p.method,
      reference: p.reference_number,
      amount: p.amount,
      status: p.status,
      to: `/supplier/vouchers/${encodeURIComponent(p.voucher_id)}`,
      workflow: true,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierName, syncVersion]);

  // ── Historical ERPNext payment entries (preserved) ────────────────────────
  const paymentsQuery = useQuery({
    queryKey: ["supplier-portal-payments", supplierName],
    enabled: !!supplierName,
    queryFn: () => getSupplierPaymentSummaries(supplierName),
  });

  const erpRows = useMemo<PaymentRow[]>(() => {
    return (paymentsQuery.data ?? []).map((payment) => ({
      id: payment.name,
      invoice: payment.invoiceReference ?? undefined,
      date: payment.posting_date ?? undefined,
      method: payment.mode_of_payment
        ? getPaymentModeLabel(payment.mode_of_payment)
        : undefined,
      amount: payment.paid_amount ?? payment.received_amount ?? 0,
      status: "Paid",
      to: `/supplier/payments/${encodeURIComponent(payment.name)}`,
      workflow: false,
    }));
  }, [paymentsQuery.data]);

  // Workflow payments first (newest), then historical ERPNext payments. De-dupe
  // by id so a payment that exists in both sources only shows once.
  const rows = useMemo<PaymentRow[]>(() => {
    const seen = new Set<string>();
    const out: PaymentRow[] = [];
    for (const r of [...workflowRows, ...erpRows]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }, [workflowRows, erpRows]);

  if (!isReady) {
    return (
      <SupplierPortalLayout>
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      </SupplierPortalLayout>
    );
  }

  // Only block on the network query when there are no workflow payments to show.
  const loading = paymentsQuery.isLoading && workflowRows.length === 0;
  const isEmpty = !loading && rows.length === 0;

  return (
    <SupplierPortalLayout supplierName={supplierName}>
      <PageHeader
        title="Payments"
        description="Payment entries released against your invoices."
      />

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900">
              All Payments
            </h2>
          </div>
          <span className="text-xs text-neutral-500">{rows.length} total</span>
        </div>

        {loading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : isEmpty ? (
          <EmptyState
            icon={CreditCard}
            title="No payments yet"
            description="Payments released for your invoices will appear here once Finance confirms them."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Payment No</th>
                  <th className="px-4 py-3">Voucher</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">PO</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">PDF</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((payment) => (
                  <tr key={payment.id} className="hover:bg-accent-50/40">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {payment.id}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {payment.voucher ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {payment.invoice ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {payment.po ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                      {payment.date ? formatDate(payment.date) : "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {payment.method ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {payment.reference ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                      {payment.amount > 0 ? formatCurrency(payment.amount) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        {payment.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {payment.workflow && payment.voucher ? (
                        <PdfActions
                          variant="compact"
                          filename={
                            payment.id.toUpperCase().startsWith("PAY-")
                              ? `${payment.id}.pdf`
                              : `PAY-${payment.id}.pdf`
                          }
                          build={async () => {
                            const v = getVoucherById(payment.voucher!);
                            if (!v) throw new Error("Voucher not found");
                            return buildVoucherPaymentPdf(v);
                          }}
                        />
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={payment.to}
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
