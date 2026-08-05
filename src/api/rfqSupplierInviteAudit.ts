/**
 * Audit trail for additional RFQ supplier invitations.
 */

import { apiPost, withSilent } from "./erpnext";

export interface RfqSupplierInviteAuditEntry {
  supplier: string;
  supplier_name: string;
  invited_by: string;
  invited_at: string;
  invitation_round: number;
}

const AUDIT_LIST_KEY = (rfqName: string) => `rfq_invite_audit_${rfqName}`;

export function readRfqInviteAudit(rfqName: string): RfqSupplierInviteAuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_LIST_KEY(rfqName));
    return raw ? (JSON.parse(raw) as RfqSupplierInviteAuditEntry[]) : [];
  } catch {
    return [];
  }
}

export function getLatestInviteRound(rfqName: string): number {
  const entries = readRfqInviteAudit(rfqName);
  if (!entries.length) return 0;
  return Math.max(...entries.map((e) => e.invitation_round));
}

export function appendRfqInviteAudit(
  rfqName: string,
  entries: Omit<RfqSupplierInviteAuditEntry, "invitation_round" | "invited_at">[],
): number {
  const round = getLatestInviteRound(rfqName) + 1;
  const now = new Date().toISOString();
  const next = [
    ...readRfqInviteAudit(rfqName),
    ...entries.map((e) => ({
      ...e,
      invited_at: now,
      invitation_round: round,
    })),
  ];
  try {
    localStorage.setItem(AUDIT_LIST_KEY(rfqName), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return round;
}

export function getPendingInvitationSupplierIds(rfqName: string): Set<string> {
  const ids = new Set<string>();
  for (const entry of readRfqInviteAudit(rfqName)) {
    ids.add(entry.supplier.trim().toLowerCase());
  }
  return ids;
}

export async function logRfqSupplierInviteAudit(input: {
  rfqName: string;
  supplier: string;
  supplierName: string;
  invitedBy: string;
  round: number;
}): Promise<void> {
  const subject = "Supplier Invited";
  const content = [
    `Supplier: ${input.supplierName} (${input.supplier})`,
    `Invited By: ${input.invitedBy}`,
    `Invitation Round: ${input.round}`,
    `Invited At: ${new Date().toISOString()}`,
  ].join("\n");

  try {
    await apiPost(
      "/api/method/frappe.client.insert",
      {
        doc: {
          doctype: "Activity Log",
          subject,
          content,
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
      console.warn("[RFQ Invite] Activity Log skipped:", err);
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
          content: `${subject} — ${content}`,
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[RFQ Invite] Comment audit skipped:", err);
    }
  }
}
