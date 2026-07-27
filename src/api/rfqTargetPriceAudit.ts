/**
 * Audit trail writes for Target Price edits and visibility changes.
 */

import { apiPost, withSilent } from "./erpnext";

export async function logRfqTargetPriceAudit(input: {
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
      console.warn("[RFQ Target Price] Activity Log skipped:", err);
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
      console.warn("[RFQ Target Price] Comment audit skipped:", err);
    }
  }
}
