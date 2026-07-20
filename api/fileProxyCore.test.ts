import { describe, expect, it } from "vitest";
import {
  classifyNonPdfResponse,
  contentTypeFromFilePath,
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
