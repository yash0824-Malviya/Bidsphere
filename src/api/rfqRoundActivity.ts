/**
 * Local + ERP activity trail for RFQ Quote Round lifecycle events.
 */

import { apiPost, withSilent } from "./erpnext";

export type RfqRoundActivityType =
  | "round_created"
  | "suppliers_invited"
  | "invitation_email";

export interface RfqRoundActivityEntry {
  id: string;
  type: RfqRoundActivityType;
  rfq_name: string;
  round_name?: string;
  round_number: number;
  reason_code?: string;
  message: string;
  detail?: string;
  supplier_count?: number;
  suppliers?: Array<{ supplier: string; supplier_name: string }>;
  email_status?: "sent" | "pending_submit" | "skipped" | "failed";
  user: string;
  timestamp: string;
}

export interface RfqRoundMeta {
  newly_added_suppliers: number;
  suppliers: Array<{ supplier: string; supplier_name: string }>;
}

const ACTIVITY_KEY = (rfqName: string) => `rfq_round_activity_${rfqName}`;
const META_KEY = (rfqName: string) => `rfq_round_meta_${rfqName}`;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function readRfqRoundActivity(rfqName: string): RfqRoundActivityEntry[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY(rfqName));
    const list = raw ? (JSON.parse(raw) as RfqRoundActivityEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function appendRfqRoundActivity(
  entry: Omit<RfqRoundActivityEntry, "id" | "timestamp"> & {
    timestamp?: string;
  },
): RfqRoundActivityEntry {
  const full: RfqRoundActivityEntry = {
    ...entry,
    id: newId(),
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };
  const next = [full, ...readRfqRoundActivity(entry.rfq_name)].slice(0, 200);
  try {
    localStorage.setItem(ACTIVITY_KEY(entry.rfq_name), JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return full;
}

export function readRfqRoundMetaMap(
  rfqName: string,
): Record<string, RfqRoundMeta> {
  try {
    const raw = localStorage.getItem(META_KEY(rfqName));
    const map = raw ? (JSON.parse(raw) as Record<string, RfqRoundMeta>) : {};
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

export function getRfqRoundMeta(
  rfqName: string,
  roundName: string,
): RfqRoundMeta | null {
  return readRfqRoundMetaMap(rfqName)[roundName] ?? null;
}

export function setRfqRoundNewlyAddedSuppliers(
  rfqName: string,
  roundName: string,
  suppliers: Array<{ supplier: string; supplier_name: string }>,
): void {
  const map = readRfqRoundMetaMap(rfqName);
  map[roundName] = {
    newly_added_suppliers: suppliers.length,
    suppliers,
  };
  try {
    localStorage.setItem(META_KEY(rfqName), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export async function logRfqRoundActivityToErp(input: {
  rfqName: string;
  subject: string;
  content: string;
}): Promise<void> {
  try {
    await apiPost(
      "/api/method/frappe.client.insert",
      {
        doc: {
          doctype: "Activity Log",
          subject: input.subject,
          content: input.content,
          operation: "Update",
          status: "Success",
          reference_doctype: "Request for Quotation",
          reference_name: input.rfqName,
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[RFQ Round] Activity Log skipped:", err);
    }
  }

  try {
    await apiPost(
      "/api/method/frappe.client.save",
      {
        doc: {
          doctype: "Comment",
          comment_type: "Comment",
          reference_doctype: "Request for Quotation",
          reference_name: input.rfqName,
          content: `${input.subject} — ${input.content}`,
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[RFQ Round] Comment audit skipped:", err);
    }
  }
}

export function recordQuoteRoundCreated(input: {
  rfqName: string;
  roundName: string;
  roundNumber: number;
  reasonCode: string;
  remarks: string;
  user: string;
}): RfqRoundActivityEntry {
  const entry = appendRfqRoundActivity({
    type: "round_created",
    rfq_name: input.rfqName,
    round_name: input.roundName,
    round_number: input.roundNumber,
    reason_code: input.reasonCode,
    message: `Quote Round R${String(input.roundNumber).padStart(2, "0")} created`,
    detail: `${input.reasonCode}${input.remarks ? ` — ${input.remarks}` : ""}`,
    user: input.user,
  });
  void logRfqRoundActivityToErp({
    rfqName: input.rfqName,
    subject: "Quote Round Created",
    content: [
      `Round: R${String(input.roundNumber).padStart(2, "0")}`,
      `Round Doc: ${input.roundName}`,
      `Reason: ${input.reasonCode}`,
      `Remarks: ${input.remarks}`,
      `Created By: ${input.user}`,
      `At: ${entry.timestamp}`,
    ].join("\n"),
  });
  return entry;
}

export function recordQuoteRoundSupplierInvites(input: {
  rfqName: string;
  roundName: string;
  roundNumber: number;
  reasonCode: string;
  user: string;
  suppliers: Array<{ supplier: string; supplier_name: string }>;
  emailStatus: RfqRoundActivityEntry["email_status"];
}): void {
  setRfqRoundNewlyAddedSuppliers(
    input.rfqName,
    input.roundName,
    input.suppliers,
  );

  appendRfqRoundActivity({
    type: "suppliers_invited",
    rfq_name: input.rfqName,
    round_name: input.roundName,
    round_number: input.roundNumber,
    reason_code: input.reasonCode,
    message: `${input.suppliers.length} supplier${
      input.suppliers.length === 1 ? "" : "s"
    } invited to R${String(input.roundNumber).padStart(2, "0")}`,
    detail: input.suppliers
      .map((s) => s.supplier_name || s.supplier)
      .join(", "),
    supplier_count: input.suppliers.length,
    suppliers: input.suppliers,
    user: input.user,
  });

  appendRfqRoundActivity({
    type: "invitation_email",
    rfq_name: input.rfqName,
    round_name: input.roundName,
    round_number: input.roundNumber,
    reason_code: input.reasonCode,
    message:
      input.emailStatus === "sent"
        ? "Invitation emails sent"
        : input.emailStatus === "pending_submit"
          ? "Invitation emails pending RFQ submit"
          : input.emailStatus === "failed"
            ? "Invitation email delivery failed"
            : "Invitation emails skipped",
    detail: `Status: ${input.emailStatus}`,
    supplier_count: input.suppliers.length,
    email_status: input.emailStatus,
    user: input.user,
  });

  void logRfqRoundActivityToErp({
    rfqName: input.rfqName,
    subject: "Quote Round Supplier Invitations",
    content: [
      `Round: R${String(input.roundNumber).padStart(2, "0")}`,
      `Round Doc: ${input.roundName}`,
      `Reason: ${input.reasonCode}`,
      `Suppliers (${input.suppliers.length}): ${input.suppliers
        .map((s) => `${s.supplier_name} (${s.supplier})`)
        .join("; ")}`,
      `Email Status: ${input.emailStatus}`,
      `Invited By: ${input.user}`,
      `At: ${new Date().toISOString()}`,
    ].join("\n"),
  });
}
