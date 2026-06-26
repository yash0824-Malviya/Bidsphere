import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Gavel,
  Layers,
  Loader2,
  Package,
  Send,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { getRFQ, getSupplierQuotations } from "../../api/sourcing";
import { getInvoicesForPO } from "../../api/accounts";
import { getAllVouchers } from "../../api/vouchers";
import { syncDeliveryStateFromERPNext, getDeliveryState } from "../../api/poDeliveryWorkflow";
import {
  createPurchaseOrderFromRFQ,
  getGRNsForPO,
  getPOsForRFQ,
  submitPurchaseOrder,
} from "../../api/purchasing";
import type { LinkedPORow } from "../../api/purchasing";
import {
  getApprovalState,
  isApprovedForPO,
  markPOCreated,
} from "../../api/rfqApprovalWorkflow";
import POStatusTimeline from "../../components/p2p/POStatusTimeline";
import { Skeleton } from "../../components/Skeleton";
import { buildProcurementWorkflowSteps } from "../../utils/procurementStatusWorkflow";
import { formatCurrency, formatDate } from "../../utils/format";
import type {
  RFQ,
  RFQApprovalState,
  SupplierQuotation,
  DocStatus,
} from "../../types/erpnext";

/** Map ERPNext Purchase Order docstatus to display label. */
function poStatusLabelFromDocstatus(docstatus?: DocStatus | number): string {
  if (docstatus === 1) return "Submitted";
  if (docstatus === 2) return "Cancelled";
  return "Draft";
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function RFQtoPOConversionPage() {
  const { rfqId } = useParams<{ rfqId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const decodedId = rfqId ? decodeURIComponent(rfqId) : "";

  /* ── Data fetching ── */
  const rfqQuery = useQuery<RFQ>({
    queryKey: ["rfq", decodedId],
    queryFn: () => getRFQ(decodedId),
    enabled: !!decodedId,
    retry: false,
  });

  const sqQuery = useQuery<SupplierQuotation[]>({
    queryKey: ["rfq-quotes", decodedId],
    queryFn: () => getSupplierQuotations(decodedId),
    enabled: !!decodedId && !!rfqQuery.data,
  });

  const linkedPOsQuery = useQuery<LinkedPORow[]>({
    queryKey: ["rfq-linked-pos", decodedId],
    queryFn: () => getPOsForRFQ(decodedId),
    enabled: !!decodedId,
    staleTime: 0,
  });

  const rfq = rfqQuery.data;
  const quotations = sqQuery.data ?? [];
  const linkedPO = (linkedPOsQuery.data ?? [])[0] ?? null;
  const rfqItems = rfq?.items ?? [];
  const rfqSuppliers = rfq?.suppliers ?? [];

  /* ── Approval state ── */
  const [approvalState, setApprovalState] = useState<RFQApprovalState | null>(null);

  useEffect(() => {
    if (decodedId) setApprovalState(getApprovalState(decodedId));
  }, [decodedId]);

  const approved = isApprovedForPO(approvalState);
  const selectedSupplier = approvalState?.selected_supplier ?? "";
  const selectedQuote = quotations.find(
    (q) => q.supplier === selectedSupplier || q.supplier_name === selectedSupplier
  );
  // Display the friendly supplier name (from quotation or approval state)
  const selectedSupplierDisplay =
    selectedQuote?.supplier_name ?? selectedSupplier;
  const approvedValue = approvalState?.selected_supplier_total ?? selectedQuote?.grand_total ?? 0;

  /* ── PO creation state ── */
  const [creatingPO, setCreatingPO] = useState(false);
  const [submittingPO, setSubmittingPO] = useState(false);
  const [createdPOName, setCreatedPOName] = useState<string | null>(linkedPO?.name ?? null);

  useEffect(() => {
    if (linkedPO?.name && !createdPOName) setCreatedPOName(linkedPO.name);
  }, [linkedPO, createdPOName]);

  const poName = linkedPO?.name ?? createdPOName;
  const poExists = !!poName;
  const poDocstatus = linkedPO?.docstatus;
  const poStatus = poStatusLabelFromDocstatus(poDocstatus);
  const poIsDraft = poDocstatus === 0;
  const poIsSubmitted = poDocstatus === 1;
  const poIsCancelled = poDocstatus === 2;
  const openPoButtonLabel = poIsSubmitted
    ? "Open Purchase Order"
    : poIsCancelled
    ? "View Cancelled PO"
    : poIsDraft
    ? "View Draft PO"
    : "View Purchase Order";

  useEffect(() => {
    if (poName) {
      // eslint-disable-next-line no-console
      console.log("PO Status", poStatus);
      // eslint-disable-next-line no-console
      console.log("PO DocStatus", poDocstatus);
    }
  }, [poName, poStatus, poDocstatus]);

  const grnsQuery = useQuery({
    queryKey: ["po-grns", poName],
    queryFn: () => getGRNsForPO(poName!),
    enabled: !!poName,
  });

  const invoicesQuery = useQuery({
    queryKey: ["po-invoices", poName],
    queryFn: () => getInvoicesForPO(poName!),
    enabled: !!poName,
  });

  const deliveryStateRaw = poName ? getDeliveryState(poName) : null;
  const submittedGRNs = (grnsQuery.data ?? []).filter((g) => g.docstatus === 1);
  const activeInvoices = (invoicesQuery.data ?? []).filter((inv) => inv.docstatus !== 2);
  const workflowInvoice =
    activeInvoices.find((inv) => inv.docstatus === 1) ?? activeInvoices[0];
  const hasSubmittedInvoice = activeInvoices.some((inv) => inv.docstatus === 1);
  const linkedPo = linkedPO;
  const deliveryState =
    poName && linkedPo && poIsSubmitted
      ? syncDeliveryStateFromERPNext(poName, {
          poSubmitted: poIsSubmitted,
          perReceived: submittedGRNs.length > 0 ? 100 : 0,
          perBilled: hasSubmittedInvoice ? 100 : 0,
          submittedGrnCount: submittedGRNs.length,
          hasSubmittedInvoice,
          invoiceOutstanding: workflowInvoice?.outstanding_amount,
          invoiceGrandTotal: workflowInvoice?.grand_total,
        }) ?? deliveryStateRaw
      : deliveryStateRaw;

  const procurementSteps = buildProcurementWorkflowSteps({
    poSubmitted: poIsSubmitted,
    poErpStatus: linkedPo?.status,
    perReceived: submittedGRNs.length > 0 ? 100 : 0,
    perBilled: hasSubmittedInvoice ? 100 : 0,
    deliveryState,
    submittedGrnCount: submittedGRNs.length,
    hasSubmittedInvoice,
    invoiceOutstanding: workflowInvoice?.outstanding_amount,
    invoiceGrandTotal: workflowInvoice?.grand_total,
    vouchers: poName
      ? getAllVouchers().filter((v) => v.po_reference === poName)
      : [],
  });

  /* ── Create Draft PO ── */
  const handleCreatePO = useCallback(async () => {
    if (!rfq || !approved || !selectedSupplier || poExists) return;
    setCreatingPO(true);

    try {
      const result = await createPurchaseOrderFromRFQ(decodedId);

      toast.success(`Draft Purchase Order ${result.poName} created!`);
      setCreatedPOName(result.poName);

      void queryClient.invalidateQueries({ queryKey: ["rfq-linked-pos", decodedId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error("[PO Conversion] Create PO error:", {
        rfq: rfq.name,
        supplier: selectedSupplier,
        error: msg,
        fullError: err,
      });
      if (msg.includes("already exists")) {
        void queryClient.invalidateQueries({ queryKey: ["rfq-linked-pos", decodedId] });
        toast.error("A Purchase Order already exists for this RFQ.");
      } else {
        toast.error(msg, { duration: 12_000 });
      }
    } finally {
      setCreatingPO(false);
    }
  }, [rfq, approved, selectedSupplier, poExists, decodedId, queryClient]);

  /* ── Submit PO ── */
  const handleSubmitPO = useCallback(async () => {
    if (!poName || poIsSubmitted) return;
    setSubmittingPO(true);
    try {
      const submitted = await submitPurchaseOrder(poName);
      toast.success(`${submitted.name} submitted successfully!`);
      markPOCreated(decodedId);
      setApprovalState(getApprovalState(decodedId));
      void queryClient.invalidateQueries({ queryKey: ["rfq-linked-pos", decodedId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error("[PO Conversion] Submit PO error:", {
        poName,
        error: msg,
        fullError: err,
      });
      toast.error(msg, { duration: 12_000 });
    } finally {
      setSubmittingPO(false);
    }
  }, [poName, poIsSubmitted, decodedId, queryClient]);

  /* ── Loading / error states ── */
  if (rfqQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-[500px] rounded-xl" />
      </div>
    );
  }

  if (rfqQuery.isError || !rfq) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="mb-4 h-12 w-12 text-danger-400" />
        <h2 className="text-lg font-bold text-neutral-900">RFQ Not Found</h2>
        <p className="mt-2 max-w-md text-center text-sm text-neutral-600">
          {rfqQuery.error instanceof Error ? rfqQuery.error.message : "Could not load RFQ data."}
        </p>
        <button
          type="button"
          onClick={() => navigate("/p2p/purchase-orders/create")}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to New PO
        </button>
      </div>
    );
  }

  if (!approved) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <ShieldCheck className="mb-4 h-12 w-12 text-warning-400" />
        <h2 className="text-lg font-bold text-neutral-900">Approval Required</h2>
        <p className="mt-2 max-w-md text-center text-sm text-neutral-600">
          This RFQ has not completed both Legal and Finance approvals. PO creation is not available.
        </p>
        <button
          type="button"
          onClick={() => navigate("/p2p/purchase-orders/create")}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to New PO
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── Back link + Header ── */}
      <button
        type="button"
        onClick={() => navigate("/p2p/purchase-orders/create")}
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition hover:text-primary cursor-pointer bg-transparent border-none p-0"
      >
        <ArrowLeft className="h-4 w-4" /> Back to New PO Queue
      </button>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100">
            <Package className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-900">
              Create Purchase Order
            </h1>
            <p className="text-sm text-neutral-500">from {decodedId}</p>
          </div>
        </div>
        {poExists && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${
            poIsSubmitted
              ? "bg-success-100 text-success-700 ring-success-200"
              : poIsCancelled
              ? "bg-danger-100 text-danger-700 ring-danger-200"
              : "bg-warning-100 text-warning-700 ring-warning-200"
          }`}>
            {poIsSubmitted ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : poIsCancelled ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
            PO Status: {poStatus}
          </span>
        )}
      </div>

      {/* ── Main layout: 2-column on lg ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: RFQ detail (2 cols) */}
        <div className="space-y-4 lg:col-span-2">
          {/* RFQ Summary */}
          <Section icon={FileText} title="RFQ Summary">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoField label="RFQ Number" value={rfq.name} />
              <InfoField label="Company" value={rfq.company ?? "—"} />
              <InfoField label="Transaction Date" value={formatDate(rfq.transaction_date)} />
              <InfoField label="Status" value={rfq.status ?? "Draft"} />
              <InfoField label="Created By" value={rfq.owner} />
              <InfoField label="Valid Till" value={rfq.valid_till ? formatDate(rfq.valid_till) : "—"} />
            </div>
          </Section>

          {/* Items Requested */}
          <Section icon={Layers} title={`Items Requested (${rfqItems.length})`}>
            {rfqItems.length === 0 ? (
              <p className="text-sm text-neutral-500">No items found.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50/50">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">Item Code</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">Item Name</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Qty</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-500">UOM</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Rate</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfqItems.map((item, idx) => {
                      const sqItem = selectedQuote?.items?.find(
                        (si) => si.item_code === item.item_code
                      );
                      const rate = sqItem?.rate ?? 0;
                      return (
                        <tr key={idx} className="border-b border-neutral-50 last:border-0">
                          <td className="px-3 py-2 font-medium text-neutral-900">{item.item_code}</td>
                          <td className="px-3 py-2 text-neutral-600">
                            {item.item_name && item.item_name !== item.item_code ? item.item_name : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{item.qty}</td>
                          <td className="px-3 py-2 text-neutral-600">{item.uom ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{rate > 0 ? formatCurrency(rate) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {rate > 0 ? formatCurrency(rate * item.qty) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-neutral-50">
                      <td colSpan={5} className="px-3 py-2.5 text-right text-sm font-semibold text-neutral-700">
                        Total
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums text-neutral-900">
                        {formatCurrency(approvedValue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Section>

          {/* Suppliers Invited */}
          <Section icon={Building2} title={`Suppliers Invited (${rfqSuppliers.length})`}>
            <div className="space-y-2">
              {rfqSuppliers.map((s, idx) => {
                const isSelected = s.supplier === selectedSupplier || s.supplier_name === selectedSupplier;
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                      isSelected
                        ? "border-success-200 bg-success-50"
                        : "border-neutral-200 bg-white"
                    }`}
                  >
                    <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isSelected ? "bg-success-200 text-success-800" : "bg-neutral-100 text-neutral-600"
                    }`}>
                      {(s.supplier_name?.[0] ?? s.supplier?.[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-neutral-900">
                        {s.supplier_name ?? s.supplier}
                      </p>
                      <p className="text-xs text-neutral-500">{s.supplier}</p>
                    </div>
                    {isSelected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-[10px] font-bold text-success-700">
                        <CheckCircle2 className="h-3 w-3" /> Selected
                      </span>
                    )}
                  </div>
                );
              })}
              {rfqSuppliers.length === 0 && (
                <p className="text-sm text-neutral-500">No suppliers invited.</p>
              )}
            </div>
          </Section>

          {/* Linked PO (if created) */}
          {poName && (
            <Section icon={FileText} title="Linked Purchase Order">
              <div className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${
                poIsSubmitted
                  ? "border-success-200 bg-success-50"
                  : poIsCancelled
                  ? "border-danger-200 bg-danger-50"
                  : "border-primary-200 bg-primary-50"
              }`}>
                <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                  poIsSubmitted
                    ? "bg-success-100"
                    : poIsCancelled
                    ? "bg-danger-100"
                    : "bg-primary-100"
                }`}>
                  <FileText className={`h-5 w-5 ${
                    poIsSubmitted
                      ? "text-success-600"
                      : poIsCancelled
                      ? "text-danger-600"
                      : "text-primary-600"
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${
                    poIsSubmitted
                      ? "text-success-900"
                      : poIsCancelled
                      ? "text-danger-900"
                      : "text-primary-900"
                  }`}>{poName}</p>
                  <p className={`text-xs ${
                    poIsSubmitted
                      ? "text-success-700"
                      : poIsCancelled
                      ? "text-danger-700"
                      : "text-primary-700"
                  }`}>
                    {poStatus} &middot; {selectedSupplierDisplay}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/p2p/purchase-orders/${encodeURIComponent(poName)}`)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${
                    poIsSubmitted
                      ? "bg-success-600 hover:bg-success-700"
                      : "bg-primary hover:bg-primary-700"
                  }`}
                >
                  {poIsSubmitted ? "Open Purchase Order" : openPoButtonLabel}{" "}
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </Section>
          )}
        </div>

        {/* Right: Action panel (1 col) */}
        <div className="space-y-4">
          {/* Purchase Order Actions */}
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-5 py-4">
              <h3 className="text-sm font-bold text-neutral-900">Purchase Order Actions</h3>
            </div>
            <div className="space-y-4 px-5 py-4">
              {/* Status rows */}
              <StatusRow
                icon={Gavel}
                label="Legal Status"
                value={approvalState?.legal_status ?? "—"}
                approved={approvalState?.legal_status === "Approved"}
              />
              <StatusRow
                icon={Wallet}
                label="Finance Status"
                value={approvalState?.finance_status === "Budget Approved" ? "Approved" : (approvalState?.finance_status ?? "—")}
                approved={approvalState?.finance_status === "Budget Approved"}
              />
              <StatusRow
                icon={Building2}
                label="Supplier"
                value={selectedSupplierDisplay || "Not selected"}
                approved={!!selectedSupplier}
              />
              <StatusRow
                icon={DollarSign}
                label="Approved Value"
                value={formatCurrency(approvedValue)}
                approved={approvedValue > 0}
              />

              <div className="border-t border-neutral-100 pt-4">
                {!poExists ? (
                  <button
                    type="button"
                    onClick={handleCreatePO}
                    disabled={creatingPO || !selectedSupplier}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-success-600 px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-success-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingPO ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Package className="h-4 w-4" />
                    )}
                    Create Purchase Order
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 ${
                      poIsSubmitted
                        ? "border-success-200 bg-success-50"
                        : poIsCancelled
                        ? "border-danger-200 bg-danger-50"
                        : "border-warning-200 bg-warning-50"
                    }`}>
                      {poIsSubmitted ? (
                        <CheckCircle2 className="h-5 w-5 text-success-600" />
                      ) : poIsCancelled ? (
                        <AlertTriangle className="h-5 w-5 text-danger-600" />
                      ) : (
                        <Clock className="h-5 w-5 text-warning-600" />
                      )}
                      <div>
                        <p className={`text-sm font-bold ${
                          poIsSubmitted
                            ? "text-success-800"
                            : poIsCancelled
                            ? "text-danger-800"
                            : "text-warning-800"
                        }`}>
                          PO Status: {poStatus}
                        </p>
                        <p className="text-xs text-neutral-600">{poName}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => navigate(`/p2p/purchase-orders/${encodeURIComponent(poName!)}`)}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition ${
                        poIsSubmitted
                          ? "bg-success-600 text-white hover:bg-success-700"
                          : "border border-primary bg-white text-primary hover:bg-primary-50"
                      }`}
                    >
                      <ExternalLink className="h-4 w-4" />
                      {openPoButtonLabel}
                    </button>

                    {poIsDraft && (
                      <button
                        type="button"
                        onClick={handleSubmitPO}
                        disabled={submittingPO}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {submittingPO ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Submit PO
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* PO Status */}
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-5 py-4">
              <h3 className="text-sm font-bold text-neutral-900">PO Status</h3>
            </div>
            <POStatusTimeline steps={procurementSteps} compact />
          </div>

          {/* Approval Audit */}
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-5 py-4">
              <h3 className="text-sm font-bold text-neutral-900">Approval Audit</h3>
            </div>
            <div className="space-y-3 px-5 py-4">
              <AuditRow
                label="Submitted for Review"
                by={approvalState?.submitted_by}
                date={approvalState?.submitted_at}
              />
              <AuditRow
                label="Legal Approved"
                by={approvalState?.legal_reviewer}
                date={approvalState?.legal_review_date}
              />
              <AuditRow
                label="Finance Approved"
                by={approvalState?.finance_reviewer}
                date={approvalState?.finance_review_date}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function Section({
  icon: Icon, title, children,
}: {
  icon: typeof FileText; title: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-neutral-100 px-5 py-3.5">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100">
          <Icon className="h-3.5 w-3.5 text-neutral-600" />
        </div>
        <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-neutral-900">{value || "—"}</p>
    </div>
  );
}

function StatusRow({
  icon: Icon, label, value, approved,
}: {
  icon: typeof Gavel; label: string; value: string; approved: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
        approved ? "bg-success-100" : "bg-neutral-100"
      }`}>
        <Icon className={`h-4 w-4 ${approved ? "text-success-600" : "text-neutral-400"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-neutral-500">{label}</p>
        <p className={`text-sm font-semibold ${approved ? "text-success-700" : "text-neutral-900"}`}>
          {value}
        </p>
      </div>
      {approved && <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success-500" />}
    </div>
  );
}

function AuditRow({
  label, by, date,
}: {
  label: string; by?: string; date?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-neutral-100">
        <CheckCircle2 className="h-3 w-3 text-neutral-400" />
      </div>
      <div>
        <p className="text-xs font-semibold text-neutral-700">{label}</p>
        <p className="text-[11px] text-neutral-500">
          {by ? `${by}` : "—"}{date ? ` · ${formatDate(date)}` : ""}
        </p>
      </div>
    </div>
  );
}
