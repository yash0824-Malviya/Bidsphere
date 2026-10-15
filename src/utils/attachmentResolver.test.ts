import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectContentType,
  isImageAttachment,
  isPdfAttachment,
  resolveAttachmentUrl,
} from "./attachmentResolver";
import {
  areFilenamesEquivalent,
  detectMimeType,
} from "../../api/business-cases-attachment";

const mockStorage: Record<string, string> = {};
const fakeLocalStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  },
};

describe("attachmentResolver & businessCaseAttachment utils", () => {
  beforeEach(() => {
    (globalThis as any).localStorage = fakeLocalStorage;
    fakeLocalStorage.clear();
  });

  afterEach(() => {
    fakeLocalStorage.clear();
  });

  describe("detectContentType", () => {
    it("detects PNG mime type", () => {
      expect(detectContentType("test.png")).toBe("image/png");
      expect(detectContentType("test.PNG")).toBe("image/png");
      expect(detectContentType("", "PNG")).toBe("image/png");
    });

    it("detects JPEG mime type", () => {
      expect(detectContentType("photo.jpg")).toBe("image/jpeg");
      expect(detectContentType("photo.jpeg")).toBe("image/jpeg");
      expect(detectContentType("", "JPG")).toBe("image/jpeg");
    });

    it("detects WEBP mime type", () => {
      expect(detectContentType("banner.webp")).toBe("image/webp");
      expect(detectContentType("", "WEBP")).toBe("image/webp");
    });

    it("detects PDF mime type", () => {
      expect(detectContentType("document.pdf")).toBe("application/pdf");
      expect(detectContentType("", "PDF")).toBe("application/pdf");
    });

    it("falls back to application/octet-stream for unknown", () => {
      expect(detectContentType("file.xyz")).toBe("application/octet-stream");
    });
  });

  describe("isImageAttachment & isPdfAttachment", () => {
    it("correctly identifies image attachments", () => {
      expect(isImageAttachment({ file_name: "04_Organization-Gains_1080×1350.png" })).toBe(true);
      expect(isImageAttachment({ file_name: "diagram.jpg" })).toBe(true);
      expect(isImageAttachment({ content_type: "image/png" })).toBe(true);
      expect(isImageAttachment({ file_name: "report.pdf" })).toBe(false);
    });

    it("correctly identifies PDF attachments", () => {
      expect(isPdfAttachment({ file_name: "business_case.pdf" })).toBe(true);
      expect(isPdfAttachment({ content_type: "application/pdf" })).toBe(true);
      expect(isPdfAttachment({ file_name: "04_Organization-Gains_1080×1350.png" })).toBe(false);
    });
  });

  describe("resolveAttachmentUrl", () => {
    it("returns empty string for falsy input", () => {
      expect(resolveAttachmentUrl(null)).toBe("");
      expect(resolveAttachmentUrl(undefined)).toBe("");
    });

    it("preserves blob: and data: URLs", () => {
      expect(resolveAttachmentUrl("blob:http://localhost:5175/1234")).toBe("blob:http://localhost:5175/1234");
      expect(resolveAttachmentUrl("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    });

    it("preserves already proxied URLs", () => {
      const proxied = "/api/file-proxy?path=%2Fprivate%2Ffiles%2Fdoc.png";
      expect(resolveAttachmentUrl(proxied)).toBe(proxied);
    });

    it("resolves private ERPNext file_url through /api/file-proxy", () => {
      const att = {
        id: "af55d9b37d",
        file_name: "04_Organization-Gains_1080×1350.png",
        file_url: "/private/files/04_Organization-Gains_1080x1350 (1).png",
        is_private: true,
      };

      const resolved = resolveAttachmentUrl(att);
      expect(resolved).toContain("/api/file-proxy?path=");
      expect(resolved).toContain(encodeURIComponent("/private/files/04_Organization-Gains_1080x1350 (1).png"));
      expect(resolved).toContain("file_id=af55d9b37d");
    });

    it("resolves public ERPNext file_url through /api/file-proxy", () => {
      const att = {
        file_name: "public-logo.png",
        file_url: "/files/public-logo.png",
        is_private: false,
      };

      const resolved = resolveAttachmentUrl(att);
      expect(resolved).toContain("/api/file-proxy?path=");
      expect(resolved).toContain(encodeURIComponent("/files/public-logo.png"));
    });

    it("uses fallback endpoint when only filename and caseId exist", () => {
      const att = {
        name: "04_Organization-Gains_1080×1350.png",
      };

      const resolved = resolveAttachmentUrl(att, "BC-2026-00004");
      expect(resolved).toBe("/api/business-cases/BC-2026-00004/attachments/04_Organization-Gains_1080%C3%971350.png/view");
    });
  });

  describe("areFilenamesEquivalent", () => {
    it("matches exact filenames", () => {
      expect(areFilenamesEquivalent("test.png", "test.png")).toBe(true);
    });

    it("matches Unicode multiplication sign (×) with ASCII x", () => {
      expect(
        areFilenamesEquivalent(
          "04_Organization-Gains_1080×1350.png",
          "04_Organization-Gains_1080x1350.png",
        ),
      ).toBe(true);
    });

    it("matches duplicate copy suffixes like (1)", () => {
      expect(
        areFilenamesEquivalent(
          "04_Organization-Gains_1080×1350.png",
          "04_Organization-Gains_1080x1350 (1).png",
        ),
      ).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(areFilenamesEquivalent("Document.PDF", "document.pdf")).toBe(true);
    });
  });

  describe("detectMimeType from magic bytes", () => {
    it("detects PNG from buffer", () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectMimeType(pngHeader, "test")).toBe("image/png");
    });

    it("detects JPEG from buffer", () => {
      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(detectMimeType(jpegHeader, "test")).toBe("image/jpeg");
    });

    it("detects PDF from buffer", () => {
      const pdfHeader = Buffer.from("%PDF-1.4");
      expect(detectMimeType(pdfHeader, "test")).toBe("application/pdf");
    });
  });
});
