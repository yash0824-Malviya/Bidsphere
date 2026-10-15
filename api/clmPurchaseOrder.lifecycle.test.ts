import { describe, expect, it, vi } from "vitest";
import { applyClmAction, ClmError, clmSnapshotHash, parseClmData, rfqClmFinanceApproved } from "./clmCore";
import { createClmPurchaseOrder, getClmPurchaseOrder, type ClmPurchaseOrderDeps } from "./clmPurchaseOrder";
import { assertRfqPurchaseOrderRequest } from "./rfqPurchaseOrderGuard";
import type { AccessPrincipal, AppRole } from "./rbacAuth";
import type { ClmActionName, ClmRecord } from "../src/types/clm";

const principal = (role: AppRole): AccessPrincipal => ({ typ: "internal", role, sub: `${role}@example.test`, email: `${role}@example.test`, iat: 0, exp: Number.MAX_SAFE_INTEGER });
const team = principal("procurement_team"), legal = principal("legal"), finance = principal("finance");
const fields = [
  { fieldname: "custom_clm_contract", fieldtype: "Link", options: "Contract" },
  { fieldname: "custom_clm_rfq", fieldtype: "Link", options: "Request for Quotation" },
  { fieldname: "custom_clm_award", fieldtype: "Link", options: "Legal Document Review" },
  { fieldname: "custom_clm_creation_key", fieldtype: "Data", unique: 1 },
];

/** Real workflow/actions/PO guards. Only the external ERP and signing transport
 * are replaced; independent PDF transaction tests exercise actual signed bytes. */
function fixture() {
  const docs = new Map<string, ClmRecord>();
  let revision = 0;
  const put = (doctype: string, doc: ClmRecord) => { const saved = { ...structuredClone(doc), modified: String(++revision) }; docs.set(`${doctype}/${doc.name}`, saved); return structuredClone(saved); };
  const get = (doctype = "Contract", name = "CON-1") => { const doc = docs.get(`${doctype}/${name}`); if (!doc) throw new ClmError(`Missing ${doctype}/${name}`, 404); return structuredClone(doc); };
  const rfq = { name: "RFQ-1", docstatus: 1, status: "Submitted", company: "Netlink", contract_required: "Yes", custom_selected_supplier: "SUP-1",
    items: [{ name: "RFQI-1", item_code: "STEEL-1", qty: 100, uom: "Kg", schedule_date: "2026-10-05" }, { name: "RFQI-2", item_code: "STEEL-2", qty: 80, uom: "Kg", schedule_date: "2026-10-06" }],
    custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", supplier: "SUP-1", quotation: "SQ-1", award: "AWARD-1" } }) };
  put("Request for Quotation", rfq);
  put("Supplier Quotation", { name: "SQ-1", docstatus: 1, supplier: "SUP-1", company: "Netlink", currency: "USD", grand_total: 4500, net_total: 4500, total: 4500,
    terms: "Pay within 30 days of invoice.", items: rfq.items.map((item, index) => ({ ...item, name: `SQI-${index + 1}`, request_for_quotation: "RFQ-1", request_for_quotation_item: item.name, rate: 25, amount: item.qty * 25 })) });
  // CLM uses Contract approvals; the old RFQ Legal/Finance workflow is untouched.
  put("Legal Document Review", { name: "AWARD-1", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "SUP-1", company: "Netlink", grand_total: 4500, review_status: "Pending", finance_status: "Pending" });
  put("Supplier", { name: "SUP-1", supplier_name: "Atlantic", disabled: 0 });
  put("User", { name: "legal@example.test", enabled: 1, roles: [{ role: "Legal Manager" }] });
  const data = parseClmData(null);
  data.rfq_source = { rfq: "RFQ-1", supplier: "SUP-1", quotation: "SQ-1", award: "AWARD-1", company: "Netlink", contract_required: true };
  data.rfq_workflow = { version: 1, phase: "draft" };
  put("Contract", { name: "CON-1", party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1", custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1",
    custom_contract_title: "Awarded steel supply", custom_contract_type: "Supply / Procurement Contract", contract_terms: "Deliver approved conforming steel.",
    custom_contract_value: 4500, custom_currency: "USD", custom_risk_level: "Medium", custom_inteva_signatory: "legal@example.test",
    start_date: "2026-09-01", end_date: "2026-12-31", custom_contract_status: "Draft", custom_approval_status: "Pending", custom_clm_data: JSON.stringify(data) });
  const deps: ClmPurchaseOrderDeps = {
    load: vi.fn(async (dt, name) => get(dt, name)),
    list: vi.fn(async (dt, filters = []) => [...docs.entries()].filter(([key]) => key.startsWith(`${dt}/`)).map(([, doc]) => structuredClone(doc)).filter(doc => filters.every(filter => {
      const parts = filter as unknown[], [field, op, expected] = parts.slice(-3);
      const values = parts.length === 4 ? (Array.isArray(doc.items) ? doc.items : []).map(item => (item as ClmRecord)[String(field)]) : [doc[String(field)]];
      return op === "=" ? values.includes(expected) : op === "!=" ? values.every(value => value !== expected) : true;
    }))),
    create: vi.fn(async (dt, doc) => put(dt, { ...doc, name: `${dt}-${revision}` })),
    save: vi.fn(async (dt, doc) => {
      if (get(dt, String(doc.name)).modified !== doc.modified) throw new ClmError("Concurrent ERP save", 409);
      return put(dt, doc);
    }),
    now: () => "2026-09-29 12:00:00",
    lock: vi.fn(async () => ({ file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64) })),
    sign: vi.fn(async (doc, who, payload) => ({ party: "inteva", by: who.typ === "internal" ? who.email : who.sub, role: "legal", at: "2026-09-29 12:00:00", version: String(doc.custom_current_version),
      file_id: "SIGNED", file_url: "/private/files/legal-signed.pdf", hash: "b".repeat(64), full_legal_name: String(payload.full_legal_name), typed_name: String((payload.signature as ClmRecord).value), signature_method: "typed", signature_adopted: true })),
    notify: vi.fn(async () => undefined),
    purchaseOrderFields: async () => fields,
    verifyIntegrity: vi.fn(async doc => { if (!rfqClmFinanceApproved(doc)) throw new ClmError("Signature gate", 409); }),
    createOrder: vi.fn(async doc => {
      if ([...docs.values()].some(row => row.custom_clm_creation_key && row.custom_clm_creation_key === doc.custom_clm_creation_key)) throw new ClmError("Duplicate unique key", 409);
      const grand_total = (doc.items as ClmRecord[]).reduce((total, row) => total + Number(row.qty) * Number(row.rate), 0);
      return put("Purchase Order", { ...doc, name: "PO-1", creation: "2026-09-29 12:00:00", grand_total, docstatus: 0, status: "Draft" });
    }),
    submitOrder: vi.fn(async doc => put("Purchase Order", { ...doc, docstatus: 1, status: "To Receive and Bill" })),
    authorizeOrder: async (who, doc, source) => assertRfqPurchaseOrderRequest({ apiPath: "method/frappe.client.save", method: "POST", principal: who, body: { doc },
      clmContext: { contractId: source.contract, rfqId: source.rfq, awardId: source.award, quotationId: source.quotation } }, {
      loadDocument: deps.load, listReviews: filters => deps.list("Legal Document Review", filters),
      assertClmReady: async () => { if (!rfqClmFinanceApproved(get())) throw new ClmError("Finance gate", 409); },
      assertReady: async name => { if (name !== "AWARD-1" || !rfqClmFinanceApproved(get())) throw new ClmError("Contract gate", 409); },
      assertAwardEligible: vi.fn(async () => undefined),
    }),
  };
  const act = (action: ClmActionName, who: AccessPrincipal, payload: ClmRecord = {}) => applyClmAction({ doctype: "Contract", name: "CON-1", action, expected_modified: String(get().modified), payload, comment: `Verified ${action}` }, who, deps);
  const approveContract = async () => {
    await act("submit_review", team); await act("approve", legal); await act("begin_signature", legal);
    await act("sign", legal, { consent: true, full_legal_name: "Legal Reviewer", signature: { method: "typed", value: "Legal Reviewer", adopted: true } });
    await act("approve", finance);
  };
  const create = (operation: "save_draft" | "submit" = "submit") => createClmPurchaseOrder(team, { name: "CON-1", expected_modified: String(get().modified), operation, payload: {} }, deps);
  return { docs, get, put, deps, act, approveContract, create };
}

describe("Contract Legal → signature → Finance → new PO → Completed", () => {
  it("creates one submitted PO after sequential approvals while preserving every signed field and existing RFQ award", async () => {
    const f = fixture(), originalRfq = f.get("Request for Quotation", "RFQ-1"), originalAward = f.get("Legal Document Review", "AWARD-1");
    await expect(f.create()).rejects.toMatchObject({ status: 409 });
    await f.approveContract();
    const approved = f.get(), before = parseClmData(approved.custom_clm_data), signedHash = clmSnapshotHash("Contract", approved);
    const prefill = await getClmPurchaseOrder(team, "CON-1", f.deps);
    expect(prefill).toMatchObject({ award_value: 4500, currency: "USD", rfq: "RFQ-1", award: "AWARD-1", quotation: "SQ-1" });
    expect((prefill.payload.items as ClmRecord[]).map(row => [row.qty, row.rate, row.uom])).toEqual([[100, 25, "Kg"], [80, 25, "Kg"]]);
    const result = await f.create();
    expect(result.completed).toBe(true);
    expect(result.purchase_order).toMatchObject({ name: "PO-1", docstatus: 1, grand_total: 4500, currency: "USD", custom_clm_contract: "CON-1", custom_clm_rfq: "RFQ-1", custom_clm_award: "AWARD-1" });
    const persisted = f.get(), after = parseClmData(persisted.custom_clm_data);
    expect(after.rfq_workflow?.phase).toBe("completed");
    expect(after.procurement_completion).toMatchObject({ purchase_order: "PO-1", role: "procurement_team", rfq: "RFQ-1", award: "AWARD-1" });
    expect(after.signatures).toEqual(before.signatures); expect(after.approvals).toEqual(before.approvals); expect(after.versions).toEqual(before.versions);
    expect(after.locked_file).toEqual(before.locked_file); expect(after.locked_hash).toBe(before.locked_hash); expect(clmSnapshotHash("Contract", persisted)).toBe(signedHash);
    expect(after.audit.slice(0, before.audit.length)).toEqual(before.audit);
    expect(after.audit.map(row => row.action)).toEqual(expect.arrayContaining(["purchase_order_creation_initiated", "purchase_order_created", "purchase_order_linked", "procurement_finalized", "completed"]));
    expect(f.get("Request for Quotation", "RFQ-1")).toEqual(originalRfq); expect(f.get("Legal Document Review", "AWARD-1")).toEqual(originalAward);
    const retry = await f.create(); expect(retry).toMatchObject({ completed: true, reused: true, purchase_order: { name: "PO-1" } });
    expect(f.deps.createOrder).toHaveBeenCalledOnce(); expect(f.deps.submitOrder).toHaveBeenCalledOnce();
  });

  it("retains Procurement Finalization and the same draft after submission fails, then resumes without duplicate PO or signature changes", async () => {
    const f = fixture(); await f.approveContract(); const signed = parseClmData(f.get().custom_clm_data).signatures;
    const submit = f.deps.submitOrder;
    f.deps.submitOrder = vi.fn(async () => { throw new ClmError("ERPNext rejected submission", 422); });
    await expect(f.create()).rejects.toThrow("ERPNext rejected submission");
    expect(f.get("Purchase Order", "PO-1").docstatus).toBe(0);
    expect(parseClmData(f.get().custom_clm_data).rfq_workflow?.phase).toBe("procurement");
    expect(parseClmData(f.get().custom_clm_data).procurement_completion).toBeUndefined();
    f.deps.submitOrder = submit;
    expect(await f.create()).toMatchObject({ completed: true, reused: true, purchase_order: { name: "PO-1", docstatus: 1 } });
    expect(f.deps.createOrder).toHaveBeenCalledOnce(); expect(parseClmData(f.get().custom_clm_data).signatures).toEqual(signed);
  });

  it("converges concurrent Create PO attempts on one persistent order and one completion", async () => {
    const f = fixture(); await f.approveContract();
    const attempts = await Promise.allSettled([f.create(), f.create()]);
    // Optimistic Contract conflicts may require a retry, but never a second PO.
    expect(attempts.every(result => result.status === "fulfilled" || result.reason instanceof ClmError)).toBe(true);
    const resumed = await f.create();
    expect(resumed).toMatchObject({ completed: true, reused: true, purchase_order: { name: "PO-1", docstatus: 1 } });
    expect([...f.docs.keys()].filter(key => key.startsWith("Purchase Order/"))).toEqual(["Purchase Order/PO-1"]);
    const audit = parseClmData(f.get().custom_clm_data).audit;
    for (const action of ["purchase_order_creation_initiated", "purchase_order_created", "purchase_order_linked", "procurement_finalized", "completed"]) {
      expect(audit.filter(row => row.action === action)).toHaveLength(1);
    }
  });
});
