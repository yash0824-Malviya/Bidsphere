import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  formatFileSize,
  inferCategoryFromFieldName,
  inferFieldNameFromCategory,
  getAttachmentsFromLocalStore,
  saveAttachmentsToLocalStore,
  fetchECRAttachments,
  type ECRAttachment,
} from "./ecrAttachments";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("ecrAttachments", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("formatFileSize", () => {
    it("formats 0 or negative or invalid sizes as —", () => {
      expect(formatFileSize(0)).toBe("—");
      expect(formatFileSize(-10)).toBe("—");
      expect(formatFileSize(undefined)).toBe("—");
      expect(formatFileSize(NaN)).toBe("—");
    });

    it("formats bytes, KB, and MB correctly", () => {
      expect(formatFileSize(512)).toBe("512 B");
      expect(formatFileSize(2048)).toBe("2.0 KB");
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    });
  });

  describe("inferCategoryFromFieldName", () => {
    it("maps fields to standard categories", () => {
      expect(inferCategoryFromFieldName("engineering_drawing")).toBe("Engineering Drawing");
      expect(inferCategoryFromFieldName("3d_cad_file")).toBe("3D CAD Model");
      expect(inferCategoryFromFieldName("specification")).toBe("Specification Document");
      expect(inferCategoryFromFieldName("supporting_documents")).toBe("Supporting Documents");
      expect(inferCategoryFromFieldName("validation_documents")).toBe("Validation Documents");
    });

    it("infers 3D CAD model from file extension if field is unknown", () => {
      expect(inferCategoryFromFieldName("", "part.step")).toBe("3D CAD Model");
      expect(inferCategoryFromFieldName("", "part.iges")).toBe("3D CAD Model");
      expect(inferCategoryFromFieldName("", "part.pdf")).toBe("Supporting Documents");
    });
  });

  describe("inferFieldNameFromCategory", () => {
    it("maps categories back to fields", () => {
      expect(inferFieldNameFromCategory("Engineering Drawing")).toBe("engineering_drawing");
      expect(inferFieldNameFromCategory("3D CAD Model")).toBe("3d_cad_file");
      expect(inferFieldNameFromCategory("Specification Document")).toBe("specification");
      expect(inferFieldNameFromCategory("Supporting Documents")).toBe("supporting_documents");
      expect(inferFieldNameFromCategory("Validation Documents")).toBe("validation_documents");
    });
  });

  describe("localStorage persistence and fetchECRAttachments", () => {
    it("stores and retrieves attachments from localStorage", () => {
      const mockAttachment: ECRAttachment = {
        id: "att-123",
        ecr_id: "ECR-001",
        category: "Engineering Drawing",
        field_name: "engineering_drawing",
        file_name: "Door_Bracket_Rev04.pdf",
        file_url: "/private/files/Door_Bracket_Rev04.pdf",
        full_url: "/api/file-proxy?path=%2Fprivate%2Ffiles%2FDoor_Bracket_Rev04.pdf",
        formatted_size: "2.4 MB",
        uploaded_by: "Engineer",
        uploaded_at: "2026-08-25T10:00:00Z",
      };

      saveAttachmentsToLocalStore("ECR-001", [mockAttachment]);
      const retrieved = getAttachmentsFromLocalStore("ECR-001");
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].file_name).toBe("Door_Bracket_Rev04.pdf");
      expect(retrieved[0].category).toBe("Engineering Drawing");
    });

    it("falls back to ecrDoc fields when no File rows exist", async () => {
      const ecrDoc = {
        name: "ECR-TEST-01",
        ecr_owner: "engineer@company.com",
        engineering_drawing: "/private/files/Drawing.pdf",
        "3d_cad_file": "/private/files/Model.step",
        specification: "/private/files/Spec.docx",
        supporting_documents: "/private/files/Report1.pdf,/private/files/Report2.pdf",
      };

      const attachments = await fetchECRAttachments("ECR-TEST-01", ecrDoc as any);
      expect(attachments.length).toBeGreaterThanOrEqual(4);

      const drawing = attachments.find((a) => a.category === "Engineering Drawing");
      expect(drawing).toBeDefined();
      expect(drawing?.file_name).toBe("Drawing.pdf");

      const cad = attachments.find((a) => a.category === "3D CAD Model");
      expect(cad).toBeDefined();
      expect(cad?.file_name).toBe("Model.step");

      const supporting = attachments.filter((a) => a.category === "Supporting Documents");
      expect(supporting.length).toBe(2);
    });
  });
});
