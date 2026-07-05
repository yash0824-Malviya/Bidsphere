/**
 * Create RFQ from Material Request — independent integration layer.
 *
 * Does NOT modify createRFQ() in sourcing.ts. Uses the same frappe.client.save
 * pattern with material_request / material_request_item linkage on item rows.
 */

import { apiGet, apiPost, buildListConfig, buildResourceUrl, COMPANY } from "./erpnext";
import {
  fetchMaterialRequestWorkflow,
  getMaterialRequestWorkflowStatus,
  markMaterialRequestRfqCreated,
  parseForwardedItemsFromMr,
} from "./materialRequestWorkflow";
import { disableServerScriptsFor, lookupDefaultWarehouse } from "./sourcing";
import { assertSuppliersActive } from "./supplier";
import type { MaterialRequestWorkflowRecord } from "./materialRequestWorkflow";
import type { RequestForQuotation } from "../types/erpnext";
import { assertERPNextDate, todayERPNextDate } from "../utils/erpNextDate";

const RFQ_DOCTYPE = "Request for Quotation";
const RFQ_ITEM_DOCTYPE = "Request for Quotation Item";
const RFQ_SUPPLIER_DOCTYPE = "Request for Quotation Supplier";

export interface CreateRFQFromMaterialRequestInput {
  material_request: string;
  suppliers: Array<{ supplier: string; supplier_name?: string }>;
  transaction_date?: string;
  message_for_supplier?: string;
  company?: string;
  procurement_remarks?: string;
}

/**
 * Strip BidSphere internal workflow tags and any serialized JSON payloads from
 * free-text so nothing internal (or raw JSON) ever leaks into a supplier-facing
 * message or a user-visible field.
 *
 * Removes:
 *  - `[BidSphere:ForwardedItems:[ ...json... ]]` (nested JSON array)
 *  - `[BidSphere:PartialIssue:...]`, `[BidSphere RFQ:...]` and similar tags
 */
export function stripInternalMetadata(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/\[BidSphere:ForwardedItems:\[[\s\S]*?\]\]/g, "")
    .replace(/\[BidSphere[^[\]]*\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface RFQFromMaterialRequestPrefill {
  material_request: string;
  company: string;
  /** Human, supplier-safe department name (custom field, then standard). */
  department?: string;
  priority?: string;
  /** Cleaned request purpose (no internal tags/JSON). */
  purpose?: string;
  /** Cleaned warehouse remarks for display only (no internal tags/JSON). */
  warehouse_remarks?: string;
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
    uom?: string;
    warehouse?: string;
    schedule_date?: string;
    material_request: string;
    material_request_item?: string;
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
  const rawItems =
    forwardedItems.length > 0
      ? forwardedItems
          .filter((fi) => (fi.forward_qty ?? fi.shortage_qty ?? 0) > 0)
          .map((fi) => {
            const mrItem = (mr.items ?? []).find(
              (i) => i.item_code === fi.item_code,
            );
            return {
              item_code: fi.item_code,
              item_name: fi.item_name || fi.item_code,
              description:
                mrItem?.description || fi.item_name || fi.item_code,
              qty: fi.forward_qty ?? fi.shortage_qty ?? (Number(mrItem?.qty) || 1),
              uom: fi.uom || mrItem?.uom || "Nos",
              warehouse: fi.warehouse || mrItem?.warehouse || warehouse,
              schedule_date:
                mrItem?.schedule_date || mr.schedule_date || today,
              material_request: mr.name,
              material_request_item: mrItem?.name,
            };
          })
      : (mr.items ?? []).map((row) => ({
          item_code: row.item_code,
          item_name: row.item_name,
          description: row.description,
          qty: Number(row.qty) || 1,
          uom: row.uom || "Nos",
          warehouse: row.warehouse || warehouse,
          schedule_date: row.schedule_date || mr.schedule_date || today,
          material_request: mr.name,
          material_request_item: row.name,
        }));

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
      uom: row.uom || master?.stock_uom || "Nos",
    };
  });

  const purposeClean = stripInternalMetadata(mr.custom_purpose);
  const warehouseRemarksClean = stripInternalMetadata(
    mr.custom_warehouse_remarks || mr.remarks,
  );

  return {
    material_request: mr.name,
    company,
    department: mr.custom_department || mr.department || "",
    priority: mr.custom_priority || "",
    purpose: purposeClean,
    warehouse_remarks: warehouseRemarksClean,
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
  if (
    status !== "Procurement Required" &&
    status !== "RFQ Created"
  ) {
    throw new Error(
      `Material Request ${mr.name} must be in "Procurement Required" status before creating an RFQ.`
    );
  }
  if (!input.suppliers?.length) {
    throw new Error("Select at least one supplier for the RFQ.");
  }

  await disableServerScriptsFor(RFQ_DOCTYPE);
  await assertSuppliersActive(input.suppliers.map((s) => s.supplier));

  const prefill = await buildRFQPrefillFromMaterialRequest(mr.name);
  const transactionDate = input.transaction_date
    ? assertERPNextDate(input.transaction_date, "transaction_date")
    : prefill.transaction_date;

  const doc: Record<string, unknown> = {
    doctype: RFQ_DOCTYPE,
    transaction_date: transactionDate,
    status: "Draft",
    company: input.company || prefill.company,
    message_for_supplier:
      input.message_for_supplier || prefill.message_for_supplier,
    items: prefill.items.map((item) => ({
      doctype: RFQ_ITEM_DOCTYPE,
      item_code: item.item_code,
      item_name: item.item_name || item.item_code,
      description: item.description || item.item_name || item.item_code,
      qty: item.qty,
      uom: item.uom || "Nos",
      stock_uom: item.uom || "Nos",
      conversion_factor: 1,
      warehouse: item.warehouse,
      schedule_date: item.schedule_date
        ? assertERPNextDate(item.schedule_date, "schedule_date")
        : transactionDate,
      material_request: item.material_request,
      material_request_item: item.material_request_item,
      purchase_requisition: item.material_request,
      purchase_requisition_item: item.material_request_item,
    })),
    suppliers: input.suppliers.map((s) => ({
      doctype: RFQ_SUPPLIER_DOCTYPE,
      supplier: s.supplier,
      supplier_name: s.supplier_name || s.supplier,
    })),
  };

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

/** Validate MR is eligible for RFQ creation. */
export function canCreateRfqFromMaterialRequest(
  mr: MaterialRequestWorkflowRecord
): boolean {
  return getMaterialRequestWorkflowStatus(mr) === "Procurement Required";
}
