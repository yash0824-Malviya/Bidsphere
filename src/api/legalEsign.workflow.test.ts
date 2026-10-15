import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { completeLegalSignature } from "./legalDocs";
import { persistEsignEnvelope, resolveEsignBundle, sha256Hex } from "./legalEsign";
import { canStartLegalSignature, createEmptyEnvelope, isLegalReviewExecuted, parseEsignBundle } from "../types/legalEsign";

vi.mock("./legalDocs", () => ({ completeLegalSignature: vi.fn() }));

describe("legal signature client uses persisted backend truth", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("ignores stale browser signatures, including when ERP has no envelope", () => {
    const getItem = vi.fn(() => '{"schemaVersion":2,"documents":{"terms":{"status":"signed"}}}');
    vi.stubGlobal("localStorage", { getItem });
    expect(resolveEsignBundle("LDR-TEST", null).documents).toEqual({});
    expect(getItem).not.toHaveBeenCalled();
  });
  it("never fabricates a signature success after a backend failure", async () => {
    const envelope = createEmptyEnvelope({ documentKey: "terms", documentHash: "fixture-hash", documentName: "fixture", documentNumber: "LDR-TEST" });
    envelope.signatureRequest = { id: "request-test", sourceHash: "fixture-hash", sourceFileId: "FILE-TEST", signerId: "legal@example.test", startedAt: "2026-01-01T12:00:00Z" };
    envelope.signatures = [{ id: "request-test", role: "legal", status: "signed", typedName: "Fixture", reviewerName: "Fixture", reviewerId: "legal@example.test", sequence: 1, fontId: "dancing-script", signedAt: "2026-01-01 12:00:00", placement: { page: 1, xNorm: 0.5, yNorm: 0.5, widthNorm: 0.32, heightNorm: 0.1 } }];
    vi.mocked(completeLegalSignature).mockRejectedValue(new Error("Backend write failed"));
    await expect(persistEsignEnvelope("LDR-TEST", envelope)).rejects.toThrow("Backend write failed");
  });
  it("does not interpret Legal Approved as signed or signature-ready", () => {
    const review = { review_status: "Approved", workflow_state: "Finance Review", finance_status: "Pending" };
    expect(canStartLegalSignature(review)).toBe(false);
    expect(isLegalReviewExecuted(review)).toBe(false);
  });
  it("retains backend review receipts, final hashes and request bindings across JSON round trips", () => {
    const hash = "a".repeat(64);
    const env = createEmptyEnvelope({ documentKey: "terms", documentHash: hash, documentName: "fixture", documentNumber: "LDR-TEST" });
    Object.assign(env, { sourceFileId: "FILE-TEST", sourceFileUrl: "/private/files/fixture.pdf", viewedAt: "2026-01-01T12:00:00Z", viewedBy: "legal@example.test", approvedHash: hash, approvedFileId: "FILE-TEST", signedFileId: "SIGNED-TEST", signatureMethod: "typed_pdf" });
    const bundle = parseEsignBundle(JSON.stringify({ schemaVersion: 2, documents: { terms: env } }));
    expect(bundle.documents.terms?.approvedFileId).toBe("FILE-TEST");
    expect(bundle.documents.terms?.signedFileId).toBe("SIGNED-TEST");
    expect(bundle.documents.terms?.signatureMethod).toBe("typed_pdf");
    const review = { review_status: "Pending", finance_status: "Pending", workflow_state: "Pending Review", terms_approved: 1, terms_file_url: "/private/files/fixture.pdf", esign_envelope: JSON.stringify(bundle) };
    expect(canStartLegalSignature(review)).toBe(true);
    expect(isLegalReviewExecuted(review)).toBe(false);
  });

  it.each([true, false])("hashes exact unchanged PDF bytes consistently (Web Crypto: %s)", async useWebCrypto => {
    vi.stubGlobal("crypto", useWebCrypto ? webcrypto : {});
    const document = await PDFDocument.create();
    document.addPage([300, 300]);
    const pdfBytes = await document.save();
    const expected = createHash("sha256").update(pdfBytes).digest("hex");
    expect(await sha256Hex(pdfBytes)).toBe(expected);
    expect(await sha256Hex(pdfBytes.slice())).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
    const modified = pdfBytes.slice();
    modified[modified.length - 1] ^= 1;
    expect(await sha256Hex(modified)).not.toBe(expected);
  });

  it("hashes only a supplied byte view, not unrelated bytes in its backing buffer", async () => {
    const bytes = new TextEncoder().encode("prefix%PDF-1.7\\ncanonical bytes\\nsuffix");
    const view = bytes.subarray(6, bytes.length - 6);
    expect(await sha256Hex(view)).toBe(createHash("sha256").update(view).digest("hex"));
  });
});
