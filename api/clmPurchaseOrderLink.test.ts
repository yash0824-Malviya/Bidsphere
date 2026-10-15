import { describe, expect, it, vi } from "vitest";
import { ClmError, parseClmData } from "./clmCore";
import { getPurchaseOrderContract } from "./clmPurchaseOrderLink";
import { clmPurchaseOrderKey } from "./clmPurchaseOrder";
import type { AccessPrincipal } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";

const supplier: AccessPrincipal = { typ: "supplier", sub: "supplier@test.invalid", supplier: "SUP-1", iat: 1, exp: 9999999999 };
const team: AccessPrincipal = { typ: "internal", role: "procurement_team", sub: "team@test.invalid", email: "team@test.invalid", iat: 1, exp: 9999999999 };
function fixture() {
  const data = parseClmData(null);
  data.rfq_context = { rfq_id: "RFQ-1", award_id: "AWARD-1", supplier_id: "SUP-1", quotation_id: "SQ-1", contract_required: "Yes" };
  data.rfq_workflow = { version: 1, phase: "completed" };
  data.signatures = [{ party: "inteva", role: "legal", by: "legal@test.invalid", typed_name: "Legal", at: "2026-09-28 10:00:00", version: "1.0", file_id: "SIGNED", file_url: "/private/files/signed.pdf", hash: "b".repeat(64) }];
  data.locked_file = { file_id: "LOCKED", version: "1.0", file_url: "/private/files/locked.pdf", hash: "a".repeat(64) };
  const documents: Record<string, ClmRecord> = {
    "Purchase Order/PO-1": { name: "PO-1", supplier: "SUP-1", company: "Netlink", docstatus: 1, status: "To Receive and Bill", custom_clm_contract: "CON-1", custom_clm_rfq: "RFQ-1", custom_clm_award: "AWARD-1", custom_clm_creation_key: clmPurchaseOrderKey("CON-1", "AWARD-1", "SQ-1"), items: [{ item_code: "STEEL", supplier_quotation: "SQ-1", supplier_quotation_item: "SQI-1" }] },
    "Contract/CON-1": { name: "CON-1", party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1", custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_contract_status: "Active", custom_current_version: "1.0", custom_contract_value: 4500, custom_currency: "USD", start_date: "2026-09-25", end_date: "2026-10-25", custom_clm_data: JSON.stringify(data), internal_notes: "INTERNAL SECRET" },
    "Request for Quotation/RFQ-1": { name: "RFQ-1", company: "Netlink", contract_required: "Yes", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" } }) },
    "Legal Document Review/AWARD-1": { name: "AWARD-1", company: "Netlink", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "SUP-1" },
    "Supplier Quotation/SQ-1": { name: "SQ-1", supplier: "SUP-1", company: "Netlink", items: [{ name: "SQI-1", item_code: "STEEL", request_for_quotation: "RFQ-1" }] },
  };
  const deps = { load: vi.fn(async (type: string, name: string) => {
    const doc = documents[`${type}/${name}`]; if (!doc) throw new ClmError("Missing document", 404); return structuredClone(doc);
  }) };
  return { documents, deps, contract: documents["Contract/CON-1"], order: documents["Purchase Order/PO-1"], read: (principal = supplier) => getPurchaseOrderContract(principal, "PO-1", deps) };
}

describe("Purchase Order linked Contract read projection", () => {
  it("returns the existing supplier Contract with live values and exact current signed PDF", async () => {
    const f = fixture(), before = structuredClone(f.documents);
    expect(await f.read()).toEqual({ purchase_order: "PO-1", contract: {
      name: "CON-1", status: "Active", value: 4500, currency: "USD", start_date: "2026-09-25", end_date: "2026-10-25", rfq: "RFQ-1", award: "AWARD-1", quotation: "SQ-1", current_version: "1.0", supplier_id: "SUP-1", supplier_name: "SUP-1",
      workflow_status: "Completed", stage: "Completed", pdf_available: true, pdf: { file_id: "SIGNED", version: "1.0", hash: "b".repeat(64), kind: "signed" },
      signature_workflow: { supplier_status: "Pending", legal_status: "Signed", can_sign: false, can_review: true }, actions: [],
    } });
    expect(f.documents).toEqual(before); expect(JSON.stringify(await f.read())).not.toContain("INTERNAL SECRET");
  });
  it("uses the current record status/value on every load, not saved PO display metadata", async () => {
    const f = fixture(); f.contract.custom_contract_status = "Expired"; f.contract.custom_contract_value = 6250;
    expect((await f.read()).contract).toMatchObject({ status: "Expired", value: 6250 });
  });
  it("uses the verified PO supplier ID and saved display name without a supplier-name lookup", async () => {
    const f = fixture(); f.order.supplier_name = "Supplier One";
    expect((await f.read()).contract).toMatchObject({ supplier_id: "SUP-1", supplier_name: "Supplier One" });
    expect(f.deps.load).not.toHaveBeenCalledWith("Supplier", expect.anything());
    delete f.order.supplier_name;
    const data = parseClmData(f.contract.custom_clm_data); data.procurement_completion = { supplier: "SUP-1", supplier_name: "Verified Supplier", purchase_order: "PO-1" }; f.contract.custom_clm_data = JSON.stringify(data);
    expect((await f.read()).contract).toMatchObject({ supplier_id: "SUP-1", supplier_name: "Verified Supplier" });
    data.procurement_completion.supplier = "OTHER"; f.contract.custom_clm_data = JSON.stringify(data);
    expect((await f.read()).contract).toMatchObject({ supplier_id: "SUP-1", supplier_name: "SUP-1" });
  });
  it("allows existing authorized staff Contract reads", async () => {
    const f = fixture(); expect((await f.read(team)).contract?.name).toBe("CON-1");
    await expect(f.read({ ...team, role: "warehouse" })).rejects.toMatchObject({ status: 403 });
  });
  it("returns no Contract for an unlinked PO and does not infer from supplier or quotation", async () => {
    const f = fixture(); delete f.order.custom_clm_contract;
    expect(await f.read()).toEqual({ purchase_order: "PO-1", contract: null });
    expect(f.deps.load).toHaveBeenCalledTimes(1);
  });
  it("checks supplier ownership before resolving even an unlinked PO", async () => {
    const f = fixture(); delete f.order.custom_clm_contract;
    await expect(f.read({ ...supplier, supplier: "OTHER" })).rejects.toMatchObject({ status: 403 });
    expect(f.deps.load).toHaveBeenCalledTimes(1);
  });
  it("uses the existing canonical supplier identity policy", async () => {
    const f = fixture(); expect((await f.read({ ...supplier, supplier: '"sup-1"' })).contract?.name).toBe("CON-1");
  });
  it("denies another supplier's Contract even if a PO link is forged", async () => {
    const f = fixture(); f.contract.party_name = "OTHER"; f.contract.custom_supplier = "OTHER";
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
    expect(f.deps.load).toHaveBeenCalledTimes(2);
  });
  it.each(["Draft", "Pending Legal", "Rejected"])("preserves the existing supplier read restriction for %s", async status => {
    const f = fixture(); f.contract.custom_contract_status = status;
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
  });
  it.each(["Cancelled", "Closed"])("preserves supplier PO visibility policy for %s orders", async status => {
    const f = fixture(); f.order.status = status;
    await expect(f.read()).rejects.toMatchObject({ status: 403 });
  });
  it("fails with an actionable error when a saved Contract reference is missing", async () => {
    const f = fixture(); delete f.documents["Contract/CON-1"];
    await expect(f.read()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("reconcile") });
  });
  it.each(["custom_clm_rfq", "custom_clm_award", "custom_clm_creation_key"])("rejects a forged %s", async field => {
    const f = fixture(); f.order[field] = "OTHER";
    await expect(f.read()).rejects.toMatchObject({ status: 409 });
  });
  it.each(["rfq", "award", "quotation", "item", "company", "decision"])("rejects a conflicting %s without a summary", async field => {
    const f = fixture();
    if (field === "rfq") f.documents["Request for Quotation/RFQ-1"].name = "OTHER";
    if (field === "award") f.documents["Legal Document Review/AWARD-1"].rfq_name = "OTHER";
    if (field === "quotation") f.documents["Supplier Quotation/SQ-1"].supplier = "OTHER";
    if (field === "item") (f.order.items as ClmRecord[])[0].supplier_quotation = "OTHER";
    if (field === "company") f.order.company = "OTHER";
    if (field === "decision") f.documents["Request for Quotation/RFQ-1"].custom_approval_data = JSON.stringify({ contract_decision: { decision: "Yes", contract: "OTHER" } });
    await expect(f.read()).rejects.toMatchObject({ status: 409 });
  });
  it.each(["custom_purchase_order", "procurement_order", "procurement_completion"])("rejects the Contract's conflicting reverse PO reference in %s", async field => {
    const f = fixture();
    if (field === "custom_purchase_order") f.contract.custom_purchase_order = "PO-OTHER";
    else {
      const data = parseClmData(f.contract.custom_clm_data); data[field] = { purchase_order: "PO-OTHER" }; f.contract.custom_clm_data = JSON.stringify(data);
    }
    await expect(f.read()).rejects.toMatchObject({ status: 409 });
  });
  it("does not expose stale version or invalid PDF evidence", async () => {
    const f = fixture(); f.contract.custom_current_version = "2.0";
    await expect(f.read()).rejects.toMatchObject({ status: 409 });
  });
  it("keeps a legitimate Contract readable when no authoritative PDF exists", async () => {
    const f = fixture(), data = parseClmData(f.contract.custom_clm_data); data.signatures = []; delete data.locked_file; f.contract.custom_clm_data = JSON.stringify(data);
    expect((await f.read()).contract).toMatchObject({ name: "CON-1", pdf_available: false, signature_workflow: { supplier_status: "Pending", legal_status: "Pending", can_sign: false } });
  });
  it("does not expose supplier sign before PO-linked Contract acceptance", async () => {
    const f = fixture(), data = parseClmData(f.contract.custom_clm_data); data.rfq_workflow = { version: 1, phase: "signature" }; data.signatures = [];
    f.contract.custom_contract_status = "Pending Signature"; f.contract.custom_final_version_locked = 1; f.contract.custom_clm_data = JSON.stringify(data);
    expect((await f.read()).contract).toMatchObject({ signature_workflow: { can_sign: false }, actions: [] });
  });
  it("shows both signatures only when both versioned receipts exist", async () => {
    const f = fixture(), data = parseClmData(f.contract.custom_clm_data);
    data.signatures.push({ party: "supplier", by: supplier.sub, typed_name: "Supplier", at: "2026-09-28 11:00:00", version: "1.0", file_id: "COUNTERSIGNED", file_url: "/private/files/countersigned.pdf", hash: "c".repeat(64) }); f.contract.custom_clm_data = JSON.stringify(data);
    expect((await f.read()).contract).toMatchObject({ signature_workflow: { supplier_status: "Signed", legal_status: "Signed", can_sign: false }, pdf: { file_id: "COUNTERSIGNED", hash: "c".repeat(64) } });
  });
});
