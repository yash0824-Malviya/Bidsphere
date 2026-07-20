/**
 * Admin Approval Center data layer.
 *
 * Live ERPNext data only — no mock/demo records. Both queries derive from the
 * standard Material Request workflow list (docstatus = 1) and are filtered to
 * INDIRECT procurement requests, which are the only ones that pass through the
 * admin approval gate. The underlying approve/reject workflow and permissions
 * are untouched; this module only shapes data for the two Approval Center pages.
 */

import { apiGet, buildListConfig, buildResourceUrl, withSilent } from "./erpnext";
import {
  getMaterialRequestMode,
  getMaterialRequestProcurementType,
  getMaterialRequestWorkflowStatus,
  listMaterialRequestsWorkflow,
  type MaterialRequestWorkflowRecord,
} from "./materialRequestWorkflow";
import type {
  MaterialRequestMode,
  MaterialRequestProcurementType,
  MaterialRequestWorkflowStatus,
} from "../types/materialRequestWorkflow";

export interface AdminApprovalRow {
  name: string;
  department: string;
  requestedBy: string;
  procurementType: MaterialRequestProcurementType;
  requestMode: MaterialRequestMode;
  priority: string;
  status: MaterialRequestWorkflowStatus;
  requestDate?: string;
  approvalDate?: string;
  approvedBy?: string;
  itemCount: number;
}

/** Statuses an INDIRECT MR reaches only after the admin has approved it. */
const APPROVED_STATUSES: MaterialRequestWorkflowStatus[] = [
  "Forwarded to Procurement",
  "RFQ Created",
  "Stock Available",
  "Material Issued",
  "Completed",
];

/**
 * Count Material Request line items per parent in a single batched child-table
 * query. Never throws — a failed probe degrades to 0 so the table still renders.
 */
async function fetchItemCounts(names: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (names.length === 0) return counts;
  try {
    const rows = await apiGet<Array<{ parent?: string }>>(
      buildResourceUrl("Material Request Item"),
      withSilent(
        buildListConfig({
          fields: ["parent"],
          filters: [["parent", "in", names]],
          limit_page_length: 5000,
        }),
      ),
    );
    for (const row of rows ?? []) {
      if (!row.parent) continue;
      counts.set(row.parent, (counts.get(row.parent) ?? 0) + 1);
    }
  } catch {
    /* degrade to empty — item count column shows 0 */
  }
  return counts;
}

function toRow(
  mr: MaterialRequestWorkflowRecord,
  itemCount: number,
): AdminApprovalRow {
  return {
    name: mr.name,
    department: mr.custom_department ?? "",
    requestedBy: mr.custom_requested_by ?? mr.owner ?? "",
    procurementType: getMaterialRequestProcurementType(mr),
    requestMode: getMaterialRequestMode(mr),
    priority: mr.custom_priority ?? "",
    status: getMaterialRequestWorkflowStatus(mr),
    requestDate: mr.transaction_date ?? mr.creation,
    approvalDate: mr.modified,
    approvedBy: (mr as { modified_by?: string }).modified_by ?? "",
    itemCount,
  };
}

/** Indirect Material Requests awaiting admin approval (status "Admin Review"). */
export async function listPendingIndirectApprovals(): Promise<
  AdminApprovalRow[]
> {
  const rows = await listMaterialRequestsWorkflow({ docstatus: 1, limit: 500 });
  const pending = rows.filter(
    (mr) =>
      getMaterialRequestProcurementType(mr) === "Indirect" &&
      getMaterialRequestWorkflowStatus(mr) === "Admin Review",
  );
  const counts = await fetchItemCounts(pending.map((m) => m.name));
  return pending.map((mr) => toRow(mr, counts.get(mr.name) ?? 0));
}

/** Indirect Material Requests that have passed the admin approval gate. */
export async function listApprovedIndirectRequests(): Promise<
  AdminApprovalRow[]
> {
  const rows = await listMaterialRequestsWorkflow({ docstatus: 1, limit: 500 });
  const approved = rows.filter(
    (mr) =>
      getMaterialRequestProcurementType(mr) === "Indirect" &&
      APPROVED_STATUSES.includes(getMaterialRequestWorkflowStatus(mr)),
  );
  const counts = await fetchItemCounts(approved.map((m) => m.name));
  return approved
    .map((mr) => toRow(mr, counts.get(mr.name) ?? 0))
    .sort((a, b) => (b.approvalDate ?? "").localeCompare(a.approvalDate ?? ""));
}
