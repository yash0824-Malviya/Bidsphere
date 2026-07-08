import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Calendar,
  FileText,
  Hash,
  Package,
  ShieldCheck,
  Truck,
  Wallet,
  X,
} from "lucide-react";

import { getSupplierQuotation } from "../../api/sourcing";
import { getLegalDocs } from "../../api/legalDocs";
import type { SupplierQuotation } from "../../types/erpnext";
import SupplierLegalDocuments from "../supplier/SupplierLegalDocuments";
import { formatCurrency, formatDate } from "../../utils/format";

/**
 * Read-only "View Quotation" modal for Procurement — reuses the exact
 * Supplier Quotation record + APIs already used by the supplier's own
 * quotation detail page (`getSupplierQuotation`, `getLegalDocs`,
 * `SupplierLegalDocuments`). No new quotation data is created; this is a
 * pure read view of what the supplier already submitted.
 */
export default function ViewQuotationModal({
  sqName,
  rfqName,
  onClose,
}: {
  sqName: string;
  rfqName: string;
  onClose: () => void;
}) {
  const sqQuery = useQuery<SupplierQuotation>({
    queryKey: ["view-quotation", sqName],
    queryFn: () => getSupplierQuotation(sqName),
    enabled: !!sqName,
  });

  const reviewQuery = useQuery({
    queryKey: ["view-quotation-legal", sqName],
    queryFn: () => getLegalDocs(sqName),
    enabled: !!sqName,
    staleTime: 30_000,
  });

  const sq = sqQuery.data;
  const items = sq?.items ?? [];
  const subtotal = items.reduce((s, it) => s + (it.amount ?? it.rate * it.qty), 0);
  const grandTotal = sq?.grand_total ?? sq?.total ?? subtotal;
  const paymentTerms = (sq as { terms?: string } | undefined)?.terms || "—";
  const deliveryDays = items.find((it) => it.delivery_days)?.delivery_days;
  const warrantyNote = (sq as { custom_warranty_note?: string } | undefined)
    ?.custom_warranty_note;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-neutral-900">
              Quotation Details
            </h2>
            <p className="truncate text-xs text-neutral-500">
              {sq?.supplier_name ?? sq?.supplier ?? sqName} · RFQ {rfqName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {sqQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-neutral-500">
            Loading quotation…
          </div>
        ) : sqQuery.isError || !sq ? (
          <div className="p-8 text-center text-sm text-red-600">
            Could not load this quotation. Please try again.
          </div>
        ) : (
          <div className="space-y-5 p-5">
            {/* Quotation info */}
            <section className="card">
              <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
                <FileText className="h-4 w-4 text-neutral-500" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  Quotation Information
                </h3>
              </div>
              <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Supplier Name" icon={Building2}>
                  {sq.supplier_name ?? sq.supplier}
                </Field>
                <Field label="RFQ Number" icon={Hash}>
                  {sq.rfq_no || rfqName}
                </Field>
                <Field label="Submitted Date" icon={Calendar}>
                  {sq.transaction_date ? formatDate(sq.transaction_date) : "—"}
                </Field>
                <Field label="Payment Terms" icon={Wallet}>
                  {paymentTerms}
                </Field>
                <Field label="Delivery Time" icon={Truck}>
                  {deliveryDays ? `${deliveryDays} days` : "—"}
                </Field>
                <Field label="Warranty" icon={ShieldCheck}>
                  {warrantyNote || "—"}
                </Field>
              </div>
            </section>

            {/* Item-wise quotation */}
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-neutral-500" />
                  <h3 className="text-sm font-semibold text-neutral-900">
                    Item-wise Quotation
                  </h3>
                </div>
                <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-600">
                  {items.length} item{items.length === 1 ? "" : "s"}
                </span>
              </div>

              {items.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-neutral-400">
                  No line items found for this quotation.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-neutral-200 text-sm">
                    <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                      <tr>
                        <th className="px-4 py-3">Item</th>
                        <th className="px-4 py-3 text-right">Qty</th>
                        <th className="px-4 py-3">UOM</th>
                        <th className="px-4 py-3 text-right">Unit Price</th>
                        <th className="px-4 py-3 text-right">Delivery</th>
                        <th className="px-4 py-3 text-right">Total Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {items.map((it, idx) => {
                        const lineTotal = it.amount ?? it.rate * it.qty;
                        return (
                          <tr key={it.name ?? idx} className="hover:bg-neutral-50/60">
                            <td className="px-4 py-3">
                              <p className="font-medium text-neutral-900">
                                {it.item_name ?? it.item_code}
                              </p>
                              {it.item_name && it.item_code !== it.item_name && (
                                <p className="font-mono text-xs text-neutral-400">
                                  {it.item_code}
                                </p>
                              )}
                              {it.description && (
                                <p className="mt-0.5 max-w-xs truncate text-xs text-neutral-500">
                                  {it.description}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-neutral-900">
                              {it.qty}
                            </td>
                            <td className="px-4 py-3 text-neutral-600">
                              {it.uom ?? "Nos"}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-neutral-900">
                              {formatCurrency(it.rate)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-neutral-600">
                              {it.delivery_days ? `${it.delivery_days}d` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                              {formatCurrency(lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {items.length > 0 && (
                <div className="border-t border-neutral-200 bg-neutral-50 px-5 py-4">
                  <div className="ml-auto flex max-w-xs flex-col gap-1.5 text-sm">
                    <div className="flex justify-between text-neutral-600">
                      <span>Subtotal</span>
                      <span className="tabular-nums">{formatCurrency(subtotal)}</span>
                    </div>
                    <div className="flex justify-between border-t border-neutral-300 pt-1.5 font-bold text-neutral-900">
                      <span>Grand Total</span>
                      <span className="tabular-nums">{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Notes */}
            {sq.notes && (
              <section className="card">
                <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
                  <FileText className="h-4 w-4 text-neutral-500" />
                  <h3 className="text-sm font-semibold text-neutral-900">Notes</h3>
                </div>
                <div className="whitespace-pre-line p-5 text-sm text-neutral-700">
                  {sq.notes}
                </div>
              </section>
            )}

            {/* Attachments / Documents — reuses the same component and data
                the supplier portal uses, in read-only mode (no upload). */}
            <SupplierLegalDocuments
              sq={sq}
              review={reviewQuery.data ?? null}
              editable={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  icon: Icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.FC<{ className?: string }>;
}) {
  return (
    <div className="flex items-start gap-2">
      {Icon && (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-neutral-400">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-neutral-500">{label}</p>
        <p className="text-sm text-neutral-900">{children}</p>
      </div>
    </div>
  );
}
