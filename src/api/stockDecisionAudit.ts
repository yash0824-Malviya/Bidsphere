/**
 * Persist Stock Decision recommendation + override audit for Warehouse Review.
 * Writes Activity Log, MR Comment, optional custom fields, and a remarks tag.
 */

import { apiPost, withSilent } from "./erpnext";

export type StockDecisionAction = "issue" | "forward";

export interface StockDecisionAuditRow {
  item_code: string;
  recommended_action: StockDecisionAction;
  selected_action: StockDecisionAction;
  selected_by: string;
  selected_at: string;
  reason?: string;
}

function toErpDateTime(iso: string): string {
  // ERPNext expects "YYYY-MM-DD HH:mm:ss"
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatStockDecisionsTag(rows: StockDecisionAuditRow[]): string {
  return `[BidSphere:StockDecisions:${JSON.stringify(rows)}]`;
}

/** Best-effort: never throws — audit must not block warehouse processing. */
export async function persistStockDecisionAudit(
  mrName: string,
  rows: StockDecisionAuditRow[],
): Promise<void> {
  if (!mrName || rows.length === 0) return;

  const primary = rows[0]!;
  const selectedBy = primary.selected_by;
  const selectedAt = primary.selected_at;
  const rollupRecommended = rows.every(
    (r) => r.recommended_action === rows[0]!.recommended_action,
  )
    ? rows[0]!.recommended_action
    : "mixed";
  const rollupSelected = rows.every(
    (r) => r.selected_action === rows[0]!.selected_action,
  )
    ? rows[0]!.selected_action
    : "mixed";
  const reason =
    rows
      .map((r) => r.reason?.trim())
      .filter(Boolean)
      .join("; ") || "";

  const summary = rows
    .map(
      (r) =>
        `${r.item_code}: recommended=${r.recommended_action}, selected=${r.selected_action}` +
        (r.reason ? ` (reason: ${r.reason})` : ""),
    )
    .join("; ");

  // Activity Log
  try {
    await apiPost(
      "/api/method/frappe.client.insert",
      {
        doc: {
          doctype: "Activity Log",
          subject: `Stock Decision on ${mrName}`,
          content: summary,
          operation: "Update",
          status: "Success",
          reference_doctype: "Material Request",
          reference_name: mrName,
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[StockDecision] Activity Log skipped:", err);
    }
  }

  // Comment on MR
  try {
    await apiPost(
      "/api/method/frappe.client.save",
      {
        doc: {
          doctype: "Comment",
          comment_type: "Comment",
          reference_doctype: "Material Request",
          reference_name: mrName,
          content: `Stock Decision audit — ${summary}`,
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[StockDecision] Comment skipped:", err);
    }
  }

  // Custom fields (created by scripts/setup-stock-decision-fields.mjs)
  try {
    await apiPost(
      "/api/method/frappe.client.set_value",
      {
        doctype: "Material Request",
        name: mrName,
        fieldname: {
          custom_recommended_action: rollupRecommended,
          custom_selected_action: rollupSelected,
          custom_selected_by: selectedBy,
          custom_selected_at: toErpDateTime(selectedAt),
          custom_selection_reason: reason,
          custom_stock_decision_audit: JSON.stringify(rows),
        },
      },
      withSilent(),
    );
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[StockDecision] custom fields not persisted:", err);
    }
  }
}
