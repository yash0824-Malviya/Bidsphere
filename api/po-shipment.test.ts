import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ClmError, clmSnapshotHash, parseClmData } from "./clmCore";
import { issueSupplierAccessToken } from "./rbacAuth";
import type { ClmRecord } from "../src/types/clm";
import type { PoShipmentRecord } from "./poShipmentCore";
const remote = vi.hoisted(() => ({ erp: vi.fn(), pdf: vi.fn(), get: vi.fn(), upsert: vi.fn() }));
vi.mock("./clmErp", async original => ({ ...await original<typeof import("./clmErp")>(), clmErpRequest: remote.erp }));
vi.mock("./clmSignature", async original => ({ ...await original<typeof import("./clmSignature")>(), readClmPdf: remote.pdf }));
vi.mock("./poShipmentCore", async original => ({ ...await original<typeof import("./poShipmentCore")>(), getPoShipment: remote.get, upsertPoShipment: remote.upsert }));
import handler from "./po-shipment";

let documents: Record<string, ClmRecord>, shipment: PoShipmentRecord | null;
const originalSecret = process.env.BIDSPHERE_SESSION_SECRET;
beforeEach(() => {
  vi.resetAllMocks(); process.env.BIDSPHERE_SESSION_SECRET = "shipment-unit-tests"; shipment = null;
  const data = parseClmData(null);
  data.rfq_context = { rfq_id: "RFQ-1", award_id: "AWARD-1", supplier_id: "SUP-1", quotation_id: "SQ-1", contract_required: "Yes" };
  data.rfq_workflow = { version: 1, phase: "completed" };
  data.approvals = [
    { id: "LEGAL", role: "legal", stage: 0, rule: "All", status: "Approved", by: "legal@example.test", at: "2026-09-28 09:00:00" },
    { id: "FINANCE", role: "finance", stage: 1, rule: "All", status: "Approved", by: "finance@example.test", at: "2026-09-28 11:00:00" },
  ];
  data.locked_file = { file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64), version: "1.0" };
  data.signatures = [
    { party: "inteva", role: "legal", by: "legal@example.test", typed_name: "Legal", at: "2026-09-28 10:00:00", version: "1.0", file_id: "LEGAL-SIGNED", file_url: "/private/files/legal.pdf", hash: "b".repeat(64) },
    { party: "supplier", by: "SUP-1", typed_name: "Supplier Signer", full_legal_name: "Supplier Signer", signer_email: "supplier@example.test", at: "2026-09-29 10:00:00", version: "1.0", file_id: "SUPPLIER-SIGNED", file_url: "/private/files/supplier.pdf", hash: "c".repeat(64), acceptance_id: "ACCEPTANCE-1", source_file_id: "LEGAL-SIGNED", source_hash: "b".repeat(64) },
  ];
  data.supplier_po_acceptance = { id: "ACCEPTANCE-1", status: "Accepted", consent: true, contract: "CON-1", purchase_order: "PO-1", supplier: "SUP-1", by: "SUP-1", at: "2026-09-29 09:00:00", version: "1.0", file_id: "LEGAL-SIGNED", file_url: "/private/files/legal.pdf", hash: "b".repeat(64) };
  data.procurement_completion = { purchase_order: "PO-1", role: "procurement_team", by: "team@example.test", at: "2026-09-28 12:00:00", rfq: "RFQ-1", award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" };
  const contract = { name: "CON-1", party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1", custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_current_version: "1.0", custom_contract_status: "Active", custom_inteva_signatory: "legal@example.test", custom_final_version_locked: 1, custom_esign_status: "Completed", custom_executed_contract: "/private/files/supplier.pdf", custom_purchase_order: "PO-1", custom_clm_data: "" };
  data.locked_hash = clmSnapshotHash("Contract", contract); contract.custom_clm_data = JSON.stringify(data);
  documents = {
    "Purchase Order/PO-1": { name: "PO-1", supplier: "SUP-1", company: "Netlink", docstatus: 1, status: "To Receive and Bill", custom_clm_contract: "CON-1", custom_clm_rfq: "RFQ-1", custom_clm_award: "AWARD-1", items: [{ item_code: "STEEL", supplier_quotation: "SQ-1", supplier_quotation_item: "SQI-1" }] },
    "Contract/CON-1": contract,
    "Request for Quotation/RFQ-1": { name: "RFQ-1", company: "Netlink", contract_required: "Yes", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" } }) },
    "Legal Document Review/AWARD-1": { name: "AWARD-1", company: "Netlink", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "SUP-1" },
    "Supplier Quotation/SQ-1": { name: "SQ-1", supplier: "SUP-1", company: "Netlink", items: [{ name: "SQI-1", item_code: "STEEL", request_for_quotation: "RFQ-1" }] },
  };
  remote.erp.mockImplementation(async (_method: string, path: string) => {
    const doc = documents[decodeURIComponent(path).replace(/^resource\//, "")]; if (!doc) throw new ClmError("Missing ERP record", 404); return structuredClone(doc);
  });
  remote.get.mockImplementation(async () => structuredClone(shipment));
  remote.upsert.mockImplementation(async input => { shipment = { ...input, name: "SHIP-1", supplier_accepted: input.supplier_accepted ? 1 : 0 }; return structuredClone(shipment); });
  remote.pdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
});
afterEach(() => { if (originalSecret === undefined) delete process.env.BIDSPHERE_SESSION_SECRET; else process.env.BIDSPHERE_SESSION_SECRET = originalSecret; });
async function call(supplier = "SUP-1", status = "Accepted", authenticated = true) {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn() }; res.status.mockReturnValue(res);
  await handler({ method: "POST", query: { action: "upsert" }, body: { po_name: "PO-1", shipment_status: status, supplier_accepted: true }, headers: authenticated ? { "x-bidsphere-access-token": issueSupplierAccessToken({ supplier }) } : {} } as unknown as VercelRequest, res as unknown as VercelResponse);
  return res;
}
describe("PO Shipment endpoint real CLM acceptance/signature gate", () => {
  it("requires an authenticated supplier/staff session", async () => { expect((await call("SUP-1", "Accepted", false)).status).toHaveBeenCalledWith(401); expect(remote.upsert).not.toHaveBeenCalled(); });
  it("rejects foreign suppliers before reading the Contract", async () => {
    expect((await call("OTHER")).status).toHaveBeenCalledWith(403); expect(remote.erp).toHaveBeenCalledTimes(1); expect(remote.upsert).not.toHaveBeenCalled();
  });
  it.each(["Accepted", "In Transit"])("rejects direct %s when the saved Contract has no acceptance receipt", async status => {
    const record = documents["Contract/CON-1"], data = parseClmData(record.custom_clm_data); delete data.supplier_po_acceptance; record.custom_clm_data = JSON.stringify(data);
    expect((await call("SUP-1", status)).status).toHaveBeenCalledWith(409); expect(remote.upsert).not.toHaveBeenCalled(); expect(remote.get).not.toHaveBeenCalled();
  });
  it("rejects a saved acceptance without the supplier signature", async () => {
    const record = documents["Contract/CON-1"], data = parseClmData(record.custom_clm_data); data.signatures.pop(); record.custom_executed_contract = "/private/files/legal.pdf"; record.custom_clm_data = JSON.stringify(data);
    expect((await call()).status).toHaveBeenCalledWith(409); expect(remote.upsert).not.toHaveBeenCalled();
  });
  it("rejects corrupted signed PDF bytes before any shipment mutation", async () => {
    remote.pdf.mockRejectedValue(new ClmError("The locked Contract document has changed.", 409));
    expect((await call()).status).toHaveBeenCalledWith(409); expect(remote.upsert).not.toHaveBeenCalled();
  });
  it("accepts only after verifying the current accepted source and signed document, then re-fetches the ERP shipment", async () => {
    const res = await call(); expect(res.status).toHaveBeenCalledWith(200); expect(res.json).toHaveBeenCalledWith({ success: true, record: expect.objectContaining({ name: "SHIP-1", shipment_status: "Accepted", supplier_accepted: 1, updated_by: "SUP-1" }) });
    expect(remote.pdf).toHaveBeenCalledTimes(2); expect(remote.pdf.mock.calls.map(([, evidence]) => evidence.file_id)).toEqual(["LEGAL-SIGNED", "SUPPLIER-SIGNED"]); expect(remote.get).toHaveBeenCalledTimes(2);
  });
  it("keeps ordinary non-CLM PO acceptance available without Contract evidence", async () => {
    delete documents["Purchase Order/PO-1"].custom_clm_contract;
    expect((await call()).status).toHaveBeenCalledWith(200); expect(remote.pdf).not.toHaveBeenCalled();
  });
});
