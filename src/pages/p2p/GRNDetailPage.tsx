import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  PackagePlus,
  Printer,
  Send,
} from "lucide-react";

import { createVoucher, getAllVouchers } from "../../api/vouchers";
import { useVoucherSyncStore } from "../../store/voucherSyncStore";
import type { VoucherItem } from "../../types/voucher";
import {
  getPurchaseReceipt,
  submitPurchaseReceipt,
} from "../../api/purchasing";
import ReadOnlyViewBadge from "../../components/document/ReadOnlyViewBadge";
import EmptyState from "../../components/EmptyState";
import PageHeader from "../../components/PageHeader";
import { Skeleton } from "../../components/Skeleton";
import StatusBadge from "../../components/StatusBadge";
import { usePoDrillDown } from "../../hooks/usePoDrillDown";
import { canCreateGRN } from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency, formatDate } from "../../utils/format";
import { downloadGrnPdf, printGrnPdf } from "../../utils/pdf";
import {
  primaryPOFromReceipt,
  primaryWarehouseFromReceipt,
} from "../../utils/supplierPortalUtils";

export default function GRNDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isReadOnly, backToPoPath } = usePoDrillDown();
  const role = useAuthStore((s) => s.user?.role);
  // Only Finance (and Admin) may issue vouchers — the Warehouse Manager
  // confirms goods receipt but cannot create vouchers.
  const canCreateVoucher = role === "finance" || role === "admin";
  // GRN creation/submission is a Warehouse operation. Procurement & Finance
  // view GRN records read-only and only track receipt status.
  const canManageGRN = canCreateGRN(role);
  // The GRN is read-only when opened from a PO drill-down OR when the viewing
  // role (Procurement / Finance / Supplier) has no management rights. This
  // drives the "Read Only" badge and hides every edit/submit affordance.
  const isGrnReadOnly = isReadOnly || !canManageGRN;
  const name = decodeURIComponent(id);

  const {
    data: grn,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["purchase-receipt", name],
    queryFn: () => getPurchaseReceipt(name),
    enabled: !!name,
    // Always fetch fresh so docstatus and per_received are accurate.
    staleTime: 0,
  });

  // Derive the PO name from query data (undefined while loading).
  const linkedPOForQuery = grn
    ? (grn.items ?? []).find((it) => it.purchase_order)?.purchase_order
    : undefined;

  // Detect a voucher already issued for this goods receipt so we can show
  // "View Voucher" instead of "Create Voucher". Derived from the sync version
  // so a voucher created elsewhere (e.g. another browser / the ngrok URL)
  // collapses the "Create Voucher" action here once the shared store syncs.
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
      // Refetch the GRN itself.
      void queryClient.invalidateQueries({
        queryKey: ["purchase-receipt", name],
      });
      // Refresh the GRN list.
      void queryClient.invalidateQueries({ queryKey: ["purchase-receipts"] });
      // Refresh the linked PO so per_received and button state update.
      const linkedPO = linkedPOName;
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
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
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

  const linkedPOName =
    primaryPOFromReceipt(grn) ??
    (grn.items ?? []).find((it) => it.purchase_order)?.purchase_order;

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

  return (
    <div>
      <BackLink backToPoPath={backToPoPath} />

      <PageHeader
        title={grn.name}
        description={grn.supplier_name ?? grn.supplier}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isGrnReadOnly ? (
              <>
                <ReadOnlyViewBadge />
                <PdfButton icon={Download} label="Download PDF" onClick={handleDownload} />
                <PdfButton icon={Printer} label="Print" onClick={handlePrint} />
                <StatusBadge status={statusLabel} />
              </>
            ) : (
              <>
                <StatusBadge status={statusLabel} />
                {isDraft && canManageGRN && (
                  <button
                    type="button"
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-60"
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Submit GRN
                  </button>
                )}
                {isDraft && !canManageGRN && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-500">
                    <Clock className="h-3.5 w-3.5" />
                    Awaiting Warehouse Receipt
                  </span>
                )}
                {isSubmitted && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Goods Received
                  </span>
                )}
              </>
            )}
          </div>
        }
      />

      {/* Header info cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <InfoCard label="GRN Number" value={grn.name} />
        <InfoCard label="Supplier" value={grn.supplier_name ?? grn.supplier} />
        <InfoCard label="Warehouse" value={warehouse ?? "—"} />
        <InfoCard label="Posting Date" value={formatDate(grn.posting_date)} />
        <InfoCard label="Status" value={statusLabel} />
        <InfoCard
          label="Total Value"
          value={formatCurrency(grn.grand_total)}
        />
        <InfoCard
          label="PO Reference"
          value={
            linkedPOName ? (
              <Link
                to={`/p2p/purchase-orders/${encodeURIComponent(linkedPOName)}`}
                className="text-primary-600 hover:underline"
              >
                {linkedPOName}
              </Link>
            ) : (
              "—"
            )
          }
        />
      </div>

      {/* Items table */}
      <div className="mt-6 card">
        <div className="border-b border-neutral-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">
            Items Received
          </h3>
        </div>

        {(grn.items ?? []).length === 0 ? (
          <EmptyState
            icon={PackagePlus}
            title="No items"
            description="This GRN has no line items."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Purchase Order</th>
                  <th className="px-4 py-2 text-right">Received Qty</th>
                  <th className="px-4 py-2">UOM</th>
                  <th className="px-4 py-2 text-right">Rate</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {(grn.items ?? []).map((item, idx) => (
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
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-accent-700">
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
              <tfoot>
                <tr className="bg-neutral-50">
                  <td
                    colSpan={5}
                    className="px-4 py-3 text-right text-sm font-medium"
                  >
                    Grand Total
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                    {formatCurrency(grn.grand_total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Goods-receipt confirmation — editable flow only */}
      {!isReadOnly && isSubmitted && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-accent-200 bg-accent-50 p-4 shadow-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-accent-900">
              GRN submitted — goods receipt confirmed
            </p>
            <p className="mt-0.5 text-xs text-accent-700">
              The linked purchase order's received percentage has been updated.
            </p>
            {linkedPOName && (
              <div className="mt-3">
                <Link
                  to={`/p2p/purchase-orders/${encodeURIComponent(linkedPOName)}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary-300 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"
                >
                  View PO {linkedPOName}
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Finance Processing — invoice lifecycle for this goods receipt. */}
      {isSubmitted && (
        <div className="mt-6 card p-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-neutral-100 pb-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-50 text-primary-600">
              <FileText className="h-4 w-4" />
            </span>
            <h3 className="text-sm font-semibold text-neutral-900">
              Finance Processing
            </h3>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-neutral-500">Status:</span>
            {hasVoucher ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-700 ring-1 ring-accent-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Voucher Created
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                <Clock className="h-3.5 w-3.5" />
                Awaiting Voucher Creation
              </span>
            )}
          </div>

          {hasVoucher ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  Voucher ID
                </p>
                <p className="mt-0.5 truncate text-sm font-semibold text-neutral-900">
                  {voucher!.id}
                </p>
              </div>
              <Link
                to={`/p2p/vouchers/${encodeURIComponent(voucher!.id)}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600"
              >
                <FileText className="h-3.5 w-3.5" />
                View Voucher
              </Link>
            </div>
          ) : canCreateVoucher && !isReadOnly ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-neutral-500">
                Goods received — issue a voucher to the supplier to continue to
                payment.
              </p>
              <button
                type="button"
                onClick={handleCreateVoucher}
                disabled={creatingVoucher}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-60"
              >
                {creatingVoucher ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {creatingVoucher ? "Creating…" : "Create Voucher"}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-xs text-neutral-500">
              This goods receipt has been routed to the Finance queue. Finance
              will issue the supplier voucher.
            </p>
          )}
        </div>
      )}

      {/* Draft submit CTA — Warehouse operation only (creation/submission of
          the goods receipt). Procurement & Finance never submit GRNs. */}
      {!isReadOnly && isDraft && canManageGRN && (
        <div className="mt-6 flex items-center justify-between card px-5 py-4 shadow-sm">
          <div>
            <p className="text-sm font-medium text-neutral-900">
              Ready to confirm receipt?
            </p>
            <p className="text-xs text-neutral-500">
              Submitting will update the linked PO's received percentage and
              unlock invoice creation.
            </p>
          </div>
          <button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-700 disabled:opacity-60"
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

      {/* Draft GRN, monitoring role — read-only status note. */}
      {!isReadOnly && isDraft && !canManageGRN && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-sm">
          <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-neutral-400" />
          <div>
            <p className="text-sm font-medium text-neutral-900">
              Awaiting warehouse receipt confirmation
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              This goods receipt is in draft. The Warehouse team confirms
              receipt and submits the GRN — Procurement can track its status
              here.
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
      to="/p2p/grn"
      className="mb-3 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-primary-600"
    >
      <ArrowLeft className="h-4 w-4" /> Back to GRNs
    </Link>
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

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-neutral-900">
        {value}
      </p>
    </div>
  );
}
