import { describe, expect, it, vi } from "vitest";
import { assertNoGenericClmAccess, authorizeClmFileIfApplicable, authorizeClmScope, authorizeClmUpload } from "./clmGatewayGuard";
import { authorizeFileResourceRequest, authorizePersistedFileRead } from "./fileResourceGuard";
import { requestDoctypesFromBodyOrQuery } from "./ecrDirectWorkflowGuard";
import { canonicalizeProxyApiPath } from "./proxyPathGuard";
import type { AccessPrincipal, AppRole } from "./rbacAuth";
import type { ParsedSecureUpload } from "./secureUploadGuard";
import type { ClmRecord } from "../src/types/clm";
import { clmSnapshotHash } from "./clmCore";

const internal = (role: AppRole): AccessPrincipal => ({ typ: "internal", role, sub: `${role}@example.test`, email: `${role}@example.test`, iat: 1, exp: 9999999999 });
const supplier = (name = "SUP-A"): AccessPrincipal => ({ typ: "supplier", supplier: name, sub: name, iat: 1, exp: 9999999999 });
const runtime = { schema: 1, approvals: [{ id: "approval-finance", role: "finance", stage: 0, status: "Pending", rule: "POLICY" }], versions: [], audit: [], signatures: [], sla: [] };
const contract: ClmRecord = { name: "CON-A", party_type: "Supplier", party_name: "SUP-A", custom_supplier: "SUP-A", custom_contract_status: "Negotiation", custom_contract_document: "/private/files/contract-a.pdf", custom_clm_data: JSON.stringify(runtime) };
const file = { name: "FILE-A", attached_to_doctype: "Contract", attached_to_name: "CON-A", file_url: "/private/files/contract-a.pdf", is_private: 1 };
const upload: ParsedSecureUpload = { doctype: "Contract", docname: "CON-A", fieldname: "", fileName: "redline.pdf", fileSize: 100, fields: { is_private: "1" } };
function loader(overrides: Record<string, ClmRecord> = {}) {
  const rows: Record<string, ClmRecord> = { "Contract/CON-A": contract, "File/FILE-A": file, ...overrides };
  return vi.fn(async (doctype: string, name: string) => { const row = rows[`${doctype}/${name}`]; if (!row) throw Object.assign(new Error("Document not found."), { status: 404 }); return structuredClone(row); });
}

describe("CLM service-credential gateway boundaries", () => {
  it.each(["Contract", "Contract Request", "Contract Clause", "Contract Approval Matrix", "Contract Risk", "Contract Milestone", "Contract Obligation", "Contract Renewal", "Contract Amendment", "Contract Template"])("blocks generic %s resource reads and writes", doctype => {
    for (const path of [`resource/${doctype}`, `resource/${encodeURIComponent(doctype)}/RECORD`]) {
      expect(() => assertNoGenericClmAccess(decodeURIComponent(canonicalizeProxyApiPath(path)), [])).toThrow("secured Contract Lifecycle API");
    }
  });

  it.each([
    ["method/frappe.client.get", { doctype: "Contract", name: "CON-A" }],
    ["method/frappe.client.save", { doc: { doctype: "Contract", name: "CON-A", custom_contract_status: "Approved" } }],
    ["method/frappe.desk.form.save.savedocs", { doc: JSON.stringify({ doctype: "Contract", name: "CON-A" }) }],
    ["method/frappe.client.set_value", { dt: "Contract", name: "CON-A", fieldname: "custom_final_version_locked", value: 0 }],
    ["method/frappe.client.insert_many", { docs: JSON.stringify([{ doctype: "Note" }, { doctype: "Contract Request" }]) }],
    ["method/frappe.model.workflow.apply_workflow", { doc: JSON.stringify({ doctype: "Contract", name: "CON-A" }), action: "Approve" }],
  ])("blocks nested generic/RPC route %s", (path, body) => {
    expect(() => assertNoGenericClmAccess(String(path), requestDoctypesFromBodyOrQuery(body, {}))).toThrow("secured Contract Lifecycle API");
  });

  it("leaves unrelated RFQ and ECR requests to their existing guards", () => {
    expect(() => assertNoGenericClmAccess("resource/Request for Quotation/RFQ-1", [])).not.toThrow();
    expect(() => assertNoGenericClmAccess("resource/Engineering Change Request/ECR-1", [])).not.toThrow();
  });

  it("permits routed Finance and denies unrouted Legal", async () => {
    await expect(authorizeClmScope(internal("finance"), "Contract", "CON-A", loader())).resolves.toMatchObject({ name: "CON-A" });
    await expect(authorizeClmScope(internal("legal"), "Contract", "CON-A", loader())).rejects.toMatchObject({ status: 403 });
  });

  it("allows only the owning supplier, and never exposes internal related records", async () => {
    await expect(authorizeClmScope(supplier(), "Contract", "CON-A", loader())).resolves.toMatchObject({ name: "CON-A" });
    await expect(authorizeClmScope(supplier("SUP-B"), "Contract", "CON-A", loader())).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmScope(supplier(), "Contract Risk", "RISK-A", loader({ "Contract Risk/RISK-A": { name: "RISK-A", contract: "CON-A" } }))).rejects.toMatchObject({ status: 403 });
  });

  it.each(["Draft", "Under Review", "Pending Approval"])("keeps %s supplier drafts/review data private", async state => {
    await expect(authorizeClmScope(supplier(), "Contract", "CON-A", loader({ "Contract/CON-A": { ...contract, custom_contract_status: state } }))).rejects.toMatchObject({ status: 403 });
  });

  it("uses the same policy for scoped files, generic metadata, and byte downloads", async () => {
    for (const principal of [supplier("SUP-B"), internal("legal")]) {
      await expect(authorizeClmFileIfApplicable({ principal, file, loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
      await expect(authorizePersistedFileRead({ principal, file, loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
      await expect(authorizeFileResourceRequest({ apiPath: "resource/File/FILE-A", method: "GET", principal, loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("denies supplier internal attachments even when attached to their own Contract", async () => {
    await expect(authorizeClmFileIfApplicable({ principal: supplier(), file: { ...file, file_url: "/private/files/internal-risk.pdf" }, loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmFileIfApplicable({ principal: supplier(), file, loadDocument: loader() })).resolves.toBe(true);
  });

  it("refuses public Contract attachments for all roles", async () => {
    await expect(authorizeClmFileIfApplicable({ principal: internal("admin"), file: { ...file, is_private: 0 }, loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
  });
  it("shares published supplier documents by exact File ID and path, without exposing internal files", async () => {
    const shared = { file_id: "SUPPLIER-FILE", file_url: "/private/files/supporting.pdf", file_name: "supporting.pdf", by: "SUP-A", at: "2026-09-17 10:00:00" };
    const loadDocument = loader({ "Contract/CON-A": { ...contract, custom_clm_data: JSON.stringify({ ...runtime, supplier_documents: [shared] }) } });
    const supportingFile = { ...file, name: shared.file_id, file_url: shared.file_url };
    await expect(authorizeClmFileIfApplicable({ principal: supplier(), file: supportingFile, loadDocument })).resolves.toBe(true);
    await expect(authorizeClmFileIfApplicable({ principal: supplier(), file: { ...supportingFile, name: "INTERNAL-DUPLICATE" }, loadDocument })).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmFileIfApplicable({ principal: supplier("SUP-B"), file: supportingFile, loadDocument })).rejects.toMatchObject({ status: 403 });
  });
  it("permits a pending upload preview only for its supplier and authenticated uploader", async () => {
    const receipt = { file_id: "PENDING", file_url: "/private/files/pending.pdf", file_name: "pending.pdf", supplier: "SUP-A", by: "SUP-A", at: "2026-09-17 10:00:00" };
    const loadDocument = loader({ "Contract/CON-A": { ...contract, custom_clm_data: JSON.stringify({ ...runtime, supplier_uploads: [receipt] }) } });
    const pendingFile = { ...file, name: receipt.file_id, file_url: receipt.file_url };
    await expect(authorizeClmFileIfApplicable({ principal: supplier(), file: pendingFile, loadDocument })).resolves.toBe(true);
    await expect(authorizeClmFileIfApplicable({ principal: { ...supplier(), sub: "OTHER-USER" }, file: pendingFile, loadDocument })).rejects.toMatchObject({ status: 403 });
  });

  it("prevents suppliers from enumerating the internal File collection", async () => {
    const filters = JSON.stringify([["attached_to_doctype", "=", "Contract"], ["attached_to_name", "=", "CON-A"]]);
    await expect(authorizeFileResourceRequest({ apiPath: "resource/File", method: "GET", query: { filters }, principal: supplier(), loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
    await expect(authorizeFileResourceRequest({ apiPath: "resource/File", method: "GET", query: { filters }, principal: internal("finance"), loadDocument: loader() })).resolves.toBeNull();
  });

  it.each(["PUT", "PATCH", "DELETE"])("denies direct File %s even for administrators", async method => {
    await expect(authorizeFileResourceRequest({ apiPath: "resource/File/FILE-A", method, body: { is_private: 0 }, principal: internal("admin"), loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
  });

  it("denies relinking an unrelated File into a Contract", async () => {
    const loadDocument = loader({ "File/FILE-A": { ...file, attached_to_doctype: "Material Request", attached_to_name: "MR-A" } });
    await expect(authorizeFileResourceRequest({ apiPath: "resource/File/FILE-A", method: "PUT", body: { attached_to_doctype: "Contract", attached_to_name: "CON-A" }, principal: internal("procurement"), loadDocument })).rejects.toMatchObject({ status: 403 });
  });

  it("permits private coordinator and supplier negotiation uploads", async () => {
    for (const role of ["procurement_team", "procurement", "admin"] as const) await expect(authorizeClmUpload(internal(role), upload, loader())).resolves.toBe(true);
    await expect(authorizeClmUpload(supplier(), upload, loader())).resolves.toBe(true);
  });

  it.each(["Contract", "Contract Request"])("allows only Team to upload an RFQ-linked %s draft", async doctype => {
    const draft = { ...contract, custom_rfq: "RFQ-1", custom_contract_status: "Draft", request_status: "Draft" };
    const source = loader({ [`${doctype}/CON-A`]: draft });
    const rfqUpload = { ...upload, doctype };
    await expect(authorizeClmUpload(internal("procurement_team"), rfqUpload, source)).resolves.toBe(true);
    for (const role of ["procurement", "admin", "legal", "finance"] as const) await expect(authorizeClmUpload(internal(role), rfqUpload, source)).rejects.toMatchObject({ status: 403 });
  });

  it.each(["Pending Legal", "Under Review", "Pending Review", "Approved", "Negotiation", "Pending Signature", "Pending Finance", "Executed", "Active", "Rejected", "Completed"])("blocks Team upload after RFQ authoring at %s", async status => {
    for (const doctype of ["Contract", "Contract Request"]) {
      const source = loader({ [`${doctype}/CON-A`]: { ...contract, custom_rfq: "RFQ-1", custom_contract_status: status, request_status: status } });
      await expect(authorizeClmUpload(internal("procurement_team"), { ...upload, doctype }, source)).rejects.toMatchObject({ status: 403 });
    }
  });

  it("checks the RFQ action policy instead of accepting stale negotiation or malformed draft evidence", async () => {
    await expect(authorizeClmUpload(supplier(), upload, loader({ "Contract/CON-A": { ...contract, custom_rfq: "RFQ-1" } }))).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmUpload(internal("procurement_team"), upload, loader({ "Contract/CON-A": { ...contract, custom_rfq: "RFQ-1", custom_contract_status: "Draft", custom_clm_data: "{invalid" } }))).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmUpload(internal("procurement_team"), upload, loader({ "Contract/CON-A": { ...contract, custom_rfq: "RFQ-1", custom_contract_status: "Draft", custom_final_version_locked: 1 } }))).rejects.toMatchObject({ status: 403 });
  });

  it.each(["Contract Risk", "Contract Obligation", "Contract Milestone", "Contract Amendment", "Contract Renewal"])("blocks Manager/Admin attachments through RFQ-linked %s children", async doctype => {
    const source = loader({ "Contract/CON-A": { ...contract, custom_rfq: "RFQ-1", custom_contract_status: "Draft" }, [`${doctype}/CHILD-A`]: { name: "CHILD-A", contract: "CON-A" } });
    for (const role of ["procurement", "admin"] as const) await expect(authorizeClmUpload(internal(role), { ...upload, doctype, docname: "CHILD-A" }, source)).rejects.toMatchObject({ status: 403 });
  });

  it("permits Team child authoring in Draft and preserves standalone child permissions", async () => {
    const childUpload = { ...upload, doctype: "Contract Risk", docname: "CHILD-A" };
    const child = { name: "CHILD-A", contract: "CON-A", risk_status: "Open" };
    await expect(authorizeClmUpload(internal("procurement_team"), childUpload, loader({ "Contract/CON-A": { ...contract, custom_rfq: "RFQ-1", custom_contract_status: "Draft" }, "Contract Risk/CHILD-A": child }))).resolves.toBe(true);
    for (const role of ["procurement", "admin"] as const) await expect(authorizeClmUpload(internal(role), childUpload, loader({ "Contract Risk/CHILD-A": child }))).resolves.toBe(true);
    for (const status of ["Pending Legal", "Pending Signature", "Pending Finance"]) await expect(authorizeClmUpload(internal("procurement_team"), childUpload, loader({ "Contract/CON-A": { ...contract, custom_rfq: "RFQ-1", custom_contract_status: status }, "Contract Risk/CHILD-A": child }))).rejects.toMatchObject({ status: 403 });
  });

  it("permits Team uploads for post-Finance child records without unlocking the signed parent", async () => {
    const approvals = [
      { id: "legal", role: "legal", stage: 0, status: "Approved", by: "legal@example.test", at: "2026-09-22 10:00:00" },
      { id: "finance", role: "finance", stage: 1, status: "Approved", by: "finance@example.test", at: "2026-09-22 10:03:00" },
    ];
    const signatures = [
      { party: "supplier", by: "SUP-A", at: "2026-09-22 10:01:00", version: "1.0", file_id: "SUP-SIGNED", file_url: "/private/files/supplier.pdf", hash: "a".repeat(64) },
      { party: "inteva", role: "legal", by: "legal@example.test", at: "2026-09-22 10:02:00", version: "1.0", file_id: "LEGAL-SIGNED", file_url: "/private/files/legal.pdf", hash: "b".repeat(64) },
    ];
    const parent = { ...contract, custom_rfq: "RFQ-1", custom_contract_status: "Active", custom_current_version: "1.0", custom_inteva_signatory: "legal@example.test", custom_esign_status: "Completed", custom_executed_contract: signatures[1].file_url, custom_final_version_locked: 1 };
    const evidence = { ...runtime, approvals, signatures, rfq_workflow: { version: 1, phase: "procurement" }, locked_hash: clmSnapshotHash("Contract", parent) };
    parent.custom_clm_data = JSON.stringify(evidence);
    const childUpload = { ...upload, doctype: "Contract Obligation", docname: "CHILD-A" };
    const source = loader({ "Contract/CON-A": parent, "Contract Obligation/CHILD-A": { name: "CHILD-A", contract: "CON-A", status: "Pending" } });
    await expect(authorizeClmUpload(internal("procurement_team"), childUpload, source)).resolves.toBe(true);
    await expect(authorizeClmUpload(internal("procurement_team"), upload, source)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmUpload(internal("procurement_team"), childUpload, loader({ "Contract/CON-A": { ...parent, custom_clm_data: JSON.stringify({ ...evidence, approvals: [approvals[0]] }) }, "Contract Obligation/CHILD-A": { name: "CHILD-A", contract: "CON-A" } }))).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    { title: "public upload", changes: { fields: { is_private: "0" } } },
    { title: "direct parent field mutation", changes: { fieldname: "custom_contract_document" } },
  ])("denies $title", async ({ changes }) => {
    await expect(authorizeClmUpload(internal("procurement"), { ...upload, ...changes }, loader())).rejects.toMatchObject({ status: 403 });
  });

  it("denies locked uploads and supplier uploads outside negotiation", async () => {
    await expect(authorizeClmUpload(internal("admin"), upload, loader({ "Contract/CON-A": { ...contract, custom_final_version_locked: 1 } }))).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmUpload(supplier(), upload, loader({ "Contract/CON-A": { ...contract, custom_contract_status: "Pending Signature" } }))).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmUpload(supplier("SUP-B"), upload, loader())).rejects.toMatchObject({ status: 403 });
    await expect(authorizeClmUpload(internal("finance"), upload, loader())).rejects.toMatchObject({ status: 403 });
  });
});
