/**
 * Enterprise RFQ Quote Rounds — client API.
 */
import { bidsphereApiFetch } from "../utils/bidsphereApiFetch";
import type { RFQ } from "../types/erpnext";

export const RFQ_ROUND_REASON_CODES = [
  "Engineering Change",
  "New Parts Added",
  "Parts Removed",
  "Quantity Changed",
  "Drawing Revision",
  "Specification Changed",
  "Commercial Revision",
  "New Supplier Added",
  "Supplier Removed",
  "Price Negotiation",
  "Delivery Schedule Changed",
  "Other",
] as const;

export type RfqRoundReasonCode = (typeof RFQ_ROUND_REASON_CODES)[number];

export type RfqRoundStatus = "Draft" | "Active" | "Closed" | "Cancelled";

export interface RfqRoundItemRow {
  name?: string;
  item_code: string;
  item_name?: string;
  description?: string;
  qty: number;
  uom?: string;
  schedule_date?: string;
  warehouse?: string;
  custom_part_name?: string;
  custom_2d_drawing?: string;
  custom_engineering_attachments?: string;
  custom_target_price?: number | null;
  custom_procurement_final_qty?: number | null;
  custom_qty_change_reason?: string | null;
  source_rfq_item?: string;
}

export interface RfqRoundSupplierRow {
  name?: string;
  supplier: string;
  supplier_name?: string;
  email_id?: string;
  contact?: string;
  send_email?: 0 | 1;
  quote_status?: "Pending" | "Received" | "No Quote";
  source_rfq_supplier?: string;
}

export interface RfqRoundChangeLogRow {
  change_type?: string;
  reason_code?: string;
  remarks?: string;
  changed_by?: string;
  changed_on?: string;
}

export interface RfqQuoteRound {
  name: string;
  rfq: string;
  round_number: number;
  tracking_id: string;
  previous_round?: string;
  reason_code: string;
  remarks: string;
  status: RfqRoundStatus;
  created_by_user?: string;
  creation?: string;
  modified?: string;
  message_for_supplier?: string;
  terms?: string;
  valid_till?: string;
  items?: RfqRoundItemRow[];
  suppliers?: RfqRoundSupplierRow[];
  change_log?: RfqRoundChangeLogRow[];
}

export interface RfqWithRounds extends RFQ {
  custom_active_rfq_round?: string;
  custom_current_round_number?: number;
}

export class RfqQuoteRoundApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "RfqQuoteRoundApiError";
    this.status = status;
    this.code = code;
  }
}

export interface CreateNextRfqQuoteRoundResult {
  round: RfqQuoteRound;
  previousRound?: RfqQuoteRound;
  invited?: Array<{ supplier: string; supplier_name?: string }>;
  inviteWarning?: string;
  emailWarning?: string;
}

async function parseApiJson<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    code?: string;
  } & T;
  if (!res.ok || json.success === false) {
    throw new RfqQuoteRoundApiError(
      json.message || `Request failed (${res.status})`,
      res.status,
      json.code,
    );
  }
  return json;
}

export async function listRfqQuoteRounds(
  rfqName: string,
): Promise<RfqQuoteRound[]> {
  const res = await bidsphereApiFetch(
    `/api/rfq-quote-round?rfq=${encodeURIComponent(rfqName)}`,
  );
  const json = await parseApiJson<{ rounds: RfqQuoteRound[] }>(res);
  return json.rounds ?? [];
}

export async function getActiveRfqQuoteRound(
  rfqName: string,
): Promise<RfqQuoteRound | null> {
  const res = await bidsphereApiFetch(
    `/api/rfq-quote-round?action=active&rfq=${encodeURIComponent(rfqName)}`,
  );
  const json = await parseApiJson<{ round: RfqQuoteRound | null }>(res);
  return json.round ?? null;
}

export async function ensureInitialRfqQuoteRound(
  rfqName: string,
  createdBy?: string,
): Promise<{ round: RfqQuoteRound; created: boolean }> {
  const res = await bidsphereApiFetch("/api/rfq-quote-round?action=ensure-initial", {
    method: "POST",
    json: { rfq_name: rfqName, created_by: createdBy },
  });
  return parseApiJson(res);
}

export async function createNextRfqQuoteRound(input: {
  rfqName: string;
  reasonCode: RfqRoundReasonCode;
  remarks: string;
  createdBy: string;
  /** Suppliers associated with this round document snapshot. */
  associateSuppliers?: Array<{
    supplier: string;
    supplier_name?: string;
  }>;
  /** Suppliers to invite on the RFQ after the round is created. */
  inviteSuppliers?: Array<{
    supplier: string;
    supplier_name?: string;
  }>;
}): Promise<CreateNextRfqQuoteRoundResult> {
  const res = await bidsphereApiFetch("/api/rfq-quote-round?action=create-next", {
    method: "POST",
    json: {
      rfq_name: input.rfqName,
      reason_code: input.reasonCode,
      remarks: input.remarks,
      created_by: input.createdBy,
      associate_suppliers: input.associateSuppliers,
      invite_suppliers: input.inviteSuppliers ?? input.associateSuppliers,
    },
  });
  const json = await parseApiJson<CreateNextRfqQuoteRoundResult>(res);
  return {
    round: json.round,
    previousRound: json.previousRound,
    invited: json.invited,
    inviteWarning: json.inviteWarning,
    emailWarning: json.emailWarning,
  };
}

export async function activateRfqQuoteRound(
  roundName: string,
  createdBy?: string,
): Promise<RfqQuoteRound> {
  const res = await bidsphereApiFetch("/api/rfq-quote-round?action=activate", {
    method: "POST",
    json: { round_name: roundName, created_by: createdBy },
  });
  const json = await parseApiJson<{ round: RfqQuoteRound }>(res);
  return json.round;
}

export function isRfqRoundReadOnly(round: RfqQuoteRound, activeRound?: RfqQuoteRound | null): boolean {
  if (!activeRound) return round.status === "Closed";
  return round.name !== activeRound.name || round.status === "Closed";
}

export function canCreateRfqQuoteRound(opts: {
  hasSelectedSupplier: boolean;
  procurementFinalized: boolean;
  rfqCancelled?: boolean;
}): boolean {
  if (opts.hasSelectedSupplier || opts.procurementFinalized) return false;
  if (opts.rfqCancelled) return false;
  return true;
}
