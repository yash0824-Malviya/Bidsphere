import { describe, expect, it } from "vitest";
import type { ClmData, ClmRecord } from "../src/types/clm";
import { clmPdfEvidenceById, clmPdfEvidenceByUrl, currentClmPdfEvidence, lockedClmPdfEvidence } from "./clmPdfEvidence";

const file = (id: string) => ({ file_id: id, file_url: `/private/files/${id}.pdf`, hash: "a".repeat(64) });
const record: ClmRecord = { name: "CON-1", custom_current_version: "2.0" };
const data = (): ClmData => ({ schema: 1, approvals: [], versions: [], audit: [], sla: [], signatures: [], locked_file: file("LOCKED") });
const signature = (id: string, version = "2.0") => ({ ...file(id), party: "inteva" as const, by: "legal@example.test", at: "2026-09-28 12:00:00", typed_name: "Legal Signer", version });

describe("authoritative versioned Contract PDF evidence", () => {
  it("selects the locked original before signing and the latest persisted receipt after signing", () => {
    const saved = data(), before = structuredClone(saved);
    expect(currentClmPdfEvidence(record, saved)).toMatchObject({ ...file("LOCKED"), version: "2.0", kind: "locked" });
    expect(saved).toEqual(before);
    saved.signatures.push(signature("LEGAL"));
    expect(currentClmPdfEvidence(record, saved)).toMatchObject({ ...file("LEGAL"), version: "2.0", kind: "signed" });
    saved.signatures.push({ ...signature("BOTH"), party: "supplier" });
    expect(currentClmPdfEvidence(record, saved)?.file_id).toBe("BOTH");
    expect(lockedClmPdfEvidence(record, saved)?.file_id).toBe("LOCKED");
  });
  it("does not fall back to an unsigned original when an active receipt has a different version", () => {
    const saved = data(); saved.signatures.push(signature("STALE", "1.0"));
    expect(() => currentClmPdfEvidence(record, saved)).toThrow("does not match");
    expect(() => clmPdfEvidenceById(record, saved, "STALE")).toThrow("does not match");
  });
  it("rejects an explicit locked version mismatch or incomplete document evidence", () => {
    const saved = data(); saved.locked_file = { ...file("LOCKED"), version: "1.0" };
    expect(() => currentClmPdfEvidence(record, saved)).toThrow("does not match");
    saved.locked_file = { ...file("LOCKED"), hash: "" };
    expect(() => currentClmPdfEvidence(record, saved)).toThrow("incomplete");
  });
  it("returns no document for a draft without approved PDF evidence", () => {
    const saved = data(); delete saved.locked_file;
    expect(currentClmPdfEvidence(record, saved)).toBeUndefined();
  });
  it.each(["short", "z".repeat(64), "a".repeat(63), "a".repeat(65)])("rejects invalid SHA-256 evidence %s before enabling review", hash => {
    const saved = data(); saved.locked_file = { ...file("LOCKED"), hash };
    expect(() => currentClmPdfEvidence(record, saved)).toThrow("valid SHA-256 digest");
  });
  it.each(["/files/public.pdf", "https://foreign.example/private/files/a.pdf", "/private/files/../secret.pdf", "/private/files/%252e%252e/secret.pdf", "/private/files/a.pdf?changed=1", "/private/files/", "/private/files/a%00.pdf"])("rejects a non-private or invalid evidence path %s", file_url => {
    const saved = data(); saved.signatures = [{ ...signature("LEGAL"), file_url }];
    expect(() => currentClmPdfEvidence(record, saved)).toThrow("private document");
  });
  it("accepts a private filename with spaces and normalizes a valid uppercase SHA-256 digest", () => {
    const saved = data(); saved.locked_file = { ...file("LOCKED"), file_url: "/private/files/Approved%20Contract.pdf", hash: "A".repeat(64) };
    expect(currentClmPdfEvidence(record, saved)).toMatchObject({ file_url: "/private/files/Approved%20Contract.pdf", hash: "a".repeat(64) });
  });
  it("resolves schema attachments to the same current evidence without accepting arbitrary paths", () => {
    const saved = data(); saved.signatures.push(signature("LEGAL"));
    expect(clmPdfEvidenceByUrl(record, saved, "/private/files/LEGAL.pdf")).toEqual(currentClmPdfEvidence(record, saved));
    expect(clmPdfEvidenceByUrl(record, saved, "/private/files/OTHER.pdf")).toBeUndefined();
  });
  it("requires explicit internal historical access and binds archived receipts to their saved version", () => {
    const saved = data(); saved.versions.push({ id: "revision-1", number: "1.0", author: "team@example.test", at: "2026-09-27 10:00:00", comment: "Initial version", hash: "snapshot", content: {} });
    saved.review_history = [{ version: "revision-1", signatures: [signature("OLD-SIGNED", "1.0")], locked_file: file("OLD-ORIGINAL") }];
    expect(clmPdfEvidenceById(record, saved, "OLD-SIGNED")).toBeUndefined();
    expect(clmPdfEvidenceById(record, saved, "OLD-SIGNED", true)).toMatchObject({ ...file("OLD-SIGNED"), version: "1.0", kind: "signed" });
    expect(clmPdfEvidenceById(record, saved, "OLD-ORIGINAL", true)).toMatchObject({ ...file("OLD-ORIGINAL"), version: "1.0", kind: "locked" });
    expect(clmPdfEvidenceById(record, saved, "ARBITRARY", true)).toBeUndefined();
  });
});
