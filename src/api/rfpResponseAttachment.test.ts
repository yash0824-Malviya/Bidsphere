import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRfpResponseAttachmentBlob,
  getRfpResponseAttachmentUrl,
  isRfpResponseAttachmentUrl,
} from "./rfpResponseAttachment";
import { openErpFileInBrowser } from "./legalDocsStorage";

const session = vi.hoisted(() => ({ token: "current-session-secret" }));
vi.mock("../utils/accessToken", () => ({
  readErpProxyAccessToken: () => session.token,
}));

const origin = "http://localhost:5175";
const documentUpload = {
  document_id: "3ae4bc85-469a-4e20-82f2-e0b7f1c04364",
  file: {
    file_url: "/private/files/Screenshot 2025-05-18 00461009cf37.png",
    file_id: "1a49008b21",
  },
};

function attachmentUrl() {
  return getRfpResponseAttachmentUrl("RFP-2026-00001", "th43q445al", documentUpload);
}

beforeEach(() => {
  session.token = "current-session-secret";
  vi.stubGlobal("window", {
    location: { origin },
    open: vi.fn(),
    setTimeout: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RFP response attachment requests", () => {
  it("keeps the RFP, response, document UUID and File ID separate without embedding credentials", () => {
    const url = new URL(attachmentUrl(), origin);
    expect(url.pathname).toBe("/api/file-proxy");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      path: documentUpload.file.file_url,
      rfp: "RFP-2026-00001",
      rfp_response: "th43q445al",
      response_document: documentUpload.document_id,
      file_id: "1a49008b21",
    });
    expect(url.href).not.toContain(session.token);
    expect(url.searchParams.has("access_token")).toBe(false);
  });

  it("distinguishes attachments sharing a path by their persisted document and File IDs", () => {
    const first = getRfpResponseAttachmentUrl("RFP-1", "RESPONSE-1", {
      document_id: "commercial-proposal-uuid",
      file: { file_url: "/private/files/shared.png", file_id: "commercial-file-id" },
    });
    const second = getRfpResponseAttachmentUrl("RFP-1", "RESPONSE-1", {
      document_id: "project-plan-uuid",
      file: { file_url: "/private/files/shared.png", file_id: "project-file-id" },
    });
    expect(first).not.toBe(second);
    const firstQuery = new URL(first, origin).searchParams;
    const secondQuery = new URL(second, origin).searchParams;
    expect(firstQuery.get("path")).toBe(secondQuery.get("path"));
    expect(firstQuery.get("file_id")).toBe("commercial-file-id");
    expect(secondQuery.get("file_id")).toBe("project-file-id");
    expect(firstQuery.get("response_document")).toBe("commercial-proposal-uuid");
    expect(secondQuery.get("response_document")).toBe("project-plan-uuid");
  });

  it("preserves parent scope when a legacy attachment has no saved File ID", () => {
    const url = new URL(getRfpResponseAttachmentUrl("RFP-1", "RESPONSE-1", {
      document_id: "legacy-document-uuid",
      file: { file_url: "/private/files/legacy.pdf" },
    }), origin);
    expect(url.searchParams.get("response_document")).toBe("legacy-document-uuid");
    expect(url.searchParams.get("rfp_response")).toBe("RESPONSE-1");
    expect(url.searchParams.has("file_id")).toBe(false);
  });

  it("preserves the existing legacy data URL fallback", () => {
    const dataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
    expect(getRfpResponseAttachmentUrl("RFP-1", "RESPONSE-1", {
      document_id: "legacy-inline-document",
      file: { file_url: dataUrl },
    })).toBe(dataUrl);
    expect(isRfpResponseAttachmentUrl(dataUrl)).toBe(false);
  });

  it("recognizes only the exact same-origin proxy with the complete response scope", () => {
    const url = attachmentUrl();
    expect(isRfpResponseAttachmentUrl(url)).toBe(true);
    expect(isRfpResponseAttachmentUrl(new URL(url, origin).href)).toBe(true);
    for (const missingKey of ["rfp", "rfp_response", "response_document"]) {
      const incomplete = new URL(url, origin);
      incomplete.searchParams.delete(missingKey);
      expect(isRfpResponseAttachmentUrl(incomplete.href)).toBe(false);
    }
    expect(isRfpResponseAttachmentUrl(`https://external.example${url}`)).toBe(false);
    expect(isRfpResponseAttachmentUrl(url.replace("/api/file-proxy", "/other/api/file-proxy"))).toBe(false);
    expect(isRfpResponseAttachmentUrl("/api/file-proxy?path=/private/files/a.pdf")).toBe(false);
  });

  it("uses the current session at fetch time, with no cookies or shared browser cache", async () => {
    const url = attachmentUrl();
    session.token = "refreshed-session-secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("%PDF-body", { headers: { "Content-Type": "application/pdf" } }),
    );
    await fetchRfpResponseAttachmentBlob(url);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
      credentials: "omit",
      cache: "no-store",
      headers: expect.objectContaining({ "X-Bidsphere-Access-Token": "refreshed-session-secret" }),
    }));
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("session-secret");
  });

  it("removes a stale URL token while preserving the persisted attachment scope", async () => {
    const url = attachmentUrl();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("%PDF-body", { headers: { "Content-Type": "application/pdf" } }),
    );
    await fetchRfpResponseAttachmentBlob(`${origin}${url}&access_token=stale-session-secret`);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
      headers: expect.objectContaining({ "X-Bidsphere-Access-Token": session.token }),
    }));
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("stale-session-secret");
  });

  it.each([
    ["application/pdf", "%PDF-1.7 body"],
    ["image/png", "png-file-bytes"],
    ["image/jpeg", "jpeg-file-bytes"],
  ])("preserves %s bytes and MIME type for the viewer", async (mimeType, bytes) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes, {
      headers: { "Content-Type": mimeType },
    }));
    const blob = await fetchRfpResponseAttachmentBlob(attachmentUrl());
    expect(blob.type).toBe(mimeType);
    expect(await blob.text()).toBe(bytes);
  });

  it.each([
    [401, "Your session has expired. Please sign in again."],
    [403, "You do not have permission to view this document."],
    [404, "Document not found."],
    [500, "Unable to load the document. Please try again."],
  ])("maps HTTP %s to a safe message without exposing the ERP response", async (status, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      message: "Internal permission exception with API credentials",
      detail: "Traceback: /private/server/path.py:88 secret-token",
    }), { status: Number(status), headers: { "Content-Type": "application/json" } }));
    await expect(fetchRfpResponseAttachmentBlob(attachmentUrl())).rejects.toMatchObject({ message });
  });

  it("shows a safe connection error when the request cannot reach the server", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Internal host and token details"));
    await expect(fetchRfpResponseAttachmentBlob(attachmentUrl())).rejects.toThrow(
      "Unable to connect to the document service.",
    );
  });

  it("does not pass an HTML login or error page to the document renderer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>Internal exception</html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    await expect(fetchRfpResponseAttachmentBlob(attachmentUrl())).rejects.toThrow(
      "Unable to load the document. Please try again.",
    );
  });

  it("shows the same safe permission error when Download is denied", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Private backend traceback", {
      status: 403,
    }));
    await expect(openErpFileInBrowser(attachmentUrl(), { mode: "download" })).rejects.toThrow(
      /^You do not have permission to view this document\.$/,
    );
  });

  it("never forwards the current session to a foreign-origin proxy URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("image", { headers: { "Content-Type": "image/png" } }),
    );
    const externalUrl = `https://external.example${attachmentUrl()}`;
    await fetchRfpResponseAttachmentBlob(externalUrl).catch(() => undefined);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("X-Bidsphere-Access-Token")).toBeNull();
    }
  });

  it("uses the same authenticated attachment context for inline preview and download", async () => {
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild },
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rfp-document");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("%PDF-private-response", { headers: { "Content-Type": "application/pdf" } }));
    const url = attachmentUrl();

    const preview = await fetchRfpResponseAttachmentBlob(url);
    await openErpFileInBrowser(url, { mode: "download", fileName: "Technical Proposal.pdf" });

    expect(preview.type).toBe("application/pdf");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [requestUrl, init] of fetchMock.mock.calls) {
      expect(requestUrl).toBe(url);
      expect(init).toEqual(expect.objectContaining({ credentials: "omit", cache: "no-store" }));
      expect(new Headers(init?.headers).get("X-Bidsphere-Access-Token")).toBe(session.token);
    }
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "application/pdf" }));
    expect(anchor.href).toBe("blob:rfp-document");
    expect(anchor.download).toBe("Technical Proposal.pdf");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    const cleanup = vi.mocked(window.setTimeout).mock.calls[0][0];
    expect(typeof cleanup).toBe("function");
    if (typeof cleanup === "function") cleanup();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:rfp-document");
  });
});
