import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  FileText,
  PackageCheck,
  Receipt,
  Truck,
  UserCheck,
  Wallet,
} from "lucide-react";

import type { PODeliveryState, PODeliveryStatus } from "../api/poDeliveryWorkflow";
import { getAllVouchers } from "../api/vouchers";
import type { Voucher } from "../types/voucher";

export type ProcurementStepState = "completed" | "current" | "pending";

export interface ProcurementWorkflowStep {
  id: string;
  label: string;
  icon: LucideIcon;
  state: ProcurementStepState;
}

export interface POWorkflowDocuments {
  /** PO submitted to ERPNext (docstatus 1). */
  poSubmitted: boolean;
  /** ERPNext PO.status (e.g. "To Receive and Bill"). */
  poErpStatus?: string;
  perReceived: number;
  perBilled: number;
  deliveryState: PODeliveryState | null;
  submittedGrnCount: number;
  hasSubmittedInvoice: boolean;
  invoiceOutstanding?: number;
  invoiceGrandTotal?: number;
  vouchers?: Voucher[];
}

export interface POWorkflowSnapshot {
  /** Unified status for header badge, delivery panel, and summary. */
  displayStatus: string;
  /** Effective delivery milestone after ERPNext reconciliation. */
  deliveryStatus: PODeliveryStatus | "Draft" | "Rejected";
  receivedPct: number;
  billedPct: number;
  poCreated: boolean;
  supplierAccepted: boolean;
  inTransitComplete: boolean;
  grnComplete: boolean;
  invoiceComplete: boolean;
  paymentConfirmed: boolean;
  workflowComplete: boolean;
  stepCompletions: boolean[];
}

/** @deprecated Use POWorkflowDocuments */
export type ProcurementWorkflowInput = POWorkflowDocuments & {
  hasSubmittedGRN?: boolean;
  paymentCompleted?: boolean;
};

const PO_STEP_DEFS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "po_created", label: "PO Created", icon: FileText },
  { id: "supplier_accepted", label: "Supplier Accepted", icon: UserCheck },
  { id: "in_transit", label: "In Transit", icon: Truck },
  { id: "grn_received", label: "GRN Received", icon: PackageCheck },
  { id: "invoice_generated", label: "Invoice Generated", icon: Receipt },
  {
    id: "supplier_payment_confirmed",
    label: "Supplier Payment Confirmed",
    icon: Wallet,
  },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
];

const RFQ_STEP = {
  id: "rfq_approved",
  label: "RFQ Approved",
  icon: FileText,
} as const;

function vouchersForPO(poName: string, vouchers?: Voucher[]): Voucher[] {
  if (!poName) return vouchers ?? [];
  const list = vouchers ?? getAllVouchers();
  return list.filter((v) => v.po_reference === poName);
}

function isSupplierAccepted(deliveryState: PODeliveryState | null): boolean {
  if (!deliveryState) return false;
  if (deliveryState.supplier_accepted) return true;
  return ["Accepted", "In Transit", "Partially Received", "Completed"].includes(
    deliveryState.status
  );
}

function hasSubmittedVoucherInvoice(vouchers: Voucher[]): boolean {
  return vouchers.some(
    (v) =>
      !!v.invoice &&
      (v.invoice.status === "submitted" ||
        v.invoice.status === "approved" ||
        v.invoice.status === "paid" ||
        [
          "invoice_raised",
          "under_review",
          "invoice_approved",
          "payment_confirmed",
          "payment_received",
        ].includes(v.status))
  );
}

function hasBillableDocument(
  docs: POWorkflowDocuments,
  vouchers: Voucher[]
): boolean {
  return docs.hasSubmittedInvoice || hasSubmittedVoucherInvoice(vouchers);
}

function isPaymentSubmitted(
  docs: POWorkflowDocuments,
  vouchers: Voucher[]
): boolean {
  if (
    vouchers.some(
      (v) =>
        !!v.payment ||
        v.status === "payment_confirmed" ||
        v.status === "payment_received"
    )
  ) {
    return true;
  }
  if (!hasBillableDocument(docs, vouchers)) return false;
  const outstanding = docs.invoiceOutstanding ?? 0;
  const grand = docs.invoiceGrandTotal ?? 0;
  return grand > 0 && outstanding < grand;
}

function isPaymentFullyComplete(
  docs: POWorkflowDocuments,
  vouchers: Voucher[]
): boolean {
  if (vouchers.some((v) => v.status === "payment_received")) return true;
  if (
    vouchers.some(
      (v) =>
        v.invoice?.status === "paid" ||
        v.status === "payment_confirmed" ||
        v.status === "payment_received"
    )
  ) {
    return true;
  }
  if (!hasBillableDocument(docs, vouchers)) return false;
  const outstanding = docs.invoiceOutstanding ?? 0;
  const grand = docs.invoiceGrandTotal ?? 0;
  return grand > 0 && outstanding === 0;
}

/** Steps must complete in order — a later step cannot be done before an earlier one. */
function enforceSequentialSteps(completions: boolean[]): boolean[] {
  const result = [...completions];
  for (let i = 1; i < result.length; i++) {
    if (result[i] && !result[i - 1]) {
      result[i] = false;
    }
  }
  return result;
}

/**
 * Reconcile local delivery status with ERPNext PO progress so the UI never
 * shows "In Transit" while GRN, invoice, and 100% receive/bill are already done.
 */
export function reconcileDeliveryStatus(
  deliveryState: PODeliveryState | null,
  docs: Omit<
    POWorkflowDocuments,
    "deliveryState" | "vouchers" | "poErpStatus"
  > & { hasSubmittedInvoice: boolean }
): PODeliveryStatus | "Draft" | "Rejected" {
  if (!docs.poSubmitted) return "Draft";
  if (deliveryState?.status === "Rejected") return "Rejected";
  if (!deliveryState) return "Pending Acceptance";

  const receivedPct = docs.perReceived;
  const billedPct = docs.perBilled;
  const hasGrn = docs.submittedGrnCount > 0;
  const hasInvoice = docs.hasSubmittedInvoice;
  const fullyReceived = receivedPct >= 100;
  const fullyBilled = billedPct >= 100;
  const paymentDone =
    hasInvoice &&
    (docs.invoiceGrandTotal ?? 0) > 0 &&
    (docs.invoiceOutstanding ?? 1) === 0;

  if (hasGrn && hasInvoice && fullyReceived && fullyBilled && paymentDone) {
    return "Completed";
  }

  // Any submitted GRN means goods arrived — advance past "In Transit".
  if (hasGrn && deliveryState.status === "In Transit") {
    return "Partially Received";
  }

  if (hasGrn && (receivedPct > 0 || fullyReceived)) {
    return "Partially Received";
  }

  return deliveryState.status;
}

/** Derive all workflow flags and the unified display status from one input. */
export function derivePOWorkflowSnapshot(
  poName: string,
  docs: POWorkflowDocuments
): POWorkflowSnapshot {
  const vouchers = docs.vouchers ?? vouchersForPO(poName);
  const submittedGrnCount = docs.submittedGrnCount;
  const hasSubmittedGRN = submittedGrnCount > 0;
  const billableDocument = hasBillableDocument(docs, vouchers);
  const receivedPct = docs.poSubmitted ? docs.perReceived : 0;
  const billedPct = docs.poSubmitted ? docs.perBilled : 0;
  const fullyReceived = receivedPct >= 100;

  const paymentSubmitted = isPaymentSubmitted(docs, vouchers);
  const paymentFullyComplete = isPaymentFullyComplete(docs, vouchers);

  const deliveryStatus = reconcileDeliveryStatus(docs.deliveryState, {
    poSubmitted: docs.poSubmitted,
    perReceived: receivedPct,
    perBilled: billedPct,
    submittedGrnCount,
    hasSubmittedInvoice: billableDocument,
    invoiceOutstanding: docs.invoiceOutstanding,
    invoiceGrandTotal: docs.invoiceGrandTotal,
  });

  const poCreated = docs.poSubmitted;
  const supplierAccepted =
    poCreated && isSupplierAccepted(docs.deliveryState);

  // Complete only after the shipment has moved past the In Transit milestone.
  const inTransitComplete =
    supplierAccepted &&
    (deliveryStatus === "Partially Received" || deliveryStatus === "Completed");

  const grnComplete = supplierAccepted && hasSubmittedGRN;
  const invoiceComplete = grnComplete && billableDocument;
  const paymentStepComplete = invoiceComplete && paymentSubmitted;
  const workflowComplete =
    fullyReceived && invoiceComplete && paymentFullyComplete && grnComplete;

  const displayStatus = resolveDisplayStatus({
    poSubmitted: docs.poSubmitted,
    poErpStatus: docs.poErpStatus,
    deliveryStatus,
    supplierAccepted,
    grnComplete,
    invoiceComplete,
    paymentFullyComplete,
    paymentSubmitted,
    workflowComplete,
    receivedPct,
    billedPct,
  });

  const stepCompletions = enforceSequentialSteps([
    poCreated,
    supplierAccepted,
    inTransitComplete,
    grnComplete,
    invoiceComplete,
    paymentStepComplete,
    workflowComplete,
  ]);

  return {
    displayStatus,
    deliveryStatus,
    receivedPct,
    billedPct,
    poCreated,
    supplierAccepted,
    inTransitComplete: stepCompletions[2] ?? false,
    grnComplete: stepCompletions[3] ?? false,
    invoiceComplete: stepCompletions[4] ?? false,
    paymentConfirmed: stepCompletions[5] ?? false,
    workflowComplete: stepCompletions[6] ?? false,
    stepCompletions,
  };
}

function resolveDisplayStatus(ctx: {
  poSubmitted: boolean;
  poErpStatus?: string;
  deliveryStatus: PODeliveryStatus | "Draft" | "Rejected";
  supplierAccepted: boolean;
  grnComplete: boolean;
  invoiceComplete: boolean;
  paymentFullyComplete: boolean;
  paymentSubmitted: boolean;
  workflowComplete: boolean;
  receivedPct: number;
  billedPct: number;
}): string {
  if (!ctx.poSubmitted) {
    return ctx.poErpStatus ?? "Draft";
  }
  if (ctx.deliveryStatus === "Rejected") return "Rejected";
  if (ctx.workflowComplete) return "Completed";
  if (ctx.paymentFullyComplete) return "Paid";
  if (ctx.invoiceComplete && ctx.paymentSubmitted) return "Payment Submitted";
  if (ctx.invoiceComplete) {
    if (ctx.poErpStatus && /pay|bill/i.test(ctx.poErpStatus)) {
      return ctx.poErpStatus;
    }
    return ctx.billedPct >= 100 ? "To Pay" : "To Bill";
  }
  if (ctx.grnComplete || ctx.receivedPct > 0) {
    if (ctx.receivedPct >= 100) return "To Bill";
    return "Partially Received";
  }

  // Rule 9 — never show In Transit when downstream milestones are already done.
  if (
    ctx.deliveryStatus === "In Transit" &&
    (ctx.grnComplete ||
      ctx.invoiceComplete ||
      ctx.receivedPct >= 100 ||
      ctx.billedPct >= 100)
  ) {
    if (ctx.invoiceComplete && ctx.billedPct >= 100) return "To Pay";
    if (ctx.grnComplete || ctx.receivedPct > 0) return "Partially Received";
  }

  if (ctx.deliveryStatus === "In Transit") return "In Transit";
  if (ctx.deliveryStatus === "Partially Received") return "Partially Received";
  if (ctx.deliveryStatus === "Completed") return "Completed";
  if (ctx.supplierAccepted && ctx.deliveryStatus === "Accepted") {
    return "Accepted";
  }
  if (!ctx.supplierAccepted) return "Pending Acceptance";
  return ctx.poErpStatus ?? String(ctx.deliveryStatus);
}

/** Map completion flags to completed / current / pending visual states. */
export function resolveProcurementStepStates(
  completions: boolean[]
): ProcurementStepState[] {
  let currentAssigned = false;
  return completions.map((done) => {
    if (done) return "completed";
    if (!currentAssigned) {
      currentAssigned = true;
      return "current";
    }
    return "pending";
  });
}

/** Build PO lifecycle workflow steps (7 steps, dynamically derived). */
export function buildPOWorkflowSteps(
  poName: string,
  docs: POWorkflowDocuments
): ProcurementWorkflowStep[] {
  const snapshot = derivePOWorkflowSnapshot(poName, docs);
  const states = resolveProcurementStepStates(snapshot.stepCompletions);

  return PO_STEP_DEFS.map((def, i) => ({
    ...def,
    state: states[i] ?? "pending",
  }));
}

/** RFQ → PO conversion view prepends the RFQ Approved milestone. */
export function buildProcurementWorkflowSteps(
  input: ProcurementWorkflowInput
): ProcurementWorkflowStep[] {
  const docs: POWorkflowDocuments = {
    poSubmitted: input.poSubmitted,
    poErpStatus: input.poErpStatus,
    perReceived: input.perReceived ?? 0,
    perBilled: input.perBilled ?? 0,
    deliveryState: input.deliveryState,
    submittedGrnCount:
      input.submittedGrnCount ?? (input.hasSubmittedGRN ? 1 : 0),
    hasSubmittedInvoice: input.hasSubmittedInvoice,
    invoiceOutstanding: input.invoiceOutstanding,
    invoiceGrandTotal: input.invoiceGrandTotal,
    vouchers: input.vouchers,
  };

  const snapshot = derivePOWorkflowSnapshot("", docs);
  const poStates = resolveProcurementStepStates(snapshot.stepCompletions);
  const rfqDone = input.poSubmitted;

  return [
    {
      ...RFQ_STEP,
      state: rfqDone ? "completed" : "current",
    },
    ...PO_STEP_DEFS.map((def, i) => ({
      ...def,
      state: rfqDone
        ? (poStates[i] ?? "pending")
        : ("pending" as ProcurementStepState),
    })),
  ];
}

/** @deprecated Use derivePOWorkflowSnapshot */
export function getProcurementStepCompletions(
  input: ProcurementWorkflowInput
): boolean[] {
  const docs: POWorkflowDocuments = {
    poSubmitted: input.poSubmitted,
    perReceived: input.perReceived ?? 0,
    perBilled: input.perBilled ?? 0,
    deliveryState: input.deliveryState,
    submittedGrnCount:
      input.submittedGrnCount ?? (input.hasSubmittedGRN ? 1 : 0),
    hasSubmittedInvoice: input.hasSubmittedInvoice,
    invoiceOutstanding: input.invoiceOutstanding,
    invoiceGrandTotal: input.invoiceGrandTotal,
    vouchers: input.vouchers,
  };
  return derivePOWorkflowSnapshot("", docs).stepCompletions;
}
