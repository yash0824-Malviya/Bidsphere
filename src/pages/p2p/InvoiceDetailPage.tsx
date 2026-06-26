import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  BadgeCheck,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Printer,
  Receipt,
  Send,
} from "lucide-react";

import {
  getPurchaseInvoice,
  InvoiceCurrencyMismatchError,
  submitPurchaseInvoice,
} from "../../api/accounts";
import { invalidateFinanceDashboardMetrics } from "../../api/financeWorkflow";
import ReadOnlyViewBadge from "../../components/document/ReadOnlyViewBadge";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { usePoDrillDown } from "../../hooks/usePoDrillDown";
import { formatCurrency, formatDate, isOverdue } from "../../utils/format";
import { downloadInvoicePdf, printInvoicePdf } from "../../utils/pdf";
import { primaryPOFromInvoice } from "../../utils/supplierPortalUtils";

export default function InvoiceDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isReadOnly, backToPoPath } = usePoDrillDown();
  const name = decodeURIComponent(id);

  const {
    data: invoice,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["purchase-invoice", name],
    queryFn: () => getPurchaseInvoice(name),
    enabled: !!name,
    staleTime: 0,
  });

  const submitMutation = useMutation({
    mutationFn: () => submitPurchaseInvoice(name),
    onSuccess: () => {
      toast.success("Invoice submitted — it is now payable.");
      queryClient.invalidateQueries({ queryKey: ["purchase-invoice", name] });
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payable-invoices"] });
      invalidateFinanceDashboardMetrics(queryClient);
    },
    onError: (err: Error) => {
      if (err instanceof InvoiceCurrencyMismatchError) {
        toast.error(err.message, { duration: 10_000 });
        return;
      }
      toast.error(err.message || "Could not submit invoice.");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div>
        <BackLink backToPoPath={backToPoPath} />
        <EmptyState
          icon={FileText}
          title="Invoice not found"
          description={`"${name}" may have been deleted or you may not have access.`}
        />
      </div>
    );
  }

  const isDraft = (invoice.docstatus ?? 0) === 0;
  const overdue =
    !isDraft &&
    invoice.status !== "Paid" &&
    invoice.status !== "Cancelled" &&
    isOverdue(invoice.due_date);
  const effectiveStatus = overdue ? "Overdue" : (invoice.status ?? "Draft");
  const isPaid = invoice.status === "Paid";
  const hasOutstanding = (invoice.outstanding_amount ?? 0) > 0;
  const payableCurrency = invoice.payable_currency ?? invoice.currency;
  const currencySplit =
    !!payableCurrency &&
    !!invoice.currency &&
    payableCurrency !== invoice.currency;

  const linkedPO = primaryPOFromInvoice(invoice);
  const linkedGrn =
    invoice.items?.find((item) => item.purchase_receipt)?.purchase_receipt ??
    undefined;
  const paymentStatus = isPaid
    ? "Paid"
    : hasOutstanding
      ? invoice.status === "Partly Paid"
        ? "Partly Paid"
        : "Unpaid"
      : (invoice.status ?? "Draft");

  return (
    <div>
      <BackLink backToPoPath={backToPoPath} />

      <PageHeader
        title={name}
        description={invoice.supplier_name ?? invoice.supplier ?? "—"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isReadOnly ? <ReadOnlyViewBadge /> : null}
            <PdfButton
              icon={Download}
              label="Download PDF"
              onClick={() => {
                void downloadInvoicePdf(invoice, effectiveStatus).catch(
                  (err: Error) =>
                    toast.error(err.message || "Could not generate PDF.")
                );
              }}
            />
            <PdfButton
              icon={Printer}
              label={isReadOnly ? "Print Invoice" : "Print"}
              onClick={() => {
                void printInvoicePdf(invoice, effectiveStatus).catch(
                  (err: Error) =>
                    toast.error(err.message || "Could not open print preview.")
                );
              }}
            />
            <StatusBadge status={effectiveStatus} />
            {!isReadOnly && isDraft ? (
              <button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-warning-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-warning-600 disabled:opacity-60"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit Invoice
              </button>
            ) : null}
            {!isReadOnly && !isDraft && !isPaid && hasOutstanding ? (
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/p2p/payments/new?invoice=${encodeURIComponent(name)}`
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-600"
              >
                <CreditCard className="h-4 w-4" />
                Record Payment
              </button>
            ) : null}
          </div>
        }
      />

      {/* Draft warning — editable flow only */}
      {!isReadOnly && isDraft && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-warning-300 bg-warning-50 p-4 shadow-sm">
          <Send className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-warning-900">
              This invoice has not been submitted
            </p>
            <p className="mt-0.5 text-xs text-warning-700">
              Draft invoices are not recorded in the accounting ledger and
              cannot be paid. Click <strong>Submit Invoice</strong> to finalise
              it and make it eligible for payment.
            </p>
          </div>
          <button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-warning-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-warning-600 disabled:opacity-60"
          >
            {submitMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Submit Invoice
          </button>
        </div>
      )}

      {/* Info cards */}
      <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <InfoCard label="Invoice Number" value={invoice.name} />
        <InfoCard label="Invoice Date" value={formatDate(invoice.posting_date)} />
        <InfoCard label="Supplier" value={invoice.supplier_name ?? invoice.supplier ?? "—"} />
        <InfoCard
          label="PO Reference"
          value={
            linkedPO ? (
              <Link
                to={`/p2p/purchase-orders/${encodeURIComponent(linkedPO)}`}
                className="text-primary-600 hover:underline"
              >
                {linkedPO}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <InfoCard
          label="GRN Reference"
          value={
            linkedGrn ? (
              isReadOnly && backToPoPath ? (
                <Link
                  to={`/p2p/grn/${encodeURIComponent(linkedGrn)}?fromPo=${encodeURIComponent(backToPoPath.split("/").pop() ?? "")}`}
                  className="text-primary-600 hover:underline"
                >
                  {linkedGrn}
                </Link>
              ) : (
                <Link
                  to={`/p2p/grn/${encodeURIComponent(linkedGrn)}`}
                  className="text-primary-600 hover:underline"
                >
                  {linkedGrn}
                </Link>
              )
            ) : (
              "—"
            )
          }
        />
        <InfoCard label="Payment Status" value={paymentStatus} />
        <InfoCard
          label="Due Date"
          value={
            <span className={overdue ? "font-semibold text-danger-600" : ""}>
              {formatDate(invoice.due_date)}
            </span>
          }
        />
        <InfoCard label="Bill No." value={invoice.bill_no ?? "—"} />
        <InfoCard label="Company" value={invoice.company ?? "—"} />
        {currencySplit && (
          <InfoCard
            label="Outstanding Currency"
            value={`${payableCurrency} (invoice in ${invoice.currency})`}
          />
        )}
      </div>

      {!isReadOnly && currencySplit && isDraft && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-800">
          <Receipt className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            This supplier&apos;s ledger uses <strong>{payableCurrency}</strong>.
            The invoice total is in <strong>{invoice.currency}</strong>, but
            outstanding will be recorded in <strong>{payableCurrency}</strong>{" "}
            when submitted. Payment must be made against the payable balance in{" "}
            {payableCurrency}.
          </p>
        </div>
      )}

      {/* Items table */}
      <div className="mt-6 card">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">Items</h3>
        </div>

        {(invoice.items ?? []).length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No items"
            description="This invoice has no line items."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Purchase Order</th>
                  <th className="px-4 py-2">GRN</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2">UOM</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {(invoice.items ?? []).map((item, idx) => (
                  <tr key={item.name ?? idx}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-neutral-900">
                        {item.item_code}
                      </div>
                      {item.item_name && item.item_name !== item.item_code && (
                        <div className="text-xs text-neutral-500">
                          {item.item_name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {item.purchase_order ? (
                        <Link
                          to={`/p2p/purchase-orders/${encodeURIComponent(item.purchase_order)}`}
                          className="text-primary-600 hover:underline"
                        >
                          {item.purchase_order}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {item.purchase_receipt ? (
                        <Link
                          to={`/p2p/grn/${encodeURIComponent(item.purchase_receipt)}`}
                          className="text-primary-600 hover:underline"
                        >
                          {item.purchase_receipt}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {item.qty ?? 0}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {item.uom ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(item.rate)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="flex flex-col items-end gap-2 border-t-2 border-neutral-200 px-5 py-4">
              <TotalRow
                label="Subtotal"
                value={formatCurrency(invoice.net_total)}
              />
              {(invoice.total_taxes_and_charges ?? 0) > 0 && (
                <TotalRow
                  label="Taxes"
                  value={formatCurrency(
                    invoice.total_taxes_and_charges)}
                />
              )}
              <TotalRow
                label="Grand Total"
                value={formatCurrency(invoice.grand_total)}
                bold
              />
              {hasOutstanding && (
                <TotalRow
                  label={
                    currencySplit
                      ? `Outstanding (${payableCurrency})`
                      : "Outstanding"
                  }
                  value={formatCurrency(
                    invoice.outstanding_amount)}
                  danger
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Paid banner */}
      {isPaid && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-accent-200 bg-accent-50 p-4 shadow-sm">
          <BadgeCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-600" />
          <div>
            <p className="text-sm font-semibold text-accent-900">
              Invoice fully paid
            </p>
            <p className="mt-0.5 text-xs text-accent-700">
              This invoice has been settled and no amount is outstanding.
            </p>
          </div>
        </div>
      )}

      {isReadOnly && (
        <p className="mt-6 text-center text-xs text-neutral-400">
          This is a read-only view opened from the purchase order. Historical
          records cannot be modified from this screen.
        </p>
      )}
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

function BackLink({ backToPoPath }: { backToPoPath?: string | null }) {
  if (backToPoPath) {
    return (
      <Link
        to={backToPoPath}
        className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Purchase Order
      </Link>
    );
  }

  return (
    <Link
      to="/p2p/invoices"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" /> Back to Invoices
    </Link>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function PdfButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function TotalRow({
  label,
  value,
  bold,
  danger,
}: {
  label: string;
  value: string;
  bold?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`flex gap-12 ${bold ? "text-base font-bold text-neutral-900" : "text-sm text-neutral-700"} ${danger ? "font-semibold text-danger-600" : ""}`}
    >
      <span className="w-28 text-right text-neutral-500">{label}</span>
      <span className="w-28 text-right tabular-nums">{value}</span>
    </div>
  );
}
