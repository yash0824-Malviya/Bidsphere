import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertRfqPurchaseOrderRequest, listPurchaseOrderLegalReviews, type RfqPurchaseOrderDependencies } from "./rfqPurchaseOrderGuard";
import type { AccessPrincipal } from "./rbacAuth";
import { assertSupplierAwardEligible, type SupplierAwardEligibilityDependencies } from "./supplierAwardEligibilityGuard";

const principal: AccessPrincipal = { typ: "internal", sub: "team@example.test", email: "team@example.test", role: "procurement_team", iat: 0, exp: 9999999999999 };
const review = { name: "LDR-1", sq_name: "SQ-1", rfq_name: "PUR-RFQ-1", supplier: "Supplier-1", company: "Company-1" };
const quotation = { name: "SQ-1", supplier: "Supplier-1", company: "Company-1", items: [{ request_for_quotation: "PUR-RFQ-1" }] };
const po = { doctype: "Purchase Order", supplier: "Supplier-1", company: "Company-1", remarks: "PUR-RFQ-1", items: [{ supplier_quotation: "SQ-1", item_code: "ITEM-1", qty: 1, rate: 12 }] };
let deps: RfqPurchaseOrderDependencies;

beforeEach(() => {
  deps = {
    loadDocument: vi.fn(async (doctype, name) => {
      if (doctype === "Supplier Quotation" && name === "SQ-1") return structuredClone(quotation);
      if (doctype === "Purchase Order" && name === "PO-1") return { ...structuredClone(po), name: "PO-1" };
      if (doctype === "Request for Quotation" && ["PUR-RFQ-1", "PUR-RFQ-2"].includes(name)) return { name, status: "Submitted", docstatus: 1, contract_required: "No", custom_approval_data: JSON.stringify({ contract_decision: { decision: "No" } }) };
      throw new Error("Not found");
    }),
    listReviews: vi.fn(async () => [structuredClone(review)]),
    assertClmReady: vi.fn(async () => undefined),
    assertReady: vi.fn(async () => review),
    assertAwardEligible: vi.fn(async () => undefined),
  };
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const check = (apiPath: string, body: unknown, method = "POST") => assertRfqPurchaseOrderRequest({ apiPath, body, method, principal }, deps);

describe("PO enforcement against the exact Apex incomplete-quotation evaluation", () => {
  const evaluation = [
    { supplier_id: "Apex Fasteners Ltd", quotation_id: "SQ-APEX", score: { overall: 88 }, rank: 1, risk: "High", verdict: "QUOTE INCOMPLETE", evaluation_status: "complete", quote_price_status: "submitted" },
    { supplier_id: "Blue Ridge Manufacturing Inc", quotation_id: "SQ-BLUE", score: { overall: 85 }, rank: 2, risk: "Low", verdict: "GOOD OPTION", evaluation_status: "complete", quote_price_status: "submitted" },
    { supplier_id: "Redwood Supply Chain Partners", quotation_id: "SQ-REDWOOD", score: { overall: 81 }, rank: 3, risk: "Medium", verdict: "GOOD OPTION", evaluation_status: "complete", quote_price_status: "submitted" },
  ];
  function exactCase(index: number, evaluationPatch: Record<string, unknown> = {}) {
    const selected = evaluation[index];
    const selectedReview = { name: "LDR-EXACT", rfq_name: "PUR-RFQ-EXACT", sq_name: selected.quotation_id, supplier: selected.supplier_id, company: "Company-1" };
    const candidate = { doctype: "Purchase Order", supplier: selected.supplier_id, company: "Company-1", remarks: "PUR-RFQ-EXACT", items: [{ supplier_quotation: selected.quotation_id, item_code: "MATERIAL", qty: 10, rate: 250 }] };
    const savedEvaluation = JSON.stringify({ rfq_name: "PUR-RFQ-EXACT", analysis: { rfq_id: "PUR-RFQ-EXACT", evaluation_run_id: "RUN-EXACT", supplier_analysis: evaluation.map((row, rowIndex) => ({ ...row, rfq_id: "PUR-RFQ-EXACT", evaluation_run_id: "RUN-EXACT", ...(rowIndex === index ? evaluationPatch : {}) })) } });
    const records: Record<string, Record<string, unknown>> = {
      "Request for Quotation/PUR-RFQ-EXACT": { name: "PUR-RFQ-EXACT", status: "Submitted", docstatus: 1, contract_required: "No", custom_active_rfq_round: "ROUND-EXACT", custom_approval_data: JSON.stringify({ contract_decision: { decision: "No" } }) },
      "Supplier Scoring Result/SCORE-EXACT": { name: "SCORE-EXACT", rfq: "PUR-RFQ-EXACT", analysis_snapshot: savedEvaluation },
      "Purchase Order/PO-EXACT": { ...candidate, name: "PO-EXACT", docstatus: 0 },
      ...Object.fromEntries(evaluation.map(row => [`Supplier Quotation/${row.quotation_id}`, { name: row.quotation_id, supplier: row.supplier_id, company: "Company-1", docstatus: 1, status: "Submitted", custom_rfq_round: "ROUND-EXACT", grand_total: 2500, items: [{ request_for_quotation: "PUR-RFQ-EXACT", qty: 10, rate: 250 }] }])),
    };
    deps.loadDocument = vi.fn(async (doctype, name) => {
      const record = records[`${doctype}/${name}`];
      if (!record) throw new Error("Fixture document not found");
      return structuredClone(record);
    });
    deps.listReviews = vi.fn(async filters => filters.every(([field, op, value]) => op === "=" && selectedReview[field as keyof typeof selectedReview] === value) ? [selectedReview] : []);
    deps.assertReady = vi.fn(async () => selectedReview);
    const eligibilityDependencies: SupplierAwardEligibilityDependencies = {
      loadDocument: deps.loadDocument,
      listDocuments: vi.fn(async doctype => doctype === "Supplier Scoring Result" ? [{ name: "SCORE-EXACT" }] : []),
    };
    // Use the real server eligibility resolver, not a mocked policy verdict.
    deps.assertAwardEligible = vi.fn(selection => assertSupplierAwardEligible(selection, eligibilityDependencies));
    return { candidate, records, savedEvaluation };
  }

  it.each(["resource", "insert", "save", "submit_resource", "submit_rpc"])("rejects Apex through %s despite client eligibility/approval claims", async route => {
    const { candidate, records, savedEvaluation } = exactCase(0);
    const forged = { ...candidate, awardEligible: true, verdict: "GOOD OPTION", risk: "Low", evaluation_status: "complete", finance_status: "Approved", signature_status: "Signed" };
    const path = route === "resource" ? "resource/Purchase Order" : route === "submit_resource" ? "resource/Purchase Order/PO-EXACT" : `method/frappe.client.${route === "submit_rpc" ? "submit" : route}`;
    const body = route === "resource" ? forged : route === "submit_resource" ? { docstatus: 1, awardEligible: true } : route === "submit_rpc" ? { doc: { doctype: "Purchase Order", name: "PO-EXACT", awardEligible: true } } : { doc: forged };
    await expect(check(path, body, route === "submit_resource" ? "PUT" : "POST")).rejects.toMatchObject({ status: 403, message: "Quote incomplete. Complete the supplier quotation before selection." });
    expect(deps.assertClmReady).toHaveBeenCalledWith("PUR-RFQ-EXACT");
    expect(deps.assertReady).toHaveBeenCalledWith("LDR-EXACT", principal);
    expect(deps.assertAwardEligible).toHaveBeenCalledWith({ rfqId: "PUR-RFQ-EXACT", supplierId: evaluation[0].supplier_id, quotationId: "SQ-APEX" });
    expect(records["Supplier Scoring Result/SCORE-EXACT"].analysis_snapshot).toBe(savedEvaluation);
    expect(records["Purchase Order/PO-EXACT"].docstatus).toBe(0);
  });

  it.each([1, 2])("permits eligible supplier index %i while retaining the existing CLM/Legal/Finance checks", async index => {
    const { candidate } = exactCase(index);
    await expect(check("resource/Purchase Order", candidate)).resolves.toBeUndefined();
    expect(deps.assertClmReady).toHaveBeenCalledWith("PUR-RFQ-EXACT");
    expect(deps.assertReady).toHaveBeenCalledWith("LDR-EXACT", principal);
    expect(deps.assertAwardEligible).toHaveBeenCalledWith({ rfqId: "PUR-RFQ-EXACT", supplierId: evaluation[index].supplier_id, quotationId: evaluation[index].quotation_id });
    expect(evaluation.map(row => [row.score.overall, row.rank])).toEqual([[88, 1], [85, 2], [81, 3]]);
  });

  it.each(["resource", "insert", "save", "submit_resource", "submit_rpc"])("permits High risk with GOOD OPTION and complete submitted evaluation through %s after existing approvals", async route => {
    const { candidate, records, savedEvaluation } = exactCase(0, { verdict: "GOOD OPTION" });
    const path = route === "resource" ? "resource/Purchase Order" : route === "submit_resource" ? "resource/Purchase Order/PO-EXACT" : `method/frappe.client.${route === "submit_rpc" ? "submit" : route}`;
    const body = route === "resource" ? candidate : route === "submit_resource" ? { docstatus: 1 } : route === "submit_rpc" ? { doc: { doctype: "Purchase Order", name: "PO-EXACT" } } : { doc: candidate };
    await expect(check(path, body, route === "submit_resource" ? "PUT" : "POST")).resolves.toBeUndefined();
    expect(deps.assertClmReady).toHaveBeenCalledWith("PUR-RFQ-EXACT");
    expect(deps.assertReady).toHaveBeenCalledWith("LDR-EXACT", principal);
    expect(deps.assertAwardEligible).toHaveBeenCalledWith({ rfqId: "PUR-RFQ-EXACT", supplierId: evaluation[0].supplier_id, quotationId: "SQ-APEX" });
    expect(records["Supplier Scoring Result/SCORE-EXACT"].analysis_snapshot).toBe(savedEvaluation);
    const persisted = JSON.parse(String(records["Supplier Scoring Result/SCORE-EXACT"].analysis_snapshot)).analysis.supplier_analysis[0];
    expect(persisted).toMatchObject({ risk: "High", verdict: "GOOD OPTION", evaluation_status: "complete", quote_price_status: "submitted", score: { overall: 88 }, rank: 1 });
  });

  it.each(["Contract is not executed", "Legal approval is pending", "Signature incomplete", "Finance approval is pending"])("does not let High risk with GOOD OPTION bypass an existing gate: %s", async reason => {
    const { candidate } = exactCase(0, { verdict: "GOOD OPTION" });
    if (reason === "Contract is not executed") deps.assertClmReady = vi.fn(async () => { throw new Error(reason); });
    else deps.assertReady = vi.fn(async () => { throw new Error(reason); });
    await expect(check("resource/Purchase Order", candidate)).rejects.toThrow(reason);
  });

  it("continues blocking an authoritative AVOID verdict despite High risk no longer being an independent blocker", async () => {
    const { candidate } = exactCase(0, { verdict: "AVOID" });
    await expect(check("resource/Purchase Order", candidate)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("AVOID") });
  });

  it.each([{ docstatus: 0 }, { docstatus: 2 }, { status: "Cancelled" }, { custom_rfq_round: "ROUND-OLD" }])("blocks an otherwise eligible supplier when its actual quotation is invalid: %j", async patch => {
    const { candidate, records } = exactCase(1);
    Object.assign(records["Supplier Quotation/SQ-BLUE"], patch);
    await expect(check("resource/Purchase Order", candidate)).rejects.toMatchObject({ status: 403 });
  });
});

describe("RFQ Purchase Order gateway approval/integrity guard", () => {
  it.each([
    ["resource/Purchase%20Order", po],
    ["method/frappe.client.save", { doc: po }],
    ["method/frappe.client.insert", { doc: JSON.stringify(po) }],
  ])("verifies signature/Finance/current bytes before creating through %s", async (path, body) => {
    await check(path, body);
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("PUR-RFQ-1");
    expect(deps.assertReady).toHaveBeenCalledExactlyOnceWith("LDR-1", principal);
  });

  it.each(["Contract decision is pending", "Execute the required contract first"])("blocks PO when %s before the existing Legal and Finance verifier", async reason => {
    deps.assertClmReady = vi.fn(async () => { throw new Error(reason); });
    await expect(check("resource/Purchase Order", po)).rejects.toThrow(reason);
    expect(deps.assertReady).not.toHaveBeenCalled();
  });

  it("checks CLM first and still checks existing Legal and Finance approval", async () => {
    const events: string[] = [];
    deps.assertClmReady = vi.fn(async () => { events.push("contract"); });
    deps.assertReady = vi.fn(async () => { events.push("legal"); });
    await check("resource/Purchase Order/PO-1", { docstatus: 1 }, "PUT");
    expect(events).toEqual(["contract", "legal"]);
  });
  it.each([
    ["resource/Purchase Order", po, "POST"],
    ["method/frappe.client.save", { doc: po }, "POST"],
    ["resource/Purchase Order/PO-1", { docstatus: 1 }, "PUT"],
    ["method/frappe.client.submit", { doc: { doctype: "Purchase Order", name: "PO-1" } }, "POST"],
    ["method/frappe.model.workflow.apply_workflow", { doc: { doctype: "Purchase Order", name: "PO-1" }, action: "Submit" }, "POST"],
  ])("blocks a new/submitted PO for a currently AVOID supplier via %s even after prior approvals", async (path, body, method) => {
    deps.assertAwardEligible = vi.fn(async () => { throw new Error("Supplier is currently marked AVOID and cannot be selected for award."); });
    await expect(check(path as string, body, method as string)).rejects.toThrow("AVOID");
    expect(deps.assertAwardEligible).toHaveBeenCalledWith({ rfqId: "PUR-RFQ-1", supplierId: "Supplier-1", quotationId: "SQ-1" });
  });
  it("preserves a harmless existing PO edit without creating or advancing a new award", async () => {
    deps.assertAwardEligible = vi.fn(async () => { throw new Error("AVOID"); });
    await check("resource/Purchase Order/PO-1", { remarks: "PUR-RFQ-1 existing note" }, "PUT");
    expect(deps.assertAwardEligible).not.toHaveBeenCalled();
  });

  it("checks every RFQ referenced by the selected quotation, including multi-RFQ item links", async () => {
    const originalLoad = deps.loadDocument;
    deps.loadDocument = vi.fn(async (doctype, name) => doctype === "Supplier Quotation"
      ? { ...quotation, items: [...quotation.items, { request_for_quotation: "PUR-RFQ-2" }] }
      : originalLoad(doctype, name));
    deps.assertClmReady = vi.fn(async name => { if (name === "PUR-RFQ-2") throw new Error("Second RFQ contract is not executed"); });
    await expect(check("resource/Purchase Order", po)).rejects.toThrow("Second RFQ contract is not executed");
    expect(deps.assertClmReady).toHaveBeenCalledWith("PUR-RFQ-1");
    expect(deps.assertClmReady).toHaveBeenCalledWith("PUR-RFQ-2");
    expect(deps.assertReady).not.toHaveBeenCalled();
  });

  it.each([undefined, "No"])("preserves an existing historical PO when its RFQ flag is %s and no decision exists", async contract_required => {
    const previous = deps.loadDocument;
    deps.loadDocument = vi.fn(async (doctype, name) => doctype === "Request for Quotation" ? { name, status: "Submitted", docstatus: 1, contract_required } : previous(doctype, name));
    deps.assertClmReady = vi.fn(async (_name, options) => { if (!options?.allowHistoricalOrder) throw new Error("Decision pending"); });
    await check("resource/Purchase Order/PO-1", { docstatus: 1 }, "PUT");
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("PUR-RFQ-1", { allowHistoricalOrder: true });
    expect(deps.assertReady).toHaveBeenCalledExactlyOnceWith("LDR-1", principal);
    await expect(check("resource/Purchase Order", po)).rejects.toThrow("Decision pending");
    expect(deps.assertClmReady).toHaveBeenLastCalledWith("PUR-RFQ-1");
  });

  it("still verifies an old No-flag RFQ's linked CLM before updating its historical PO", async () => {
    const previous = deps.loadDocument;
    deps.loadDocument = vi.fn(async (doctype, name) => doctype === "Request for Quotation" ? { name, status: "Submitted", docstatus: 1, contract_required: "No" } : previous(doctype, name));
    deps.assertClmReady = vi.fn(async () => { throw new Error("Existing linked CLM is not executed"); });
    await expect(check("resource/Purchase Order/PO-1", { docstatus: 1 }, "PUT")).rejects.toThrow("Existing linked CLM is not executed");
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("PUR-RFQ-1", { allowHistoricalOrder: true });
    expect(deps.assertReady).not.toHaveBeenCalled();
  });

  it("does not grandfather an existing PO whose RFQ requires a contract", async () => {
    const previous = deps.loadDocument;
    deps.loadDocument = vi.fn(async (doctype, name) => doctype === "Request for Quotation" ? { name, status: "Submitted", docstatus: 1, contract_required: "Yes" } : previous(doctype, name));
    deps.assertClmReady = vi.fn(async () => { throw new Error("Contract is not executed"); });
    await expect(check("resource/Purchase Order/PO-1", { docstatus: 1 }, "PUT")).rejects.toThrow("Contract is not executed");
    expect(deps.assertReady).not.toHaveBeenCalled();
  });

  it.each(["Finance approval is pending", "Signature incomplete", "Document integrity failed"])("blocks direct creation when %s", async reason => {
    deps.assertReady = vi.fn(async () => { throw new Error(reason); });
    await expect(check("method/frappe.client.save", { doc: { ...po, finance_status: "Approved", signature_status: "Signed" } })).rejects.toThrow(reason);
  });

  it.each([
    ["resource/Purchase%20Order/PO-1", { docstatus: 1 }, "PUT"],
    ["method/frappe.client.submit", { doc: { doctype: "Purchase Order", name: "PO-1" } }, "POST"],
    ["method/frappe.model.workflow.apply_workflow", { doc: JSON.stringify({ doctype: "Purchase Order", name: "PO-1" }), action: "Submit" }, "POST"],
    ["method/frappe.client.set_value", { doctype: "Purchase Order", name: "PO-1", fieldname: "docstatus", value: 1 }, "POST"],
  ])("checks persisted RFQ/SQ links when submitting through %s", async (path, body, method) => {
    deps.assertReady = vi.fn(async () => { throw new Error("Finance not approved"); });
    await expect(check(path, body, method)).rejects.toThrow("Finance not approved");
    expect(deps.loadDocument).toHaveBeenCalledWith("Purchase Order", "PO-1");
  });

  it("also guards a mutation RPC sent with GET query arguments", async () => {
    deps.assertReady = vi.fn(async () => { throw new Error("Finance not approved"); });
    await expect(assertRfqPurchaseOrderRequest({ apiPath: "method/frappe.client.submit", method: "GET", principal, query: { doc: JSON.stringify({ doctype: "Purchase Order", name: "PO-1" }) } }, deps)).rejects.toThrow("Finance not approved");
  });

  it("blocks unauthorized roles even with supplied approval flags", async () => {
    await expect(assertRfqPurchaseOrderRequest({ apiPath: "method/frappe.client.save", method: "POST", body: { doc: po }, principal: { ...principal, role: "legal" } }, deps)).rejects.toThrow(/Access denied/);
    expect(deps.assertReady).not.toHaveBeenCalled();
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });

  it("does not accept remarks-only or orphan RFQ references", async () => {
    await expect(check("resource/Purchase Order", { ...po, items: [{ item_code: "ITEM-1" }] })).rejects.toThrow(/Supplier Quotation item links/);
    await expect(check("resource/Purchase Order", { ...po, remarks: "PUR-RFQ-OTHER" })).rejects.toThrow(/references do not match/);
  });

  it("does not accept an unreviewed/ambiguous selected quotation", async () => {
    deps.listReviews = vi.fn(async () => []);
    await expect(check("resource/Purchase Order", po)).rejects.toThrow(/one authoritative/);
    deps.listReviews = vi.fn(async filters => filters[0][0] === "sq_name" ? [review] : [review, { ...review, name: "LDR-2", sq_name: "SQ-2" }]);
    await expect(check("resource/Purchase Order", po)).rejects.toThrow(/ambiguous/);
  });

  it("validates supplier/company and cancelled RFQ state", async () => {
    await expect(check("resource/Purchase Order", { ...po, supplier: "Other Supplier" })).rejects.toThrow(/reviewed supplier/);
    await expect(check("resource/Purchase Order", { ...po, company: "Other Company" })).rejects.toThrow(/reviewed supplier/);
    const previous = deps.loadDocument;
    deps.loadDocument = vi.fn(async (doctype, name) => doctype === "Request for Quotation" ? { name, docstatus: 2 } : previous(doctype, name));
    await expect(check("resource/Purchase Order", po)).rejects.toThrow(/cancelled/);
  });

  it("prevents stripping links from an existing RFQ PO", async () => {
    await expect(check("resource/Purchase Order/PO-1", { remarks: "", items: [{ item_code: "ITEM-1" }] }, "PUT")).rejects.toThrow(/cannot be removed/);
    await expect(check("method/frappe.client.set_value", { doctype: "Purchase Order", name: "PO-1", fieldname: JSON.stringify({ remarks: "", items: [] }) })).rejects.toThrow(/cannot be removed/);
  });

  it("keeps non-RFQ purchase orders and read-only queries unchanged", async () => {
    await check("resource/Purchase Order", { ...po, remarks: "", items: [{ item_code: "MANUAL-1" }] });
    await check("resource/Purchase Order/PO-1", undefined, "GET");
    await check("method/frappe.client.get_value", { doctype: "Purchase Order", fieldname: "status" });
    expect(deps.assertReady).not.toHaveBeenCalled();
  });

  it("does not alter Business Case or Purchase Requisition workflow", async () => {
    await check("resource/Business Case", { status: "Approved" });
    await check("method/frappe.client.save", { doc: { doctype: "Purchase Requisition" } });
    expect(deps.loadDocument).not.toHaveBeenCalled();
  });

  it("rejects opaque wrapped/bulk PO writes", async () => {
    await expect(check("resource/Purchase Order", { data: po })).rejects.toThrow(/Wrapped/);
    await expect(check("method/frappe.client.save", { docs: [po, po] })).rejects.toThrow(/Bulk/);
  });

  it.each(["https://erp.test", "https://erp.test/", "https://erp.test/api", " https://erp.test/api/ "])("normalizes configured ERP base %s without a duplicate /api", async base => {
    vi.stubEnv("ERPNEXT_URL", base);
    vi.stubEnv("ERP_API_KEY", "isolated-test-key");
    vi.stubEnv("ERP_API_SECRET", "isolated-test-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [review] }), { headers: { "Content-Type": "application/json" } }));
    await expect(listPurchaseOrderLegalReviews([["sq_name", "=", "SQ-1"]])).resolves.toEqual([review]);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/api/resource/Legal%20Document%20Review");
  });
});

describe("Contract Purchase Order routing cannot be bypassed through generic ERP writes", () => {
  const clmContext = { contractId: "CON-1", rfqId: "PUR-RFQ-1", awardId: "LDR-1", quotationId: "SQ-1" };
  const clmOrder = { ...po, custom_clm_contract: "CON-1", custom_clm_rfq: "PUR-RFQ-1", custom_clm_award: "LDR-1", custom_clm_creation_key: "server-persisted-operation-key" };
  function withContract(order = clmOrder) {
    const previous = deps.loadDocument;
    deps.loadDocument = vi.fn(async (doctype, name) => doctype === "Request for Quotation" ? {
      name, docstatus: 1, status: "Submitted", contract_required: "Yes",
      custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", award: "LDR-1", quotation: "SQ-1" } }),
    } : doctype === "Purchase Order" ? { ...structuredClone(order), name, docstatus: 0 } : previous(doctype, name));
  }

  it.each(["custom_clm_contract", "custom_clm_rfq", "custom_clm_award", "custom_clm_creation_key"])("rejects forging %s on a generic PO create", async field => {
    await expect(check("resource/Purchase Order", { ...po, [field]: "forged" })).rejects.toThrow("Contract Procurement Finalization");
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });

  it("does not treat body/query clmContext claims as trusted service context", async () => {
    withContract();
    await expect(assertRfqPurchaseOrderRequest({ apiPath: "resource/Purchase Order", method: "POST", principal,
      body: { ...clmOrder, clmContext }, query: { clmContext } }, deps)).rejects.toThrow("generic PO API");
  });

  it.each(["resource", "insert", "save", "submit", "set_value", "workflow"])("blocks managed PO writes through generic %s", async route => {
    withContract();
    const apiPath = route === "resource" ? "resource/Purchase Order/PO-1" : route === "workflow" ? "method/frappe.model.workflow.apply_workflow" : `method/frappe.client.${route}`;
    const body = route === "resource" ? { docstatus: 1 } : route === "set_value"
      ? { doctype: "Purchase Order", name: "PO-1", fieldname: "docstatus", value: 1 }
      : { doc: { doctype: "Purchase Order", name: "PO-1" }, action: "Submit" };
    await expect(check(apiPath, body, route === "resource" ? "PUT" : "POST")).rejects.toThrow("generic PO API");
    expect(deps.assertReady).not.toHaveBeenCalled();
  });

  it("blocks clearing the saved Contract fields to escape its creation operation", async () => {
    withContract();
    await expect(check("resource/Purchase Order/PO-1", { custom_clm_contract: "", custom_clm_rfq: "", custom_clm_award: "", custom_clm_creation_key: "", items: [] }, "PUT")).rejects.toThrow("generic PO API");
  });

  it("blocks a second generic order for the same Contract RFQ even when its Contract fields are omitted", async () => {
    withContract();
    await expect(check("resource/Purchase Order", po)).rejects.toThrow("prevent duplicates");
    expect(deps.assertClmReady).not.toHaveBeenCalled();
  });

  it("allows the verified internal Contract service while preserving source, approval and eligibility checks", async () => {
    withContract();
    await expect(assertRfqPurchaseOrderRequest({ apiPath: "resource/Purchase Order", method: "POST", principal, body: clmOrder, clmContext }, deps)).resolves.toBeUndefined();
    expect(deps.assertClmReady).toHaveBeenCalledExactlyOnceWith("PUR-RFQ-1");
    expect(deps.assertReady).toHaveBeenCalledExactlyOnceWith("LDR-1", principal);
    expect(deps.assertAwardEligible).toHaveBeenCalledExactlyOnceWith({ rfqId: "PUR-RFQ-1", supplierId: "Supplier-1", quotationId: "SQ-1" });
  });

  it("supports submission/recovery of the same verified Contract PO", async () => {
    withContract();
    await expect(assertRfqPurchaseOrderRequest({ apiPath: "resource/Purchase Order/PO-1", method: "PUT", principal, body: { docstatus: 1 }, clmContext }, deps)).resolves.toBeUndefined();
    expect(deps.assertAwardEligible).toHaveBeenCalledOnce();
  });

  it.each(["contractId", "rfqId", "awardId", "quotationId"])("rejects a mismatched trusted %s", async field => {
    withContract();
    await expect(assertRfqPurchaseOrderRequest({ apiPath: "resource/Purchase Order", method: "POST", principal, body: clmOrder, clmContext: { ...clmContext, [field]: "OTHER" } }, deps)).rejects.toMatchObject({ status: 403 });
  });

  it.each(["procurement", "admin", "finance", "legal"])("does not grant Contract PO creation to %s", async role => {
    withContract();
    await expect(assertRfqPurchaseOrderRequest({ apiPath: "resource/Purchase Order", method: "POST", principal: { ...principal, role } as AccessPrincipal, body: clmOrder, clmContext }, deps)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a mismatched saved Contract decision", async () => {
    withContract();
    const previous = deps.loadDocument;
    deps.loadDocument = vi.fn(async (doctype, name) => doctype === "Request for Quotation" ? { ...await previous(doctype, name), contract_required: "No" } : previous(doctype, name));
    await expect(assertRfqPurchaseOrderRequest({ apiPath: "resource/Purchase Order", method: "POST", principal, body: clmOrder, clmContext }, deps)).rejects.toThrow("saved RFQ Contract decision");
  });

  it("preserves existing read and cancellation paths", async () => {
    withContract();
    await check("resource/Purchase Order/PO-1", undefined, "GET");
    await check("method/frappe.client.cancel", { doctype: "Purchase Order", name: "PO-1" });
    expect(deps.loadDocument).not.toHaveBeenCalled();
  });
});
