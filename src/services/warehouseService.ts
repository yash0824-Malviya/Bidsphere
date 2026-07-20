import type { QueryClient } from "@tanstack/react-query";

import {
  normalizeWorkflowStatus,
  resolveProcurementType,
  resolveRequestMode,
  type MaterialRequestWorkflowStatus,
  type MaterialRequestMode,
  type MaterialRequestPriority,
  type MaterialRequestProcurementType,
} from "../types/materialRequestWorkflow";

export interface WarehouseItem {
  item_code: string;
  item_name: string;
  description: string;
  category: string;
  uom: string;
  status: "In Stock" | "Low Stock" | "Out of Stock";
  available_qty: number;
  reserved_qty: number;
  reorder_level: number;
  warehouse: string;
}

export interface WarehouseMaterialRequestItem {
  item_code: string;
  description: string;
  required_qty: number;
  available_qty: number;
  uom: string;
  /** Warehouse the stock check resolved this line against (live ERPNext Bin). */
  warehouse?: string;
  status: "Available" | "Partial Stock" | "Out of Stock";
  /** Optional engineering part label from Department MR (read-only in Warehouse). */
  part_name?: string;
  /** Optional 2D drawing Attach URL on the MR item row. */
  drawing_2d_url?: string;
  /** Multi-file engineering attachments (JSON / legacy merge). */
  attachments?: EngineeringAttachment[];
}

export interface WarehouseMaterialRequest {
  name: string;
  department: string;
  requested_by: string;
  request_date: string;
  required_date: string;
  priority: MaterialRequestPriority;
  status: MaterialRequestWorkflowStatus;
  procurement_type: MaterialRequestProcurementType;
  request_mode: MaterialRequestMode;
  items_count: number;
  items: WarehouseMaterialRequestItem[];
}

export type MaterialIssueStatus =
  | "Fully Issued"
  | "Partially Issued"
  | "Cancelled";

export interface WarehouseMaterialIssued {
  name: string;
  /** Linked Material Request (empty string when the issue has no MR link). */
  mr_name: string;
  /** Department resolved from the linked Material Request (empty when unknown). */
  department: string;
  /** Human display name of the issuer — never an email / "Administrator". */
  issued_by: string;
  issue_date: string;
  /** Source warehouse the stock was issued from (empty when unknown). */
  warehouse: string;
  /** Full ISO timestamp (creation) for activity feeds — date + time. */
  issued_at?: string;
  status: MaterialIssueStatus;
}

export interface MaterialIssueDetailItem {
  item_code: string;
  item_name: string;
  uom: string;
  /** Requested quantity from the linked MR line (null when no MR link). */
  requested_qty: number | null;
  issued_qty: number;
  /** requested − issued, floored at 0 (null when requested is unknown). */
  remaining_qty: number | null;
  warehouse: string;
}

export interface MaterialIssueDetail {
  name: string;
  mr_name: string;
  department: string;
  warehouse: string;
  issued_by: string;
  issue_date: string;
  status: MaterialIssueStatus;
  remarks: string;
  /** Stock Entry document name (same as `name`) — surfaced explicitly for UI. */
  stock_entry_number: string;
  items: MaterialIssueDetailItem[];
}

export interface WarehouseForwardedRequest {
  name: string;
  department: string;
  forwarded_date: string;
  /** Full ISO timestamp (modified) for activity feeds — date + time. */
  forwarded_at?: string;
  forwarded_by: string;
  rfq_status: "RFQ Draft" | "RFQ Sent" | "Pending RFQ";
  rfq_id?: string;
}

import {
  listWarehouseMaterialRequestQueue,
  checkMaterialRequestStock,
  issueMaterialRequest,
  forwardMaterialRequestToProcurement,
  rejectMaterialRequest as rejectMaterialRequestWorkflow,
  listMaterialRequestsWorkflow,
  getMaterialRequestProcurementType,
  getMaterialRequestMode,
  parseForwardedItemsFromMr,
  WAREHOUSE_PENDING_STATUSES,
} from "../api/materialRequestWorkflow";
import { fetchWarehouseStockSummary } from "../api/warehouseStock";
import { getMaterialRequest } from "../api/purchasing";
import { apiGet, buildListConfig, buildResourceUrl, COMPANY } from "../api/erpnext";
import { hydrateEngineeringDocsFromChild } from "../utils/materialRequestItemFiles";
import type { EngineeringAttachment } from "../utils/materialRequestItemFiles";
import {
  logMrFilterTable,
  logMrWorkflowStage,
} from "../utils/mrWorkflowDebug";

/** True when the ERPNext response indicates the caller lacks permission. */
function isForbidden(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | undefined)
    ?.response?.status;
  return status === 403;
}

/**
 * Logs a doctype fetch failure without throwing. 403s are logged distinctly
 * so the widget can render an empty state instead of blocking the dashboard.
 */
function logWidgetFailure(widget: string, err: unknown): void {
  const status = (err as { response?: { status?: number } } | undefined)
    ?.response?.status;
  if (isForbidden(err)) {
    // eslint-disable-next-line no-console
    console.error(
      `[Warehouse Dashboard] 403 Forbidden loading "${widget}" — showing empty widget and continuing.`,
      err
    );
  } else {
    // eslint-disable-next-line no-console
    console.error(
      `[Warehouse Dashboard] Failed to load "${widget}" (status: ${status ?? "n/a"}):`,
      err
    );
  }
}

// Helper to map workflow status from standard fields if custom status is not present
function workflowStatusFromStandardFields(mr: any): MaterialRequestWorkflowStatus {
  const docstatus = mr.docstatus ?? 0;
  const stdStatus = (mr.status ?? "").trim();

  if (docstatus === 0) return "Draft";
  if (docstatus === 2 || stdStatus === "Cancelled" || stdStatus === "Stopped") {
    return "Cancelled";
  }
  if (stdStatus === "Issued") {
    return mr.material_request_type === "Material Issue"
      ? "Material Issued"
      : "Completed";
  }
  // This fallback only runs when `custom_bidsphere_status` is entirely
  // unavailable/unset, so it has no visibility into whether Warehouse has
  // reviewed the request yet. A submitted MR must therefore default to
  // "Under Warehouse Review" — shortage statuses are written by Stock Decision.
  if (docstatus === 1) return "Under Warehouse Review";
  return "Draft";
}

// ─── API Methods ───

/** Never throws — any failure (incl. 403) resolves to an empty list so the
 *  "Pending Material Requests" widget renders its empty state instead of
 *  blocking the rest of the dashboard. */
export async function getPendingMaterialRequests(): Promise<WarehouseMaterialRequest[]> {
  let rawList: Awaited<ReturnType<typeof listWarehouseMaterialRequestQueue>>;
  try {
    rawList = await listWarehouseMaterialRequestQueue();
  } catch (err) {
    logWidgetFailure("Pending Material Requests", err);
    return [];
  }

  // eslint-disable-next-line no-console
  console.log("Material Request API Response", {
    page: "Warehouse → Pending Review",
    api: "listWarehouseMaterialRequestQueue",
    beforeFilter: rawList.length,
  });

  // Fetch details in parallel — Promise.allSettled so a single failed detail
  // fetch never blocks the others from rendering.
  const detailResults = await Promise.allSettled(
    rawList.map((row) => getMaterialRequest(row.name))
  );
  const detailsRaw = detailResults.map((result, idx) =>
    result.status === "fulfilled" ? result.value : rawList[idx]
  );

  // ERP BidSphere Status is the single source of truth after hydrate.
  // Do NOT hide rows that still say Under Warehouse Review just because an
  // optional forwarded flag/tag was set by a partial write.
  const rejected: Array<{ name: string; reason: string }> = [];
  const details = detailsRaw.filter((mr: any) => {
    const status =
      normalizeWorkflowStatus(mr.custom_bidsphere_status) ||
      workflowStatusFromStandardFields(mr);
    const payload = {
      "MR Number": mr.name,
      Purpose: mr.material_request_type,
      Docstatus: mr.docstatus,
      Status: mr.status,
      "Workflow State": mr.workflow_state ?? null,
      "BidSphere Status": mr.custom_bidsphere_status ?? null,
      "Warehouse Status": status,
      "Procurement Status": mr.custom_bidsphere_status ?? status,
      "Request Type": mr.custom_procurement_type ?? null,
      "Request Mode": mr.custom_request_mode ?? null,
      Resolved: status,
    };
    // eslint-disable-next-line no-console
    console.log("ERP Response (hydrated MR)", payload);

    const keep = WAREHOUSE_PENDING_STATUSES.includes(status);
    if (!keep) {
      const reason = `Rejected ${mr.name} — BidSphere Status "${mr.custom_bidsphere_status || status}" is not a Pending Review status (${WAREHOUSE_PENDING_STATUSES.join(", ")})`;
      // eslint-disable-next-line no-console
      console.log(reason);
      rejected.push({ name: mr.name, reason });
    }
    return keep;
  });

  logMrFilterTable({
    page: "Warehouse → Pending Review",
    api: "listWarehouseMaterialRequestQueue + getMaterialRequest hydrate",
    filterUsed: {
      docstatus: 1,
      bidsphere_status_in: WAREHOUSE_PENDING_STATUSES,
      request_type: "Direct",
    },
    recordsReturned: details.length,
    rejected: rejected.slice(0, 40),
  });

  const mappedResults = await Promise.allSettled(
    details.map(async (mr: any) => {
      let stockLines: any[] = [];
      try {
        const stockCheck = await checkMaterialRequestStock(mr.name);
        stockLines = stockCheck.lines;
      } catch {
        // ignore stock check failure — items fall back to 0 available
      }
      const stockMap = new Map(stockLines.map((l) => [l.item_code, l]));

      const items = (mr.items || []).map((item: any) => {
        const stock = stockMap.get(item.item_code);
        const avail = stock ? stock.available_qty : 0;
        return {
          item_code: item.item_code,
          description: item.description || "",
          required_qty: item.qty || 0,
          available_qty: avail,
          uom: item.uom || "Nos",
          warehouse: stock?.warehouse || item.warehouse || undefined,
          status:
            avail >= (item.qty || 0)
              ? ("Available" as const)
              : avail > 0
                ? ("Partial Stock" as const)
                : ("Out of Stock" as const),
        };
      });

      return {
        name: mr.name,
        department: mr.custom_department || mr.department || "General",
        requested_by: mr.custom_requested_by || mr.owner || "System",
        request_date: mr.transaction_date || mr.modified?.split("T")[0] || "",
        required_date: mr.schedule_date || "",
        priority: mr.custom_priority || "Medium",
        status: normalizeWorkflowStatus(mr.custom_bidsphere_status) || workflowStatusFromStandardFields(mr),
        procurement_type: resolveProcurementType(mr.custom_procurement_type),
        request_mode: resolveRequestMode(mr.custom_request_mode),
        items_count: mr.items ? mr.items.length : 0,
        items,
      };
    })
  );

  return mappedResults
    .filter(
      (r): r is PromiseFulfilledResult<WarehouseMaterialRequest> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value);
}

/**
 * Legacy "Procurement Required" Material Requests (pre single-step forward) —
 * shortage recorded but not yet Forwarded. Item lines come from the
 * `[BidSphere:ForwardedItems:...]` snapshot. Concatenate with
 * `getPendingMaterialRequests()` before `selectProcurementRequiredRows`.
 * Never throws.
 */
export async function getWarehouseProcurementRequiredRequests(): Promise<
  WarehouseMaterialRequest[]
> {
  let rows: Awaited<ReturnType<typeof listMaterialRequestsWorkflow>>;
  try {
    // Do NOT hard-filter material_request_type — Purchase-type MRs also enter
    // warehouse review. Do NOT rely on list-row workflowStatus alone (custom
    // fields may be missing from list). Fetch submitted MRs, hydrate, then
    // filter on ERP custom_bidsphere_status.
    rows = await listMaterialRequestsWorkflow({
      docstatus: 1,
      limit: 500,
    });
  } catch (err) {
    logWidgetFailure("Procurement Required (persisted)", err);
    return [];
  }

  // eslint-disable-next-line no-console
  console.log("Material Request API Response", {
    page: "Warehouse → Procurement Required",
    api: "listMaterialRequestsWorkflow(docstatus=1)",
    beforeFilter: rows.length,
    sample: rows.slice(0, 10).map((m) => ({
      name: m.name,
      custom_bidsphere_status: m.custom_bidsphere_status,
      material_request_type: m.material_request_type,
      docstatus: m.docstatus,
    })),
  });

  const detailResults = await Promise.allSettled(
    rows.map((r) => getMaterialRequest(r.name)),
  );
  const hydrated = detailResults.map((result, idx) =>
    result.status === "fulfilled" ? (result.value as any) : (rows[idx] as any),
  );

  const rejected: Array<{ name: string; reason: string }> = [];
  const notForwarded = hydrated.filter((mr: any) => {
    const name = String(mr.name || "");
    const status =
      normalizeWorkflowStatus(mr.custom_bidsphere_status) ||
      workflowStatusFromStandardFields(mr);
    const procurementType = resolveProcurementType(mr.custom_procurement_type);
    const forwardedFlag = Number(mr.custom_forwarded_to_procurement) === 1;

    logMrWorkflowStage("Warehouse Procurement Required (hydrate)", mr);

    if (procurementType !== "Direct") {
      rejected.push({ name, reason: `procurement_type=${procurementType}` });
      return false;
    }
    if (status !== "Procurement Required") {
      rejected.push({
        name,
        reason: `bidsphere_status=${mr.custom_bidsphere_status || status}`,
      });
      return false;
    }
    if (forwardedFlag) {
      rejected.push({ name, reason: "custom_forwarded_to_procurement=1" });
      return false;
    }
    return true;
  });

  logMrFilterTable({
    page: "Warehouse → Procurement Required",
    api: "listMaterialRequestsWorkflow + getMaterialRequest hydrate",
    filterUsed: {
      docstatus: 1,
      custom_bidsphere_status: "Procurement Required",
      custom_forwarded_to_procurement: "!= 1",
      procurement_type: "Direct",
    },
    recordsReturned: notForwarded.length,
    rejected: rejected.slice(0, 30),
  });

  return notForwarded.map((mr: any) => {
    const forwardedItems = parseForwardedItemsFromMr(mr);
    const items: WarehouseMaterialRequestItem[] =
      forwardedItems.length > 0
        ? forwardedItems.map((fi) => {
            const required = fi.requested_qty ?? fi.forward_qty ?? 0;
            const available =
              fi.issued_qty ?? Math.max(0, required - (fi.forward_qty ?? 0));
            return {
              item_code: fi.item_code,
              description: fi.item_name ?? fi.item_code,
              required_qty: required,
              available_qty: available,
              uom: fi.uom ?? "Nos",
              warehouse: fi.warehouse || undefined,
              status:
                available >= required
                  ? ("Available" as const)
                  : available > 0
                    ? ("Partial Stock" as const)
                    : ("Out of Stock" as const),
            };
          })
        : (mr.items || []).map((item: any) => ({
            item_code: item.item_code,
            description: item.description || item.item_name || item.item_code,
            required_qty: item.qty || 0,
            available_qty: 0,
            uom: item.uom || "Nos",
            warehouse: item.warehouse || undefined,
            status: "Out of Stock" as const,
          }));

    return {
      name: mr.name,
      department: mr.custom_department || mr.department || "General",
      requested_by: mr.custom_requested_by || mr.owner || "System",
      request_date: mr.transaction_date || mr.modified?.split("T")[0] || "",
      required_date: mr.schedule_date || "",
      priority: mr.custom_priority || "Medium",
      status:
        normalizeWorkflowStatus(mr.custom_bidsphere_status) ||
        ("Procurement Required" as MaterialRequestWorkflowStatus),
      procurement_type: getMaterialRequestProcurementType(mr),
      request_mode: getMaterialRequestMode(mr),
      items_count: items.length,
      items,
    };
  });
}

export async function getMaterialRequestDetail(
  mrNumber: string
): Promise<WarehouseMaterialRequest | null> {
  if (!mrNumber) return null;
  const mr = (await getMaterialRequest(mrNumber)) as any;
  if (!mr) return null;

  let stockLines: any[] = [];
  try {
    const stockCheck = await checkMaterialRequestStock(mr.name);
    stockLines = stockCheck.lines;
  } catch {
    // ignore stock check failure
  }
  const stockMap = new Map(stockLines.map((l) => [l.item_code, l]));

  const items = await Promise.all(
    (mr.items || []).map(async (item: any) => {
      const stock = stockMap.get(item.item_code);
      const avail = stock ? stock.available_qty : 0;
      // Prefer child JSON / Attach fields; fall back to File DocType links
      // when upload succeeded but custom_engineering_attachments was empty.
      const eng = await hydrateEngineeringDocsFromChild(item);
      return {
        item_code: item.item_code,
        description: item.description || "",
        required_qty: item.qty || 0,
        available_qty: avail,
        uom: item.uom || "Nos",
        warehouse: stock?.warehouse || item.warehouse || undefined,
        status:
          avail >= (item.qty || 0)
            ? ("Available" as const)
            : avail > 0
              ? ("Partial Stock" as const)
              : ("Out of Stock" as const),
        part_name: eng.part_name,
        drawing_2d_url: eng.drawing_2d_url,
        attachments: eng.attachments,
      };
    }),
  );

  return {
    name: mr.name,
    department: mr.custom_department || mr.department || "General",
    requested_by: mr.custom_requested_by || mr.owner || "System",
    request_date: mr.transaction_date || mr.modified?.split("T")[0] || "",
    required_date: mr.schedule_date || "",
    priority: mr.custom_priority || "Medium",
    status: normalizeWorkflowStatus(mr.custom_bidsphere_status) || workflowStatusFromStandardFields(mr),
    procurement_type: resolveProcurementType(mr.custom_procurement_type),
    request_mode: resolveRequestMode(mr.custom_request_mode),
    items_count: mr.items ? mr.items.length : 0,
    items,
  };
}

/** Never throws — fetchWarehouseStockSummary() already degrades gracefully,
 *  but this is wrapped defensively so the widget always resolves. */
export async function getInventorySummary(): Promise<WarehouseItem[]> {
  try {
    const summary = await fetchWarehouseStockSummary();
    return (summary.rows || []).map((row) => ({
      item_code: row.item_code,
      item_name: row.item_name,
      description: row.description,
      category: row.category,
      uom: row.uom,
      status: row.status as "In Stock" | "Low Stock" | "Out of Stock",
      available_qty: row.available_qty,
      reserved_qty: row.reserved_qty,
      reorder_level: row.reorder_level,
      warehouse: row.warehouse,
    }));
  } catch (err) {
    logWidgetFailure("Inventory Summary", err);
    return [];
  }
}

/** Never throws — any failure (incl. 403 on Stock Entry) resolves to an
 *  empty list so the "Issued Materials" widget renders empty instead of
 *  blocking the rest of the dashboard. */
/** Strip the machine-only `[BidSphere:…]` snapshot embedded in remarks. */
function cleanIssueRemarks(raw?: string): string {
  if (!raw) return "";
  return raw
    .replace(/\[BidSphere:ForwardedItems:\[.*?\]\]/gs, "")
    .replace(/\[BidSphere:[^\]]*\]/gs, "")
    .trim();
}

/** Extract an MR number from free-text remarks as a last resort. */
function mrFromRemarks(remarks?: string): string {
  const match = remarks?.match(/(MAT-MR-\d+-\d+|MR-\d{4}-\d+)/i);
  return match ? match[0] : "";
}

/**
 * Resolve an issuer's human display name. Never returns an email or
 * "Administrator" — material issues are a warehouse action, so an unknown or
 * system account falls back to "Warehouse Manager".
 */
function resolveIssuerName(
  owner: string | undefined,
  nameByEmail: Map<string, string>,
): string {
  const email = (owner ?? "").trim();
  const full = nameByEmail.get(email)?.trim();
  if (full && full.toLowerCase() !== "administrator") return full;
  return "Warehouse Manager";
}

/** Bulk-resolve ERPNext User full names for a set of login emails. */
async function fetchUserNames(emails: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(emails.filter(Boolean)));
  if (unique.length === 0) return map;
  try {
    const users = await apiGet<Array<{ name: string; full_name?: string }>>(
      buildResourceUrl("User"),
      {
        ...buildListConfig({
          fields: ["name", "full_name"],
          filters: [["name", "in", unique]],
          limit_page_length: unique.length,
        }),
        timeout: 5000,
      },
    );
    for (const u of users ?? []) {
      if (u.name && u.full_name) map.set(u.name, u.full_name);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[getIssuedMaterials] Could not resolve issuer names:", err);
  }
  return map;
}

/**
 * Material Issue logs — live ERPNext Stock Entry (Material Issue) records,
 * enriched with the linked Material Request, its department, the issuer's
 * display name, the source warehouse, and a Fully/Partially/Cancelled status
 * derived from issued-vs-requested quantities. Never throws — degrades to [].
 */
export async function getIssuedMaterials(options?: {
  includeCancelled?: boolean;
}): Promise<WarehouseMaterialIssued[]> {
  try {
    const stockEntries = await apiGet<any[]>(buildResourceUrl("Stock Entry"), {
      ...buildListConfig({
        fields: [
          "name",
          "posting_date",
          "creation",
          "owner",
          "remarks",
          "docstatus",
          "from_warehouse",
        ],
        filters: [
          ["purpose", "=", "Material Issue"],
          options?.includeCancelled
            ? ["docstatus", "in", [1, 2]]
            : ["docstatus", "=", 1],
        ],
        limit_page_length: 200,
        order_by: "posting_date desc",
      }),
      timeout: 5000,
    });

    if (!stockEntries || stockEntries.length === 0) return [];

    const seNames = stockEntries.map((se) => se.name);

    // Stock Entry Detail child rows → MR link, issued qty, source warehouse.
    const mrByParent = new Map<string, string>();
    const issuedQtyByParent = new Map<string, number>();
    const warehouseByParent = new Map<string, string>();
    try {
      const details = await apiGet<any[]>(
        buildResourceUrl("Stock Entry Detail"),
        {
          ...buildListConfig({
            fields: ["parent", "material_request", "qty", "s_warehouse"],
            filters: [["parent", "in", seNames]],
            limit_page_length: 2000,
          }),
          timeout: 5000,
        },
      );
      for (const d of details ?? []) {
        if (!d.parent) continue;
        if (d.material_request && !mrByParent.has(d.parent)) {
          mrByParent.set(d.parent, d.material_request);
        }
        issuedQtyByParent.set(
          d.parent,
          (issuedQtyByParent.get(d.parent) ?? 0) + (Number(d.qty) || 0),
        );
        if (d.s_warehouse && !warehouseByParent.has(d.parent)) {
          warehouseByParent.set(d.parent, d.s_warehouse);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[getIssuedMaterials] Could not fetch Stock Entry Detail:", err);
    }

    // Resolve MR names for department + requested-qty lookups.
    const mrNames = Array.from(
      new Set(
        stockEntries
          .map((se) => mrByParent.get(se.name) || mrFromRemarks(se.remarks))
          .filter(Boolean),
      ),
    );

    const deptByMr = new Map<string, string>();
    const requestedQtyByMr = new Map<string, number>();
    if (mrNames.length > 0) {
      try {
        const mrs = await apiGet<any[]>(buildResourceUrl("Material Request"), {
          ...buildListConfig({
            fields: ["name", "custom_department", "department"],
            filters: [["name", "in", mrNames]],
            limit_page_length: mrNames.length,
          }),
          timeout: 5000,
        });
        for (const mr of mrs ?? []) {
          const dept = (mr.custom_department || mr.department || "").trim();
          if (mr.name && dept) deptByMr.set(mr.name, dept);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[getIssuedMaterials] Could not fetch Material Requests:", err);
      }
      try {
        const mrItems = await apiGet<any[]>(
          buildResourceUrl("Material Request Item"),
          {
            ...buildListConfig({
              fields: ["parent", "qty"],
              filters: [["parent", "in", mrNames]],
              limit_page_length: 2000,
            }),
            timeout: 5000,
          },
        );
        for (const it of mrItems ?? []) {
          if (!it.parent) continue;
          requestedQtyByMr.set(
            it.parent,
            (requestedQtyByMr.get(it.parent) ?? 0) + (Number(it.qty) || 0),
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[getIssuedMaterials] Could not fetch MR items:", err);
      }
    }

    const nameByEmail = await fetchUserNames(
      stockEntries.map((se) => se.owner as string),
    );

    return stockEntries.map((se) => {
      const mrName = mrByParent.get(se.name) || mrFromRemarks(se.remarks) || "";
      const requested = mrName ? requestedQtyByMr.get(mrName) : undefined;
      const issued = issuedQtyByParent.get(se.name) ?? 0;

      let status: MaterialIssueStatus;
      if (se.docstatus === 2) {
        status = "Cancelled";
      } else if (requested != null && requested > 0 && issued < requested) {
        status = "Partially Issued";
      } else {
        status = "Fully Issued";
      }

      return {
        name: se.name,
        mr_name: mrName,
        department: mrName ? deptByMr.get(mrName) ?? "" : "",
        issued_by: resolveIssuerName(se.owner, nameByEmail),
        issue_date: se.posting_date || "",
        warehouse: warehouseByParent.get(se.name) || se.from_warehouse || "",
        issued_at: se.creation || se.posting_date || "",
        status,
      };
    });
  } catch (error) {
    logWidgetFailure("Issued Materials", error);
    return [];
  }
}

/**
 * Full read-only detail for a single Material Issue (Stock Entry). Pulls the
 * Stock Entry document with its item lines, resolves the linked Material
 * Request for department + requested quantities, and computes issued/remaining
 * per line. Live ERPNext data only. Throws on a hard failure so the detail
 * page can render an error state.
 */
export async function getMaterialIssueDetail(
  name: string,
): Promise<MaterialIssueDetail> {
  const se = await apiGet<any>(buildResourceUrl("Stock Entry", name));

  const items: any[] = Array.isArray(se.items) ? se.items : [];
  const mrName =
    items.find((it) => it.material_request)?.material_request ||
    mrFromRemarks(se.remarks) ||
    "";

  // Resolve the MR for department + per-item requested quantities.
  let department = "";
  const requestedByCode = new Map<string, number>();
  if (mrName) {
    try {
      const mr = await getMaterialRequest(mrName);
      department = (
        (mr as any).custom_department ||
        (mr as any).department ||
        ""
      ).trim();
      for (const line of mr.items ?? []) {
        requestedByCode.set(
          line.item_code,
          (requestedByCode.get(line.item_code) ?? 0) + (Number(line.qty) || 0),
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[getMaterialIssueDetail] Could not fetch linked MR:", err);
    }
  }

  const nameByEmail = await fetchUserNames([se.owner as string]);

  const detailItems: MaterialIssueDetailItem[] = items.map((it) => {
    const issued = Number(it.qty) || 0;
    const requested = requestedByCode.has(it.item_code)
      ? requestedByCode.get(it.item_code) ?? null
      : null;
    const remaining =
      requested == null ? null : Math.max(0, requested - issued);
    return {
      item_code: it.item_code,
      item_name: it.item_name || it.item_code,
      uom: it.uom || it.stock_uom || "Nos",
      requested_qty: requested,
      issued_qty: issued,
      remaining_qty: remaining,
      warehouse: it.s_warehouse || se.from_warehouse || "",
    };
  });

  const totalIssued = detailItems.reduce((s, i) => s + i.issued_qty, 0);
  const totalRequested = detailItems.reduce(
    (s, i) => s + (i.requested_qty ?? 0),
    0,
  );
  let status: MaterialIssueStatus;
  if (se.docstatus === 2) {
    status = "Cancelled";
  } else if (totalRequested > 0 && totalIssued < totalRequested) {
    status = "Partially Issued";
  } else {
    status = "Fully Issued";
  }

  const warehouse =
    detailItems.find((i) => i.warehouse)?.warehouse || se.from_warehouse || "";

  return {
    name: se.name,
    mr_name: mrName,
    department,
    warehouse,
    issued_by: resolveIssuerName(se.owner, nameByEmail),
    issue_date: se.posting_date || "",
    status,
    remarks: cleanIssueRemarks(se.remarks),
    stock_entry_number: se.name,
    items: detailItems,
  };
}

/** Never throws — any failure (incl. 403) resolves to an empty list so the
 *  "Forwarded to Procurement" widget renders empty instead of blocking the
 *  rest of the dashboard. Note: this only reads Material Request fields
 *  (custom_linked_rfq is a plain string field) — it never calls the RFQ API. */
export async function getForwardedRequests(): Promise<WarehouseForwardedRequest[]> {
  try {
    const forwarded = await listMaterialRequestsWorkflow({
      workflowStatus: "Forwarded to Procurement",
      limit: 100,
    });

    return forwarded.map((mr) => {
      const rfqId = mr.custom_linked_rfq || (mr.remarks ? mr.remarks.match(/\[BidSphere RFQ:([^\]]+)\]/)?.[1]?.trim() : undefined);
      return {
        name: mr.name,
        department: mr.custom_department || mr.department || "General",
        forwarded_date: mr.modified?.split("T")[0] || mr.transaction_date || "",
        forwarded_at: mr.modified || mr.transaction_date || "",
        forwarded_by: mr.custom_requested_by || mr.owner || "System",
        rfq_status: rfqId ? ("RFQ Sent" as const) : ("Pending RFQ" as const),
        rfq_id: rfqId,
      };
    });
  } catch (err) {
    logWidgetFailure("Procurement Required", err);
    return [];
  }
}

export async function issueMaterial(
  mrNumber: string,
  type: "full" | "partial"
): Promise<{ success: boolean; issueNumber: string }> {
  const res = await issueMaterialRequest(mrNumber, { partial: type === "partial" });
  return { success: true, issueNumber: res.stock_entry };
}

export async function forwardToProcurement(
  mrNumber: string,
  forwardedBy?: string
): Promise<{ success: boolean }> {
  // eslint-disable-next-line no-console
  console.log(`[Warehouse] Forwarding MR ${mrNumber}`, { forwardedBy });
  // Persist to ERPNext (single source of truth) — no local/mock state.
  await forwardMaterialRequestToProcurement(mrNumber, undefined, {
    forwardedBy,
  });
  // eslint-disable-next-line no-console
  console.log("[Warehouse] ERP Update Success", { mr: mrNumber });
  return { success: true };
}

/**
 * Invalidate every cache a forward-to-procurement affects so the request leaves
 * the warehouse queue and appears in the Procurement queue/dashboard without a
 * manual refresh. Prefixes cover the warehouse dashboard + View All
 * (["warehouse", …]), the shared procurement queue (["mr-procurement-queue"]),
 * the procurement/admin dashboards (["dashboard-counts"], ["dashboard-analytics"]),
 * and the MR workflow lists (["material-requests-workflow"]).
 */
export function invalidateForwardCaches(queryClient: QueryClient): void {
  for (const key of [
    ["warehouse"],
    ["mr-procurement-queue"],
    ["mr-forwarded-history"],
    ["dashboard-counts"],
    ["dashboard-analytics"],
    ["material-requests-workflow"],
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

export async function rejectMaterialRequest(
  mrNumber: string,
  remarks: string
): Promise<{ success: boolean }> {
  await rejectMaterialRequestWorkflow(mrNumber, remarks);
  return { success: true };
}

/* ─── Shared dashboard/list selectors (single source of truth) ───────────────
 * The Warehouse Dashboard "Ready to Issue" / "Procurement Required" cards AND
 * their "View All" pages derive from the SAME `getPendingMaterialRequests`
 * dataset (query key ["warehouse","pending-requests"]) through these selectors,
 * so a card and its list page can never disagree.
 * ─────────────────────────────────────────────────────────────────────────── */

export interface ReadyToIssueRow {
  name: string;
  department: string;
  warehouse: string;
  totalItems: number;
  /** Total quantity fully in stock and ready to issue. */
  readyQty: number;
  uom: string;
  requiredDate: string;
  priority: string;
  procurementType: MaterialRequestProcurementType;
}

export interface ProcurementRequiredRow {
  name: string;
  department: string;
  requiredDate: string;
  priority: string;
  /** Number of item lines that are short (partial or out of stock). */
  missingItems: number;
  /** Total quantity to procure (Σ required − available). */
  requiredQty: number;
  uom: string;
  procurementType: MaterialRequestProcurementType;
}

/**
 * READY TO ISSUE — Direct MRs whose warehouse review is done and EVERY line is
 * fully in stock (available ≥ required), not yet issued.
 */
export function selectReadyToIssueRows(
  pending: WarehouseMaterialRequest[]
): ReadyToIssueRow[] {
  return pending
    .filter((mr) => {
      if (mr.procurement_type !== "Direct") return false;
      // A frozen shortage decision (or an already-forwarded MR) must never
      // show up as "ready to issue", even if a stale computation looks clean.
      if (
        mr.status === "Procurement Required" ||
        mr.status === "Forwarded to Procurement" ||
        mr.status === "RFQ Created"
      ) {
        return false;
      }
      const items = mr.items ?? [];
      if (items.length === 0) return false;
      const hasDemand = items.some((i) => i.required_qty > 0);
      const allInStock = items.every((i) => i.available_qty >= i.required_qty);
      return hasDemand && allInStock;
    })
    .map((mr) => {
      const items = mr.items ?? [];
      const readyQty = items.reduce(
        (acc, i) => acc + Math.min(i.available_qty, i.required_qty),
        0
      );
      return {
        name: mr.name,
        department: mr.department || "—",
        warehouse: items.find((i) => i.warehouse)?.warehouse || "—",
        totalItems: mr.items_count || items.length,
        readyQty,
        uom: items[0]?.uom || "Nos",
        requiredDate: mr.required_date || "",
        priority: mr.priority || "Medium",
        procurementType: mr.procurement_type,
      };
    });
}

/**
 * PROCUREMENT REQUIRED — Direct MRs the warehouse has reviewed whose stock is
 * insufficient (≥1 short line) and that have NOT yet been forwarded. Feed this
 * BOTH `getPendingMaterialRequests()` (live-inferred shortages on MRs still
 * "Under Warehouse Review") AND `getWarehouseProcurementRequiredRequests()`
 * (legacy persisted "Procurement Required" records) concatenated together —
 * awaiting Stock Decision / Confirm & Process (not a separate Send action).
 */
export function selectProcurementRequiredRows(
  pending: WarehouseMaterialRequest[]
): ProcurementRequiredRow[] {
  return pending
    .filter((mr) => {
      if (mr.procurement_type !== "Direct") return false;
      // Already handed to Procurement — leave the warehouse queue.
      if (
        mr.status === "Forwarded to Procurement" ||
        mr.status === "RFQ Created"
      ) {
        return false;
      }
      // Legacy shortage-recorded (pre single-step forward) — still warehouse-owned.
      if (mr.status === "Procurement Required") return true;
      const items = mr.items ?? [];
      if (items.length === 0) return false;
      const hasDemand = items.some((i) => i.required_qty > 0);
      const anyShort = items.some((i) => i.available_qty < i.required_qty);
      return hasDemand && anyShort;
    })
    .map((mr) => {
      const items = mr.items ?? [];
      const shortLines = items.filter((i) => i.available_qty < i.required_qty);
      const requiredQty = shortLines.reduce(
        (acc, i) => acc + Math.max(0, i.required_qty - i.available_qty),
        0
      );
      return {
        name: mr.name,
        department: mr.department || "—",
        requiredDate: mr.required_date || "",
        priority: mr.priority || "Medium",
        missingItems: shortLines.length,
        requiredQty,
        uom: items[0]?.uom || "Nos",
        procurementType: mr.procurement_type,
      };
    })
    .sort((a, b) => a.requiredDate.localeCompare(b.requiredDate));
}

// Keep stubs for local testing controls so we don't break anything expecting them
export type MockStateMode = "success" | "empty" | "loading" | "error";
export function getMockStateMode(): MockStateMode {
  return "success";
}
export function setMockStateMode(_mode: MockStateMode) {}
export function resetMockData() {}

export interface ItemStockBreakdownRow {
  warehouse: string;
  available_qty: number;
  reserved_qty: number;
  reorder_level: number;
}

export async function getItemStockBreakdown(itemCode: string): Promise<ItemStockBreakdownRow[]> {
  try {
    // Fetch Netlink warehouses first to prevent cross-company stock data leak
    const list = await apiGet<any[]>("/api/resource/Warehouse", {
      params: {
        filters: JSON.stringify([
          ["company", "=", COMPANY],
          ["is_group", "=", 0],
          ["disabled", "=", 0],
        ]),
        fields: JSON.stringify(["name"]),
        limit_page_length: 500,
      },
    });
    const netlinkWhNames = Array.isArray(list) ? list.map((w) => w.name) : [];
    if (netlinkWhNames.length === 0) return [];

    const bins = await apiGet<any[]>(
      buildResourceUrl("Bin"),
      {
        ...buildListConfig({
          fields: ["warehouse", "actual_qty", "reserved_qty"],
          filters: [
            ["item_code", "=", itemCode],
            ["warehouse", "in", netlinkWhNames],
          ],
          limit_page_length: 50,
        }),
        timeout: 5000,
      }
    );

    return bins.map((bin) => ({
      warehouse: bin.warehouse,
      available_qty: bin.actual_qty ?? 0,
      reserved_qty: bin.reserved_qty ?? 0,
      reorder_level: 0,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to fetch stock breakdown for ${itemCode}`, err);
    throw err;
  }
}
