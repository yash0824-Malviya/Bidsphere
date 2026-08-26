/**
 * Audit trail for additional RFQ supplier invitations.
 */

import { apiPost, withSilent } from "./erpnext";

export interface RfqSupplierInviteAuditEntry {
  invitationId: string;
  rfqId: string;
  supplierId: string;
  supplier: string;
  supplier_name: string;
  supplierName?: string;
  portal_user?: string;
  user_email?: string;
  invited_by: string;
  invitedBy?: string;
  invited_at: string;
  invitedAt: string;
  status: "Pending" | "Quoted" | "Declined" | "Awarded" | "Closed" | string;
  invitation_round: number;
}

const AUDIT_LIST_KEY = (rfqName: string) => `rfq_invite_audit_${rfqName}`;

export function readRfqInviteAudit(rfqName: string): RfqSupplierInviteAuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_LIST_KEY(rfqName));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<RfqSupplierInviteAuditEntry>[];
    return parsed.map((e, idx) => ({
      invitationId: e.invitationId || `${rfqName}-${(e.supplier || `supp-${idx}`).trim().toLowerCase()}-R${e.invitation_round || 1}`,
      rfqId: e.rfqId || rfqName,
      supplierId: e.supplierId || e.supplier || "",
      supplier: e.supplier || e.supplierId || "",
      supplier_name: e.supplier_name || e.supplierName || e.supplier || "",
      supplierName: e.supplierName || e.supplier_name || e.supplier || "",
      portal_user: e.portal_user,
      user_email: e.user_email,
      invited_by: e.invited_by || e.invitedBy || "Procurement",
      invitedBy: e.invitedBy || e.invited_by || "Procurement",
      invited_at: e.invited_at || e.invitedAt || new Date().toISOString(),
      invitedAt: e.invitedAt || e.invited_at || new Date().toISOString(),
      status: e.status || "Pending",
      invitation_round: e.invitation_round || 1,
    }));
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
  entries: Array<{
    supplier: string;
    supplierId?: string;
    supplier_name?: string;
    supplierName?: string;
    invited_by?: string;
    invitedBy?: string;
    portal_user?: string;
    user_email?: string;
    status?: string;
  }>,
): number {
  const round = getLatestInviteRound(rfqName) + 1;
  const now = new Date().toISOString();
  const next: RfqSupplierInviteAuditEntry[] = [
    ...readRfqInviteAudit(rfqName),
    ...entries.map((e, idx) => {
      const supplierKey = (e.supplier || e.supplierId || `supp-${idx}`).trim();
      const suppName = e.supplier_name || e.supplierName || supplierKey;
      const invBy = e.invited_by || e.invitedBy || "Procurement";
      const invId = `${rfqName}-${supplierKey.toLowerCase()}-R${round}`;
      return {
        invitationId: invId,
        rfqId: rfqName,
        supplierId: supplierKey,
        supplier: supplierKey,
        supplier_name: suppName,
        supplierName: suppName,
        portal_user: e.portal_user,
        user_email: e.user_email,
        invited_by: invBy,
        invitedBy: invBy,
        invited_at: now,
        invitedAt: now,
        status: (e.status || "Pending") as RfqSupplierInviteAuditEntry["status"],
        invitation_round: round,
      };
    }),
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
    if (entry.status === "Pending" || !entry.status) {
      ids.add(entry.supplier.trim().toLowerCase());
    }
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
