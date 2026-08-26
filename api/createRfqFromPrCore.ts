import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";

type PrItem = {
  partitem?: string;
  description?: string;
  technical_requirement?: string;
  quantity?: number;
  uom?: string;
  required_date?: string;
  plant?: string;
};

type PurchaseRequisition = {
  name: string;
  status?: string;
  rfq?: string;
  ecr_reference?: string;
  requisition_title?: string;
  required_date?: string;
  requisition_items?: PrItem[];
};

type RequestForQuotationTrace = {
  name: string;
  docstatus?: number;
  custom_ecr_reference?: string;
  custom_purchase_requisition_reference?: string;
  custom_bidsphere_pr_idempotency_key?: string;
};

export interface CreateRfqFromPrInput {
  prName: string;
  suppliers: string[];
  title?: string;
  scheduleDate?: string;
}

export interface CreateRfqFromPrResult {
  success: true;
  rfqName: string;
  created: boolean;
  message: string;
  warnings: string[];
}

export class CreateRfqFromPrError extends Error {
  status: number;
  code: "validation" | "conflict" | "erp" | "config" | "partial";
  rfqName?: string;

  constructor(
    message: string,
    status = 400,
    code: CreateRfqFromPrError["code"] = "validation",
    rfqName?: string,
  ) {
    super(message);
    this.name = "CreateRfqFromPrError";
    this.status = status;
    this.code = code;
    this.rfqName = rfqName;
  }
}

export interface CreateRfqFromPrDependencies {
  loadPr: (name: string) => Promise<PurchaseRequisition>;
  loadRfq: (name: string) => Promise<RequestForQuotationTrace>;
  assertSupplierExists: (name: string) => Promise<void>;
  findExistingRfq: (prName: string) => Promise<string | null>;
  createRfq: (payload: Record<string, unknown>) => Promise<string>;
  updatePr: (name: string, payload: Record<string, unknown>) => Promise<void>;
  updateRfq: (name: string, payload: Record<string, unknown>) => Promise<void>;
  applyWorkflow: (doctype: string, name: string, action: string) => Promise<void>;
}

type ErpConfig = { baseUrl: string; key: string; secret: string };

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function readConfig(): ErpConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  ).trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!baseUrl || !key || !secret) {
    throw new CreateRfqFromPrError(
      "RFQ creation backend is missing ERPNext configuration.",
      500,
      "config",
    );
  }
  return { baseUrl, key, secret };
}

function extractErpMessage(payload: unknown, fallback: string): string {
  const value = (payload ?? {}) as {
    message?: string | { message?: string };
    exception?: string;
    _server_messages?: string;
  };
  if (value._server_messages) {
    try {
      const messages = JSON.parse(value._server_messages) as string[];
      const first = messages[0] ? JSON.parse(messages[0]) as { message?: string } : null;
      if (first?.message) return first.message;
    } catch {
      // Fall through to the other ERPNext error shapes.
    }
  }
  if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
  if (value.message && typeof value.message === "object" && value.message.message) {
    return value.message.message;
  }
  if (value.exception) return value.exception.replace(/^[^:]+:\s*/, "").trim();
  return fallback;
}

async function erpRequest<T>(
  config: ErpConfig,
  method: string,
  path: string,
  options: { body?: unknown; search?: Record<string, string> } = {},
): Promise<T> {
  const query = options.search
    ? `?${new URLSearchParams(options.search).toString()}`
    : "";
  const response = await fetch(`${config.baseUrl}/api/${path}${query}`, {
    method,
    headers: {
      Authorization: `token ${config.key}:${config.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body === undefined
      ? undefined
      : JSON.stringify(sanitizeErpPayloadDates(options.body)),
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new CreateRfqFromPrError(
      extractErpMessage(payload, text || `ERPNext request failed (${response.status}).`),
      response.status || 502,
      "erp",
    );
  }
  const envelope = payload as { data?: T; message?: T };
  return envelope.data !== undefined
    ? envelope.data
    : envelope.message !== undefined
      ? envelope.message
      : payload as T;
}

function createDefaultDependencies(): CreateRfqFromPrDependencies {
  const config = readConfig();
  const resource = (doctype: string, name: string) =>
    `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
  return {
    loadPr: (name) => erpRequest<PurchaseRequisition>(
      config,
      "GET",
      resource("Purchase Requisition", name),
    ),
    loadRfq: (name) => erpRequest<RequestForQuotationTrace>(
      config,
      "GET",
      resource("Request for Quotation", name),
    ),
    assertSupplierExists: async (name) => {
      await erpRequest(config, "GET", resource("Supplier", name));
    },
    findExistingRfq: async (prName) => {
      const findByField = (fieldname: string) => erpRequest<Array<{ name?: string }>>(
        config,
        "GET",
        `resource/${encodeURIComponent("Request for Quotation")}`,
        {
          search: {
            fields: JSON.stringify(["name"]),
            filters: JSON.stringify([
              [fieldname, "=", prName],
              ["docstatus", "!=", 2],
            ]),
            order_by: "creation asc",
            limit_page_length: "3",
          },
        },
      );
      const [idempotentRows, legacyRows] = await Promise.all([
        findByField("custom_bidsphere_pr_idempotency_key"),
        findByField("custom_purchase_requisition_reference"),
      ]);
      const names = [...new Set(
        [...(idempotentRows ?? []), ...(legacyRows ?? [])]
          .map((row) => clean(row.name))
          .filter(Boolean),
      )];
      if (names.length > 1) {
        throw new CreateRfqFromPrError(
          `Multiple active RFQs already reference Purchase Requisition ${prName}: ${names.join(", ")}. Resolve the duplicate records before continuing.`,
          409,
          "conflict",
        );
      }
      return names[0] || null;
    },
    createRfq: async (payload) => {
      const created = await erpRequest<{ name?: string }>(
        config,
        "POST",
        `resource/${encodeURIComponent("Request for Quotation")}`,
        { body: payload },
      );
      const name = clean(created?.name);
      if (!name) throw new CreateRfqFromPrError("ERPNext did not return the new RFQ name.", 502, "erp");
      return name;
    },
    updatePr: async (name, payload) => {
      await erpRequest(config, "PUT", resource("Purchase Requisition", name), { body: payload });
    },
    updateRfq: async (name, payload) => {
      await erpRequest(config, "PUT", resource("Request for Quotation", name), { body: payload });
    },
    applyWorkflow: async (doctype, name, action) => {
      await erpRequest(
        config,
        "POST",
        "method/frappe.model.workflow.apply_workflow",
        { body: { doc: { doctype, name }, action } },
      );
    },
  };
}

async function validateAndHealReusableRfq(
  rfqName: string,
  prName: string,
  dependencies: CreateRfqFromPrDependencies,
): Promise<void> {
  const rfq = await dependencies.loadRfq(rfqName);
  if (clean(rfq.name) !== rfqName) {
    throw new CreateRfqFromPrError(
      `RFQ ${rfqName} could not be verified for Purchase Requisition ${prName}.`,
      409,
      "conflict",
      rfqName,
    );
  }

  const docstatus = Number(rfq.docstatus);
  if (![0, 1].includes(docstatus)) {
    throw new CreateRfqFromPrError(
      `RFQ ${rfqName} is cancelled or inactive and cannot be reused for Purchase Requisition ${prName}.`,
      409,
      "conflict",
      rfqName,
    );
  }

  const legacyPr = clean(rfq.custom_purchase_requisition_reference);
  const idempotencyPr = clean(rfq.custom_bidsphere_pr_idempotency_key);
  if (
    (legacyPr && legacyPr !== prName) ||
    (idempotencyPr && idempotencyPr !== prName) ||
    (legacyPr !== prName && idempotencyPr !== prName)
  ) {
    throw new CreateRfqFromPrError(
      `RFQ ${rfqName} does not carry trusted traceability for Purchase Requisition ${prName}.`,
      409,
      "conflict",
      rfqName,
    );
  }

  const linkedEcr = clean(rfq.custom_ecr_reference);
  if (linkedEcr) {
    throw new CreateRfqFromPrError(
      `RFQ ${rfqName} is linked to ECR ${linkedEcr}. ECR-linked RFQs must use /api/create-rfq-from-ecr.`,
      409,
      "conflict",
      rfqName,
    );
  }

  const traceUpdates: Record<string, unknown> = {};
  if (!legacyPr) traceUpdates.custom_purchase_requisition_reference = prName;
  if (!idempotencyPr) traceUpdates.custom_bidsphere_pr_idempotency_key = prName;
  if (Object.keys(traceUpdates).length === 0) return;

  try {
    await dependencies.updateRfq(rfqName, traceUpdates);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown ERPNext error.";
    throw new CreateRfqFromPrError(
      `RFQ ${rfqName} exists but its trusted PR traceability could not be repaired: ${detail}`,
      502,
      "partial",
      rfqName,
    );
  }
}

const inFlight = new Map<string, Promise<CreateRfqFromPrResult>>();

async function runCreateRfqFromPr(
  input: CreateRfqFromPrInput,
  dependencies: CreateRfqFromPrDependencies,
): Promise<CreateRfqFromPrResult> {
  const prName = clean(input.prName);
  if (!prName) throw new CreateRfqFromPrError("Purchase Requisition is required.");

  const pr = await dependencies.loadPr(prName);

  const ecrName = clean(pr.ecr_reference);
  if (ecrName) {
    throw new CreateRfqFromPrError(
      `Purchase Requisition ${prName} is linked to ECR ${ecrName}. ` +
      "The simplified ECR workflow permits RFQ creation only through /api/create-rfq-from-ecr after Procurement Manager action.",
      409,
      "conflict",
    );
  }

  if (clean(pr.status) !== "Approved" && clean(pr.status) !== "RFQ Created") {
    throw new CreateRfqFromPrError(
      `Purchase Requisition must be Approved before creating an RFQ. Current status: ${clean(pr.status) || "Unknown"}.`,
      409,
      "conflict",
    );
  }

  if (clean(pr.rfq)) {
    const existingRfq = clean(pr.rfq);
    await validateAndHealReusableRfq(
      existingRfq,
      prName,
      dependencies,
    );
    const warnings: string[] = [];
    if (clean(pr.status) === "Approved") {
      try {
        await dependencies.applyWorkflow("Purchase Requisition", prName, "Mark RFQ Created");
      } catch (error) {
        warnings.push(`PR workflow was not advanced: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
    return {
      success: true,
      rfqName: existingRfq,
      created: false,
      warnings,
      message: warnings.length > 0
        ? `RFQ ${existingRfq} is already linked to Purchase Requisition ${prName}, but follow-up is required: ${warnings.join(" ")}`
        : `RFQ ${existingRfq} is already linked to Purchase Requisition ${prName}.`,
    };
  }

  const supplierNames = [...new Set(input.suppliers.map(clean).filter(Boolean))];
  if (supplierNames.length === 0) {
    throw new CreateRfqFromPrError("Select at least one existing supplier before creating an RFQ.");
  }
  await Promise.all(supplierNames.map((supplier) => dependencies.assertSupplierExists(supplier)));

  const rfqItems = (pr.requisition_items ?? []).map((item) => ({
    item_code: clean(item.partitem),
    description: clean(item.description) || clean(item.technical_requirement),
    qty: Number(item.quantity),
    uom: clean(item.uom),
    schedule_date: clean(item.required_date) || clean(input.scheduleDate) || clean(pr.required_date),
    warehouse: clean(item.plant) || undefined,
  }));
  if (
    rfqItems.length === 0 ||
    rfqItems.some((item) => !item.item_code || !Number.isFinite(item.qty) || !item.uom)
  ) {
    throw new CreateRfqFromPrError(
      "Purchase Requisition contains no valid Item, quantity, and UOM lines for an RFQ.",
    );
  }

  let rfqName = await dependencies.findExistingRfq(prName);
  let created = false;
  if (!rfqName) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      rfqName = await dependencies.createRfq({
        title: clean(input.title) || `RFQ for ${clean(pr.requisition_title) || prName}`,
        transaction_date: today,
        schedule_date: clean(input.scheduleDate) || clean(pr.required_date) || today,
        items: rfqItems,
        suppliers: supplierNames.map((supplier) => ({ supplier })),
        custom_purchase_requisition_reference: prName,
        custom_bidsphere_pr_idempotency_key: prName,
      });
      created = true;
    } catch (error) {
      // The ERP-level unique idempotency key resolves cross-instance races: the
      // losing request reloads and links the RFQ created by the winning request.
      const concurrentRfq = await dependencies.findExistingRfq(prName);
      if (!concurrentRfq) throw error;
      rfqName = concurrentRfq;
    }
  }

  if (!rfqName) {
    throw new CreateRfqFromPrError(
      `ERPNext did not return or recover an RFQ for Purchase Requisition ${prName}.`,
      502,
      "erp",
    );
  }
  if (!created) {
    await validateAndHealReusableRfq(rfqName, prName, dependencies);
  }

  try {
    await dependencies.updatePr(prName, { rfq: rfqName });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown ERPNext error.";
    throw new CreateRfqFromPrError(
      `RFQ ${rfqName} exists but could not be linked to Purchase Requisition ${prName}: ${detail}`,
      502,
      "partial",
      rfqName,
    );
  }

  const warnings: string[] = [];
  try {
    await dependencies.applyWorkflow("Purchase Requisition", prName, "Mark RFQ Created");
  } catch (error) {
    warnings.push(`PR workflow was not advanced: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  const action = created ? "created" : "recovered and linked without creating a duplicate";
  return {
    success: true,
    rfqName,
    created,
    warnings,
    message: warnings.length === 0
      ? `RFQ ${rfqName} ${action} for Purchase Requisition ${prName}.`
      : `RFQ ${rfqName} ${action} for Purchase Requisition ${prName}, but follow-up is required: ${warnings.join(" ")}`,
  };
}

export async function createRfqFromPrCore(
  input: CreateRfqFromPrInput,
  dependencies?: CreateRfqFromPrDependencies,
): Promise<CreateRfqFromPrResult> {
  const prName = clean(input.prName);
  const current = inFlight.get(prName);
  if (current) return current;

  const operation = runCreateRfqFromPr(
    input,
    dependencies ?? createDefaultDependencies(),
  );
  inFlight.set(prName, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(prName) === operation) inFlight.delete(prName);
  }
}
