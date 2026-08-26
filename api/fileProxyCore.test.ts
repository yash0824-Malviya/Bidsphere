import { describe, expect, it, vi } from "vitest";
import {
  classifyNonPdfResponse,
  contentTypeFromFilePath,
  fetchErpFile,
  isValidErpFilePath,
  resolveFileContentType,
} from "./fileProxyCore.js";

describe("classifyNonPdfResponse", () => {
  it("detects login HTML as expired session", () => {
    const body = classifyNonPdfResponse(
      200,
      "text/html; charset=utf-8",
      "<!doctype html><html><body>Login</body></html>",
    );
    expect(body.success).toBe(false);
    expect(body.status).toBe(401);
    expect(body.message).toBe("Your ERP session has expired.");
    expect(body.detail).toBe("ERP returned HTML instead of PDF");
  });

  it("maps plain HTML 404 page to Document not found", () => {
    const body = classifyNonPdfResponse(
      404,
      "text/html",
      "<!DOCTYPE html><html><body>Not Found</body></html>",
    );
    expect(body.status).toBe(404);
    expect(body.message).toBe("Document not found.");
  });

  it("maps 403 to permission message", () => {
    const body = classifyNonPdfResponse(403, "text/plain", "Forbidden");
    expect(body.status).toBe(403);
    expect(body.message).toBe("You do not have permission to view this document.");
  });

  it("maps 404 to not found", () => {
    const body = classifyNonPdfResponse(404, "application/json", '{"exc":"not found"}');
    expect(body.status).toBe(404);
    expect(body.message).toBe("Document not found.");
  });

  it("maps 500 to ERP retrieve failure", () => {
    const body = classifyNonPdfResponse(500, "text/plain", "Internal Server Error");
    expect(body.status).toBe(500);
    expect(body.message).toBe("Unable to retrieve the PDF from ERP.");
  });
});

describe("isValidErpFilePath", () => {
  it("accepts private and public file paths", () => {
    expect(isValidErpFilePath("/private/files/a.pdf")).toBe(true);
    expect(isValidErpFilePath("/files/a.pdf")).toBe(true);
    expect(isValidErpFilePath("private/files/a.pdf")).toBe(true);
  });

  it("rejects unrelated paths", () => {
    expect(isValidErpFilePath("/api/method/login")).toBe(false);
    expect(isValidErpFilePath("../secret")).toBe(false);
  });

  it.each([
    "/private/files/../site_config.json",
    "/private/files/%2e%2e/site_config.json",
    "/private/files/%252e%252e/site_config.json",
    "/private/files/%255c..%255csite_config.json",
    "/private/files/folder\\secret.pdf",
    "/private/files/file.pdf?download=1",
    "/private/files/file.pdf%23fragment",
    "/private/files/file.pdf%00.png",
    "/private/files//file.pdf",
  ])("rejects traversal or ambiguous encoded path %s", (path) => {
    expect(isValidErpFilePath(path)).toBe(false);
  });
});

describe("fetchErpFile persisted metadata gate", () => {
  const record = {
    name: "FILE-001",
    file_name: "drawing.pdf",
    file_url: "/private/files/drawing.pdf",
    is_private: 1,
    is_folder: 0,
    attached_to_doctype: "Engineering Change Request",
    attached_to_name: "ECR-2026-100001",
    attached_to_field: "engineering_drawing",
  };

  it("fails closed on a missing or ambiguous File lookup before fetching bytes", async () => {
    const missingFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const authorizeMissing = vi.fn();
    const missing = await fetchErpFile({
      baseUrl: "https://erp.test",
      filePath: record.file_url,
      apiKey: "key",
      apiSecret: "secret",
      authorizeFile: authorizeMissing,
    });
    expect(missing).toMatchObject({ ok: false, status: 404 });
    expect(authorizeMissing).not.toHaveBeenCalled();
    expect(missingFetch).toHaveBeenCalledTimes(1);
    missingFetch.mockRestore();

    const ambiguousFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [record, { ...record, name: "FILE-002" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const ambiguous = await fetchErpFile({
      baseUrl: "https://erp.test",
      filePath: record.file_url,
      apiKey: "key",
      apiSecret: "secret",
      authorizeFile: vi.fn(),
    });
    expect(ambiguous).toMatchObject({ ok: false, status: 403 });
    expect(ambiguousFetch).toHaveBeenCalledTimes(1);
    ambiguousFetch.mockRestore();
  });

  it("authorizes exact persisted metadata before making the binary request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [record] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(Buffer.from("%PDF-secure"), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }));
    const authorizeFile = vi.fn(async () => undefined);

    const result = await fetchErpFile({
      baseUrl: "https://erp.test",
      filePath: record.file_url,
      apiKey: "key",
      apiSecret: "secret",
      authorizeFile,
    });

    expect(result).toMatchObject({ ok: true, status: 200, contentType: "application/pdf" });
    expect(authorizeFile).toHaveBeenCalledWith(record);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/resource/File?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://erp.test/private/files/drawing.pdf",
    );
    fetchMock.mockRestore();
  });

  it("does not request bytes when persisted-parent authorization fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [record] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const denied = Object.assign(new Error("wrong ECR owner"), { status: 403 });

    const result = await fetchErpFile({
      baseUrl: "https://erp.test",
      filePath: record.file_url,
      apiKey: "key",
      apiSecret: "secret",
      authorizeFile: vi.fn(async () => { throw denied; }),
    });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});

describe("resolveFileContentType", () => {
  it("detects PNG magic bytes", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    expect(resolveFileContentType(png, "application/octet-stream", "/files/x.bin")).toBe(
      "image/png",
    );
  });

  it("falls back to path extension for CAD", () => {
    expect(contentTypeFromFilePath("/private/files/part.step")).toBe(
      "application/step",
    );
    expect(
      resolveFileContentType(Buffer.from([0x00, 0x01]), "", "/files/part.dwg"),
    ).toBe("application/acad");
  });
});
