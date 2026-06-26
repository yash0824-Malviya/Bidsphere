import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Package,
  PackagePlus,
  Printer,
  Send,
  Truck,
} from "lucide-react";

import { createVoucher, getAllVouchers } from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { Voucher, VoucherItem } from "../../types/voucher";
import {
  getPurchaseReceipt,
  submitPurchaseReceipt,
} from "../../api/purchasing";
import { invalidateFinanceDashboardMetrics } from "../../api/financeWorkflow";
import ReadOnlyViewBadge from "../../components/document/ReadOnlyViewBadge";
import EmptyState from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import ProcurementTimeline from "../../components/supplier-portal/ProcurementTimeline";
import { usePoDrillDown } from "../../hooks/usePoDrillDown";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { canCreateGRN } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format";
import { downloadGrnPdf, printGrnPdf } from "../../utils/pdf";
import {
  primaryPOFromReceipt,
  primaryWarehouseFromReceipt,
  purchaseOrderDetailPath,
} from "../../utils/supplierPortalUtils";

const LARGE_STATUS_STYLES: Record<string, string> = {
  Draft: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  Submitted: "bg-primary-50 text-primary-800 ring-primary-200",
  "To Bill": "bg-primary-50 text-primary-800 ring-primary-200",
  Completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Closed: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  Cancelled: "bg-red-50 text-red-700 ring-red-200",
  "Return Issued": "bg-amber-50 text-amber-800 ring-amber-200",
};

export default function GRNDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isReadOnly, backToPoPath } = usePoDrillDown();
  const role = useAuthStore((s) => s.user?.role);
  const canCreateVoucher = role === "finance" || role === "admin";
  const canManageGRN = canCreateGRN(role);
  const isGrnReadOnly = isReadOnly || !canManageGRN;
  const name = decodeURIComponent(id);

  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const {
    data: grn,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["purchase-receipt", name],
    queryFn: () => getPurchaseReceipt(name),
    enabled: !!name,
    staleTime: 0,
  });

  const linkedPOForQuery = grn
    ? (grn.items ?? []).find((it) => it.purchase_order)?.purchase_order
    : undefined;

  const syncVersion = useVoucherSyncStore((s) => s.version);
  const voucher = useMemo(
    () => getAllVouchers().find((v) => v.grn_reference === name) ?? null,
    [name, syncVersion]
  );
  const hasVoucher = !!voucher;

  const [creatingVoucher, setCreatingVoucher] = useState(false);

  function handleCreateVoucher() {
    if (!grn) return;

    if (!canCreateVoucher) {
      toast.error("Only Finance can create vouchers.");
      return;
    }

    if (hasVoucher) {
      navigate(`/p2p/vouchers/${encodeURIComponent(voucher!.id)}`);
      return;
    }

    setCreatingVoucher(true);
    try {
      const items: VoucherItem[] = (grn.items ?? []).map((it) => ({
        item_code: it.item_code,
        item_name: it.item_name ?? it.item_code,
        qty: it.qty,
        rate: it.rate,
        amount: it.amount ?? it.rate * it.qty,
        uom: it.uom ?? "Nos",
      }));
      const created = createVoucher({
        po_reference: linkedPOForQuery ?? "",
        grn_reference: name,
        supplier: grn.supplier,
        supplier_name: grn.supplier_name ?? grn.supplier,
        amount: grn.grand_total ?? items.reduce((s, it) => s + it.amount, 0),
        currency: grn.currency ?? "USD",
        items,
      });
      void queryClient.invalidateQueries({
        queryKey: ["grns-awaiting-invoice"],
      });
      toast.success(`Voucher ${created.id} created!`);
      navigate(`/p2p/vouchers/${encodeURIComponent(created.id)}`);
    } finally {
      setCreatingVoucher(false);
    }
  }

  const submitMutation = useMutation({
    mutationFn: () => submitPurchaseReceipt(name),
    onSuccess: () => {
      toast.success(`${name} submitted — goods received recorded.`);
      void queryClient.invalidateQueries({
        queryKey: ["purchase-receipt", name],
      });
      void queryClient.invalidateQueries({ queryKey: ["purchase-receipts"] });
      void queryClient.invalidateQueries({ queryKey: ["grns-awaiting-invoice"] });
      invalidateFinanceDashboardMetrics(queryClient);
      const linkedPO =
        primaryPOFromReceipt(grn!) ??
        (grn!.items ?? []).find((it) => it.purchase_order)?.purchase_order;
      if (linkedPO) {
        void queryClient.invalidateQueries({
          queryKey: ["purchase-order", linkedPO],
        });
        void queryClient.invalidateQueries({
          queryKey: ["po-grns", linkedPO],
        });
      }
    },
    onError: (err) => {
      toast.error(
        `Submit failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        { duration: 8_000 }
      );
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !grn) {
    return (
      <div>
        <BackLink backToPoPath={backToPoPath} />
        <EmptyState
          icon={PackagePlus}
          title="GRN not found"
          description={`"${name}" may have been deleted or you may not have access.`}
        />
      </div>
    );
  }

  const isDraft = (grn.docstatus ?? 0) === 0;
  const isSubmitted = (grn.docstatus ?? 0) === 1;
  const statusLabel = grn.status ?? (isDraft ? "Draft" : "Submitted");

  const linkedPOName = primaryPOFromReceipt(grn);
  const linkedPOPath = linkedPOName ? purchaseOrderDetailPath(linkedPOName) : undefined;

  const warehouse = primaryWarehouseFromReceipt(grn);

  const handlePrint = () => {
    void printGrnPdf(grn, statusLabel).catch((err: Error) =>
      toast.error(err.message || "Could not open print preview.")
    );
  };

  const handleDownload = () => {
    void downloadGrnPdf(grn, statusLabel).catch((err: Error) =>
      toast.error(err.message || "Could not generate PDF.")
    );
  };

  const workflow = deriveGrnWorkflow({
    linkedPOName,
    isSubmitted,
    hasVoucher,
    voucher,
    grnStatus: statusLabel,
  });

  const financeStage = deriveFinanceStage({
    isSubmitted,
    isDraft,
    hasVoucher,
    voucher,
    canCreateVoucher,
    isReadOnly,
  });

  const activityEvents = buildActivityEvents(grn, voucher, isSubmitted);

  return (
    <div className="space-y-3 pb-4">
      <BackLink backToPoPath={backToPoPath} />

      {/* Page header + large status */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">
            Goods Receipt Note
          </p>
          <h1 className="mt-0.5 text-xl font-bold text-neutral-900 sm:text-2xl">{grn.name}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {grn.supplier_name ?? grn.supplier}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isGrnReadOnly && <ReadOnlyViewBadge />}
          <LargeStatusBadge status={statusLabel} />
          {!isGrnReadOnly && isDraft && canManageGRN && (
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
            >
              {submitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Submit GRN
            </button>
          )}
        </div>
      </div>

      {/* Compact summary strip */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <SummaryField
              label="PO Reference"
              value={
                linkedPOName && linkedPOPath ? (
                  <Link
                    to={linkedPOPath}
                    className="font-semibold text-primary-600 hover:underline"
                  >
                    {linkedPOName}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <SummaryField label="Posting Date" value={formatDate(grn.posting_date)} />
            <SummaryField label="Warehouse" value={warehouse ?? "—"} />
          </div>
          <div className="space-y-2 sm:border-l sm:border-neutral-100 sm:pl-4">
            <SummaryField label="Status" value={statusLabel} />
            <SummaryField
              label="Total Value"
              value={formatCurrency(grn.grand_total)}
              highlight
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0 space-y-3">
          {/* Items received table */}
          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-3.5 py-2.5">
              <h2 className="text-sm font-semibold text-neutral-900">Items Received</h2>
              <p className="text-[11px] text-neutral-500">
                {(grn.items ?? []).length} line item{(grn.items ?? []).length === 1 ? "" : "s"}
              </p>
            </div>

            {(grn.items ?? []).length === 0 ? (
              <EmptyState
                icon={PackagePlus}
                title="No items"
                description="This GRN has no line items."
              />
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-neutral-50 shadow-[0_1px_0_0_rgb(229,229,229)]">
                    <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      <th className="px-3.5 py-2.5">Item</th>
                      <th className="px-3 py-2.5">Purchase Order</th>
                      <th className="px-3 py-2.5 text-right">Qty</th>
                      <th className="px-3 py-2.5">UOM</th>
                      <th className="px-3 py-2.5 text-right">Rate</th>
                      <th className="px-3.5 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {(grn.items ?? []).map((item, idx) => (
                      <tr
                        key={item.name ?? idx}
                        className="transition-colors hover:bg-primary-50/30"
                      >
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100">
                              <Package className="h-4 w-4 text-primary-600" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-neutral-900">{item.item_code}</p>
                              {item.item_name && item.item_name !== item.item_code && (
                                <p className="text-xs text-neutral-500">{item.item_name}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-neutral-600">
                          {item.purchase_order ? (
                            <Link
                              to={purchaseOrderDetailPath(item.purchase_order)}
                              className="text-primary-600 hover:underline"
                            >
                              {item.purchase_order}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-800">
                          {item.qty ?? 0}
                        </td>
                        <td className="px-3 py-2.5 text-neutral-600">{item.uom ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">
                          {formatCurrency(item.rate)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold tabular-nums text-neutral-900">
                          {formatCurrency(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-primary-600 text-white">
                    <tr>
                      <td colSpan={5} className="px-3.5 py-3 text-right text-sm font-semibold">
                        Grand Total
                      </td>
                      <td className="px-3.5 py-3 text-right text-base font-bold tabular-nums">
                        {formatCurrency(grn.grand_total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Procurement workflow — replaces GRN submitted banner */}
          <ProcurementTimeline steps={workflow.steps} title="Procurement Workflow" />

          {/* Finance processing */}
          {(isSubmitted || hasVoucher) && (
            <section className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                  <FileText className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">Finance Processing</h2>
                  <p className="text-[11px] text-neutral-500">Voucher and payment lifecycle</p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <FinanceMetric label="Current Stage" value={financeStage.currentStage} />
                <FinanceMetric label="Next Action" value={financeStage.nextAction} />
                <FinanceMetric label="Responsible Team" value={financeStage.responsibleTeam} />
                <FinanceMetric
                  label="Expected Completion"
                  value={financeStage.expectedCompletion}
                />
              </div>

              {hasVoucher && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-100 bg-neutral-50/80 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      Voucher ID
                    </p>
                    <p className="truncate text-sm font-semibold text-neutral-900">{voucher!.id}</p>
                  </div>
                  <Link
                    to={`/p2p/vouchers/${encodeURIComponent(voucher!.id)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-700"
                  >
                    View Voucher
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}

              {!hasVoucher && canCreateVoucher && !isReadOnly && isSubmitted && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3">
                  <p className="text-xs text-neutral-500">
                    Issue a supplier voucher to continue toward invoice and payment.
                  </p>
                  <button
                    type="button"
                    onClick={handleCreateVoucher}
                    disabled={creatingVoucher}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-60"
                  >
                    {creatingVoucher ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    {creatingVoucher ? "Creating…" : "Create Voucher"}
                  </button>
                </div>
              )}

              {!hasVoucher && !canCreateVoucher && isSubmitted && (
                <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                  Routed to the Finance queue — Accounts Payable will issue the supplier voucher.
                </p>
              )}
            </section>
          )}

          {/* Activity timeline */}
          <section className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
              Activity Timeline
            </h2>
            <ol className="relative ml-2 border-l border-neutral-200 pl-4">
              {activityEvents.map((event, idx) => (
                <li key={event.id} className={`relative ${idx < activityEvents.length - 1 ? "pb-4" : ""}`}>
                  <span className="absolute -left-[21px] top-1 flex h-2.5 w-2.5 rounded-full bg-primary-500 ring-4 ring-white" />
                  <p className="text-sm font-medium text-neutral-900">{event.title}</p>
                  {event.detail && (
                    <p className="mt-0.5 text-xs text-neutral-600">{event.detail}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-neutral-400">{formatDateTime(event.timestamp)}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Draft states */}
          {!isReadOnly && isDraft && !canManageGRN && (
            <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 shadow-sm">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  Awaiting warehouse receipt confirmation
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  The Warehouse team confirms receipt and submits this GRN.
                </p>
              </div>
            </div>
          )}

          {!isReadOnly && isDraft && canManageGRN && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-3 shadow-sm">
              <div>
                <p className="text-sm font-semibold text-amber-900">Ready to confirm receipt?</p>
                <p className="text-xs text-amber-800">
                  Submitting updates the linked PO received percentage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {submitMutation.isPending ? "Submitting…" : "Submit GRN"}
              </button>
            </div>
          )}

          {isReadOnly && (
            <p className="text-center text-xs text-neutral-400">
              Read-only view opened from the purchase order.
            </p>
          )}
        </div>

        {/* Quick actions sidebar */}
        <aside className="w-full lg:sticky lg:top-4 lg:w-[220px] lg:shrink-0 lg:self-start">
          <QuickActionsCard
            hasVoucher={hasVoucher}
            voucherId={voucher?.id}
            onDownload={handleDownload}
            onPrint={handlePrint}
          />
        </aside>
      </div>
    </div>
  );
}

/* ── UI helpers (display-only derivation) ───────────────────────────────── */

function deriveGrnWorkflow({
  linkedPOName,
  isSubmitted,
  hasVoucher,
  voucher,
  grnStatus,
}: {
  linkedPOName?: string;
  isSubmitted: boolean;
  hasVoucher: boolean;
  voucher: Voucher | null;
  grnStatus: string;
}) {
  const poCreated = !!linkedPOName;
  const goodsReceived = isSubmitted;
  const inventoryUpdated = isSubmitted && grnStatus !== "Draft";
  const voucherPending = isSubmitted && !hasVoucher;
  const voucherDone = hasVoucher;

  const invoiceDone =
    !!voucher &&
    (!!voucher.invoice ||
      ["invoice_raised", "under_review", "invoice_approved", "payment_confirmed", "payment_received"].includes(
        voucher.status
      ));

  const paymentDone =
    !!voucher &&
    (!!voucher.payment ||
      voucher.status === "payment_confirmed" ||
      voucher.status === "payment_received" ||
      voucher.invoice?.status === "paid");

  return {
    steps: [
      { label: "PO Created", done: poCreated, sublabel: linkedPOName },
      { label: "Goods Received", done: goodsReceived },
      { label: "Inventory Updated", done: inventoryUpdated },
      {
        label: "Voucher Pending",
        done: voucherDone || (!voucherPending && invoiceDone),
        sublabel: voucher?.id,
      },
      {
        label: "Invoice",
        done: invoiceDone,
        sublabel: voucher?.invoice?.invoice_number,
      },
      { label: "Payment", done: paymentDone },
    ],
  };
}

function deriveFinanceStage({
  isSubmitted,
  isDraft,
  hasVoucher,
  voucher,
  canCreateVoucher,
  isReadOnly,
}: {
  isSubmitted: boolean;
  isDraft: boolean;
  hasVoucher: boolean;
  voucher: Voucher | null;
  canCreateVoucher: boolean;
  isReadOnly: boolean;
}) {
  if (isDraft) {
    return {
      currentStage: "Goods Receipt (Draft)",
      nextAction: "Warehouse to confirm and submit GRN",
      responsibleTeam: "Warehouse Operations",
      expectedCompletion: "Same business day",
    };
  }

  if (!isSubmitted) {
    return {
      currentStage: "Pending Submission",
      nextAction: "Complete goods receipt confirmation",
      responsibleTeam: "Warehouse Operations",
      expectedCompletion: "1 business day",
    };
  }

  if (!hasVoucher) {
    return {
      currentStage: "Awaiting Voucher",
      nextAction: canCreateVoucher && !isReadOnly
        ? "Create supplier voucher"
        : "Finance to issue voucher",
      responsibleTeam: "Accounts Payable",
      expectedCompletion: "1–2 business days",
    };
  }

  if (voucher?.payment || voucher?.status === "payment_confirmed" || voucher?.status === "payment_received") {
    return {
      currentStage: "Payment Complete",
      nextAction: "No action required",
      responsibleTeam: "Accounts Payable",
      expectedCompletion: "Completed",
    };
  }

  if (voucher?.invoice?.status === "paid") {
    return {
      currentStage: "Invoice Paid",
      nextAction: "Awaiting supplier payment confirmation",
      responsibleTeam: "Supplier Portal",
      expectedCompletion: "2–3 business days",
    };
  }

  if (voucher?.invoice || ["invoice_raised", "under_review"].includes(voucher?.status ?? "")) {
    return {
      currentStage: "Invoice Under Review",
      nextAction: "Finance to approve supplier invoice",
      responsibleTeam: "Finance & Procurement",
      expectedCompletion: voucher?.invoice?.due_date
        ? formatDate(voucher.invoice.due_date)
        : "3–5 business days",
    };
  }

  if (voucher?.status === "invoice_approved") {
    return {
      currentStage: "Invoice Approved",
      nextAction: "Release payment to supplier",
      responsibleTeam: "Accounts Payable",
      expectedCompletion: "1–2 business days",
    };
  }

  return {
    currentStage: "Voucher Issued",
    nextAction: "Supplier to raise invoice against voucher",
    responsibleTeam: "Supplier",
    expectedCompletion: voucher?.due_date ? formatDate(voucher.due_date) : "5–7 business days",
  };
}

function buildActivityEvents(
  grn: { name: string; creation?: string; modified?: string; supplier_name?: string; supplier: string },
  voucher: Voucher | null,
  isSubmitted: boolean
) {
  const events: Array<{ id: string; title: string; detail?: string; timestamp: string }> = [];

  if (grn.creation) {
    events.push({
      id: "created",
      title: "GRN created",
      detail: `Draft goods receipt ${grn.name} opened`,
      timestamp: grn.creation,
    });
  }

  if (isSubmitted && grn.modified) {
    events.push({
      id: "submitted",
      title: "Goods receipt submitted",
      detail: "Inventory receipt confirmed and PO updated",
      timestamp: grn.modified,
    });
  }

  if (voucher?.created_at) {
    events.push({
      id: "voucher",
      title: "Voucher issued",
      detail: `Finance voucher ${voucher.id} created`,
      timestamp: voucher.created_at,
    });
  }

  if (voucher?.invoice?.raised_at) {
    events.push({
      id: "invoice",
      title: "Supplier invoice received",
      detail: voucher.invoice.invoice_number,
      timestamp: voucher.invoice.raised_at,
    });
  }

  if (voucher?.payment?.confirmed_at) {
    events.push({
      id: "payment",
      title: "Payment confirmed",
      detail: voucher.payment.reference_number || undefined,
      timestamp: voucher.payment.confirmed_at,
    });
  }

  for (const entry of voucher?.history ?? []) {
    events.push({
      id: entry.id,
      title: entry.action,
      detail: entry.note || `${entry.actor} (${entry.actor_role})`,
      timestamp: entry.timestamp,
    });
  }

  if (events.length === 0 && grn.modified) {
    events.push({
      id: "modified",
      title: "Record updated",
      timestamp: grn.modified,
    });
  }

  return events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function BackLink({ backToPoPath }: { backToPoPath?: string | null }) {
  if (backToPoPath) {
    return (
      <Link
        to={backToPoPath}
        className="inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Purchase Order
      </Link>
    );
  }

  return (
    <Link
      to="/p2p/grn"
      className="inline-flex items-center gap-1 text-sm text-neutral-500 transition hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" /> Back to GRNs
    </Link>
  );
}

function LargeStatusBadge({ status }: { status: string }) {
  const classes =
    LARGE_STATUS_STYLES[status] ?? "bg-primary-50 text-primary-800 ring-primary-200";
  return (
    <span
      className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-bold ring-2 ring-inset ${classes}`}
    >
      {status}
    </span>
  );
}

function SummaryField({
  label,
  value,
  highlight,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span
        className={`min-w-0 truncate text-right font-semibold ${
          highlight ? "text-primary-600" : "text-neutral-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function FinanceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function QuickActionsCard({
  hasVoucher,
  voucherId,
  onDownload,
  onPrint,
}: {
  hasVoucher: boolean;
  voucherId?: string;
  onDownload: () => void;
  onPrint: () => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-500">
        Quick Actions
      </h2>
      <nav className="flex flex-col gap-1.5">
        <QuickActionButton icon={Download} label="Download GRN PDF" onClick={onDownload} />
        <QuickActionButton icon={Printer} label="Print GRN" onClick={onPrint} />
        {hasVoucher && voucherId ? (
          <QuickActionLink
            to={`/p2p/vouchers/${encodeURIComponent(voucherId)}`}
            icon={Truck}
            label="Track Voucher"
          />
        ) : (
          <QuickActionDisabled
            icon={Truck}
            label="Track Voucher"
            hint="Voucher has not been created yet."
          />
        )}
      </nav>
    </div>
  );
}

function QuickActionLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof FileText;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/50 hover:text-primary-700"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary-600" />
      {label}
    </Link>
  );
}

function QuickActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm font-medium text-neutral-700 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/50 hover:text-primary-700"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary-600" />
      {label}
    </button>
  );
}

function QuickActionDisabled({
  icon: Icon,
  label,
  hint = "Unavailable",
}: {
  icon: typeof FileText;
  label: string;
  hint?: string;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm text-neutral-400"
      title={hint}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </div>
  );
}
