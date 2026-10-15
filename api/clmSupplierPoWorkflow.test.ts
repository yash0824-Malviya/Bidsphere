import { describe, expect, it, vi } from "vitest";
import { applyClmAction, ClmError, clmSnapshotHash, parseClmData, rfqClmFinanceApproved, toClmAggregate, type ClmDeps } from "./clmCore";
import { assertClmSupplierPoReady, clmSupplierPoWorkflow, getClmSupplierPoWorkflow } from "./clmSupplierPoWorkflow";
import { clmPurchaseOrderKey } from "./clmPurchaseOrder";
import { getPurchaseOrderContract } from "./clmPurchaseOrderLink";
import type { AccessPrincipal } from "./rbacAuth";
import type { ClmRecord, ClmSignature } from "../src/types/clm";

const supplier: AccessPrincipal = { typ: "supplier", supplier: "SUP-1", sub: "SUP-1", iat: 1, exp: 9999999999999 };
const actor = (role: "procurement_team" | "warehouse" | "legal" | "finance"): AccessPrincipal => ({ typ: "internal", role, sub: role, email: `${role}@test.invalid`, iat: 1, exp: 9999999999999 });
const signPayload = { signer_email: "signer@supplier.test", full_legal_name: "Supplier Signer", signature: { method: "typed", value: "S. Signer", adopted: true }, consent: true, request_id: "supplier-sign-1" };
function fixture() {
  let sequence = 1;
  const contract: ClmRecord = { name: "CON-1", modified: "1", party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1", custom_contract_status: "Active", custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1",
    custom_current_version: "1.0", custom_contract_value: 4500, custom_currency: "USD", custom_inteva_signatory: "legal@test.invalid", custom_final_version_locked: 1,
    custom_esign_status: "Completed", custom_executed_contract: "/private/files/legal.pdf", contract_terms: "Reviewed terms", start_date: "2026-09-01", end_date: "2026-12-31" };
  const data = parseClmData(null); data.rfq_workflow = { version: 1, phase: "completed" }; data.version = "V1";
  data.rfq_context = { rfq_id: "RFQ-1", award_id: "AWARD-1", supplier_id: "SUP-1", quotation_id: "SQ-1", contract_required: "Yes" };
  data.approvals = [{ id: "LEGAL", role: "legal", stage: 0, rule: "RFQ", status: "Approved", by: "legal@test.invalid", at: "2026-09-29 08:00:00" }, { id: "FINANCE", role: "finance", stage: 1, rule: "RFQ", status: "Approved", by: "finance@test.invalid", at: "2026-09-29 10:00:00" }];
  data.signatures = [{ party: "inteva", by: "legal@test.invalid", role: "legal", at: "2026-09-29 09:00:00", version: "1.0", file_id: "LEGAL-PDF", file_url: "/private/files/legal.pdf", hash: "b".repeat(64), typed_name: "Legal" }];
  data.locked_file = { file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64), version: "1.0" }; data.locked_hash = clmSnapshotHash("Contract", contract);
  data.procurement_completion = { purchase_order: "PO-1", role: "procurement_team", by: "team@test.invalid", at: "2026-09-29 11:00:00", rfq: "RFQ-1", award: "AWARD-1", quotation: "SQ-1", supplier: "SUP-1" };
  contract.custom_clm_data = JSON.stringify(data);
  const documents: Record<string, ClmRecord> = {
    "Contract/CON-1": contract,
    "Purchase Order/PO-1": { name: "PO-1", supplier: "SUP-1", company: "Netlink", docstatus: 1, status: "To Receive and Bill", custom_clm_contract: "CON-1", custom_clm_rfq: "RFQ-1", custom_clm_award: "AWARD-1", custom_clm_creation_key: clmPurchaseOrderKey("CON-1", "AWARD-1", "SQ-1"), items: [{ item_code: "STEEL", supplier_quotation: "SQ-1", supplier_quotation_item: "SQI-1" }] },
    "Request for Quotation/RFQ-1": { name: "RFQ-1", company: "Netlink", contract_required: "Yes", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" } }) },
    "Legal Document Review/AWARD-1": { name: "AWARD-1", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "SUP-1" },
    "Supplier Quotation/SQ-1": { name: "SQ-1", supplier: "SUP-1", company: "Netlink", items: [{ name: "SQI-1", item_code: "STEEL", request_for_quotation: "RFQ-1" }] },
  };
  const get = () => structuredClone(documents["Contract/CON-1"]);
  const deps: ClmDeps & { verifyPdf: NonNullable<ClmDeps["verifyPdf"]> } = {
    load: vi.fn(async (dt, name) => { const doc = documents[`${dt}/${name}`]; if (!doc) throw new ClmError("Not found", 404); return structuredClone(doc); }),
    save: vi.fn(async (dt, doc) => { if (doc.modified !== documents[`${dt}/${doc.name}`]?.modified) throw new ClmError("Concurrent save", 409); const saved = { ...structuredClone(doc), modified: String(++sequence) }; documents[`${dt}/${doc.name}`] = saved; return saved; }),
    list: vi.fn(async () => []), create: vi.fn(async () => { throw new Error("No creates"); }), now: () => "2026-09-29 12:00:00", verifyPdf: vi.fn(async () => undefined),
    sign: vi.fn(async (doc, p, payload): Promise<ClmSignature> => ({ party: "supplier", by: p.sub, at: "2026-09-29 12:01:00", version: String(doc.custom_current_version), file_id: "SUPPLIER-PDF", file_url: "/private/files/supplier.pdf", hash: "c".repeat(64), typed_name: String((payload.signature as ClmRecord).value), full_legal_name: String(payload.full_legal_name), signature_method: "typed", signature_adopted: true, request_id: String(payload.request_id) })),
  };
  const acceptance = { consent: true, expected_version: "1.0", document_file_id: "LEGAL-PDF", document_hash: "b".repeat(64), request_id: "accept-1" };
  const act = (action: "supplier_accept" | "sign", payload: ClmRecord = action === "sign" ? signPayload : acceptance, who = supplier, revision = String(get().modified)) => applyClmAction({ doctype: "Contract", name: "CON-1", action, payload, expected_modified: revision }, who, deps);
  return { documents, deps, get, act, acceptance, workflow: () => clmSupplierPoWorkflow(get(), parseClmData(get().custom_clm_data), supplier) };
}

describe("Supplier PO Contract acceptance and signature sequence", () => {
  it("starts with acceptance only and blocks direct supplier sign and PO acceptance", async () => {
    const f = fixture(); expect(f.workflow()).toMatchObject({ status: "Supplier Contract Acceptance Required", can_accept_contract: true, can_sign_contract: false, can_accept_po: false });
    expect(toClmAggregate(supplier, "Contract", f.get()).actions.map(row => row.action)).toEqual(["supplier_accept"]);
    await expect(f.act("sign")).rejects.toMatchObject({ status: 403 }); await expect(assertClmSupplierPoReady(supplier, "PO-1", f.deps)).rejects.toMatchObject({ status: 409 });
    expect(f.deps.sign).not.toHaveBeenCalled(); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("persists acceptance, signs the existing Legal PDF, and unlocks PO with no internal workflow changes", async () => {
    const f = fixture(), before = f.get(), prior = parseClmData(before.custom_clm_data);
    await f.act("supplier_accept");
    expect(f.workflow()).toMatchObject({ acceptance_status: "Accepted", status: "Pending Supplier Signature", current_stage: "E-Signature", can_sign_contract: true, can_accept_po: false });
    // The actual supplier transport projection must agree with the action and
    // workflow grants; an internal-only readiness object hid Sign Contract.
    const supplierDetail = toClmAggregate(supplier, "Contract", f.get());
    expect(supplierDetail.record.custom_contract_status).toBe("Active");
    expect(supplierDetail.actions.map(row => row.action)).toEqual(["sign"]);
    expect(supplierDetail.signature_workflow).toMatchObject({ supplier_status: "Pending", legal_status: "Signed", is_legal_signatory: false, can_sign: true, can_review: true, can_request_signatures: false, document_file_id: "LEGAL-PDF" });
    expect(supplierDetail.signature_workflow?.blocked_reason).toBeUndefined();
    expect(f.deps.verifyPdf).toHaveBeenCalledWith(expect.objectContaining({ name: "CON-1" }), expect.objectContaining({ file_id: "LEGAL-PDF", hash: "b".repeat(64) }));
    const accepted = parseClmData(f.get().custom_clm_data).supplier_po_acceptance!;
    expect(accepted).toMatchObject({ contract: "CON-1", purchase_order: "PO-1", supplier: "SUP-1", by: "SUP-1", consent: true, version: "1.0", file_id: "LEGAL-PDF", at: "2026-09-29 12:00:00" });
    await expect(assertClmSupplierPoReady(supplier, "PO-1", f.deps)).rejects.toMatchObject({ status: 409 });
    await f.act("sign"); const after = f.get(), data = parseClmData(after.custom_clm_data);
    expect(f.workflow()).toMatchObject({ signature_status: "Signed", status: "Purchase Order Acceptance Required", can_accept_po: true, can_sign_contract: false });
    expect(data.signatures[1]).toMatchObject({ full_legal_name: "Supplier Signer", signer_email: "signer@supplier.test", signer_email_source: "supplier_declared", acceptance_id: accepted.id, source_file_id: "LEGAL-PDF", source_hash: "b".repeat(64), contract_id: "CON-1", purchase_order_id: "PO-1", supplier_id: "SUP-1" });
    expect(data.signatures[0]).toEqual(prior.signatures[0]); expect(data.locked_file).toEqual(prior.locked_file); expect(data.approvals).toEqual(prior.approvals); expect(data.procurement_completion).toEqual(prior.procurement_completion);
    expect(data.rfq_workflow).toEqual(prior.rfq_workflow); expect(after.custom_contract_status).toBe("Active"); expect(clmSnapshotHash("Contract", after)).toBe(clmSnapshotHash("Contract", before));
    expect(rfqClmFinanceApproved(after)).toBe(true); await expect(assertClmSupplierPoReady(supplier, "PO-1", f.deps)).resolves.toEqual({ supplierSignedAt: "2026-09-29 12:01:00" });
    await expect(assertClmSupplierPoReady(actor("warehouse"), "PO-1", f.deps)).resolves.toEqual({ supplierSignedAt: "2026-09-29 12:01:00" });
    expect(data.audit.map(row => row.action)).toEqual(["supplier_accept", "sign", "e_signed"]);
  });
  it("recovers accepted and signed responses without duplicate audits or PDFs", async () => {
    const f = fixture(); await f.act("supplier_accept"); await f.act("supplier_accept", f.acceptance, supplier, "1"); expect(f.deps.save).toHaveBeenCalledTimes(1);
    await f.act("sign"); await f.act("sign", signPayload, supplier, "1"); expect(f.deps.sign).toHaveBeenCalledTimes(1); expect(f.deps.save).toHaveBeenCalledTimes(2);
  });
  it.each(["consent", "expected_version", "document_file_id", "document_hash"])("rejects a missing or stale acceptance %s", async field => {
    const f = fixture(); await expect(f.act("supplier_accept", { ...f.acceptance, [field]: "invalid" })).rejects.toMatchObject({ status: 422 }); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it.each([actor("procurement_team"), actor("legal"), actor("finance"), { ...supplier, supplier: "OTHER" }])("denies an unauthorized acceptance actor %j", async who => {
    const f = fixture(); await expect(f.act("supplier_accept", f.acceptance, who)).rejects.toMatchObject({ status: 403 }); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("rejects a crossed PO source before acceptance", async () => {
    const f = fixture(); f.documents["Purchase Order/PO-1"].custom_clm_award = "OTHER";
    await expect(f.act("supplier_accept")).rejects.toMatchObject({ status: 409 }); expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("does not return success or unlock anything when acceptance is not persisted", async () => {
    const f = fixture(); vi.mocked(f.deps.save).mockImplementation(async (_dt, doc) => ({ ...doc, modified: "lost" }));
    await expect(f.act("supplier_accept")).rejects.toThrow("persistence could not be verified"); expect(f.workflow()?.can_accept_po).toBe(false);
  });
  it("blocks signing when acceptance document/version changes", async () => {
    const f = fixture(); await f.act("supplier_accept"); const doc = f.get(), data = parseClmData(doc.custom_clm_data); data.supplier_po_acceptance!.hash = "a".repeat(64); f.documents["Contract/CON-1"] = { ...doc, custom_clm_data: JSON.stringify(data) };
    await expect(f.act("sign")).rejects.toMatchObject({ status: 403 }); expect(f.deps.sign).not.toHaveBeenCalled();
  });
  it("validates signer email before producing a PDF", async () => {
    const f = fixture(); await f.act("supplier_accept"); await expect(f.act("sign", { ...signPayload, signer_email: "bad" })).rejects.toMatchObject({ status: 422 }); expect(f.deps.sign).not.toHaveBeenCalled();
  });
  it("stores optional declared signatory role separately from the authenticated supplier role", async () => {
    const f = fixture(); await f.act("supplier_accept"); await f.act("sign", { ...signPayload, signatory_role: "Sales Director" });
    expect(parseClmData(f.get().custom_clm_data).signatures[1]).toMatchObject({ signatory_role: "Sales Director", role: "supplier" });
    const g = fixture(); await g.act("supplier_accept"); await expect(g.act("sign", { ...signPayload, signatory_role: "x".repeat(121) })).rejects.toMatchObject({ status: 422 }); expect(g.deps.sign).not.toHaveBeenCalled();
  });
  it("uses a verified portal account email when its onboarding identity is available", async () => {
    const f = fixture(); f.documents["Supplier Onboarding/ON-1"] = { name: "ON-1", linked_supplier: "SUP-1", email: "registered@supplier.test" };
    await f.act("supplier_accept"); await f.act("sign", signPayload, { ...supplier, onboarding: "ON-1" });
    expect(parseClmData(f.get().custom_clm_data).signatures[1]).toMatchObject({ signer_email: "registered@supplier.test", signer_email_source: "registered_supplier_account" });
  });
  it("blocks failed PDF verification and preserves old signed-without-acceptance evidence", async () => {
    const f = fixture(); vi.mocked(f.deps.verifyPdf).mockRejectedValueOnce(new ClmError("PDF checksum mismatch", 409)); await expect(f.act("supplier_accept")).rejects.toThrow("checksum"); expect(f.deps.save).not.toHaveBeenCalled();
    const g = fixture(); await g.act("supplier_accept"); await g.act("sign"); const doc = g.get(), data = parseClmData(doc.custom_clm_data); delete data.supplier_po_acceptance; g.documents["Contract/CON-1"] = { ...doc, custom_clm_data: JSON.stringify(data) };
    expect(g.workflow()).toMatchObject({ can_accept_contract: false, can_sign_contract: false, can_accept_po: false, blocked_reason: expect.stringContaining("will not be replaced") });
  });
  it("keeps non-CLM PO acceptance untouched", async () => {
    const f = fixture(); delete f.documents["Purchase Order/PO-1"].custom_clm_contract;
    await expect(assertClmSupplierPoReady(supplier, "PO-1", f.deps)).resolves.toBeUndefined(); expect(f.deps.verifyPdf).not.toHaveBeenCalled();
  });
  it("shows PO acceptance and completion only from a real subsequent Shipment receipt", async () => {
    const f = fixture(); await f.act("supplier_accept"); await f.act("sign");
    const shipment = { name: "SHIP-1", po_name: "PO-1", supplier: "SUP-1", supplier_accepted: 1, shipment_status: "Accepted", supplier_acceptance_date: "2026-09-29 12:02:00", updated_by: "SUP-1" };
    vi.mocked(f.deps.list).mockResolvedValue([shipment]);
    const project = () => getClmSupplierPoWorkflow(f.get(), parseClmData(f.get().custom_clm_data), supplier, f.deps);
    expect(await project()).toMatchObject({ status: "Purchase Order Accepted", current_stage: "Existing PO Processing", next_stage: "Completed", po_acceptance_status: "Accepted", can_accept_po: false });
    shipment.shipment_status = "Completed";
    expect(await project()).toMatchObject({ status: "Completed", current_stage: "Completed", responsible: "None / Completed", can_accept_po: false });
    shipment.supplier_acceptance_date = "2026-09-29 11:00:00";
    expect(await project()).toMatchObject({ status: "Purchase Order Acceptance Required", po_acceptance_status: "Pending", can_accept_po: true });
  });
  it.each([
    { po_name: "PO-1", supplier: null },
    { po_name: "PO-1", supplier: "OTHER" },
    { po_name: "PO-OTHER", supplier: "SUP-1" },
    { po_name: "PO-1", supplier: "sup-1" },
    { po_name: "PO-1", supplier: '"SUP-1"' },
  ])("keeps the verified Contract visible without granting PO acceptance from an unrelated receipt %j", async identity => {
    const f = fixture(); await f.act("supplier_accept"); await f.act("sign");
    const before = structuredClone(f.documents);
    vi.mocked(f.deps.list).mockResolvedValue([{ name: "SHIP-1", ...identity, supplier_accepted: 1, shipment_status: "Completed", supplier_acceptance_date: "2026-09-29 12:02:00" }]);
    const result = await getPurchaseOrderContract(supplier, "PO-1", f.deps);
    expect(result.contract).toMatchObject({ name: "CON-1", supplier_id: "SUP-1", supplier_workflow: {
      acceptance_status: "Accepted", signature_status: "Signed", po_acceptance_status: "Pending", status: "Purchase Order Acceptance Required", can_accept_po: true,
    } });
    expect(result.contract?.supplier_workflow?.shipment_status).toBeUndefined();
    expect(f.deps.list).toHaveBeenCalledWith("PO Shipment", [["po_name", "=", "PO-1"], ["supplier", "=", "SUP-1"]]);
    expect(f.documents).toEqual(before);
  });
  it("keeps Contract acceptance required when no valid Contract or PO acceptance exists", async () => {
    const f = fixture(); vi.mocked(f.deps.list).mockResolvedValue([{ po_name: "PO-1", supplier: null, supplier_accepted: 1, shipment_status: "Accepted", supplier_acceptance_date: "2026-09-29 12:02:00" }]);
    expect((await getPurchaseOrderContract(supplier, "PO-1", f.deps)).contract?.supplier_workflow).toMatchObject({ acceptance_status: "Pending", signature_status: "Pending", po_acceptance_status: "Pending", status: "Supplier Contract Acceptance Required", can_accept_contract: true, can_accept_po: false });
    expect(f.deps.save).not.toHaveBeenCalled();
  });
  it("rejects duplicate matching Shipment records in the supplier lifecycle", async () => {
    const f = fixture(); await f.act("supplier_accept");
    vi.mocked(f.deps.list).mockResolvedValue([{ po_name: "PO-1", supplier: "SUP-1" }, { po_name: "PO-1", supplier: "SUP-1" }]);
    await expect(getClmSupplierPoWorkflow(f.get(), parseClmData(f.get().custom_clm_data), supplier, f.deps)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["contract_id", "purchase_order_id", "supplier_id"])("rejects a conflicting explicit supplier signature %s without rewriting evidence", async field => {
    const f = fixture(); await f.act("supplier_accept"); await f.act("sign");
    const record = f.get(), data = parseClmData(record.custom_clm_data); Object.assign(data.signatures[1], { [field]: "OTHER" });
    f.documents["Contract/CON-1"].custom_clm_data = JSON.stringify(data);
    expect(f.workflow()).toMatchObject({ signature_status: "Pending", can_accept_po: false });
    await expect(assertClmSupplierPoReady(supplier, "PO-1", f.deps)).rejects.toMatchObject({ status: 409 });
  });
  it("preserves valid historical signatures bound through acceptance_id without adding new metadata", async () => {
    const f = fixture(); await f.act("supplier_accept"); await f.act("sign");
    const record = f.get(), data = parseClmData(record.custom_clm_data); delete data.signatures[1].contract_id; delete data.signatures[1].purchase_order_id; delete data.signatures[1].supplier_id;
    f.documents["Contract/CON-1"].custom_clm_data = JSON.stringify(data);
    const before = structuredClone(f.documents);
    expect((await getPurchaseOrderContract(supplier, "PO-1", f.deps)).contract?.supplier_workflow).toMatchObject({ signature_status: "Signed", can_accept_po: true });
    expect(f.documents).toEqual(before);
  });
  it("verifies the persisted signed PDF again before PO acceptance", async () => {
    const f = fixture(); await f.act("supplier_accept"); await f.act("sign");
    vi.mocked(f.deps.verifyPdf).mockRejectedValueOnce(new ClmError("Saved PDF changed", 409));
    await expect(assertClmSupplierPoReady(supplier, "PO-1", f.deps)).rejects.toThrow("Saved PDF changed");
  });
});
