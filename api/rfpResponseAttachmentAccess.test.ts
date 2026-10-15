import { describe, expect, it, vi } from "vitest";
import {
  authorizeRfpResponseFileIfApplicable,
  parseRfpResponseAttachmentContext,
  resolveRfpResponseFile,
} from "./rfpResponseAttachmentAccess";
import { authorizeFileResourceRequest, authorizePersistedFileRead } from "./fileResourceGuard";
import type { AccessPrincipal, AppRole } from "./rbacAuth";

type Doc = Record<string, unknown>;
const path = "/private/files/technical-proposal.pdf";
const file = { name: "FILE-RESPONSE", file_url: path, is_private: 1, attached_to_doctype: "RFP Response", attached_to_name: "RESPONSE-A" };
const attachment = { document_id: "technical", doc_type: "Technical Proposal", file: { file_id: file.name, file_url: path } };
const response = { name: "RESPONSE-A", rfp: "RFP-1", supplier: "SUP-A", documents_json: JSON.stringify([attachment]) };
const rfp = { name: "RFP-1", suppliers: [{ supplier: "SUP-A" }, { supplier: "SUP-B" }] };
const internal = (role: AppRole): AccessPrincipal => ({ typ: "internal", role, sub: "reviewer@example.test", email: "reviewer@example.test", iat: 1, exp: 9999999999 });
const supplier = (name = "SUP-A"): AccessPrincipal => ({ typ: "supplier", supplier: name, sub: name, iat: 1, exp: 9999999999 });
const context = { rfpName: rfp.name, responseName: response.name, documentId: attachment.document_id, requestedPath: path };

function loader(overrides: Record<string, Doc | null> = {}) {
  const records: Record<string, Doc | null> = {
    "RFP/RFP-1": rfp,
    "RFP Response/RESPONSE-A": response,
    "File/FILE-RESPONSE": file,
    // ERP permits duplicate paths. An unrelated File must never become the
    // authority for the document selected from this persisted response.
    "File/FILE-OTHER": { ...file, name: "FILE-OTHER", attached_to_name: "RESPONSE-B" },
    ...overrides,
  };
  return vi.fn(async (doctype: string, name: string): Promise<Doc> => {
    const document = records[`${doctype}/${name}`];
    if (!document) throw Object.assign(new Error("Document not found."), { status: 404 });
    return document;
  });
}

describe("RFP response attachment parent authorization", () => {
  it.each(["procurement", "admin"] as AppRole[])("resolves the persisted File ID for %s despite duplicate paths", async role => {
    const loadDocument = loader();
    await expect(resolveRfpResponseFile({ ...context, principal: internal(role), loadDocument })).resolves.toEqual(file);
    expect(loadDocument.mock.calls).toEqual([["RFP Response", response.name], ["RFP", rfp.name], ["File", file.name]]);
  });

  it.each(["procurement_team", "finance", "legal", "department", "engineer"] as AppRole[])("does not expand existing RFP permissions to %s", async role => {
    const loadDocument = loader();
    await expect(resolveRfpResponseFile({ ...context, principal: internal(role), loadDocument })).rejects.toMatchObject({ status: 403 });
    expect(loadDocument).not.toHaveBeenCalled();
  });

  it("permits an invited supplier's own persisted response document", async () => {
    await expect(resolveRfpResponseFile({ ...context, principal: supplier(), loadDocument: loader() })).resolves.toEqual(file);
  });

  it("denies another supplier even when both suppliers are invited to the RFP", async () => {
    const loadDocument = loader();
    await expect(resolveRfpResponseFile({ ...context, principal: supplier("SUP-B"), loadDocument })).rejects.toMatchObject({ status: 403 });
    expect(loadDocument.mock.calls.some(([doctype]) => doctype === "File")).toBe(false);
  });

  it("requires an invitation as well as supplier response ownership", async () => {
    const loadDocument = loader({ "RFP/RFP-1": { ...rfp, suppliers: [{ supplier: "SUP-B" }] } });
    await expect(resolveRfpResponseFile({ ...context, principal: supplier(), loadDocument })).rejects.toMatchObject({ status: 403 });
    expect(loadDocument.mock.calls.some(([doctype]) => doctype === "File")).toBe(false);
  });

  it.each([
    { requestedFileId: "FILE-OTHER" },
    { requestedPath: "/private/files/another.pdf" },
    { documentId: "internal-notes" },
    { rfpName: "RFP-OTHER" },
  ])("rejects substituted context %j before loading a File", async tampering => {
    const loadDocument = loader();
    await expect(resolveRfpResponseFile({ ...context, ...tampering, principal: internal("procurement"), loadDocument })).rejects.toMatchObject({ status: 403 });
    expect(loadDocument.mock.calls.some(([doctype]) => doctype === "File")).toBe(false);
  });

  it.each([
    { attached_to_name: "RESPONSE-B" },
    { attached_to_doctype: "Supplier Quotation" },
    { name: "FILE-OTHER" },
    { file_url: "/private/files/other.pdf" },
    { is_folder: 1 },
  ])("rejects persisted File parent/identity tampering %j", async changes => {
    await expect(resolveRfpResponseFile({ ...context, principal: internal("procurement"), loadDocument: loader({ "File/FILE-RESPONSE": { ...file, ...changes } }) })).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    { name: "RESPONSE-B" },
    { rfp: "RFP-OTHER" },
    { documents_json: "{invalid" },
    { documents_json: JSON.stringify([attachment, attachment]) },
  ])("rejects mismatched or ambiguous persisted response metadata %j", async changes => {
    await expect(resolveRfpResponseFile({ ...context, principal: internal("procurement"), loadDocument: loader({ "RFP Response/RESPONSE-A": { ...response, ...changes } }) })).rejects.toMatchObject({ status: 403 });
  });

  it.each(["RFP/RFP-1", "RFP Response/RESPONSE-A", "File/FILE-RESPONSE"])("preserves 404 for missing %s", async key => {
    await expect(resolveRfpResponseFile({ ...context, principal: internal("procurement"), loadDocument: loader({ [key]: null }) })).rejects.toMatchObject({ status: 404 });
  });

  it("accepts an explicit verified File ID for old rows without a saved ID", async () => {
    const withoutId = { ...attachment, file: { file_url: path } };
    const loadDocument = loader({ "RFP Response/RESPONSE-A": { ...response, documents_json: JSON.stringify([withoutId]) } });
    await expect(resolveRfpResponseFile({ ...context, requestedFileId: file.name, principal: internal("procurement"), loadDocument })).resolves.toEqual(file);
    await expect(resolveRfpResponseFile({ ...context, requestedFileId: "FILE-OTHER", principal: internal("procurement"), loadDocument })).rejects.toMatchObject({ status: 403 });
    await expect(resolveRfpResponseFile({ ...context, principal: internal("procurement"), loadDocument })).rejects.toMatchObject({ status: 404 });
  });

  it("preserves legacy documents with a unique verified path under the actual response", async () => {
    const withoutId = { ...attachment, file: { file_url: path } };
    const loadDocument = loader({ "RFP Response/RESPONSE-A": { ...response, documents_json: JSON.stringify([withoutId]) } });
    const resolveFileByPath = vi.fn(async () => file);
    await expect(resolveRfpResponseFile({ ...context, principal: internal("procurement"), loadDocument, resolveFileByPath })).resolves.toEqual(file);
    expect(resolveFileByPath).toHaveBeenCalledExactlyOnceWith(path);
  });

  it.each([403, 404])("preserves strict legacy path lookup failures (%s)", async status => {
    const withoutId = { ...attachment, file: { file_url: path } };
    const loadDocument = loader({ "RFP Response/RESPONSE-A": { ...response, documents_json: JSON.stringify([withoutId]) } });
    const resolveFileByPath = vi.fn(async () => { throw Object.assign(new Error(status === 403 ? "Ambiguous file path." : "Document not found."), { status }); });
    await expect(resolveRfpResponseFile({ ...context, principal: internal("procurement"), loadDocument, resolveFileByPath })).rejects.toMatchObject({ status });
  });

  it("denies a legacy unique path attached to a different response", async () => {
    const withoutId = { ...attachment, file: { file_url: path } };
    const loadDocument = loader({ "RFP Response/RESPONSE-A": { ...response, documents_json: JSON.stringify([withoutId]) } });
    const resolveFileByPath = vi.fn(async () => ({ ...file, attached_to_name: "RESPONSE-B" }));
    await expect(resolveRfpResponseFile({ ...context, principal: internal("procurement"), loadDocument, resolveFileByPath })).rejects.toMatchObject({ status: 403 });
  });

  it("never falls back to a path lookup when a saved File ID exists or permission is denied", async () => {
    const resolveFileByPath = vi.fn(async () => file);
    await expect(resolveRfpResponseFile({ ...context, principal: internal("procurement"), loadDocument: loader(), resolveFileByPath })).resolves.toEqual(file);
    const withoutId = { ...attachment, file: { file_url: path } };
    const loadDocument = loader({ "RFP Response/RESPONSE-A": { ...response, documents_json: JSON.stringify([withoutId]) } });
    await expect(resolveRfpResponseFile({ ...context, principal: supplier("SUP-B"), loadDocument, resolveFileByPath })).rejects.toMatchObject({ status: 403 });
    expect(resolveFileByPath).not.toHaveBeenCalled();
  });
});

describe("RFP generic File routes enforce the same policy", () => {
  it.each([internal("procurement"), internal("admin"), supplier()])("allows authorized $typ/$role without requiring preview-only context", async principal => {
    await expect(authorizeRfpResponseFileIfApplicable({ principal, file, loadDocument: loader() })).resolves.toBe(true);
    await expect(authorizePersistedFileRead({ principal, file, loadDocument: loader() })).resolves.toBeUndefined();
    await expect(authorizeFileResourceRequest({ principal, apiPath: `resource/File/${file.name}`, method: "GET", loadDocument: loader() })).resolves.toEqual(file);
  });

  it.each([internal("procurement_team"), internal("finance"), internal("legal"), supplier("SUP-B")])("denies context-stripped access for $typ/$role", async principal => {
    await expect(authorizeRfpResponseFileIfApplicable({ principal, file, loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
    await expect(authorizePersistedFileRead({ principal, file, loadDocument: loader(), supplierContextAuthorized: true })).rejects.toMatchObject({ status: 403 });
    await expect(authorizeFileResourceRequest({ principal, apiPath: `resource/File/${file.name}`, method: "GET", loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
  });

  it("denies internal documents not saved among supplier uploads", async () => {
    await expect(authorizeRfpResponseFileIfApplicable({ principal: supplier(), file: { ...file, name: "FILE-INTERNAL" }, loadDocument: loader() })).rejects.toMatchObject({ status: 403 });
  });

  it("leaves unrelated attachment policy to its existing module", async () => {
    const loadDocument = loader();
    await expect(authorizeRfpResponseFileIfApplicable({ principal: internal("finance"), file: { ...file, attached_to_doctype: "Supplier Quotation" }, loadDocument })).resolves.toBe(false);
    expect(loadDocument).not.toHaveBeenCalled();
  });
});

describe("RFP attachment query context is atomic", () => {
  const query = { rfp: rfp.name, rfp_response: response.name, response_document: attachment.document_id };
  it("parses the existing identifiers and ignores an unrelated generic request", () => {
    expect(parseRfpResponseAttachmentContext(query)).toEqual({ rfpName: rfp.name, responseName: response.name, documentId: attachment.document_id });
    expect(parseRfpResponseAttachmentContext({ path })).toBeNull();
  });
  it.each(["rfp", "rfp_response", "response_document"])("rejects missing, blank or duplicate %s", key => {
    for (const value of [undefined, "", [query[key as keyof typeof query], "substituted"]]) {
      expect(() => parseRfpResponseAttachmentContext({ ...query, [key]: value })).toThrow(expect.objectContaining({ status: 400 }));
    }
  });
  it.each(["legal_review", "document_key", "rfq", "erp_supplier_id"])("rejects mixed %s context", key => {
    expect(() => parseRfpResponseAttachmentContext({ ...query, [key]: "OTHER" })).toThrow(expect.objectContaining({ status: 400 }));
  });
});
