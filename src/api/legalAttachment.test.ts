import { afterEach, describe, expect, it, vi } from "vitest";
import { getLegalReviewAttachmentUrl } from "./legalAttachment";
import { fetchPdfBytes, burnTypedSignatureIntoPdf, sha256Hex } from "./legalEsign";
import { PDFDocument } from "pdf-lib";
import { openErpFileInBrowser } from "./legalDocsStorage";

vi.mock("../utils/accessToken", () => ({ readErpProxyAccessToken: () => "current-session-secret" }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Legal attachment client", () => {
  it("builds a parent-scoped URL without embedding a session token", () => {
    const url = new URL(getLegalReviewAttachmentUrl("LDR-1", "terms", "/private/files/contract file.pdf"), "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ path: "/private/files/contract file.pdf", legal_review: "LDR-1", document_key: "terms" });
    expect(getLegalReviewAttachmentUrl("", "terms", "/private/files/a.pdf")).toBe("");
    expect(getLegalReviewAttachmentUrl("LDR-1", "terms", "https://other.test/login")).toBe("");
  });
  it("fetches PDF bytes with the current session header, no token in URLs or logs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("%PDF-1.7 body", { headers: { "Content-Type": "application/pdf" } }));
    const result = await fetchPdfBytes("/api/file-proxy?path=%2Fprivate%2Ffiles%2Fa.pdf&access_token=stale-secret");
    expect(new TextDecoder().decode(result)).toBe("%PDF-1.7 body");
    expect(fetchMock).toHaveBeenCalledWith("/api/file-proxy?path=%2Fprivate%2Ffiles%2Fa.pdf", expect.objectContaining({ cache: "no-store", credentials: "omit", headers: expect.objectContaining({ "X-Bidsphere-Access-Token": "current-session-secret" }) }));
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/current-session-secret|stale-secret/);
  });
  it("never sends an internal session header to an external origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("%PDF-ok", { headers: { "Content-Type": "application/pdf" } }));
    await fetchPdfBytes("https://external.test/file.pdf");
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("X-Bidsphere-Access-Token");
  });
  it("uses the same authenticated scope for Procurement preview and cleans up the Blob URL", async () => {
    const open = vi.fn();
    const timeout = vi.fn();
    vi.stubGlobal("window", { location: { origin: "http://localhost" }, open, setTimeout: timeout });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-preview");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("%PDF-body", { headers: { "Content-Type": "application/pdf" } }));
    const url = getLegalReviewAttachmentUrl("LDR-1", "terms", "/private/files/contract.pdf");
    await openErpFileInBrowser(url, { mode: "view" });
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ headers: expect.objectContaining({ "X-Bidsphere-Access-Token": "current-session-secret" }) }));
    expect(open).toHaveBeenCalledWith("blob:private-preview", "_blank", "noopener,noreferrer");
    timeout.mock.calls[0][0]();
    expect(revoke).toHaveBeenCalledWith("blob:private-preview");
  });
  it.each([[401, "Your ERP session has expired."], [403, "You do not have permission to view this document."], [404, "Document not found."]])("preserves HTTP %s and safe diagnostics", async (status, message) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "x".repeat(400), message }), { status: Number(status), headers: { "Content-Type": "application/json" } }));
    await expect(fetchPdfBytes("/api/file-proxy?path=a&access_token=stale-secret")).rejects.toMatchObject({ message, status });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/current-session-secret|stale-secret|xxxx/);
  });
  it("rejects HTML or mislabeled bytes instead of passing them to the renderer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (const contentType of ["text/html", "application/pdf"]) {
      fetchMock.mockResolvedValueOnce(new Response("<html>Not a PDF</html>", { headers: { "Content-Type": contentType } }));
      await expect(fetchPdfBytes("/api/file-proxy?path=a")).rejects.toThrow();
    }
  });
  it("keeps fetched bytes compatible with the unchanged signature burn/hash pipeline", async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    const bytes = await source.save();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Uint8Array.from(bytes).buffer, { headers: { "Content-Type": "application/pdf" } }));
    const fetched = await fetchPdfBytes("/api/file-proxy?path=a");
    const originalHash = await sha256Hex(fetched);
    const signed = await burnTypedSignatureIntoPdf(fetched, "Test Reviewer", "Legal Reviewer", new Date("2026-09-09T10:00:00Z"), { page: 1, xNorm: 0.5, yNorm: 0.5, widthNorm: 0.35, heightNorm: 0.1 });
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(1);
    expect(await sha256Hex(signed)).not.toBe(originalHash);
    expect(await sha256Hex(fetched)).toBe(originalHash);
  });
});
