/**
 * Temporary workflow diagnostics — log the ERP fields every stage reads.
 * Remove once Department → Warehouse → Procurement → RFQ is stable.
 */

export type MrDebugFields = {
  name?: string;
  mr_number?: string;
  status?: string | null;
  workflow_state?: string | null;
  bidsphere_status?: string | null;
  warehouse_status?: string | null;
  procurement_status?: string | null;
  purpose?: string | null;
  docstatus?: number | null;
  custom_forwarded_to_procurement?: number | string | null;
  stage?: string;
  [key: string]: unknown;
};

export function logMrWorkflowStage(
  stage: string,
  doc: Record<string, unknown> | null | undefined,
  extra?: Record<string, unknown>,
): void {
  const d = doc ?? {};
  const bidsphere = (d.custom_bidsphere_status as string | undefined) ?? null;
  const payload: MrDebugFields = {
    stage,
    name: (d.name as string | undefined) ?? null,
    mr_number: (d.name as string | undefined) ?? null,
    status: (d.status as string | undefined) ?? null,
    workflow_state: (d.workflow_state as string | undefined) ?? null,
    bidsphere_status: bidsphere,
    warehouse_status: bidsphere,
    procurement_status: bidsphere,
    purpose: (d.material_request_type as string | undefined) ?? null,
    docstatus: (d.docstatus as number | undefined) ?? null,
    custom_forwarded_to_procurement:
      (d.custom_forwarded_to_procurement as number | undefined) ?? null,
    ...extra,
  };
  // eslint-disable-next-line no-console
  console.log(`[MR Workflow] ${stage}`, payload);
}

export function logMrFilterTable(row: {
  page: string;
  api: string;
  filterUsed: unknown;
  recordsReturned: number;
  rejected?: Array<{ name: string; reason: string }>;
}): void {
  // eslint-disable-next-line no-console
  console.log("[MR Workflow] Filter table", {
    Page: row.page,
    API: row.api,
    "Filter Used": row.filterUsed,
    "Records Returned": row.recordsReturned,
    "Reason Records Rejected": row.rejected ?? [],
  });
}
