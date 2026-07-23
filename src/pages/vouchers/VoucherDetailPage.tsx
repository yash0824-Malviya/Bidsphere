import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Package,
  Receipt,
  Send,
  Wallet,
} from "lucide-react";

import { EnterpriseError } from "../../components/enterprise";
import PageHeader from "../../components/PageHeader";
import VoucherHistory from "../../components/VoucherHistory";
import VoucherStatusBadge from "../../components/VoucherStatusBadge";
import WarehouseVerificationCard from "../../components/warehouse/WarehouseVerificationCard";
import { getPurchaseReceipt } from "../../api/purchasing";
import { appendWarehouseEsignAudit } from "../../api/warehouseEsign";
import { getVoucherById, sendVoucherToSupplier } from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import PdfActions from "../../components/PdfActions";
import {
  buildVoucherInvoicePdf,
  buildVoucherPaymentPdf,
  buildVoucherPdf,
  voucherInvoicePdfFilename,
  voucherPaymentPdfFilename,
  voucherPdfFilename,
} from "../../utils/pdf/voucherDocPdf";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate } from "../../utils/format";
import LineEngineeringDocsCell from "../../components/attachments/LineEngineeringDocsCell";

export default function VoucherDetailPage() {
  const { id = "" } = useParams();
  const voucherId = decodeURIComponent(id);
  const user = useAuthStore((s) => s.user);
  const canAct = user?.role === "finance" || user?.role === "admin";

  const syncVersion = useVoucherSyncStore((s) => s.version);
  const {
    data: voucher,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["voucher", voucherId, syncVersion],
    queryFn: () => getVoucherById(voucherId),
    enabled: !!voucherId,
  });

  const grnName = voucher?.grn_reference?.trim() || "";
  const {
    data: linkedGrn,
    isLoading: grnLoading,
  } = useQuery({
    queryKey: ["purchase-receipt", grnName],
    queryFn: () => getPurchaseReceipt(grnName),
    enabled: !!grnName,
    staleTime: 0,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!linkedGrn || !user) return;
    if (user.role !== "finance" && user.role !== "admin") return;
    const key = `bidsphere:finance-viewed-signed-grn:${linkedGrn.name}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    appendWarehouseEsignAudit(
      "Finance viewed signed GRN",
      user.full_name || user.email || "Finance",
      linkedGrn.name,
      { targetRole: "finance", grnName: linkedGrn.name },
    );
  }, [linkedGrn, user]);

  if (isLoading) {
    return <VoucherDetailSkeleton />;
  }

  if (isError || !voucher) {
    return (
      <EnterpriseError
        error={error ?? new Error("not found")}
        onRetry={() => void refetch()}
        onBack={() => window.history.back()}
      />
    );
  }

  const hasInvoice = !!voucher.invoice;
  const items = voucher.items ?? [];

  async function handleSend() {
    try {
      const updated = await sendVoucherToSupplier(voucher!.id);
      if (updated) {
        await refetch();
        toast.success("Voucher sent to supplier.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send voucher");
    }
  }

  return (
    <div className="space-y-5">
      <BackLink />

      <PageHeader
        title="Voucher"
        description={`${voucher.id} · Issued to ${voucher.supplier_name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PdfActions
              showView={false}
              docLabel="Voucher PDF"
              filename={voucherPdfFilename(voucher)}
              build={() => buildVoucherPdf(voucher!)}
            />
            {hasInvoice && (
              <PdfActions
                showView={false}
                docLabel="Invoice PDF"
                filename={voucherInvoicePdfFilename(voucher)}
                build={() => buildVoucherInvoicePdf(voucher!)}
              />
            )}
            {voucher.payment && (
              <PdfActions
                showView={false}
                docLabel="Payment PDF"
                filename={voucherPaymentPdfFilename(voucher)}
                build={() => buildVoucherPaymentPdf(voucher!)}
              />
            )}
            {!canAct && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600 ring-1 ring-inset ring-neutral-200">
                <Eye className="h-3.5 w-3.5" />
                Read Only
              </span>
            )}
            <VoucherStatusBadge status={voucher.status} />
          </div>
        }
      />

      <p className="text-base font-semibold tracking-tight text-neutral-900">
        {voucher.id}
      </p>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          icon={<Building2 className="h-4 w-4 text-primary-600" />}
          label="Supplier"
          value={voucher.supplier_name}
        />
        <SummaryTile
          icon={<Wallet className="h-4 w-4 text-emerald-600" />}
          label="Voucher Amount"
          value={formatCurrency(voucher.amount)}
        />
        <SummaryTile
          icon={<FileText className="h-4 w-4 text-violet-600" />}
          label="PO Reference"
          value={voucher.po_reference || "—"}
        />
        <SummaryTile
          icon={<Clock className="h-4 w-4 text-amber-600" />}
          label="Created"
          value={`${formatDate(voucher.created_at)} · ${voucher.created_by}`}
        />
      </div>

      {/* Linked GRN / documents */}
      <div>
        {grnName ? (
          grnLoading ? (
            <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-5 text-sm text-neutral-500 shadow-sm">
              Loading linked signed GRN…
            </div>
          ) : linkedGrn ? (
            <WarehouseVerificationCard grn={linkedGrn} />
          ) : (
            <EmptyPanel
              title="Linked GRN unavailable"
              description={`GRN ${grnName} could not be loaded. Voucher inventory reference may be incomplete.`}
            />
          )
        ) : (
          <EmptyPanel
            title="No linked GRN"
            description="This voucher has no linked GRN. Warehouse verification cannot be shown."
          />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Items */}
          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
              <Package className="h-4 w-4 text-primary-600" />
              <h3 className="text-sm font-semibold tracking-tight text-neutral-900">
                Line Items
              </h3>
            </div>
            {items.length === 0 ? (
              <EmptyPanel
                title="No line items"
                description="Items will appear here once they are added to this voucher."
                flush
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-200 text-sm">
                  <thead className="bg-neutral-50 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-2.5">Item</th>
                      <th className="min-w-[160px] px-4 py-2.5">Attachments</th>
                      <th className="px-4 py-2.5 text-right">Qty</th>
                      <th className="px-4 py-2.5 text-right">Rate</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {items.map((it) => (
                      <tr
                        key={it.item_code}
                        className="transition-colors hover:bg-primary-50/50"
                      >
                        <td className="px-4 py-2.5 align-top font-medium text-neutral-900">
                          {it.item_name}
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <LineEngineeringDocsCell
                            lookup={{
                              item_code: it.item_code,
                              purchase_order: voucher.po_reference || undefined,
                            }}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right align-top tabular-nums text-neutral-700">
                          {it.qty} {it.uom}
                        </td>
                        <td className="px-4 py-2.5 text-right align-top tabular-nums text-neutral-700">
                          {formatCurrency(it.rate)}
                        </td>
                        <td className="px-4 py-2.5 text-right align-top font-semibold tabular-nums text-neutral-900">
                          {formatCurrency(it.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-neutral-50">
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-600"
                      >
                        Total
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-bold tabular-nums text-neutral-900">
                        {formatCurrency(voucher.amount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Supplier invoice */}
          {voucher.invoice && (
            <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
                <Receipt className="h-4 w-4 text-orange-500" />
                <h3 className="text-sm font-semibold tracking-tight text-neutral-900">
                  Supplier Invoice — {voucher.invoice.invoice_number}
                </h3>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryTile
                  label="Subtotal"
                  value={formatCurrency(voucher.invoice.subtotal)}
                />
                <SummaryTile
                  label={`Tax (${voucher.invoice.tax_rate}%)`}
                  value={formatCurrency(voucher.invoice.tax_amount)}
                />
                <SummaryTile
                  label="Invoice Total"
                  value={formatCurrency(voucher.invoice.total)}
                />
                <SummaryTile
                  label="Payment Terms"
                  value={voucher.invoice.payment_terms}
                />
                <SummaryTile
                  label="Due Date"
                  value={
                    voucher.invoice.due_date
                      ? formatDate(voucher.invoice.due_date)
                      : "—"
                  }
                />
              </div>
              {voucher.invoice.notes && (
                <p className="border-t border-neutral-100 px-4 py-3 text-sm leading-relaxed text-neutral-600">
                  {voucher.invoice.notes}
                </p>
              )}
            </section>
          )}

          {/* Payment confirmation */}
          {voucher.payment && (
            <section className="overflow-hidden rounded-2xl border border-neutral-200 border-l-4 border-l-teal-500 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
                <h3 className="text-sm font-semibold tracking-tight text-neutral-900">
                  Payment Confirmed
                </h3>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryTile
                  label="Amount Paid"
                  value={formatCurrency(voucher.payment.amount)}
                />
                <SummaryTile
                  label="Method"
                  value={voucher.payment.payment_method}
                />
                <SummaryTile
                  label="Reference"
                  value={voucher.payment.reference_number}
                />
                <SummaryTile
                  label="Confirmed By"
                  value={voucher.payment.confirmed_by}
                />
                <SummaryTile
                  label="Confirmed On"
                  value={formatDate(voucher.payment.confirmed_at)}
                />
              </div>
            </section>
          )}

          {/* Actions */}
          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold tracking-tight text-neutral-900">
              Actions
            </h3>
            {voucher.status === "draft" && canAct && (
              <button
                type="button"
                onClick={handleSend}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-primary-700"
              >
                <Send className="h-4 w-4" />
                Send to Supplier
              </button>
            )}

            {(voucher.status === "sent" || voucher.status === "viewed") && (
              <WaitingMsg text="Waiting for the supplier to review and create an invoice." />
            )}

            {hasInvoice &&
              (voucher.status === "invoice_raised" ||
                voucher.status === "under_review" ||
                voucher.status === "invoice_approved" ||
                voucher.status === "invoice_rejected") && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <p className="text-sm leading-relaxed text-neutral-600">
                    {voucher.status === "invoice_raised"
                      ? "An invoice has been submitted — review it to approve or reject."
                      : voucher.status === "invoice_approved"
                        ? "Invoice approved — release payment from the invoice."
                        : voucher.status === "invoice_rejected"
                          ? "Invoice rejected — waiting for the supplier to re-submit."
                          : "Invoice is under review."}
                  </p>
                  <Link
                    to={`/p2p/invoices/${encodeURIComponent(voucher.id)}`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-primary-700"
                  >
                    {canAct ? "Review Invoice" : "View Invoice"}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}

            {voucher.status === "payment_confirmed" && (
              <WaitingMsg text="Payment released. Waiting for the supplier to acknowledge receipt." />
            )}

            {voucher.status === "payment_received" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-100 px-3 py-1.5 text-sm font-semibold text-success-700 ring-1 ring-inset ring-success-200">
                <CheckCircle2 className="h-4 w-4" />
                Completed — fully settled
              </span>
            )}

            {!canAct && voucher.status === "draft" && (
              <WaitingMsg text="This voucher is awaiting action by the Finance team." />
            )}
          </section>
        </div>

        {/* Timeline — sticky on desktop */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary-600" />
              <h3 className="text-sm font-semibold tracking-tight text-neutral-900">
                Activity
              </h3>
            </div>
            {(voucher.history ?? []).length === 0 ? (
              <EmptyPanel
                title="No activity yet"
                description="Lifecycle events will appear here as the voucher progresses."
                flush
              />
            ) : (
              <VoucherHistory history={voucher.history} />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function WaitingMsg({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-600">
      <Clock className="h-4 w-4 shrink-0 text-neutral-400" />
      {text}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md">
      <div className="mb-1.5 flex items-center gap-2">
        {icon}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {label}
        </p>
      </div>
      <p className="truncate text-sm font-semibold tracking-tight text-neutral-900">
        {value}
      </p>
    </div>
  );
}

function EmptyPanel({
  title,
  description,
  flush,
}: {
  title: string;
  description: string;
  flush?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center px-4 py-8 text-center ${
        flush
          ? ""
          : "rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/80"
      }`}
    >
      <span className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-white text-neutral-400 shadow-sm ring-1 ring-neutral-200">
        <FileText className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-neutral-800">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-neutral-500">
        {description}
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/p2p/vouchers"
      className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500 transition hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to vouchers
    </Link>
  );
}

function VoucherDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="h-4 w-32 rounded bg-neutral-200" />
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-neutral-200" />
        <div className="h-4 w-64 rounded bg-neutral-100" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-2xl border border-neutral-200 bg-white"
          />
        ))}
      </div>
      <div className="h-28 rounded-2xl border border-neutral-200 bg-white" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="h-56 rounded-2xl border border-neutral-200 bg-white" />
          <div className="h-32 rounded-2xl border border-neutral-200 bg-white" />
        </div>
        <div className="h-64 rounded-2xl border border-neutral-200 bg-white" />
      </div>
    </div>
  );
}
