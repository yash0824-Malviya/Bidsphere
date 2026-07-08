/**
 * RFQ → Budget assignment persistence.
 *
 * When no ERPNext Budget can be auto-resolved from an RFQ's Material Request
 * chain (Department / Cost Center / Fiscal Year), the Finance Manager may
 * manually pick an Active Budget for the RFQ. That choice must survive reloads
 * and be visible to every reviewer — so it is stored on the RFQ itself in
 * ERPNext (never localStorage / mock data).
 *
 * The `Request for Quotation` DocType has no dedicated budget field, so the
 * assignment is recorded as a tagged ERPNext Comment against the RFQ. This is
 * the same lightweight, schema-free persistence pattern used for Budget
 * workflow comments — fully live, cross-device, and requiring no custom field.
 */
import {
  apiGet,
  apiPost,
  buildListConfig,
  buildResourceUrl,
  withSilent,
} from "./erpnext";

const RFQ_DOCTYPE = "Request for Quotation";
/** Marker that identifies a budget-assignment comment on an RFQ. */
const ASSIGNMENT_TAG = "[BudgetAssignment]";

/**
 * Persist the Finance Manager's chosen Budget for an RFQ as a tagged ERPNext
 * Comment. The latest such comment wins, so re-assigning simply appends a new
 * one (the full history stays for audit).
 */
export async function assignBudgetToRfq(
  rfqName: string,
  budgetName: string,
  assignedBy?: string
): Promise<void> {
  const content = `${ASSIGNMENT_TAG} ${budgetName}${
    assignedBy ? ` | ${assignedBy}` : ""
  }`;
  await apiPost(
    "/api/method/frappe.desk.form.utils.add_comment",
    {
      reference_doctype: RFQ_DOCTYPE,
      reference_name: rfqName,
      content,
      comment_email: assignedBy || "",
      comment_by: assignedBy || "",
    },
    withSilent()
  );
}

/**
 * The Budget name most recently assigned to an RFQ, or `null` when none was.
 * Reads the RFQ's tagged assignment comments (newest first).
 */
export async function getAssignedBudgetName(
  rfqName: string
): Promise<string | null> {
  if (!rfqName) return null;
  try {
    const rows = await apiGet<Array<{ content?: string; creation?: string }>>(
      buildResourceUrl("Comment"),
      withSilent(
        buildListConfig({
          fields: ["content", "creation"],
          filters: [
            ["reference_doctype", "=", RFQ_DOCTYPE],
            ["reference_name", "=", rfqName],
            ["content", "like", `%${ASSIGNMENT_TAG}%`],
          ],
          order_by: "creation desc",
          limit_page_length: 5,
        })
      )
    );
    for (const row of rows ?? []) {
      const parsed = parseAssignmentContent(row.content);
      if (parsed) return parsed;
    }
  } catch {
    /* best-effort — a missing assignment is not an error */
  }
  return null;
}

function parseAssignmentContent(content?: string): string | null {
  if (!content) return null;
  const idx = content.indexOf(ASSIGNMENT_TAG);
  if (idx < 0) return null;
  const after = content.slice(idx + ASSIGNMENT_TAG.length).trim();
  // Strip any trailing "| assignedBy" and stray HTML the desk API may wrap in.
  const budget = after.split("|")[0].replace(/<[^>]*>/g, "").trim();
  return budget || null;
}
