import { describe, expect, it } from "vitest";
import {
  assertEcrUploadField,
  assertSecureEcrUpload,
  parseSecureUpload,
  supplierOwnsUploadTarget,
} from "./secureUploadGuard";

async function encodedForm(extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File(["drawing"], "drawing.pdf", { type: "application/pdf" }));
  form.append("doctype", "Engineering Change Request");
  form.append("docname", "ECR-2026-100001");
  form.append("fieldname", "engineering_drawing");
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const request = new Request("http://local", { method: "POST", body: form });
  return {
    body: new Uint8Array(await request.arrayBuffer()),
    contentType: request.headers.get("content-type") || "",
  };
}

describe("secure multipart uploads", () => {
  it("parses one scoped file and matching target fields", async () => {
    const encoded = await encodedForm();
    await expect(parseSecureUpload(encoded.body, encoded.contentType)).resolves.toMatchObject({
      doctype: "Engineering Change Request",
      docname: "ECR-2026-100001",
      fieldname: "engineering_drawing",
      fileName: "drawing.pdf",
    });
  });

  it("rejects callback dispatch and duplicate target fields", async () => {
    const callback = await encodedForm({ method: "frappe.core.doctype.user.user.add_role" });
    await expect(parseSecureUpload(callback.body, callback.contentType))
      .rejects.toThrow(/unsupported upload field 'method'/i);

    const form = new FormData();
    form.append("file", new File(["x"], "x.txt"));
    form.append("doctype", "Item");
    form.append("doctype", "Engineering Change Request");
    form.append("docname", "ECR-1");
    const request = new Request("http://local", { method: "POST", body: form });
    await expect(parseSecureUpload(
      new Uint8Array(await request.arrayBuffer()),
      request.headers.get("content-type") || "",
    )).rejects.toThrow(/duplicate upload field 'doctype'/i);
  });

  it("rejects unscoped uploads without an authorizable document target", async () => {
    const form = new FormData();
    form.append("file", new File(["x"], "x.txt"));
    form.append("is_private", "1");
    const request = new Request("http://local", { method: "POST", body: form });
    await expect(parseSecureUpload(
      new Uint8Array(await request.arrayBuffer()),
      request.headers.get("content-type") || "",
    )).rejects.toThrow(/doctype and document name are required/i);
  });

  it("limits ECR uploads to the five attachment fields", () => {
    expect(() => assertEcrUploadField("supporting_documents")).not.toThrow();
    expect(() => assertEcrUploadField("select_pxfp")).toThrow(/supported/i);
  });

  it("requires private ECR storage and rejects arbitrary folders", async () => {
    const publicUpload = await encodedForm({ is_private: "0" });
    const parsedPublic = await parseSecureUpload(publicUpload.body, publicUpload.contentType);
    expect(() => assertSecureEcrUpload(parsedPublic)).toThrow(/is_private=1/i);

    const missingPrivacy = await encodedForm();
    const parsedMissing = await parseSecureUpload(
      missingPrivacy.body,
      missingPrivacy.contentType,
    );
    expect(() => assertSecureEcrUpload(parsedMissing)).toThrow(/is_private=1/i);

    const unsafeFolder = await encodedForm({ is_private: "1", folder: "Home/Other Team" });
    const parsedFolder = await parseSecureUpload(unsafeFolder.body, unsafeFolder.contentType);
    expect(() => assertSecureEcrUpload(parsedFolder)).toThrow(/default Home folder/i);

    const privateUpload = await encodedForm({ is_private: "1", folder: "Home" });
    const parsedPrivate = await parseSecureUpload(privateUpload.body, privateUpload.contentType);
    expect(() => assertSecureEcrUpload(parsedPrivate)).not.toThrow();
  });

  it("scopes supplier uploads to owned or isolated temporary targets", () => {
    expect(supplierOwnsUploadTarget("Apex Fasteners Ltd", {
      doctype: "Supplier Quotation",
      docname: "temp-Apex_Fasteners_Ltd-123",
    })).toBe(true);
    expect(supplierOwnsUploadTarget("Apex Fasteners Ltd", {
      doctype: "Supplier Quotation",
      docname: "SQ-OTHER",
    }, { supplier: "Other Supplier" })).toBe(false);
  });
});
