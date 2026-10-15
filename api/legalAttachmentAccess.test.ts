import { describe, expect, it, vi } from "vitest";
import { assertLegalReviewFileAccess, authorizeLegalFileIfApplicable, resolveLegalReviewFile } from "./legalAttachmentAccess";
import type { AccessPrincipal, AppRole } from "./rbacAuth";

const path = "/private/files/contract.pdf";
const review = { name: "LDR-1", sq_name: "SQ-1", owner: "Administrator", procurement_manager: "buyer@example.test", review_status: "Pending", workflow_state: "Pending Review", terms_file_url: path };
const quotation = { name: "SQ-1", owner: "Administrator" };
const file = { name: "FILE-1", file_url: path, is_private: 1, attached_to_doctype: "Supplier Quotation", attached_to_name: "SQ-1", attached_to_field: "custom_terms__condition" };
const internal = (role: AppRole, email = "person@example.test"): AccessPrincipal => ({ typ: "internal", role, email, sub: email, iat: 1, exp: 9999999999 });
const supplier: AccessPrincipal = { typ: "supplier", supplier: "SUP-1", sub: "SUP-1", iat: 1, exp: 9999999999 };
const loader = async (doctype: string) => doctype === "Legal Document Review" ? review : quotation;

describe("CLM attachment business authorization", () => {
  it.each(["legal", "admin"] as AppRole[])("allows canonical %s, without a hardcoded user email", role => {
    expect(() => assertLegalReviewFileAccess(internal(role), review, quotation)).not.toThrow();
  });
  it.each(["procurement", "procurement_team"] as AppRole[])("allows assigned %s", role => {
    expect(() => assertLegalReviewFileAccess(internal(role, "buyer@example.test"), review, quotation)).not.toThrow();
    expect(() => assertLegalReviewFileAccess(internal(role), review, quotation)).toThrow();
  });
  it.each(["department", "warehouse", "finance", "finance_executive", "executive", "engineering"] as AppRole[])("denies unassigned %s during Legal Review", role => {
    expect(() => assertLegalReviewFileAccess(internal(role), review, quotation)).toThrow(expect.objectContaining({ status: 403 }));
  });
  it("denies suppliers even if they own the supplier quotation", () => {
    expect(() => assertLegalReviewFileAccess(supplier, review, { ...quotation, owner: supplier.sub })).toThrow();
  });
  it("allows explicit internal parent ownership or review assignment", () => {
    const principal = internal("department");
    expect(() => assertLegalReviewFileAccess(principal, review, { ...quotation, owner: principal.sub })).not.toThrow();
    expect(() => assertLegalReviewFileAccess(principal, { ...review, _assign: JSON.stringify([principal.sub]) }, quotation)).not.toThrow();
    expect(() => assertLegalReviewFileAccess(principal, { ...review, next_approver: principal.sub }, quotation)).not.toThrow();
  });
  it("uses the existing finance stage; completed reviews require individual authority", () => {
    const finance = { ...review, review_status: "Approved", workflow_state: "Finance Review", finance_status: "Pending" };
    expect(() => assertLegalReviewFileAccess(internal("finance"), finance, quotation)).not.toThrow();
    expect(() => assertLegalReviewFileAccess(internal("legal"), finance, quotation)).toThrow();
    expect(() => assertLegalReviewFileAccess(internal("legal"), { ...finance, approved_by: "person@example.test" }, quotation)).not.toThrow();
    expect(() => assertLegalReviewFileAccess(internal("legal"), { ...review, workflow_state: "Completed" }, quotation)).toThrow();
  });
});

describe("parent-scoped duplicate File resolution", () => {
  const input = { principal: internal("legal"), reviewName: review.name, documentKey: "terms", requestedPath: path, loadDocument: loader };
  it("reads an existing procurement attachment without requiring a supplier upload", async () => {
    const procurementFile = { ...file, owner: "buyer@example.test" };
    const loadDocument = vi.fn(loader);
    const list = vi.fn(async (_doctype: string, filters: string[][]) =>
      filters.some(f => f[2] === "SQ-1") ? [procurementFile] : []);
    await expect(resolveLegalReviewFile({ ...input, loadDocument, list })).resolves.toEqual(procurementFile);
    expect(loadDocument.mock.calls).toEqual([
      ["Legal Document Review", review.name],
      ["Supplier Quotation", quotation.name],
    ]);
  });

  it("selects the exact review/SQ parent despite duplicate URLs, preferring a field attachment", async () => {
    const list = vi.fn(async (_doctype: string, filters: string[][]) => filters.some(f => f[2] === "SQ-1") ? [
      { ...file, name: "OTHER", attached_to_name: "SQ-OTHER" },
      { ...file, name: "BARE", attached_to_field: "" }, file,
    ] : []);
    expect(await resolveLegalReviewFile({ ...input, list })).toEqual(file);
    expect(list).toHaveBeenCalledWith("File", [["file_url", "=", path], ["attached_to_doctype", "=", "Supplier Quotation"], ["attached_to_name", "=", "SQ-1"]], expect.any(Array));
  });
  it("does not look up File metadata for an unauthorized user or a substituted URL", async () => {
    const list = vi.fn();
    await expect(resolveLegalReviewFile({ ...input, principal: internal("department"), list })).rejects.toMatchObject({ status: 403 });
    await expect(resolveLegalReviewFile({ ...input, requestedPath: "/private/files/other.pdf", list })).rejects.toMatchObject({ status: 403 });
    expect(list).not.toHaveBeenCalled();
  });
  it("returns 404 when no File exists under the authorized parent", async () => {
    await expect(resolveLegalReviewFile({ ...input, list: async () => [] })).rejects.toMatchObject({ status: 404 });
  });
  it("does not trust an attachment on a different quotation or a folder", async () => {
    await expect(resolveLegalReviewFile({ ...input, list: async () => [{ ...file, attached_to_name: "SQ-OTHER" }, { ...file, is_folder: 1 }] })).rejects.toMatchObject({ status: 404 });
  });
  it("rejects invalid document slots and mismatched review IDs", async () => {
    await expect(resolveLegalReviewFile({ ...input, documentKey: "__proto__" })).rejects.toMatchObject({ status: 400 });
    await expect(resolveLegalReviewFile({ ...input, reviewName: "LDR-OTHER" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("generic File routes cannot bypass CLM authorization", () => {
  const input = { file, loadDocument: loader, list: async () => [{ name: review.name }] };
  it.each([internal("department"), supplier, internal("procurement")])("rejects unassigned principal $typ/$role", async principal => {
    await expect(authorizeLegalFileIfApplicable({ ...input, principal })).rejects.toMatchObject({ status: 403 });
  });
  it("preserves assigned procurement and legal access via File ID", async () => {
    for (const principal of [internal("legal"), internal("procurement", "buyer@example.test")]) {
      expect(await authorizeLegalFileIfApplicable({ ...input, principal })).toBe(true);
    }
  });
  it("blocks a historical duplicate attached to a different quotation", async () => {
    await expect(authorizeLegalFileIfApplicable({
      ...input, file: { ...file, attached_to_name: "SQ-OLD", attached_to_field: "" }, principal: internal("department"),
      list: async (_doctype, filters) => filters[0][0] === "sq_name" ? [] : [{ name: review.name }],
    })).rejects.toMatchObject({ status: 403 });
  });
  it("recognizes the ERP warranty spelling before forwarding", async () => {
    const warranty = { ...file, attached_to_field: "custom_warenty_certificate" };
    const beforeForward = { ...input, file: warranty, list: async () => [] };
    expect(await authorizeLegalFileIfApplicable({ ...beforeForward, principal: internal("procurement"),
      loadDocument: async () => ({ ...quotation, _assign: JSON.stringify(["person@example.test"]) }) })).toBe(true);
    await expect(authorizeLegalFileIfApplicable({ ...beforeForward, principal: internal("procurement") })).rejects.toMatchObject({ status: 403 });
    await expect(authorizeLegalFileIfApplicable({ ...beforeForward, principal: internal("department") })).rejects.toMatchObject({ status: 403 });
  });
  it("allows assigned Procurement to verify a replacement upload before the review URL is updated", async () => {
    const replacement = { ...input, file: { ...file, file_url: "/private/files/replacement.pdf" },
      list: async (_doctype: string, filters: string[][]) => filters[0][0] === "sq_name" ? [{ name: review.name }] : [] };
    expect(await authorizeLegalFileIfApplicable({ ...replacement, principal: internal("procurement", "buyer@example.test") })).toBe(true);
    await expect(authorizeLegalFileIfApplicable({ ...replacement, principal: internal("procurement") })).rejects.toMatchObject({ status: 403 });
    await expect(authorizeLegalFileIfApplicable({ ...replacement, principal: internal("legal") })).rejects.toMatchObject({ status: 403 });
  });
});
