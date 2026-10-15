import { describe, it, expect } from "vitest";
import {
  canStartLegalSignature,
  canFinalLegalApprove,
  getRequiredLegalDocumentKeys,
  isFinanceApproved,
  areRequiredDocumentsVerified,
  isLegalReviewExecuted,
  createEmptyEnvelope,
  type LegalDocKey,
  type LegalEsignBundle,
  type RfqLegalSignatureReview,
} from "../types/legalEsign";

const keys: LegalDocKey[] = ["terms", "warranty", "insurance"];
const hash = "a".repeat(64);

function reviewFixture(verifiedCount = 3, requiredKeys = keys): RfqLegalSignatureReview {
  const bundle: LegalEsignBundle = { schemaVersion: 2, documents: {} };
  const review: RfqLegalSignatureReview = {
    review_status: "Pending",
    workflow_state: "Pending Review",
    current_owner: "Legal Reviewer",
    finance_status: "Pending",
    required_document_keys: requiredKeys,
  };
  for (const [index, key] of keys.entries()) {
    review[`${key}_file_url`] = `/private/files/${key}.pdf`;
    review[`${key}_approved`] = index < verifiedCount ? 1 : 0;
    const env = createEmptyEnvelope({ documentKey: key, documentName: key, documentNumber: "LDR-TEST", documentHash: hash });
    Object.assign(env, {
      sourceFileId: `FILE-${key}`, sourceFileUrl: review[`${key}_file_url`],
      viewedBy: "legal@example.test", viewedAt: "2026-09-10 12:00:00",
      approvedHash: hash, approvedFileId: `FILE-${key}`,
    });
    bundle.documents[key] = env;
  }
  review.esign_envelope = JSON.stringify(bundle);
  return review;
}

function sign(review: RfqLegalSignatureReview, key: LegalDocKey) {
  const bundle = JSON.parse(review.esign_envelope!) as LegalEsignBundle;
  const env = bundle.documents[key]!;
  Object.assign(env, {
    signedFileHash: "b".repeat(64), signedFileUrl: `/private/files/signed-${key}.pdf`,
    signedFileId: `SIGNED-${key}`, signatureMethod: "typed_pdf", locked: true, status: "locked",
    signatureRequest: { id: `REQUEST-${key}`, sourceHash: hash, sourceFileId: env.sourceFileId,
      signerId: "legal@example.test", startedAt: "2026-09-10 12:00:00", completedAt: "2026-09-10 12:01:00" },
  });
  env.signatures = [{
    id: `REQUEST-${key}`, role: "legal", status: "locked", sequence: 1,
    typedName: "Legal Counsel", reviewerName: "Legal Counsel", reviewerId: "legal@example.test",
    fontId: "dancing-script", signedAt: "2026-09-10 12:00:00",
    placement: { page: 1, xNorm: 0.5, yNorm: 0.8, widthNorm: 0.3, heightNorm: 0.1 },
  }];
  review.esign_envelope = JSON.stringify(bundle);
}

describe("RFQ verification → electronic signature → Finance gating", () => {
  it.each([0, 1, 2])("%i of 3 required documents verified keeps signing disabled", count => {
    const review = reviewFixture(count);
    expect(areRequiredDocumentsVerified(review)).toBe(false);
    expect(canStartLegalSignature(review)).toBe(false);
  });

  it("3 of 3 verified permits signing while Finance and final Legal approval are pending", () => {
    const review = reviewFixture();
    expect(isFinanceApproved(review)).toBe(false);
    expect(areRequiredDocumentsVerified(review)).toBe(true);
    expect(canStartLegalSignature(review, "terms")).toBe(true);
    expect(canFinalLegalApprove(review)).toBe(false);
    expect(isLegalReviewExecuted(review)).toBe(false);
  });

  it.each(["", "Pending", "Approved", "Budget Approved"])("Finance value '%s' is not a signature prerequisite", finance => {
    const review = { ...reviewFixture(), finance_status: finance };
    expect(canStartLegalSignature(review)).toBe(true);
  });

  it("explicit server list of two requires only those two, even with an optional third attached", () => {
    const review = reviewFixture(2, ["terms", "warranty"]);
    expect(getRequiredLegalDocumentKeys(review)).toEqual(["terms", "warranty"]);
    expect(canStartLegalSignature(review)).toBe(true);
    expect(canStartLegalSignature(review, "insurance")).toBe(false);
  });

  it("legacy ERP rows derive two required documents from their two populated legal slots", () => {
    const review = reviewFixture(2);
    delete review.required_document_keys;
    delete review.insurance_file_url;
    expect(getRequiredLegalDocumentKeys(review)).toEqual(["terms", "warranty"]);
    expect(canStartLegalSignature(review)).toBe(true);
  });

  it("explicit empty list and an attachment-free review both fail closed", () => {
    expect(canStartLegalSignature({ ...reviewFixture(), required_document_keys: [] })).toBe(false);
    expect(areRequiredDocumentsVerified({})).toBe(false);
    expect(canStartLegalSignature({ review_status: "Pending", workflow_state: "Pending Review" })).toBe(false);
  });

  it("a required missing attachment cannot disappear from the denominator", () => {
    const review = reviewFixture();
    delete review.warranty_file_url;
    expect(getRequiredLegalDocumentKeys(review)).toHaveLength(3);
    expect(canStartLegalSignature(review)).toBe(false);
  });

  it("legacy checkbox flags do not replace server-bound PDF review receipts", () => {
    const review = reviewFixture();
    review.esign_envelope = undefined;
    expect(canStartLegalSignature(review)).toBe(false);
  });

  it.each(["Rejected", "Cancelled", "Closed", "Completed", "Finance Review"])("workflow '%s' blocks new RFQ signatures", workflow_state => {
    expect(canStartLegalSignature({ ...reviewFixture(), workflow_state })).toBe(false);
  });

  it("blocks a returned Procurement review and cancelled quotation", () => {
    expect(canStartLegalSignature({ ...reviewFixture(), current_owner: "Procurement" })).toBe(false);
    expect(canStartLegalSignature({ ...reviewFixture(), docstatus: 2 })).toBe(false);
  });

  it("one signed document does not execute a three-document RFQ", () => {
    const review = reviewFixture();
    sign(review, "terms");
    expect(canStartLegalSignature(review, "terms")).toBe(false);
    expect(canStartLegalSignature(review, "warranty")).toBe(true);
    expect(isLegalReviewExecuted(review)).toBe(false);
  });

  it("all persisted source-bound artifacts are executed before Finance, and remain executed afterward", () => {
    const review = reviewFixture();
    keys.forEach(key => sign(review, key));
    expect(canStartLegalSignature(review)).toBe(false);
    expect(isLegalReviewExecuted(review)).toBe(true);
    expect(canFinalLegalApprove(review)).toBe(true);
    review.review_status = "Approved";
    review.workflow_state = "Finance Review";
    expect(isLegalReviewExecuted(review)).toBe(true);
    review.finance_status = "Approved";
    review.workflow_state = "Completed";
    expect(isLegalReviewExecuted(review)).toBe(true);
  });

  it("changed canonical bytes or stale file identity blocks signing/execution", () => {
    const review = reviewFixture();
    const bundle = JSON.parse(review.esign_envelope!) as LegalEsignBundle;
    bundle.documents.terms!.documentHash = "c".repeat(64);
    review.esign_envelope = JSON.stringify(bundle);
    expect(canStartLegalSignature(review)).toBe(false);
    expect(isLegalReviewExecuted(review)).toBe(false);
  });

  it("hash strings must be real lowercase 64-character SHA-256 values", () => {
    const review = reviewFixture();
    const bundle = JSON.parse(review.esign_envelope!) as LegalEsignBundle;
    bundle.documents.terms!.documentHash = "hash123";
    bundle.documents.terms!.approvedHash = "hash123";
    review.esign_envelope = JSON.stringify(bundle);
    expect(canStartLegalSignature(review)).toBe(false);
  });

  it("signature metadata without a completed request and artifact is not execution", () => {
    const review = reviewFixture(1, ["terms"]);
    sign(review, "terms");
    const bundle = JSON.parse(review.esign_envelope!) as LegalEsignBundle;
    delete bundle.documents.terms!.signatureRequest!.completedAt;
    review.esign_envelope = JSON.stringify(bundle);
    expect(isLegalReviewExecuted(review)).toBe(false);
  });
});
