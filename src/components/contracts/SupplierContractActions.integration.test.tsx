import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { applyClmAction, ClmError, clmSnapshotHash, parseClmData, toClmAggregate, type ClmDeps } from "../../../api/clmCore";
import type { AccessPrincipal } from "../../../api/rbacAuth";
import type { ClmAggregate, ClmRecord } from "../../types/clm";
import type { ClmDetail } from "../../api/clm";
vi.mock("./ClmFields", () => ({ CLM_BUTTON: "button", CLM_PRIMARY: "primary" }));
vi.mock("./RfqContractSigning", () => ({ SigningWorkspace: () => null }));
vi.mock("./ClmDocuments", () => ({ default: () => null }));
import SupplierContractActions from "./SupplierContractActions";

const supplier: AccessPrincipal = { typ: "supplier", supplier: "SUP-1", sub: "SUP-1", iat: 1, exp: Number.MAX_SAFE_INTEGER };
const render = (aggregate: ClmAggregate) => renderToStaticMarkup(<MemoryRouter><SupplierContractActions
  detail={JSON.parse(JSON.stringify(aggregate)) as ClmDetail} fields={[]} busy={false} onAction={async () => undefined}
/></MemoryRouter>);
const hasButton = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).test(html);

/** Exercise the actual server action/aggregate and actual action component.
 * Only ERP transport and the separately tested PDF signature transport are stubbed.
 * Never construct supplier_workflow/signature_workflow/actions by hand: doing so
 * hid the production regression where the supplier response omitted its grant. */
function fixture() {
  let revision = 1;
  const contract: ClmRecord = { name: "CON-1", modified: "1", party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1", custom_contract_status: "Active",
    custom_rfq: "RFQ-1", custom_supplier_quotation: "SQ-1", custom_current_version: "1.0", custom_contract_value: 4500, custom_currency: "USD",
    custom_inteva_signatory: "legal@test.invalid", custom_final_version_locked: 1, custom_esign_status: "Completed", custom_executed_contract: "/private/files/legal.pdf",
    contract_terms: "Approved supply terms", start_date: "2026-09-01", end_date: "2026-12-31" };
  const data = parseClmData(null);
  data.rfq_workflow = { version: 1, phase: "completed" };
  data.rfq_context = { rfq_id: "RFQ-1", award_id: "AWARD-1", supplier_id: "SUP-1", quotation_id: "SQ-1", contract_required: "Yes" };
  data.approvals = [
    { id: "LEGAL", role: "legal", stage: 0, rule: "RFQ", status: "Approved", by: "legal@test.invalid", at: "2026-09-29 08:00:00" },
    { id: "FINANCE", role: "finance", stage: 1, rule: "RFQ", status: "Approved", by: "finance@test.invalid", at: "2026-09-29 10:00:00" },
  ];
  data.signatures = [{ party: "inteva", by: "legal@test.invalid", role: "legal", at: "2026-09-29 09:00:00", version: "1.0", file_id: "LEGAL-PDF", file_url: "/private/files/legal.pdf", hash: "b".repeat(64), typed_name: "Legal" }];
  data.locked_file = { file_id: "LOCKED", file_url: "/private/files/locked.pdf", hash: "a".repeat(64), version: "1.0" };
  data.locked_hash = clmSnapshotHash("Contract", contract);
  data.procurement_completion = { purchase_order: "PO-1", role: "procurement_team", by: "team@test.invalid", at: "2026-09-29 11:00:00", rfq: "RFQ-1", award: "AWARD-1", quotation: "SQ-1", supplier: "SUP-1" };
  contract.custom_clm_data = JSON.stringify(data);
  const documents: Record<string, ClmRecord> = {
    "Contract/CON-1": contract,
    "Purchase Order/PO-1": { name: "PO-1", supplier: "SUP-1", company: "Netlink", docstatus: 1, status: "To Receive and Bill", custom_clm_contract: "CON-1", custom_clm_rfq: "RFQ-1", custom_clm_award: "AWARD-1", items: [{ item_code: "STEEL", supplier_quotation: "SQ-1", supplier_quotation_item: "SQI-1" }] },
    "Request for Quotation/RFQ-1": { name: "RFQ-1", company: "Netlink", contract_required: "Yes", custom_approval_data: JSON.stringify({ contract_decision: { decision: "Yes", contract: "CON-1", award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" } }) },
    "Legal Document Review/AWARD-1": { name: "AWARD-1", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "SUP-1" },
    "Supplier Quotation/SQ-1": { name: "SQ-1", supplier: "SUP-1", company: "Netlink", items: [{ name: "SQI-1", item_code: "STEEL", request_for_quotation: "RFQ-1" }] },
  };
  const get = () => structuredClone(documents["Contract/CON-1"]);
  const deps: ClmDeps = {
    load: async (type, name) => { const saved = documents[`${type}/${name}`]; if (!saved) throw new ClmError("Not found", 404); return structuredClone(saved); },
    save: async (type, doc) => { if (doc.modified !== documents[`${type}/${doc.name}`]?.modified) throw new ClmError("Stale save", 409); const saved = { ...structuredClone(doc), modified: String(++revision) }; documents[`${type}/${doc.name}`] = saved; return saved; },
    list: async () => [], create: async () => { throw new Error("Unexpected create"); }, now: () => "2026-09-29 12:00:00", verifyPdf: async () => undefined,
    sign: async (doc, who, payload) => ({ party: "supplier", by: who.sub, at: "2026-09-29 12:01:00", version: String(doc.custom_current_version), file_id: "SUPPLIER-PDF", file_url: "/private/files/supplier.pdf", hash: "c".repeat(64), typed_name: String((payload.signature as ClmRecord).value), full_legal_name: String(payload.full_legal_name), signature_method: "typed", signature_adopted: true, request_id: String(payload.request_id) }),
  };
  const act = (action: "supplier_accept" | "sign", payload: ClmRecord) => applyClmAction({ doctype: "Contract", name: "CON-1", expected_modified: String(get().modified), action, payload }, supplier, deps);
  return {
    aggregate: () => toClmAggregate(supplier, "Contract", get()),
    accept: () => act("supplier_accept", { consent: true, expected_version: "1.0", document_file_id: "LEGAL-PDF", document_hash: "b".repeat(64) }),
    sign: () => act("sign", { consent: true, signer_email: "supplier@test.invalid", full_legal_name: "Supplier Signer", signature: { method: "typed", value: "Supplier Signer", adopted: true }, request_id: "sign-1" }),
  };
}

describe("persisted supplier Contract state → visible action integration", () => {
  it("shows Accept Contract only before the backend acceptance action", () => {
    const f = fixture(), aggregate = f.aggregate(), html = render(aggregate);
    expect(hasButton(html, "Accept Contract")).toBe(true);
    expect(hasButton(html, "Sign Contract")).toBe(false);
    expect(aggregate.supplier_workflow?.can_accept_po).toBe(false);
  });
  it("shows Sign Contract from the real successful acceptance response and independently reloaded aggregate", async () => {
    const f = fixture(), accepted = await f.accept();
    for (const aggregate of [accepted, f.aggregate()]) {
      expect(aggregate.actions.map(action => action.action)).toContain("sign");
      expect(aggregate.signature_workflow).toMatchObject({ can_sign: true, supplier_status: "Pending", legal_status: "Signed" });
      expect(aggregate.supplier_workflow).toMatchObject({ acceptance_status: "Accepted", can_sign_contract: true, can_accept_po: false });
      const html = render(aggregate);
      expect(hasButton(html, "Sign Contract")).toBe(true);
      expect(hasButton(html, "Accept Contract")).toBe(false);
    }
  });
  it("removes Sign Contract after the real signature action and exposes PO readiness", async () => {
    const f = fixture(); await f.accept(); const signed = await f.sign();
    for (const aggregate of [signed, f.aggregate()]) {
      expect(aggregate.signature_workflow).toMatchObject({ can_sign: false, supplier_status: "Signed", legal_status: "Signed" });
      expect(aggregate.supplier_workflow).toMatchObject({ signature_status: "Signed", can_sign_contract: false, can_accept_po: true, current_stage: "Purchase Order Acceptance" });
      const html = render(aggregate);
      expect(hasButton(html, "Sign Contract")).toBe(false);
      expect(hasButton(html, "Accept Contract")).toBe(false);
      expect(html).toContain('href="/supplier/po/PO-1"');
    }
  });
});
