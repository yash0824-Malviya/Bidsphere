import { describe, expect, it, vi } from "vitest";
import { ClmError, clmSnapshotHash, parseClmData } from "./clmCore";
import { clmPurchaseOrderKey, createClmPurchaseOrder, getClmPurchaseOrder, type ClmPurchaseOrderDeps } from "./clmPurchaseOrder";
import type { ClmRecord } from "../src/types/clm";
import type { AccessPrincipal, AppRole } from "./rbacAuth";

const user = (role: AppRole): AccessPrincipal => ({ typ: "internal", role, sub: `${role}@test.invalid`, email: `${role}@test.invalid`, iat: 1, exp: 9999999999 });
const team = user("procurement_team");
function fixture() {
  let revision = 1;
  const record: ClmRecord = { name: "CON-1", modified: "1", custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_supplier: "SUP-1", party_type: "Supplier", party_name: "SUP-1",
    custom_contract_status: "Executed", custom_current_version: "1.0", custom_final_version_locked: 1, custom_inteva_signatory: "legal@test.invalid",
    custom_contract_value: 4500, custom_currency: "USD", custom_esign_status: "Completed", custom_executed_contract: "/private/files/signed.pdf", contract_terms: "Approved terms" };
  const data = parseClmData(null);
  data.version = "V1"; data.rfq_workflow = { version: 1, phase: "procurement" };
  data.rfq_context = { rfq_id: "RFQ-1", award_id: "AWARD-1", supplier_id: "SUP-1", quotation_id: "SQ-1", contract_required: "Yes" };
  data.approvals = [{ id: "LEGAL", role: "legal", stage: 0, rule: "Legal", status: "Approved", by: "legal@test.invalid", at: "2026-09-28 09:00:00" }, { id: "FINANCE", role: "finance", stage: 1, rule: "Finance", status: "Approved", by: "finance@test.invalid", at: "2026-09-28 11:00:00" }];
  data.signatures = [{ party: "inteva", role: "legal", by: "legal@test.invalid", at: "2026-09-28 10:00:00", typed_name: "Legal", version: "1.0", file_id: "SIGNED", file_url: "/private/files/signed.pdf", hash: "b".repeat(64) }];
  data.locked_file = { file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64), version: "1.0" }; data.locked_hash = clmSnapshotHash("Contract", record);
  record.custom_clm_data = JSON.stringify(data);
  const documents = new Map<string, ClmRecord>([
    ["Contract/CON-1", record],
    ["Request for Quotation/RFQ-1", { name: "RFQ-1", company: "Netlink", docstatus: 1, contract_required: "Yes", items: [{ name: "RI-1", item_code: "STEEL", schedule_date: "2026-10-01" }], custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" } }) }],
    ["Legal Document Review/AWARD-1", { name: "AWARD-1", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "SUP-1", company: "Netlink", grand_total: 4500 }],
    ["Supplier Quotation/SQ-1", { name: "SQ-1", docstatus: 1, supplier: "SUP-1", company: "Netlink", currency: "USD", terms: "Approved quotation terms", payment_terms_template: "Net 30", items: [{ name: "SQI-1", item_code: "STEEL", qty: 180, uom: "Kg", rate: 25, warehouse: "Stores", request_for_quotation: "RFQ-1", request_for_quotation_item: "RI-1" }] }],
    ["Supplier/SUP-1", { name: "SUP-1", supplier_name: "Atlantic" }],
  ]);
  const get = (type = "Contract", name = "CON-1") => structuredClone(documents.get(`${type}/${name}`)!);
  const put = (type: string, record: ClmRecord) => documents.set(`${type}/${record.name}`, structuredClone(record));
  const deps: ClmPurchaseOrderDeps = {
    load: vi.fn(async (type, name) => { const doc = get(type, name); if (!doc) throw new ClmError("Missing record", 404); return doc; }),
    list: vi.fn(async (type, filters = []) => [...documents.entries()].filter(([key, doc]) => key.startsWith(`${type}/`) && filters.every(filter => { const values = filter as unknown[]; if (values.length === 4) return (doc.items as ClmRecord[] || []).some(row => row[String(values[1])] === values[3]); const [field, operator, value] = values; return operator === "=" ? doc[String(field)] === value : doc[String(field)] !== value; })).map(([, doc]) => structuredClone(doc))),
    save: vi.fn(async (type, doc) => { const prior = get(type, String(doc.name)); if (prior.modified !== doc.modified) throw new ClmError("Document version conflict", 409); const saved = { ...structuredClone(doc), modified: String(++revision) }; put(type, saved); return saved; }),
    create: vi.fn(async () => { throw new Error("Unexpected generic creation"); }),
    now: () => "2026-09-29 11:00:00", notify: vi.fn(async () => undefined),
    purchaseOrderFields: vi.fn(async () => [
      { fieldname: "custom_clm_contract", fieldtype: "Link", options: "Contract" }, { fieldname: "custom_clm_rfq", fieldtype: "Link", options: "Request for Quotation" }, { fieldname: "custom_clm_award", fieldtype: "Link", options: "Legal Document Review" }, { fieldname: "custom_clm_creation_key", fieldtype: "Data", unique: 1 },
    ]),
    verifyIntegrity: vi.fn(async () => undefined), authorizeOrder: vi.fn(async () => undefined),
    createOrder: vi.fn(async doc => {
      if ([...documents.values()].some(row => row.custom_clm_creation_key === doc.custom_clm_creation_key)) throw new ClmError("Duplicate entry", 409);
      const order = { ...structuredClone(doc), name: "PO-1", modified: String(++revision), docstatus: 0, status: "Draft", creation: "2026-09-29 11:00:00", grand_total: (doc.items as ClmRecord[]).reduce((sum, row) => sum + Number(row.qty) * Number(row.rate), 0) };
      put("Purchase Order", order); return order;
    }),
    submitOrder: vi.fn(async doc => { const saved = { ...doc, docstatus: 1, status: "To Receive and Bill", modified: String(++revision) }; put("Purchase Order", saved); return saved; }),
  };
  const request = (operation: "save_draft" | "submit" = "submit", payload: ClmRecord = {}, expected_modified = String(get().modified)) => createClmPurchaseOrder(team, { name: "CON-1", expected_modified, operation, payload }, deps);
  return { deps, get, put, documents, request };
}

describe("Contract-owned Purchase Order creation", () => {
  it("prefills exact awarded source and approved delivery/payment data without writes", async () => {
    const f = fixture(), before = f.get(); const result = await getClmPurchaseOrder(team, "CON-1", f.deps);
    expect(result).toMatchObject({ contract: "CON-1", rfq: "RFQ-1", award: "AWARD-1", quotation: "SQ-1", supplier: "SUP-1", currency: "USD", award_value: 4500, completed: false });
    expect(result.payload).toMatchObject({ supplier: "SUP-1", company: "Netlink", currency: "USD", terms: "Approved quotation terms", payment_terms_template: "Net 30", items: [{ item_code: "STEEL", qty: 180, uom: "Kg", rate: 25, warehouse: "Stores", schedule_date: "2026-10-01", supplier_quotation: "SQ-1" }] });
    expect(f.get()).toEqual(before); expect(f.deps.save).not.toHaveBeenCalled(); expect(f.deps.createOrder).not.toHaveBeenCalled();
  });
  it("creates one submitted PO, preserves signatures, persists links/audit and finalizes", async () => {
    const f = fixture(), before = f.get(), prior = parseClmData(before.custom_clm_data);
    const result = await f.request(), saved = f.get(), data = parseClmData(saved.custom_clm_data);
    expect(result).toMatchObject({ contract: "CON-1", completed: true, reused: false, purchase_order: { name: "PO-1", docstatus: 1, grand_total: 4500 } });
    expect(f.get("Purchase Order", "PO-1")).toMatchObject({ custom_clm_contract: "CON-1", custom_clm_rfq: "RFQ-1", custom_clm_award: "AWARD-1", custom_clm_creation_key: clmPurchaseOrderKey("CON-1", "AWARD-1", "SQ-1") });
    expect(data.rfq_workflow?.phase).toBe("completed"); expect(data.procurement_completion).toMatchObject({ purchase_order: "PO-1", supplier: "SUP-1", currency: "USD", grand_total: 4500 });
    expect(data.audit.map(row => row.action)).toEqual(["purchase_order_creation_initiated", "purchase_order_created", "purchase_order_linked", "procurement_finalized", "completed"]);
    expect(data.signatures).toEqual(prior.signatures); expect(data.locked_hash).toBe(prior.locked_hash); expect(clmSnapshotHash("Contract", saved)).toBe(clmSnapshotHash("Contract", before));
    const again = await f.request("submit", {}, "1"); expect(again.reused).toBe(true); expect(f.deps.createOrder).toHaveBeenCalledTimes(1); expect(f.deps.submitOrder).toHaveBeenCalledTimes(1);
  });
  it("saves a real linked draft without completing; resumes that same draft for submit", async () => {
    const f = fixture(); const draft = await f.request("save_draft"); expect(draft.completed).toBe(false);
    expect(parseClmData(f.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement"); expect(f.deps.submitOrder).not.toHaveBeenCalled();
    expect((await f.request()).purchase_order.name).toBe(draft.purchase_order.name); expect(f.deps.createOrder).toHaveBeenCalledTimes(1);
  });
  it.each(["procurement", "admin", "legal", "finance", "engineering"] as AppRole[])("denies %s even with valid fields", async role => {
    const f = fixture(); await expect(getClmPurchaseOrder(user(role), "CON-1", f.deps)).rejects.toMatchObject({ status: 403 });
    await expect(createClmPurchaseOrder(user(role), { name: "CON-1", expected_modified: "1", operation: "submit", payload: {} }, f.deps)).rejects.toMatchObject({ status: 403 });
    expect(f.deps.createOrder).not.toHaveBeenCalled(); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("blocks missing Finance and signature integrity before creation", async () => {
    const f = fixture(), doc = f.get(), data = parseClmData(doc.custom_clm_data); data.approvals[1].status = "Pending"; f.put("Contract", { ...doc, custom_clm_data: JSON.stringify(data) });
    await expect(f.request()).rejects.toThrow("Finance"); expect(f.deps.createOrder).not.toHaveBeenCalled();
    const other = fixture(); vi.mocked(other.deps.verifyIntegrity).mockRejectedValue(new ClmError("PDF digest failed", 409)); await expect(other.request()).rejects.toThrow("PDF digest failed"); expect(other.deps.save).not.toHaveBeenCalled();
  });
  it.each(["award", "supplier", "quotation", "RFQ"])("rejects changed %s source without persistence", async field => {
    const f = fixture();
    if (field === "award") f.put("Legal Document Review", { ...f.get("Legal Document Review", "AWARD-1"), rfq_name: "RFQ-OTHER" });
    if (field === "supplier") f.put("Supplier", { ...f.get("Supplier", "SUP-1"), disabled: 1 });
    if (field === "quotation") f.put("Supplier Quotation", { ...f.get("Supplier Quotation", "SQ-1"), docstatus: 0 });
    if (field === "RFQ") f.put("Request for Quotation", { ...f.get("Request for Quotation", "RFQ-1"), contract_required: "No" });
    await expect(f.request()).rejects.toMatchObject({ status: 409 }); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("requires database uniqueness before creating anything", async () => {
    const f = fixture(); vi.mocked(f.deps.purchaseOrderFields).mockResolvedValue([]); await expect(f.request()).rejects.toMatchObject({ status: 503 }); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("retains the resumable draft and Procurement stage when submit fails", async () => {
    const f = fixture(); vi.mocked(f.deps.submitOrder).mockRejectedValueOnce(new ClmError("ERP accounting validation failed", 422));
    await expect(f.request()).rejects.toThrow("ERP accounting validation failed"); expect(parseClmData(f.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement");
    expect((await f.request()).completed).toBe(true); expect(f.deps.createOrder).toHaveBeenCalledTimes(1);
  });
  it("recovers a persisted creation after a lost ERP response without duplicate insertion", async () => {
    const f = fixture(), create = f.deps.createOrder;
    vi.mocked(f.deps.createOrder).mockImplementationOnce(async doc => { const result = await create.getMockImplementation()!(doc); throw new ClmError(`Lost response ${result.name}`, 504); });
    expect((await f.request()).completed).toBe(true); expect(f.deps.createOrder).toHaveBeenCalledTimes(1);
  });
  it("does not return success when ERP drops the PO write", async () => {
    const f = fixture(); vi.mocked(f.deps.createOrder).mockResolvedValue({ name: "NOT-PERSISTED" }); await expect(f.request()).rejects.toMatchObject({ status: 502 });
    expect(parseClmData(f.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement"); expect(f.deps.submitOrder).not.toHaveBeenCalled();
  });
  it("rejects stale first submit, foreign supplier and browser lifecycle fields", async () => {
    const f = fixture(); await expect(f.request("submit", {}, "stale")).rejects.toMatchObject({ status: 409 });
    await expect(f.request("submit", { supplier: "SUP-OTHER" })).rejects.toMatchObject({ status: 422 });
    await expect(f.request("submit", { docstatus: 1 })).rejects.toMatchObject({ status: 400 }); expect(f.deps.createOrder).not.toHaveBeenCalled();
  });
  it("serializes competing requests through DB uniqueness and retries one persisted PO", async () => {
    const f = fixture();
    await Promise.allSettled([f.request(), f.request()]);
    const result = await f.request();
    expect(result.completed).toBe(true);
    expect([...f.documents.keys()].filter(key => key.startsWith("Purchase Order/"))).toEqual(["Purchase Order/PO-1"]);
    const audit = parseClmData(f.get().custom_clm_data).audit;
    for (const action of ["purchase_order_creation_initiated", "purchase_order_created", "purchase_order_linked", "procurement_finalized", "completed"]) expect(audit.filter(row => row.action === action)).toHaveLength(1);
  });
  it("recovers a submitted PO when its submit response is lost", async () => {
    const f = fixture(), submit = vi.mocked(f.deps.submitOrder).getMockImplementation()!;
    vi.mocked(f.deps.submitOrder).mockImplementationOnce(async doc => { await submit(doc); throw new ClmError("Submit response lost", 504); });
    expect((await f.request()).completed).toBe(true); expect(f.deps.createOrder).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed monetary obligation before PO creation or submission", async () => {
    const f = fixture(); await expect(f.request("submit", { items: [{ item_code: "STEEL", qty: 180, uom: "Kg", rate: 24 }] })).rejects.toThrow("final award amount");
    expect(f.deps.createOrder).not.toHaveBeenCalled(); expect(f.deps.submitOrder).not.toHaveBeenCalled();
    const created = vi.mocked(f.deps.createOrder).getMockImplementation()!;
    vi.mocked(f.deps.createOrder).mockImplementationOnce(async doc => { const order = await created(doc); f.put("Purchase Order", { ...order, grand_total: 4501 }); return order; });
    await expect(f.request()).rejects.toThrow("final award amount"); expect(f.deps.submitOrder).not.toHaveBeenCalled(); expect(parseClmData(f.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement");
  });
  it("does not duplicate or adopt an unrelated existing PO against the award", async () => {
    const f = fixture(); f.put("Purchase Order", { name: "OLDER-PO", docstatus: 1, supplier: "SUP-1", items: [{ supplier_quotation: "SQ-1" }] });
    await expect(f.request()).rejects.toThrow("already exists"); expect(f.deps.createOrder).not.toHaveBeenCalled(); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("rejects foreign RFQ scope even if the item code also exists in this RFQ", async () => {
    const f = fixture(), quote = f.get("Supplier Quotation", "SQ-1");
    f.put("Supplier Quotation", { ...quote, request_for_quotation: "RFQ-1", items: [{ ...(quote.items as ClmRecord[])[0], request_for_quotation: "RFQ-OTHER" }] });
    await expect(f.request()).rejects.toThrow("another RFQ"); expect(f.deps.createOrder).not.toHaveBeenCalled();
  });
  it("rechecks current award eligibility for draft submission", async () => {
    const f = fixture(); await f.request("save_draft");
    vi.mocked(f.deps.authorizeOrder).mockImplementation(async (_principal, doc) => { if (doc.docstatus === 1) throw new ClmError("Award is now blocked", 403); });
    await expect(f.request()).rejects.toThrow("Award is now blocked"); expect(f.deps.submitOrder).not.toHaveBeenCalled(); expect(parseClmData(f.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement");
  });
  it("leaves a recoverable PO when Contract linkage persistence fails", async () => {
    const f = fixture(), save = vi.mocked(f.deps.save).getMockImplementation()!; let calls = 0;
    vi.mocked(f.deps.save).mockImplementation(async (type, doc) => { if (type === "Contract" && ++calls === 2) throw new ClmError("Contract link save failed", 503); return save(type, doc); });
    await expect(f.request()).rejects.toThrow("Contract link save failed"); expect(f.get("Purchase Order", "PO-1").docstatus).toBe(0);
    expect((await f.request()).completed).toBe(true); expect(f.deps.createOrder).toHaveBeenCalledTimes(1);
  });
});
