import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  CreditCard,
  FileSearch,
  FileText,
  PackageCheck,
  Receipt,
  Truck,
  UserCheck,
  Wallet,
} from "lucide-react";

import type { PODeliveryState } from "../api/poDeliveryWorkflow";

export type ProcurementStepState = "completed" | "current" | "pending";

export interface ProcurementWorkflowStep {
  id: string;
  label: string;
  icon: LucideIcon;
  state: ProcurementStepState;
}

export interface ProcurementWorkflowInput {
  /** PO submitted to ERPNext (docstatus 1). */
  poSubmitted: boolean;
  deliveryState: PODeliveryState | null;
  hasSubmittedGRN: boolean;
  hasSubmittedInvoice: boolean;
  invoiceOutstanding?: number;
  invoiceGrandTotal?: number;
  paymentCompleted: boolean;
}

const STEP_DEFS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "rfq_approved", label: "RFQ Approved", icon: FileSearch },
  { id: "po_created", label: "Purchase Order Created", icon: FileText },
  { id: "supplier_confirmed", label: "Supplier Confirmed", icon: UserCheck },
  { id: "in_transit", label: "In Transit", icon: Truck },
  { id: "grn_received", label: "GRN Received", icon: PackageCheck },
  { id: "invoice_generated", label: "Invoice Generated", icon: Receipt },
  { id: "supplier_payment_confirmed", label: "Supplier Payment Confirmed", icon: CreditCard },
  { id: "payment_completed", label: "Payment Completed", icon: Wallet },
];

function isSupplierConfirmed(deliveryState: PODeliveryState | null): boolean {
  if (!deliveryState) return false;
  if (deliveryState.supplier_accepted) return true;
  return ["Accepted", "In Transit", "Partially Received", "Completed"].includes(
    deliveryState.status
  );
}

function isInTransitComplete(deliveryState: PODeliveryState | null, hasSubmittedGRN: boolean): boolean {
  if (hasSubmittedGRN) return true;
  if (!deliveryState) return false;
  return ["Partially Received", "Completed"].includes(deliveryState.status);
}

function isSupplierPaymentConfirmed(input: ProcurementWorkflowInput): boolean {
  if (input.paymentCompleted) return true;
  if (!input.hasSubmittedInvoice) return false;
  const outstanding = input.invoiceOutstanding ?? 0;
  const grand = input.invoiceGrandTotal ?? 0;
  return grand > 0 && outstanding < grand;
}

/** Derive completion flags for each procurement milestone (in order). */
export function getProcurementStepCompletions(input: ProcurementWorkflowInput): boolean[] {
  const supplierConfirmed = isSupplierConfirmed(input.deliveryState);
  const inTransitComplete = isInTransitComplete(input.deliveryState, input.hasSubmittedGRN);

  return [
    true, // RFQ Approved — PO page implies RFQ cleared
    input.poSubmitted,
    supplierConfirmed,
    inTransitComplete,
    input.hasSubmittedGRN,
    input.hasSubmittedInvoice,
    isSupplierPaymentConfirmed(input),
    input.paymentCompleted,
  ];
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

/** Build the 8-step procurement workflow for display. */
export function buildProcurementWorkflowSteps(
  input: ProcurementWorkflowInput
): ProcurementWorkflowStep[] {
  const completions = getProcurementStepCompletions(input);
  const states = resolveProcurementStepStates(completions);

  return STEP_DEFS.map((def, i) => ({
    ...def,
    state: states[i] ?? "pending",
  }));
}
