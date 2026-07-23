/**
 * Warehouse Material Issue — enterprise issue execution.
 *
 * Isolated from Procurement forward / RFQ / PO / GRN paths.
 * Creates ERPNext Stock Entry (Material Issue), updates MR status,
 * and records a Warehouse Review + remarks audit tag.
 */

import { apiGet, apiPost, buildResourceUrl } from "./erpnext";
import {
  nowERPNextDatetime,
  todayERPNextDate,
} from "../utils/erpNextDate";
import {
  checkMaterialRequestStock,
  createWarehouseReview,
  fetchMaterialRequestWorkflow,
  makeStockEntryDraftFromMaterialRequest,
  parseForwardedItemsFromMr,
  updateMaterialRequestWorkflowStatus,
  type MaterialRequestWorkflowRecord,
} from "./materialRequestWorkflow";
import type { MaterialRequestWorkflowStatus } from "../types/materialRequestWorkflow";
import {
  assertMaterialRequestIsWarehouseCompany,
  assertNetlinkWarehouse,
  remapStockEntryDraftToNetlink,
  WAREHOUSE_MODULE_COMPANY,
} from "./warehouseCompany";
import {
  applyCostCentersToStockEntryDoc,
  fetchMrItemCostCenters,
} from "./stockEntryCostCenter";
import {
  composeWarehouseRemarks,
  extractWarehouseMachineTags,
  formatForwardedItemsTag,
  mergeIssuedIntoForwardedItems,
  parseMaterialIssueJsonFromRemarks,
} from "../utils/warehouseIssueFulfillmentSync";

export type StockLineStatus = "Available" | "Partial Stock" | "Out of Stock";
export type IssueType = "Full Issue" | "Partial Issue";
export type ReceiverRole = "Department User" | "Supervisor" | "Operator";

export interface MaterialIssueLineInput {
  item_code: string;
  item_name?: string;
  warehouse?: string;
  uom?: string;
  required_qty: number;
  available_qty: number;
  issue_qty: number;
  remarks?: string;
  batch?: string;
  bin?: string;
}

export interface MaterialIssueAuditMeta {
  created_by: string;
  issue_time: string;
  warehouse: string;
  receiver: string;
  browser: string;
  device: string;
}

export interface ExecuteMaterialIssueInput {
  mrName: string;
  lines: MaterialIssueLineInput[];
  receiver: ReceiverRole;
  remarks?: string;
  issuedBy: string;
  warehouse?: string;
}

export interface ExecuteMaterialIssueResult {
  stock_entry: string;
  issue_type: IssueType;
  mr_status: MaterialRequestWorkflowStatus;
  total_issued: number;
  total_required: number;
  audit: MaterialIssueAuditMeta;
}

const DRAFT_PREFIX = "bidsphere-material-issue-draft:";

export function stockStatusForLine(
  available: number,
  required: number,
): StockLineStatus {
  const avail = Math.max(0, Number(available) || 0);
  const req = Math.max(0, Number(required) || 0);
  if (avail <= 0) return "Out of Stock";
  if (avail < req) return "Partial Stock";
  return "Available";
}

export function resolveIssueType(
  lines: Array<{ required_qty: number; issue_qty: number }>,
): IssueType {
  const anyIssue = lines.some((l) => l.issue_qty > 0);
  const allFull =
    anyIssue &&
    lines.every(
      (l) => l.required_qty <= 0 || l.issue_qty >= l.required_qty - 1e-9,
    );
  return allFull ? "Full Issue" : "Partial Issue";
}

export function validateIssueLines(
  lines: MaterialIssueLineInput[],
): string | null {
  let anyPositive = false;
  for (const line of lines) {
    const issue = Number(line.issue_qty) || 0;
    const avail = Math.max(0, Number(line.available_qty) || 0);
    const req = Math.max(0, Number(line.required_qty) || 0);
    if (issue < 0) {
      return `Issue Qty for ${line.item_code} cannot be negative.`;
    }
    if (issue > avail + 1e-9) {
      return `Issue Qty for ${line.item_code} cannot exceed Available Qty (${avail}).`;
    }
    if (issue > req + 1e-9) {
      return `Issue Qty for ${line.item_code} cannot exceed Required Qty (${req}).`;
    }
    if (issue > 0) anyPositive = true;
  }
  if (!anyPositive) {
    return "Enter Issue Qty for at least one item with available stock.";
  }
  return null;
}

function detectBrowser(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  if (/Firefox\//.test(ua)) return "Mozilla Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Browser";
}

function detectDevice(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Mobi|Android/i.test(ua)) return "Mobile";
  if (/Tablet|iPad/i.test(ua)) return "Tablet";
  return "Desktop";
}

export function buildAuditMeta(input: {
  created_by: string;
  warehouse: string;
  receiver: string;
}): MaterialIssueAuditMeta {
  return {
    created_by: input.created_by,
    issue_time: nowERPNextDatetime(),
    warehouse: input.warehouse || "—",
    receiver: input.receiver,
    browser: detectBrowser(),
    device: detectDevice(),
  };
}

/**
 * Execute a Material Issue for the given MR with per-line issue quantities.
 * Does NOT forward shortages to Procurement.
 */
export async function executeMaterialIssue(
  input: ExecuteMaterialIssueInput,
): Promise<ExecuteMaterialIssueResult> {
  const err = validateIssueLines(input.lines);
  if (err) throw new Error(err);

  const selectedWarehouse = (input.warehouse || "").trim();
  if (!selectedWarehouse || selectedWarehouse === "—") {
    throw new Error(
      'From Warehouse is required. Select a warehouse before issuing material.',
    );
  }

  const issueType = resolveIssueType(input.lines);
  const stockCheck = await checkMaterialRequestStock(input.mrName);
  const qtyByCode = new Map(
    input.lines.map((l) => [l.item_code, Number(l.issue_qty) || 0]),
  );

  // Re-validate against live stock.
  for (const line of input.lines) {
    const live = stockCheck.lines.find((l) => l.item_code === line.item_code);
    const avail = Math.max(
      0,
      Number(live?.available_qty ?? line.available_qty) || 0,
    );
    const issue = qtyByCode.get(line.item_code) ?? 0;
    if (issue > avail + 1e-9) {
      throw new Error(
        `Insufficient live stock for ${line.item_code}. Available: ${avail}.`,
      );
    }
  }

  if (!String(input.mrName || "").trim()) {
    throw new Error(
      "Material Request reference is missing. Stock Entry cannot be created.",
    );
  }

  // Read MR company before mapping so debug logs include company.
  let mrCompany = WAREHOUSE_MODULE_COMPANY;
  try {
    const mrDoc = await apiGet<{ company?: string }>(
      buildResourceUrl("Material Request", input.mrName),
    );
    mrCompany = assertMaterialRequestIsWarehouseCompany(mrDoc?.company);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Company")) throw err;
    mrCompany = assertMaterialRequestIsWarehouseCompany(
      WAREHOUSE_MODULE_COMPANY,
    );
  }

  // eslint-disable-next-line no-console
  console.log("[Material Issue] Confirm Issue payload", {
    material_request: input.mrName,
    company: mrCompany,
    warehouse: selectedWarehouse,
    receiver: input.receiver,
    items: input.lines.map((l) => ({
      item_code: l.item_code,
      required_qty: l.required_qty,
      available_qty: l.available_qty,
      issue_qty: l.issue_qty,
    })),
  });

  const draft = (await makeStockEntryDraftFromMaterialRequest(input.mrName, {
    company: mrCompany,
    warehouse: selectedWarehouse,
    receiver: input.receiver,
    items: input.lines.map((l) => ({
      item_code: l.item_code,
      issue_qty: l.issue_qty,
    })),
  })) as Record<string, unknown> & {
    doctype?: string;
    items?: Array<Record<string, unknown>>;
    remarks?: string;
    from_warehouse?: string;
  };

  if (!Array.isArray(draft.items)) {
    throw new Error("Stock Entry draft has no items.");
  }

  // Force every line to the UI-selected From Warehouse.
  // Never keep ERPNext Item defaults like "Finished Goods - B" (Bidsphere).
  draft.company = mrCompany;

  const adjusted = draft.items
    .map((item) => {
      const code = String(item.item_code || "");
      const issueQty = qtyByCode.get(code) ?? 0;
      if (issueQty <= 0) return null;
      item.qty = issueQty;
      item.transfer_qty = issueQty;
      return item;
    })
    .filter((item): item is Record<string, unknown> => item !== null);

  if (adjusted.length === 0) {
    throw new Error("No items have available stock to issue.");
  }
  draft.items = adjusted;

  const warehouse = await remapStockEntryDraftToNetlink(
    draft,
    qtyByCode,
    selectedWarehouse,
  );

  for (const item of adjusted) {
    await assertNetlinkWarehouse(String(item.s_warehouse || ""), "Source");
    if (String(item.s_warehouse) !== warehouse) {
      throw new Error(
        `Stock Entry line warehouse must be "${warehouse}" (Material Request company ${mrCompany}).`,
      );
    }
  }
  await assertNetlinkWarehouse(warehouse, "Source");

  const audit = buildAuditMeta({
    created_by: input.issuedBy,
    warehouse,
    receiver: input.receiver,
  });

  const auditTag = `[BidSphere:MaterialIssue:${JSON.stringify({
    issue_type: issueType,
    receiver: input.receiver,
    remarks: input.remarks || "",
    audit,
    lines: input.lines.map((l) => ({
      item_code: l.item_code,
      required_qty: l.required_qty,
      issue_qty: l.issue_qty,
      remaining_qty: Math.max(0, l.required_qty - l.issue_qty),
    })),
  })}]`;

  // Merge issued qtys into ForwardedItems so Department fulfillment shows
  // Issued/Remaining correctly (not stale Procurement = Requested).
  let priorMr: MaterialRequestWorkflowRecord | null = null;
  try {
    priorMr = await fetchMaterialRequestWorkflow(input.mrName);
  } catch {
    priorMr = null;
  }
  const existingForwarded = priorMr ? parseForwardedItemsFromMr(priorMr) : [];
  const mergedForwarded = mergeIssuedIntoForwardedItems(
    existingForwarded,
    input.lines.map((l) => ({
      item_code: l.item_code,
      issued_qty: l.issue_qty,
      required_qty: l.required_qty,
    })),
    { warehouse },
  );
  const forwardedTag = formatForwardedItemsTag(mergedForwarded);
  const priorTags = extractWarehouseMachineTags(
    priorMr?.custom_warehouse_remarks ?? priorMr?.remarks ?? "",
  );
  const warehouseRemarks = composeWarehouseRemarks(
    [
      priorTags.prose,
      input.remarks?.trim() || "",
      `Receiver: ${input.receiver}`,
      `Issue Type: ${issueType}`,
    ]
      .filter(Boolean)
      .join("\n"),
    {
      materialIssueTag: auditTag,
      forwardedTag,
      mirTag: priorTags.mirTag,
    },
  );

  draft.remarks = warehouseRemarks;

  // Cost Center must belong to Stock Entry company (never "Main - B" for Netlink).
  const mrCostCenters = await fetchMrItemCostCenters(input.mrName);
  const costCenter = await applyCostCentersToStockEntryDoc(draft, {
    mrItemCostCenters: mrCostCenters,
  });
  // eslint-disable-next-line no-console
  console.log("[Material Issue] before Stock Entry save", {
    company: mrCompany,
    costCenter,
    warehouse,
  });

  let saved: { name?: string } & Record<string, unknown>;
  try {
    saved = await apiPost<{ name?: string } & Record<string, unknown>>(
      "/api/method/frappe.client.save",
      { doc: draft },
    );
  } catch (err) {
    const ax = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    // eslint-disable-next-line no-console
    console.error("[Material Issue] frappe.client.save failed — complete response", {
      material_request: input.mrName,
      status: ax.response?.status,
      completeResponse: ax.response?.data,
      _server_messages: (ax.response?.data as { _server_messages?: unknown })
        ?._server_messages,
      exc: (ax.response?.data as { exc?: unknown })?.exc,
      exception: (ax.response?.data as { exception?: unknown })?.exception,
      message: (ax.response?.data as { message?: unknown })?.message,
      parsedMessage: ax.message,
    });
    throw err;
  }
  const stockEntryName = saved.name;
  if (!stockEntryName) {
    throw new Error("Stock Entry was not created.");
  }

  try {
    await apiPost("/api/method/frappe.client.submit", { doc: saved });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Material Issue] Stock Entry submit ERPNext Error", {
      material_request: input.mrName,
      stock_entry: stockEntryName,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  // eslint-disable-next-line no-console
  console.log("[Material Issue] Stock Entry created", {
    material_request: input.mrName,
    stock_entry: stockEntryName,
    company: mrCompany,
    warehouse: selectedWarehouse,
    receiver: input.receiver,
  });

  const total_required = input.lines.reduce(
    (s, l) => s + (Number(l.required_qty) || 0),
    0,
  );
  const total_issued = input.lines.reduce(
    (s, l) => s + (Number(l.issue_qty) || 0),
    0,
  );
  const remaining = Math.max(0, total_required - total_issued);

  // After Stock Entry: do NOT complete the MR. Full issue moves to
  // Pending Department Acceptance (receipt + dual e-sign). Partial stays
  // Stock Available so remaining lines can still be issued.
  const mr_status: MaterialRequestWorkflowStatus =
    remaining <= 1e-9
      ? "Pending Department Acceptance"
      : "Stock Available";

  const mr = await updateMaterialRequestWorkflowStatus(input.mrName, mr_status, {
    custom_warehouse_remarks: warehouseRemarks,
  });

  await createWarehouseReview({
    material_request: input.mrName,
    warehouse_remarks: warehouseRemarks,
    decision: remaining <= 1e-9 ? "Material Issued" : "Partially Issued",
    issued_qty: total_issued,
    remaining_qty: remaining,
    review_date: todayERPNextDate(),
    warehouse_user: input.issuedBy,
  });

  clearMaterialIssueDraft(input.mrName);

  return {
    stock_entry: stockEntryName,
    issue_type: issueType,
    mr_status: mr.custom_bidsphere_status
      ? (mr.custom_bidsphere_status as MaterialRequestWorkflowStatus)
      : mr_status,
    total_issued,
    total_required,
    audit,
  };
}

export interface MaterialIssueDraft {
  mrName: string;
  receiver: ReceiverRole;
  remarks: string;
  lines: Array<{ item_code: string; issue_qty: number; remarks?: string }>;
  saved_at: string;
}

export function saveMaterialIssueDraft(draft: MaterialIssueDraft): void {
  try {
    localStorage.setItem(
      `${DRAFT_PREFIX}${draft.mrName}`,
      JSON.stringify(draft),
    );
  } catch {
    /* ignore quota */
  }
}

export function loadMaterialIssueDraft(
  mrName: string,
): MaterialIssueDraft | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${mrName}`);
    if (!raw) return null;
    return JSON.parse(raw) as MaterialIssueDraft;
  } catch {
    return null;
  }
}

export function clearMaterialIssueDraft(mrName: string): void {
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${mrName}`);
  } catch {
    /* ignore */
  }
}

export function parseMaterialIssueAudit(
  remarks?: string,
): {
  issue_type?: IssueType;
  receiver?: string;
  audit?: MaterialIssueAuditMeta;
  lines?: Array<{
    item_code: string;
    required_qty?: number;
    issue_qty?: number;
    remaining_qty?: number;
  }>;
} | null {
  if (!remarks) return null;
  const parsed = parseMaterialIssueJsonFromRemarks(remarks);
  if (!parsed) return null;
  return {
    issue_type: parsed.issue_type as IssueType | undefined,
    receiver: parsed.receiver,
    audit: parsed.audit as MaterialIssueAuditMeta | undefined,
    lines: parsed.lines,
  };
}
