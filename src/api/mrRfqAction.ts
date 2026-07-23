/**
 * Material Request ↔ RFQ action rules (frontend enforcement).
 *
 * Business rule: one Material Request → one active RFQ.
 * A new RFQ may be created only when no active RFQ exists
 * (or the previous RFQ is Cancelled / Rejected).
 *
 * Uses existing ERPNext resource APIs — no workflow/backend architecture change.
 */

import { apiGet, buildListConfig, buildResourceUrl } from "./erpnext";
import {
  getLinkedRfqName,
  getMaterialRequestWorkflowStatus,
  type MaterialRequestWorkflowRecord,
} from "./materialRequestWorkflow";
import { getPurchaseOrderByRFQ } from "./purchasing";

export type MrRfqActionKind = "create_rfq" | "view_rfq" | "view_po";

export interface MrRfqUiAction {
  /** Display status for the MR → RFQ stage. */
  statusLabel: string;
  action: MrRfqActionKind;
  rfqName?: string;
  poName?: string;
  /** True when Create RFQ is allowed. */
  canCreate: boolean;
}

/** RFQs that no longer block a replacement RFQ for the same MR. */
export function isInactiveRfqForMrReuse(doc: {
  status?: string | null;
  docstatus?: number | null;
}): boolean {
  if (doc.docstatus === 2) return true;
  const s = String(doc.status ?? "")
    .trim()
    .toLowerCase();
  return (
    s === "cancelled" ||
    s === "rejected" ||
    s === "lost" ||
    s === "expired"
  );
}

async function fetchRfqLifecycle(
  name: string,
): Promise<{ name: string; status?: string; docstatus?: number } | null> {
  try {
    return await apiGet<{ name: string; status?: string; docstatus?: number }>(
      buildResourceUrl("Request for Quotation", name),
    );
  } catch {
    return null;
  }
}

/** All RFQ parents linked via Request for Quotation Item.material_request. */
export async function listRfqParentsForMaterialRequest(
  mrName: string,
): Promise<string[]> {
  const name = String(mrName || "").trim();
  if (!name) return [];
  try {
    const rows = await apiGet<
      Array<{ parent?: string; material_request?: string }>
    >(
      buildResourceUrl("Request for Quotation Item"),
      buildListConfig({
        fields: ["parent", "material_request"],
        filters: [["material_request", "=", name]],
        limit_page_length: 50,
        order_by: "creation asc",
      }),
    );
    const out: string[] = [];
    for (const row of rows ?? []) {
      const parent = String(row.parent ?? "").trim();
      if (parent && !out.includes(parent)) out.push(parent);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Active RFQ for this MR (not Cancelled / Rejected), if any.
 * Checks custom_linked_rfq / remarks tags, then RFQ Item rows.
 */
export async function findActiveRfqForMaterialRequest(
  mrName: string,
  mr?: MaterialRequestWorkflowRecord | null,
): Promise<string | undefined> {
  const candidates: string[] = [];
  const fromField = mr ? getLinkedRfqName(mr) : undefined;
  if (fromField) candidates.push(fromField);

  for (const parent of await listRfqParentsForMaterialRequest(mrName)) {
    if (!candidates.includes(parent)) candidates.push(parent);
  }
  if (candidates.length === 0) return undefined;

  for (const rfqName of candidates) {
    const doc = await fetchRfqLifecycle(rfqName);
    if (!doc) continue;
    if (!isInactiveRfqForMrReuse(doc)) return rfqName;
  }
  return undefined;
}

/**
 * Batch: MR name → active RFQ name.
 * Used by procurement queue enrichment so Cancelled RFQs do not hide Create RFQ.
 *
 * @param fieldLinks optional mr → RFQ from custom_linked_rfq / remarks (checked too)
 */
export async function batchFindActiveRfqNamesForMaterialRequests(
  mrNames: string[],
  fieldLinks?: Map<string, string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const names = [
    ...new Set(mrNames.map((n) => String(n || "").trim()).filter(Boolean)),
  ];
  if (names.length === 0) return out;

  try {
    const rows = await apiGet<
      Array<{ parent?: string; material_request?: string }>
    >(
      buildResourceUrl("Request for Quotation Item"),
      buildListConfig({
        fields: ["parent", "material_request"],
        filters: [["material_request", "in", names]],
        limit_page_length: Math.min(2000, Math.max(names.length * 6, 50)),
        order_by: "creation asc",
      }),
    );

    const parentsByMr = new Map<string, string[]>();
    const allParents = new Set<string>();
    for (const row of rows ?? []) {
      const mr = String(row.material_request ?? "").trim();
      const parent = String(row.parent ?? "").trim();
      if (!mr || !parent) continue;
      const list = parentsByMr.get(mr) ?? [];
      if (!list.includes(parent)) list.push(parent);
      parentsByMr.set(mr, list);
      allParents.add(parent);
    }
    if (fieldLinks) {
      for (const [mr, rfq] of fieldLinks) {
        const parent = String(rfq || "").trim();
        if (!mr || !parent) continue;
        const list = parentsByMr.get(mr) ?? [];
        if (!list.includes(parent)) list.unshift(parent);
        parentsByMr.set(mr, list);
        allParents.add(parent);
      }
    }

    if (allParents.size === 0) return out;

    const rfqRows = await apiGet<
      Array<{ name: string; status?: string; docstatus?: number }>
    >(
      buildResourceUrl("Request for Quotation"),
      buildListConfig({
        fields: ["name", "status", "docstatus"],
        filters: [["name", "in", [...allParents]]],
        limit_page_length: allParents.size,
      }),
    );
    const lifecycle = new Map(
      (rfqRows ?? []).map((r) => [r.name, r] as const),
    );

    for (const [mr, parents] of parentsByMr) {
      for (const parent of parents) {
        const doc = lifecycle.get(parent);
        if (doc && !isInactiveRfqForMrReuse(doc)) {
          out.set(mr, parent);
          break;
        }
      }
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("[MR→RFQ] batch active RFQ lookup failed:", err);
    }
  }
  return out;
}

/**
 * Resolve the single UI action for an MR regarding RFQ / PO.
 */
export async function resolveMrRfqUiAction(
  mr: MaterialRequestWorkflowRecord,
): Promise<MrRfqUiAction> {
  const activeRfq = await findActiveRfqForMaterialRequest(mr.name, mr);

  if (!activeRfq) {
    const wf = getMaterialRequestWorkflowStatus(mr);
    const canCreate =
      wf === "Forwarded to Procurement" || wf === "RFQ Created";
    return {
      statusLabel: "Awaiting RFQ Creation",
      action: "create_rfq",
      canCreate,
    };
  }

  try {
    const po = await getPurchaseOrderByRFQ(activeRfq);
    if (po?.name) {
      return {
        statusLabel: "Purchase Order Created",
        action: "view_po",
        rfqName: activeRfq,
        poName: po.name,
        canCreate: false,
      };
    }
  } catch {
    /* PO lookup soft-fail → still offer View RFQ */
  }

  return {
    statusLabel: "RFQ In Progress",
    action: "view_rfq",
    rfqName: activeRfq,
    canCreate: false,
  };
}
