import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./legal-review";
import { issueInternalAccessToken, type AppRole } from "./rbacAuth";
import { LEGAL_CHECKPOINT_IDS, canStartLegalSignature, parseEsignBundle } from "../src/types/legalEsign";
import { assertSafeProxyBody } from "./proxyRequestGuard";
import { assertLegalReviewReadyForPurchaseOrder, type LegalSignatureEligibilityResult } from "./legalReviewCore";

// Entirely isolated ERP fixture; no production documents or users are changed.
let review: Record<string, unknown>;
let quotation: Record<string, unknown>;
let rfq: Record<string, unknown>;
let clmRequest: Record<string, unknown> | undefined;
let files: Array<Record<string, unknown>>;
let bytes: Map<string, Uint8Array>;
let revision: number;
let dropField: string;
let failUpload: boolean;
let ambiguousUpload: boolean;
let uploadCount: number;
const sourcePath = "/private/files/fixture-contract.pdf";
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

async function makePdf(label: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText(label);
  return pdf.save();
}
async function call(action: string, body: Record<string, unknown> = {}, role: AppRole | null = "legal", email?: string) {
  const identity = email || `${role}@example.test`;
  const token = role ? issueInternalAccessToken({ sub: identity, email: identity, role }) : undefined;
  const req = {
    method: "POST", query: { action }, body: { name: "LDR-TEST", ...body },
    headers: token ? { "x-bidsphere-access-token": token } : {},
  } as unknown as VercelRequest;
  let code = 0;
  let payload: { record?: Record<string, unknown>; records?: Record<string, unknown>[]; error?: string } & Partial<Omit<LegalSignatureEligibilityResult, "record">> = {};
  const res = {
    status(value: number) { code = value; return res; },
    json(value: typeof payload) { payload = value; return res; },
    end() { return res; },
  };
  await handler(req, res as unknown as VercelResponse);
  return { code, ...payload };
}
async function reviewAndVerify() {
  expect((await call("document-viewed", { documentKey: "terms", hash: hash(bytes.get(sourcePath)!) })).code).toBe(200);
  expect(review.review_status).toBe("Pending");
  expect((await call("update-flags", { updates: { terms_approved: 1 } })).code).toBe(200);
  expect((await call("save-checklist", { items: LEGAL_CHECKPOINT_IDS.map(id => ({ id, status: "Compliant" })) })).code).toBe(200);
}
async function internallyApprove() {
  await reviewAndVerify();
}
async function startSignature() {
  const started = await call("begin-signature", { documentKey: "terms" });
  expect(started.code).toBe(200);
  return parseEsignBundle(started.record?.esign_envelope).documents.terms!.signatureRequest!.id;
}
const signature = {
  typedName: "Fixture Signer", reviewerId: "spoofed@example.test", reviewerName: "Spoofed",
  placement: { page: 1, xNorm: 0.5, yNorm: 0.5, widthNorm: 0.32, heightNorm: 0.1 },
};
function holdForProcurementTeam() {
  const decision = { decision: "Yes", request: "CR-TEST", supplier: "Fixture Supplier", quotation: "SQ-TEST", award: "LDR-TEST", legal_review: "LDR-TEST" };
  rfq.contract_required = "Yes"; rfq.custom_approval_data = JSON.stringify({ contract_decision: decision });
  clmRequest = { name: "CR-TEST", custom_rfq: "RFQ-TEST", custom_supplier_quotation: "SQ-TEST", supplier: "Fixture Supplier", request_status: "Draft", custom_clm_data: JSON.stringify({
    schema: 1, rfq_source: { rfq: "RFQ-TEST", quotation: "SQ-TEST", supplier: "Fixture Supplier", award: "LDR-TEST", legal_review: "LDR-TEST" },
    rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" },
    approvals: [{ id: "TEAM", role: "procurement_team", stage: 0, status: "Pending" }],
    audit: [{ action: "procurement_team_assigned", role: "procurement_team", new_status: "Pending Procurement Team", by: "procurement_team@example.test", at: "2026-09-23 10:00:00" }],
  }) };
  return decision;
}

describe("backend-owned legal review and exact-version signature workflow", () => {
  beforeEach(async () => {
    vi.stubEnv("BIDSPHERE_SESSION_SECRET", "isolated-legal-workflow-tests-only");
    vi.stubEnv("ERPNEXT_URL", "https://erp.test");
    vi.stubEnv("ERP_API_KEY", "fixture-key"); vi.stubEnv("ERP_API_SECRET", "fixture-secret");
    revision = 1; dropField = ""; failUpload = false; ambiguousUpload = false; uploadCount = 0;
    review = { name: "LDR-TEST", sq_name: "SQ-TEST", rfq_name: "RFQ-TEST", supplier: "Fixture Supplier", modified: "revision-1",
      owner: "Administrator", procurement_manager: "procurement@example.test",
      terms_file_url: sourcePath, review_status: "Pending", workflow_state: "Pending Review", current_owner: "Legal Reviewer" };
    quotation = { name: "SQ-TEST", owner: "Administrator", supplier: "Fixture Supplier", custom_terms__condition: sourcePath,
      items: [{ request_for_quotation: "RFQ-TEST" }] };
    rfq = { name: "RFQ-TEST", status: "Open", docstatus: 1 };
    clmRequest = undefined;
    files = [{ name: "FILE-TEST", file_name: "fixture-contract.pdf", file_url: sourcePath, is_private: 1,
      attached_to_doctype: "Supplier Quotation", attached_to_name: "SQ-TEST", attached_to_field: "custom_terms__condition" }];
    bytes = new Map([[sourcePath, await makePdf("Isolated legal workflow fixture")]]);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const route = decodeURIComponent(url.pathname);
      if (route === "/api/resource/Legal Document Review/LDR-TEST") {
        if (init?.method === "PUT") {
          const updates = JSON.parse(String(init.body)) as Record<string, unknown>;
          if (updates.modified !== review.modified) return json({ exception: "Timestamp mismatch" }, 409);
          delete updates[dropField];
          review = { ...review, ...updates, modified: `revision-${++revision}` };
        }
        return json(review);
      }
      if (route === "/api/resource/Supplier Quotation/SQ-TEST") return json(quotation);
      if (route === "/api/resource/Request for Quotation/RFQ-TEST") return json(rfq);
      if (route === "/api/resource/Contract Request/CR-TEST") return json(clmRequest || {}, clmRequest ? 200 : 404);
      if (route === "/api/resource/Legal Document Review") return json([review]);
      if (route === "/api/resource/DocType/Legal Document Review") return json({ fields: ["workflow_state", "finance_status", "finance_approved_by", "finance_approved_on", "finance_comments", "finance_rejection_reason", "current_owner", "next_approver"].map(fieldname => ({ fieldname })) });
      if (route === "/api/resource/DocType/Request for Quotation") return json({ fields: [] });
      if (route === "/api/resource/File") {
        const filters = JSON.parse(url.searchParams.get("filters") || "[]") as string[][];
        return json(files.filter(file => filters.every(([field, , value]) => file[field] === value)));
      }
      if (route.startsWith("/api/resource/File/")) {
        const file = files.find(file => file.name === route.split("/").pop());
        return json(file || {}, file ? 200 : 404);
      }
      if (route === "/api/method/upload_file") {
        if (ambiguousUpload) return json({}, 500);
        if (failUpload) return json({}, 422);
        uploadCount++;
        const form = init!.body as FormData;
        const content = form.get("file") as File;
        const path = `/private/files/${content.name}`;
        const file = { name: `SIGNED-${uploadCount}`, file_name: content.name, file_url: path, is_private: 1,
          attached_to_doctype: form.get("doctype"), attached_to_name: form.get("docname") };
        files.push(file); bytes.set(path, new Uint8Array(await content.arrayBuffer()));
        return new Response(JSON.stringify({ message: file }), { headers: { "Content-Type": "application/json" } });
      }
      if (bytes.has(route)) return new Response(new Uint8Array(bytes.get(route)!), { headers: { "Content-Type": "application/pdf" } });
      throw new Error(`Unexpected fixture request: ${route}`);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("excludes the initial Team handoff from Legal/Finance queues while preserving Manager award reads", async () => {
    holdForProcurementTeam(); const before = structuredClone(review);
    expect((await call("list", {}, "legal")).records).toEqual([]);
    expect((await call("list", {}, "finance")).records).toEqual([]);
    expect((await call("list", {}, "procurement")).records?.map(row => row.name)).toEqual(["LDR-TEST"]);
    expect((await call("get", {}, "procurement")).record?.name).toBe("LDR-TEST");
    expect(review).toEqual(before);
  });
  it.each(["approve", "reject", "request-changes", "document-viewed", "save-checklist", "update-flags", "begin-signature", "complete-signature", "signature-eligibility"])("blocks direct Legal %s while the persisted request belongs to Procurement Team", async action => {
    holdForProcurementTeam(); const before = structuredClone(review);
    const result = await call(action, { comments: "Review decision", documentKey: "terms", requestId: "SIGN", signature, updates: { terms_approved: 1 } });
    expect(result.code).toBe(409); expect(result.error).toContain("Pending Procurement Team");
    expect(review).toEqual(before); expect(uploadCount).toBe(0);
  });
  it.each(["finance-approve", "finance-reject", "finance-resubmit"])("blocks direct %s during the initial CLM hold", async action => {
    holdForProcurementTeam(); Object.assign(review, { review_status: "Approved", finance_status: "Pending", workflow_state: "Finance Review", current_owner: "Finance Manager" });
    const before = structuredClone(review), result = await call(action, { comments: "Finance decision" }, "finance");
    expect(result.code).toBe(409); expect(result.error).toContain("Pending Procurement Team"); expect(review).toEqual(before);
  });
  it("releases only the initial hold after Team creates the linked Contract", async () => {
    const decision = holdForProcurementTeam();
    expect((await call("list")).records).toEqual([]);
    rfq.custom_approval_data = JSON.stringify({ contract_decision: { ...decision, contract: "CON-TEST" } });
    clmRequest!.request_status = "Completed";
    expect((await call("list")).records?.map(row => row.name)).toEqual(["LDR-TEST"]);
    await reviewAndVerify();
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(200);
  });
  it("leaves the explicit No branch on its existing Legal and signature flow", async () => {
    rfq.contract_required = "No"; rfq.custom_approval_data = JSON.stringify({ contract_decision: { decision: "No" } });
    expect((await call("list")).records?.map(row => row.name)).toEqual(["LDR-TEST"]);
    await reviewAndVerify();
    const requestId = await startSignature();
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(200);
    expect((await call("finance-approve", { comments: "Budget confirmed" }, "finance")).code).toBe(200);
    expect(review.workflow_state).toBe("Completed");
  });

  it.each(["approve", "reject", "update-flags", "document-viewed", "save-checklist", "request-changes", "begin-signature", "complete-signature", "signature-eligibility"])("requires authentication for %s", async action => {
    expect((await call(action, {}, null)).code).toBe(401);
  });
  it.each(["department", "procurement", "warehouse"] as AppRole[])("denies Legal actions to %s", async role => {
    expect((await call("request-changes", { comments: "Not authorized" }, role)).code).toBe(403);
  });
  it("does not accept fabricated viewed, signed, approved, or workflow fields", async () => {
    for (const updates of [{ terms_viewed: 1 }, { esign_status: "signed" }, { esign_envelope: "{}" }, { review_status: "Approved" }]) {
      expect((await call("update-flags", { updates })).code).toBe(400);
    }
    expect((await call("update-flags", { updates: { terms_approved: 1 } })).code).toBe(422);
    expect((await call("approve", { comments: "No review yet" })).code).toBe(409);
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
  });
  it("records a current-byte render receipt without approving or signing; reopening is idempotent", async () => {
    const result = await call("document-viewed", { documentKey: "terms", hash: hash(bytes.get(sourcePath)!) });
    expect(result.code).toBe(200);
    expect(result.record?.review_status).toBe("Pending");
    const bundle = parseEsignBundle(result.record?.esign_envelope);
    expect(bundle.documents.terms?.viewedBy).toBe("legal@example.test");
    expect(bundle.documents.terms?.approvedHash).toBeUndefined();
    const version = review.modified;
    await call("document-viewed", { documentKey: "terms", hash: hash(bytes.get(sourcePath)!) });
    expect(review.modified).toBe(version);
    expect((await call("document-viewed", { documentKey: "terms", hash: "wrong-version" })).code).toBe(409);
  });
  it("rejects corrupt PDFs without recording a viewed receipt", async () => {
    bytes.set(sourcePath, new TextEncoder().encode("%PDF-corrupt"));
    expect((await call("document-viewed", { documentKey: "terms", hash: hash(bytes.get(sourcePath)!) })).code).toBe(422);
    expect(review.terms_viewed).toBeUndefined();
  });
  it("signs before Finance, persists the handoff, then enables Procurement only after Finance", async () => {
    await reviewAndVerify();
    expect((await call("approve", { comments: "Early approve" })).code).toBe(409);
    // Admin reaches the actual Finance-stage guard, not just the role ACL.
    expect((await call("finance-approve", {}, "admin")).code).toBe(409);
    review.finance_status = "Pending";
    expect(canStartLegalSignature(review)).toBe(true);
    const requestId = await startSignature();
    const signed = await call("complete-signature", { documentKey: "terms", requestId, signature });
    expect(signed.code).toBe(200);
    expect(signed.record).toMatchObject({ esign_status: "signed", review_status: "Approved", finance_status: "Pending", workflow_state: "Finance Review", current_owner: "Finance Manager" });
    expect((await call("get")).record).toMatchObject({ workflow_state: "Finance Review", esign_status: "signed" });
    const team = { typ: "internal" as const, role: "procurement_team" as const, email: "team@example.test", sub: "team@example.test", iat: 1, exp: 9999999999999 };
    await expect(assertLegalReviewReadyForPurchaseOrder("LDR-TEST", team)).rejects.toBeTruthy();
    // A legacy final-approve click is idempotent; it does not bypass Finance.
    const approved = await call("approve", { comments: "Reviewed fixture version", reviewedBy: "spoofed@example.test" });
    expect(approved.code).toBe(200);
    expect(approved.record?.approved_by).toBe("legal@example.test");
    expect(approved.record?.workflow_state).toBe("Finance Review");
    const finance = await call("finance-approve", { comments: "Verified fixture budget" }, "finance");
    expect(finance.code).toBe(200);
    expect(finance.record).toMatchObject({ finance_status: "Approved", workflow_state: "Completed", current_owner: "Procurement Team" });
    await expect(assertLegalReviewReadyForPurchaseOrder("LDR-TEST", team)).resolves.toMatchObject({ workflow_state: "Completed" });
  });
  it.each(["reject", "request-changes"])("persists %s and rejects a stale Legal decision", async action => {
    expect((await call(action, { comments: "Change the fixture terms" })).code).toBe(200);
    expect(review.review_status).toBe(action === "reject" ? "Rejected" : "Pending");
    expect(review.current_owner).toBe(action === "reject" ? "—" : "Procurement");
    expect((await call("approve", { comments: "Stale click" })).code).toBe(409);
    expect((await call("resubmit", {}, "procurement")).code).toBe(200);
    expect(review.current_owner).toBe("Legal Reviewer");
    expect(review.terms_viewed).toBe(0);
  });
  it("does not report success when ERP drops a required field", async () => {
    dropField = "terms_viewed";
    expect((await call("document-viewed", { documentKey: "terms", hash: hash(bytes.get(sourcePath)!) })).code).toBe(502);
  });
  it("reopens review when bytes change under the same filename", async () => {
    await internallyApprove();
    bytes.set(sourcePath, await makePdf("Replacement version"));
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    expect(review.review_status).toBe("Pending");
    expect(review.finance_status).toBe("");
    expect(parseEsignBundle(review.esign_envelope).documents.terms?.approvedHash).toBeUndefined();
    expect(uploadCount).toBe(0);
  });
  it("blocks signing when the quotation points to a newer attachment", async () => {
    await internallyApprove();
    quotation.custom_terms__condition = "/private/files/new-version.pdf";
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    expect(review.review_status).toBe("Pending");
  });
  it("binds signature to approved source, actual signer and private persisted artifact; retries create no second file", async () => {
    await internallyApprove();
    const requestId = await startSignature();
    expect(await startSignature()).toBe(requestId);
    const signed = await call("complete-signature", { documentKey: "terms", requestId, signature });
    expect(signed.code).toBe(200);
    const env = parseEsignBundle(signed.record?.esign_envelope).documents.terms!;
    expect(env.signatureRequest?.sourceHash).toBe(hash(bytes.get(sourcePath)!));
    expect(env.signatureRequest?.completedAt).toBeTruthy();
    expect(env.signatures[0].reviewerId).toBe("legal@example.test");
    expect(env.signedFileHash).toBe(hash(bytes.get(env.signedFileUrl!)!));
    expect(signed.record?.esign_status).toBe("signed");
    expect(env.signatureMethod).toBe("typed_pdf");
    expect(env.signedFileId).toBeTruthy();
    expect((await PDFDocument.load(bytes.get(env.signedFileUrl!)!)).getPageCount()).toBe(1);
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(200);
    expect(uploadCount).toBe(1);
    expect(files.every(file => file.is_private === 1)).toBe(true);
  });
  it("fails honestly on upload error and keeps the same request for retry", async () => {
    await internallyApprove();
    const requestId = await startSignature();
    failUpload = true;
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(502);
    expect(review.esign_status).toBe("unsigned");
    expect(parseEsignBundle(review.esign_envelope).documents.terms?.signatureRequest?.completedAt).toBeUndefined();
    failUpload = false;
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(200);
    expect(uploadCount).toBe(1);
  });
  it("rejects a signature request after its reviewed bytes change", async () => {
    await internallyApprove();
    const requestId = await startSignature();
    bytes.set(sourcePath, await makePdf("Revised after signature started"));
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(409);
    expect(uploadCount).toBe(0);
  });
  it("does not retry an unconfirmed upstream upload or create a duplicate signed artifact", async () => {
    await internallyApprove();
    const requestId = await startSignature();
    ambiguousUpload = true;
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(502);
    ambiguousUpload = false;
    expect(await call("signature-eligibility")).toMatchObject({ eligible: false, canSignDocumentKeys: [], reason: expect.stringContaining("unconfirmed save") });
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(409);
    expect(uploadCount).toBe(0);
  });
  it("requires all attached PDFs to be reviewed, not just one signed or approved flag", async () => {
    await call("document-viewed", { documentKey: "terms", hash: hash(bytes.get(sourcePath)!) });
    await call("update-flags", { updates: { terms_approved: 1 } });
    await call("save-checklist", { items: LEGAL_CHECKPOINT_IDS.map(id => ({ id, status: "Compliant" })) });
    review.warranty_file_url = sourcePath;
    expect((await call("approve", { comments: "Unreviewed warranty" })).code).toBe(409);
    expect(review.review_status).toBe("Pending");
  });
  it("requires the actual 3-document set; 0/3, 1/3, 2/3 block and 3/3 signs with Finance pending", async () => {
    for (const key of ["warranty", "insurance"] as const) {
      const path = `/private/files/${key}.pdf`;
      review[`${key}_file_url`] = path;
      quotation[key === "warranty" ? "custom_warenty_certificate" : "custom_insurance_certificate"] = path;
      files.push({ name: `FILE-${key}`, file_name: `${key}.pdf`, file_url: path, is_private: 1, attached_to_doctype: "Supplier Quotation", attached_to_name: "SQ-TEST" });
      bytes.set(path, await makePdf(`${key} fixture`));
    }
    review.finance_status = "Pending";
    for (const key of ["terms", "warranty", "insurance"] as const) {
      const eligibility = await call("signature-eligibility");
      expect(eligibility.code).toBe(200);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.pendingDocumentKeys).toContain(key);
      expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
      const path = String(review[`${key}_file_url`]);
      expect((await call("document-viewed", { documentKey: key, hash: hash(bytes.get(path)!) })).code).toBe(200);
      expect((await call("update-flags", { updates: { [`${key}_approved`]: 1 } })).code).toBe(200);
    }
    const eligibility = await call("signature-eligibility");
    expect(eligibility).toMatchObject({ code: 200, eligible: true, pendingDocumentKeys: [], canSignDocumentKeys: ["terms", "warranty", "insurance"] });
    expect((await call("get")).record?.required_document_keys).toEqual(["terms", "warranty", "insurance"]);
    for (const key of ["terms", "warranty", "insurance"] as const) {
      const started = await call("begin-signature", { documentKey: key });
      expect(started.code).toBe(200);
      const requestId = parseEsignBundle(started.record?.esign_envelope).documents[key]!.signatureRequest!.id;
      const signed = await call("complete-signature", { documentKey: key, requestId, signature });
      expect(signed.code).toBe(200);
      expect(review.workflow_state).toBe(key === "insurance" ? "Finance Review" : "Pending Review");
    }
    expect(review.esign_status).toBe("signed");
    expect(review.finance_status).toBe("Pending");
  });
  it("preflight and begin share RFQ-state checks despite complete documents and Finance pending", async () => {
    await reviewAndVerify();
    review.finance_status = "Pending";
    expect((await call("signature-eligibility")).eligible).toBe(true);
    rfq.status = "Closed";
    expect((await call("signature-eligibility")).eligible).toBe(false);
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    expect((await call("signature-eligibility", {}, "finance")).code).toBe(403);
  });
  it("preflight is read-only and detects changed PDF bytes without erasing evidence", async () => {
    await reviewAndVerify();
    const before = JSON.stringify(review);
    expect((await call("signature-eligibility")).eligible).toBe(true);
    expect(JSON.stringify(review)).toBe(before);
    bytes.set(sourcePath, await makePdf("Replacement source"));
    expect((await call("signature-eligibility")).eligible).toBe(false);
    expect(JSON.stringify(review)).toBe(before);
    expect(uploadCount).toBe(0);
    expect(parseEsignBundle(review.esign_envelope).documents.terms?.signatureRequest).toBeUndefined();
  });
  it("preflight returns new verification counts on every request, without treating a view as verification", async () => {
    const before = await call("signature-eligibility");
    expect(before).toMatchObject({ eligible: false, requiredDocumentKeys: ["terms"], verifiedDocumentKeys: [], pendingDocumentKeys: ["terms"] });
    await call("document-viewed", { documentKey: "terms", hash: hash(bytes.get(sourcePath)!) });
    expect((await call("signature-eligibility")).verifiedDocumentKeys).toEqual([]);
    await call("update-flags", { updates: { terms_approved: 1 } });
    expect(await call("signature-eligibility")).toMatchObject({ eligible: true, verifiedDocumentKeys: ["terms"], pendingDocumentKeys: [] });
  });
  it.each(["Cancelled", "Closed", "Rejected"])("blocks signing for a %s quotation despite verified documents", async status => {
    await reviewAndVerify();
    quotation.status = status;
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    expect(uploadCount).toBe(0);
  });
  it("requires a linked active RFQ even when the quotation and verification remain valid", async () => {
    await reviewAndVerify();
    delete review.rfq_name;
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    review.rfq_name = "RFQ-TEST";
    rfq.status = "Closed";
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
  });
  it("treats a removed quotation attachment as a changed version", async () => {
    await reviewAndVerify();
    delete quotation.custom_terms__condition;
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    expect(uploadCount).toBe(0);
  });
  it("rejects a quotation relinked to another RFQ and conflicting persisted supplier selection", async () => {
    await reviewAndVerify();
    quotation.items = [{ request_for_quotation: "OTHER-RFQ" }];
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    quotation.items = [{ request_for_quotation: "RFQ-TEST" }];
    rfq.custom_selected_supplier = "Another Supplier";
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
    rfq.custom_selected_supplier = "Fixture Supplier";
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(200);
  });
  it("rejects a completed request replay from a different signer", async () => {
    await reviewAndVerify();
    const requestId = await startSignature();
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(200);
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature }, "admin", "other@example.test")).code).toBe(409);
  });
  it("preserves an earlier signed instrument when a later unsigned instrument changes", async () => {
    const warrantyPath = "/private/files/warranty.pdf";
    review.warranty_file_url = warrantyPath;
    quotation.custom_warenty_certificate = warrantyPath;
    files.push({ name: "FILE-WARRANTY", file_url: warrantyPath, is_private: 1, attached_to_doctype: "Supplier Quotation", attached_to_name: "SQ-TEST" });
    bytes.set(warrantyPath, await makePdf("Warranty before replacement"));
    await reviewAndVerify();
    await call("document-viewed", { documentKey: "warranty", hash: hash(bytes.get(warrantyPath)!) });
    await call("update-flags", { updates: { warranty_approved: 1 } });
    expect(await call("signature-eligibility")).toMatchObject({ eligible: true, requiredDocumentKeys: ["terms", "warranty"], verifiedDocumentKeys: ["terms", "warranty"] });
    const requestId = await startSignature();
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(200);
    const signedTerms = parseEsignBundle(review.esign_envelope).documents.terms;
    expect((await call("update-flags", { updates: { terms_approved: 1 } })).code).toBe(409);
    expect(parseEsignBundle(review.esign_envelope).documents.terms).toEqual(signedTerms);
    bytes.set(warrantyPath, await makePdf("Changed unsigned warranty"));
    expect((await call("begin-signature", { documentKey: "warranty" })).code).toBe(409);
    expect(parseEsignBundle(review.esign_envelope).documents.terms).toEqual(signedTerms);
  });
  it("refreshes the document set from the quotation on an explicit returned-review resubmission", async () => {
    review.warranty_file_url = "/private/files/removed-warranty.pdf";
    review.review_status = "Rejected";
    review.workflow_state = "Rejected";
    expect((await call("resubmit", {}, "procurement")).code).toBe(200);
    expect(review.warranty_file_url).toBe("");
    expect((await call("get")).record?.required_document_keys).toEqual(["terms"]);
    expect((await call("begin-signature", { documentKey: "terms" })).code).toBe(409);
  });
  it("verifies unchanged source and signed bytes on reopen, and preserves evidence while blocking tampered artifacts", async () => {
    await reviewAndVerify();
    const requestId = await startSignature();
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(200);
    const env = parseEsignBundle(review.esign_envelope).documents.terms!;
    const first = await call("verify-integrity") as unknown as { code: number; documents: Array<{ status: string; documentHash: string }> };
    expect(first.code).toBe(200);
    expect(first.documents[0]).toMatchObject({ status: "Verified", documentHash: hash(bytes.get(sourcePath)!) });
    const savedEnvelope = review.esign_envelope;
    bytes.set(env.signedFileUrl!, await makePdf("Tampered signed artifact"));
    const result = await call("verify-integrity") as unknown as { documents: Array<{ status: string }> };
    expect(result.documents[0].status).toBe("Failed");
    expect((await call("finance-approve", {}, "finance")).code).toBe(409);
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(409);
    expect(review.esign_envelope).toBe(savedEnvelope);
    expect(review.finance_status).toBe("Pending");
  });
  it("blocks downstream approval after source replacement without clearing the signed evidence", async () => {
    await reviewAndVerify();
    const requestId = await startSignature();
    expect((await call("complete-signature", { documentKey: "terms", requestId, signature })).code).toBe(200);
    const stored = review.esign_envelope;
    bytes.set(sourcePath, await makePdf("Changed source after execution"));
    expect((await call("finance-approve", {}, "finance")).code).toBe(409);
    expect(review.esign_envelope).toBe(stored);
    expect(review.finance_status).toBe("Pending");
  });
  it.each([
    { apiPath: "resource/Legal%20Document%20Review/LDR-TEST", body: { review_status: "Approved" } },
    { apiPath: "method/frappe.client.set_value", body: { doctype: "Legal Document Review", fieldname: "esign_status", value: "signed" } },
    { apiPath: "method/frappe.client.save", body: { doc: JSON.stringify({ doctype: "Legal Document Review", review_status: "Approved" }) } },
  ])("blocks generic ERP workflow bypass: $apiPath", input => {
    expect(() => assertSafeProxyBody({ ...input, method: "POST" })).toThrow("legal-review workflow endpoint");
  });
});
