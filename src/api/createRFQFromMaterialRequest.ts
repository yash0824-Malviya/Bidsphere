/**
 * Create RFQ from Material Request — independent integration layer.
 *
 * Does NOT modify createRFQ() in sourcing.ts. Uses the same frappe.client.save
 * pattern with material_request / material_request_item linkage on item rows.
 */

import { apiGet, apiPost, buildListConfig, buildResourceUrl, COMPANY } from "./erpnext";
import {
  extractSourceDepartmentMrName,
  fetchMaterialRequestWorkflow,
  getLinkedRfqName,
  getMaterialRequestWorkflowStatus,
  markMaterialRequestRfqCreated,
  parseForwardedItemsFromMr,
} from "./materialRequestWorkflow";
import { findActiveRfqForMaterialRequest } from "./mrRfqAction";
import type { EngineeringAttachment } from "../utils/materialRequestItemFiles";
import { disableServerScriptsFor, lookupDefaultWarehouse } from "./sourcing";
import { assertSuppliersActive } from "./supplier";
import type { MaterialRequestWorkflowRecord } from "./materialRequestWorkflow";
import type { RequestForQuotation } from "../types/erpnext";
import { assertERPNextDate, todayERPNextDate } from "../utils/erpNextDate";
import {
  engineeringCustomFieldsForErp,
  hydrateEngineeringDocsFromChild,
  type EngineeringDocs,
} from "../utils/materialRequestItemFiles";
import type { MaterialRequestItem } from "../types/erpnext";
import { assertProcurementTypeCategory } from "../config/procurementCategory";
import {
  MR_PROCUREMENT_CATEGORY_FIELD,
  MR_PROCUREMENT_TYPE_FIELD,
  resolveProcurementCategory,
  resolveProcurementType,
  type MaterialRequestProcurementType,
} from "../types/materialRequestWorkflow";
import {
  buildWarehouseReviewSummary,
  stripAllBidSphereMetadata,
  type WarehouseReviewSummary,
} from "../utils/warehouseReviewSummary";
import { resolveStockUomFromItem } from "../utils/itemMasterUom";

const RFQ_DOCTYPE = "Request for Quotation";
const RFQ_ITEM_DOCTYPE = "Request for Quotation Item";
const RFQ_SUPPLIER_DOCTYPE = "Request for Quotation Supplier";

/** Thrown when create is blocked by an existing active RFQ for the MR. */
export class ActiveRfqExistsError extends Error {
  readonly rfqName: string;
  constructor(rfqName: string) {
    super(
      `An RFQ already exists for this Material Request (${rfqName}). Open that RFQ instead of creating a duplicate.`,
    );
    this.name = "ActiveRfqExistsError";
    this.rfqName = rfqName;
  }
}

export interface CreateRFQFromMaterialRequestInput {
  material_request: string;
  suppliers: Array<{ supplier: string; supplier_name?: string }>;
  transaction_date?: string;
  message_for_supplier?: string;
  company?: string;
  procurement_remarks?: string;
  /**
   * Optional per-item Procurement Final Qty overrides from the New RFQ wizard.
   * When set, RFQ Item.qty and custom_procurement_final_qty use these values.
   */
  item_qty_overrides?: Array<{
    item_code: string;
    procurement_final_qty: number;
    qty_change_reason?: string | null;
  }>;
  /**
   * Procurement-added RFQ lines (no Material Request linkage).
   * Appended after inherited MR items on create.
   */
  additional_items?: Array<{
    item_code: string;
    item_name?: string;
    description?: string;
    qty: number;
    uom?: string;
    schedule_date?: string;
    primary_uom?: string;
    uom_conversion_factor?: number;
    custom_part_name?: string;
    custom_2d_drawing?: string;
    custom_engineering_attachments?: string;
    custom_department_requested_qty?: number;
    custom_procurement_final_qty?: number;
    custom_qty_change_reason?: string | null;
  }>;
}

/**
 * Strip BidSphere internal workflow tags from free-text so raw JSON never
 * leaks into supplier-facing or user-visible fields.
 */
export function stripInternalMetadata(text?: string | null): string {
  return stripAllBidSphereMetadata(text);
}

export interface RFQFromMaterialRequestPrefill {
  material_request: string;
  company: string;
  /** Inherited procurement type from MR (read-only in RFQ wizard). */
  procurement_type?: MaterialRequestProcurementType;
  /** Inherited procurement category from MR (read-only in RFQ wizard). */
  procurement_category?: string;
  /** Human, supplier-safe department name (custom field, then standard). */
  department?: string;
  priority?: string;
  /** Cleaned request purpose (no internal tags/JSON). */
  purpose?: string;
  /** Cleaned warehouse remarks for display only (no internal tags/JSON). */
  warehouse_remarks?: string;
  /** Structured warehouse review summary for Procurement UI. */
  warehouse_review_summary?: WarehouseReviewSummary;
  /** Original requester on the Material Request. */
  requested_by?: string;
  message_for_supplier: string;
  transaction_date: string;
  items: Array<{
    item_code: string;
    item_name?: string;
    item_group?: string;
    description?: string;
    qty: number;
    /** Department original request (from MR Item.qty / ForwardedItems.requested_qty). */
    department_requested_qty?: number;
    /** Warehouse available at forward (from ForwardedItems.available_qty). */
    warehouse_available_qty?: number | null;
    uom?: string;
    warehouse?: string;
    schedule_date?: string;
    material_request: string;
    material_request_item?: string;
    custom_part_name?: string;
    custom_2d_drawing?: string;
    custom_engineering_attachments?: string;
    /** Hydrated URL refs for Step 2 UI (same File URLs as Department MR). */
    attachments?: EngineeringAttachment[];
    /** Primary attachment convenience fields (first of `attachments`). */
    attachment_name?: string;
    attachment_url?: string;
    attachment_type?: string;
  }>;
}

/** Build RFQ prefill data for New RFQ wizard (?mr=MAT-MR-...) */
export async function buildRFQPrefillFromMaterialRequest(
  mrName: string
): Promise<RFQFromMaterialRequestPrefill> {
  const mr = await fetchMaterialRequestWorkflow(mrName);
  const company = mr.company || COMPANY;
  const today = todayERPNextDate();
  const warehouse = await lookupDefaultWarehouse(company);

  const forwardedItems = parseForwardedItemsFromMr(mr);

  // Warehouse "Forward to Procurement" creates a Purchase MR whose items often
  // lacked engineering fields. Resolve the Department source MR and use its
  // item attachments (URL refs only) when the Purchase MR row is empty.
  const sourceMrName = extractSourceDepartmentMrName(mr);
  let sourceItemsByCode = new Map<string, MaterialRequestItem>();
  if (sourceMrName && sourceMrName !== mr.name) {
    try {
      const sourceMr = await fetchMaterialRequestWorkflow(sourceMrName);
      for (const it of sourceMr.items ?? []) {
        if (it.item_code) sourceItemsByCode.set(it.item_code, it);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          "[RFQ Prefill] Could not load source Department MR for attachments:",
          sourceMrName,
          err,
        );
      }
      sourceItemsByCode = new Map();
    }
  }

  // Hydrate engineering docs from MR Item JSON + File DocType (URL refs only).
  async function engBundleForMrItem(
    mrItem: (typeof mr.items)[number] | undefined,
    itemCode?: string,
  ): Promise<{
    erp: ReturnType<typeof engineeringCustomFieldsForErp>;
    hydrated: EngineeringDocs;
  }> {
    let hydrated: EngineeringDocs = { attachments: [] };
    if (mrItem) {
      hydrated = await hydrateEngineeringDocsFromChild(mrItem);
    }
    if (
      hydrated.attachments.length === 0 &&
      itemCode &&
      sourceItemsByCode.has(itemCode)
    ) {
      hydrated = await hydrateEngineeringDocsFromChild(
        sourceItemsByCode.get(itemCode),
      );
    }
    const erp = engineeringCustomFieldsForErp({
      ...(mrItem ?? {}),
      part_name: hydrated.part_name ?? mrItem?.custom_part_name,
      drawing_2d_url: hydrated.drawing_2d_url ?? mrItem?.custom_2d_drawing,
      attachments: hydrated.attachments,
    });
    return { erp, hydrated };
  }

  function attachmentAliases(hydrated: EngineeringDocs) {
    const first = hydrated.attachments[0];
    if (!first) return {};
    return {
      attachments: hydrated.attachments,
      attachment_name: first.fileName,
      attachment_url: first.fileUrl,
      attachment_type: first.fileType,
    };
  }

  const rawItems =
    forwardedItems.length > 0
      ? await Promise.all(
          forwardedItems
            .filter((fi) => (fi.forward_qty ?? fi.shortage_qty ?? 0) > 0)
            .map(async (fi) => {
              const mrItem = (mr.items ?? []).find(
                (i) => i.item_code === fi.item_code,
              );
              const { erp, hydrated } = await engBundleForMrItem(
                mrItem,
                fi.item_code,
              );
              const deptQty =
                Number(fi.requested_qty) ||
                Number(mrItem?.custom_department_requested_qty) ||
                Number(mrItem?.qty) ||
                1;
              const whAvail =
                fi.available_qty != null && Number.isFinite(Number(fi.available_qty))
                  ? Number(fi.available_qty)
                  : mrItem?.custom_warehouse_available_qty != null
                    ? Number(mrItem.custom_warehouse_available_qty)
                    : null;
              const finalQty =
                fi.forward_qty ??
                fi.shortage_qty ??
                deptQty;
              return {
                item_code: fi.item_code,
                item_name: fi.item_name || fi.item_code,
                description:
                  mrItem?.description || fi.item_name || fi.item_code,
                qty: finalQty,
                department_requested_qty: deptQty,
                warehouse_available_qty: whAvail,
                uom:
                  resolveStockUomFromItem(fi.uom) ||
                  resolveStockUomFromItem(mrItem?.uom),
                warehouse: fi.warehouse || mrItem?.warehouse || warehouse,
                schedule_date:
                  mrItem?.schedule_date || mr.schedule_date || today,
                material_request: mr.name,
                material_request_item: mrItem?.name,
                ...erp,
                ...attachmentAliases(hydrated),
              };
            }),
        )
      : await Promise.all(
          (mr.items ?? []).map(async (row) => {
            const { erp, hydrated } = await engBundleForMrItem(
              row,
              row.item_code,
            );
            const deptQty =
              Number(row.custom_department_requested_qty) ||
              Number(row.qty) ||
              1;
            return {
              item_code: row.item_code,
              item_name: row.item_name,
              description: row.description,
              qty: deptQty,
              department_requested_qty: deptQty,
              warehouse_available_qty:
                row.custom_warehouse_available_qty != null
                  ? Number(row.custom_warehouse_available_qty)
                  : null,
              uom: resolveStockUomFromItem(row.uom),
              warehouse: row.warehouse || warehouse,
              schedule_date: row.schedule_date || mr.schedule_date || today,
              material_request: mr.name,
              material_request_item: row.name,
              ...erp,
              ...attachmentAliases(hydrated),
            };
          }),
        );

  // Fetch Item master records from ERPNext in bulk to resolve item_group
  const itemCodes = Array.from(new Set(rawItems.map((i) => i.item_code).filter(Boolean)));
  const itemMasterMap = new Map<
    string,
    { item_group?: string; item_name?: string; description?: string; stock_uom?: string }
  >();

  if (itemCodes.length > 0) {
    try {
      const itemRows = await apiGet<
        Array<{
          name: string;
          item_code?: string;
          item_group?: string;
          item_name?: string;
          description?: string;
          stock_uom?: string;
        }>
      >(
        buildResourceUrl("Item"),
        buildListConfig({
          fields: ["name", "item_code", "item_group", "item_name", "description", "stock_uom"],
          // Filter by `item_code`, NOT `name` — ERPNext's Item DocType is only
          // named after `item_code` when "Item Naming By" is set to that
          // field; on installs using a naming series/autoname this filter
          // would silently match nothing and leave item_group unresolved.
          filters: [["item_code", "in", itemCodes]],
          limit_page_length: itemCodes.length,
        })
      );
      for (const row of itemRows ?? []) {
        const code = row.item_code || row.name;
        if (code) itemMasterMap.set(code, row);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("[RFQ Prefill] Warning: Failed to fetch Item master records in bulk:", err);
      }
    }
  }

  const items = rawItems.map((row) => {
    const master = itemMasterMap.get(row.item_code);
    let item_group = master?.item_group?.trim();
    if (!item_group) {
      // eslint-disable-next-line no-console
      console.warn(
        `[RFQ Prefill] Warning: Item Group not found for Item Code "${row.item_code}". Defaulting to "Unknown".`
      );
      item_group = "Unknown";
    }

    return {
      ...row,
      item_group,
      item_name: row.item_name || master?.item_name || row.item_code,
      description: row.description || master?.description || row.item_name || row.item_code,
      uom:
        resolveStockUomFromItem(row.uom) ||
        resolveStockUomFromItem(master?.stock_uom),
    };
  });

  const purposeClean = stripInternalMetadata(mr.custom_purpose);
  const rawWarehouseRemarks = mr.custom_warehouse_remarks || mr.remarks || "";
  const warehouseRemarksClean = stripInternalMetadata(rawWarehouseRemarks);
  const warehouseReviewSummary = buildWarehouseReviewSummary(rawWarehouseRemarks, {
    forwarded_by: mr.custom_forwarded_by,
    forwarded_on: mr.custom_forwarded_on || mr.modified,
    mr_items: mr.items,
    material_request: mr.name,
  });

  return {
    material_request: mr.name,
    company,
    procurement_type: resolveProcurementType(mr[MR_PROCUREMENT_TYPE_FIELD]),
    procurement_category: resolveProcurementCategory(
      mr[MR_PROCUREMENT_CATEGORY_FIELD],
    ),
    department: mr.custom_department || mr.department || "",
    priority: mr.custom_priority || "",
    purpose: purposeClean,
    warehouse_remarks: warehouseRemarksClean,
    warehouse_review_summary: warehouseReviewSummary,
    requested_by: mr.custom_requested_by || mr.owner || "",
    transaction_date: today,
    // Supplier-facing default — clean, professional, never internal JSON.
    message_for_supplier: [
      `This Request for Quotation covers the items listed below. Please submit your best pricing and lead times.`,
      purposeClean ? `Purpose: ${purposeClean}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    items,
  };
}

/**
 * Create RFQ from a forwarded Material Request and link item rows.
 * Procurement must call this manually — never auto-created on forward.
 */
export async function createRFQFromMaterialRequest(
  input: CreateRFQFromMaterialRequestInput
): Promise<RequestForQuotation> {
  const mr = await fetchMaterialRequestWorkflow(input.material_request);
  const status = getMaterialRequestWorkflowStatus(mr);

  // Hard stop: one MR → one *active* RFQ. Cancelled / Rejected RFQs do not block.
  const existingActiveRfq = await findActiveRfqForMaterialRequest(mr.name, mr);
  if (existingActiveRfq) {
    throw new ActiveRfqExistsError(existingActiveRfq);
  }
  // "RFQ Created" with only inactive RFQs may recreate; otherwise require Forwarded.
  if (
    status !== "Forwarded to Procurement" &&
    status !== "RFQ Created"
  ) {
    throw new Error(
      `Material Request ${mr.name} must be in "Forwarded to Procurement" status before creating an RFQ.`,
    );
  }
  if (!input.suppliers?.length) {
    throw new Error("Select at least one supplier for the RFQ.");
  }

  await disableServerScriptsFor(RFQ_DOCTYPE);
  await assertSuppliersActive(input.suppliers.map((s) => s.supplier));

  const prefill = await buildRFQPrefillFromMaterialRequest(mr.name);
  if (prefill.procurement_type && prefill.procurement_category) {
    assertProcurementTypeCategory(
      prefill.procurement_type,
      prefill.procurement_category,
    );
  }
  const transactionDate = input.transaction_date
    ? assertERPNextDate(input.transaction_date, "transaction_date")
    : prefill.transaction_date;
  const company = input.company || prefill.company;
  const warehouse = await lookupDefaultWarehouse(company);

  const overrideByCode = new Map(
    (input.item_qty_overrides ?? []).map((o) => [
      o.item_code,
      o,
    ] as const),
  );

  const inheritedRows = prefill.items.map((item) => {
      const override = overrideByCode.get(item.item_code);
      const dept =
        Number(item.department_requested_qty) || Number(item.qty) || 1;
      const finalQty =
        override?.procurement_final_qty != null &&
        Number(override.procurement_final_qty) > 0
          ? Number(override.procurement_final_qty)
          : Number(item.qty) || dept;
      const wh =
        item.warehouse_available_qty != null &&
        Number.isFinite(Number(item.warehouse_available_qty))
          ? Number(item.warehouse_available_qty)
          : null;
      const changed = Math.abs(dept - finalQty) > 1e-9;
      return {
        doctype: RFQ_ITEM_DOCTYPE,
        item_code: item.item_code,
        item_name: item.item_name || item.item_code,
        description: item.description || item.item_name || item.item_code,
        qty: finalQty,
        uom: resolveStockUomFromItem(item.uom) || undefined,
        stock_uom: resolveStockUomFromItem(item.uom) || undefined,
        conversion_factor: 1,
        warehouse: item.warehouse,
        schedule_date: item.schedule_date
          ? assertERPNextDate(item.schedule_date, "schedule_date")
          : transactionDate,
        material_request: item.material_request,
        material_request_item: item.material_request_item,
        purchase_requisition: item.material_request,
        purchase_requisition_item: item.material_request_item,
        custom_department_requested_qty: dept,
        custom_warehouse_available_qty: wh,
        custom_procurement_final_qty: finalQty,
        custom_qty_change_reason: changed
          ? String(override?.qty_change_reason || "").trim() || null
          : null,
        ...engineeringCustomFieldsForErp(item),
      };
    });

  const additionalRows = (input.additional_items ?? []).map((item) => {
    const qty = Number(item.qty) || 1;
    const uom = resolveStockUomFromItem(item.uom);
    const primaryUom =
      resolveStockUomFromItem(item.primary_uom) || uom;
    const conversionFactor =
      item.uom_conversion_factor != null &&
      Number.isFinite(Number(item.uom_conversion_factor)) &&
      Number(item.uom_conversion_factor) > 0
        ? Number(item.uom_conversion_factor)
        : 1;
    const dept =
      item.custom_department_requested_qty != null &&
      Number.isFinite(Number(item.custom_department_requested_qty))
        ? Number(item.custom_department_requested_qty)
        : qty;
    const finalQty =
      item.custom_procurement_final_qty != null &&
      Number.isFinite(Number(item.custom_procurement_final_qty))
        ? Number(item.custom_procurement_final_qty)
        : qty;
    const changed = Math.abs(dept - finalQty) > 1e-9;
    const row: Record<string, unknown> = {
      doctype: RFQ_ITEM_DOCTYPE,
      item_code: item.item_code,
      item_name: item.item_name || item.item_code,
      description: item.description || item.item_name || item.item_code,
      qty: finalQty,
      uom,
      stock_uom: primaryUom,
      conversion_factor: conversionFactor,
      warehouse,
      schedule_date: item.schedule_date
        ? assertERPNextDate(item.schedule_date, "schedule_date")
        : transactionDate,
      custom_department_requested_qty: dept,
      custom_procurement_final_qty: finalQty,
      custom_qty_change_reason: changed
        ? String(item.custom_qty_change_reason || "").trim() || null
        : null,
    };
    if (item.custom_part_name?.trim()) {
      row.custom_part_name = item.custom_part_name.trim();
    }
    if (item.custom_2d_drawing?.trim()) {
      row.custom_2d_drawing = item.custom_2d_drawing.trim();
    }
    if (item.custom_engineering_attachments?.trim()) {
      row.custom_engineering_attachments =
        item.custom_engineering_attachments.trim();
    }
    return row;
  });

  const doc: Record<string, unknown> = {
    doctype: RFQ_DOCTYPE,
    transaction_date: transactionDate,
    status: "Draft",
    company,
    message_for_supplier:
      input.message_for_supplier || prefill.message_for_supplier,
    items: [...inheritedRows, ...additionalRows],
    suppliers: input.suppliers.map((s) => ({
      doctype: RFQ_SUPPLIER_DOCTYPE,
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    })),
  };
  if (prefill.procurement_type) {
    doc.custom_procurement_type = prefill.procurement_type;
  }
  if (prefill.procurement_category) {
    doc.custom_procurement_category = prefill.procurement_category;
  }

  const created = await apiPost<RequestForQuotation>(
    "/api/method/frappe.client.save",
    { doc }
  );

  await markMaterialRequestRfqCreated(
    mr.name,
    created.name,
    input.procurement_remarks
  );

  return created;
}

/**
 * Sync UI gate (may be stale if linked RFQ was cancelled).
 * Prefer {@link canCreateRfqFromMaterialRequestAsync} when possible.
 */
export function canCreateRfqFromMaterialRequest(
  mr: MaterialRequestWorkflowRecord
): boolean {
  if (getLinkedRfqName(mr)) return false;
  const status = getMaterialRequestWorkflowStatus(mr);
  if (status === "RFQ Created") return false;
  return status === "Forwarded to Procurement";
}

/** Authoritative create-eligibility check (active RFQ only blocks). */
export async function canCreateRfqFromMaterialRequestAsync(
  mr: MaterialRequestWorkflowRecord,
): Promise<boolean> {
  const active = await findActiveRfqForMaterialRequest(mr.name, mr);
  if (active) return false;
  const status = getMaterialRequestWorkflowStatus(mr);
  return status === "Forwarded to Procurement" || status === "RFQ Created";
}
