import { describe, expect, it } from "vitest";
import {
  buildItemAttachmentMeta,
  parseEngineeringAttachments,
  pickEngineeringDocs,
  resolveEngineeringAttachments,
  serializeEngineeringAttachments,
  validateMrItemDrawing,
  filterSupplierVisibleAttachments,
  isSupplierVisibleAttachment,
} from "./materialRequestItemFiles";
import {
  inferDocumentTypeFromFileName,
  normalizeAttachmentVisibility,
  supplierMayAccessAttachmentPath,
} from "./rfqAttachmentVisibility";

describe("materialRequestItemFiles multi-attachment", () => {
  it("validates supported and unsupported extensions", () => {
    const ok = new File([new Uint8Array(10)], "part.step", {
      type: "application/octet-stream",
    });
    expect(validateMrItemDrawing(ok)).toBeNull();

    const bad = new File([new Uint8Array(10)], "part.exe", {
      type: "application/octet-stream",
    });
    expect(validateMrItemDrawing(bad)).toMatch(/Supported formats/i);

    const docx = new File([new Uint8Array(10)], "spec.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(validateMrItemDrawing(docx)).toBeNull();
  });

  it("parses JSON attachments and falls back to legacy single URL", () => {
    const json = serializeEngineeringAttachments([
      {
        id: "a1",
        fileName: "a.pdf",
        fileUrl: "/private/files/a.pdf",
        fileType: "pdf",
        fileSize: 1200,
        uploadedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(parseEngineeringAttachments(json)).toHaveLength(1);
    expect(parseEngineeringAttachments(json)[0].visibility).toBe("supplier");

    const legacy = resolveEngineeringAttachments({
      custom_2d_drawing: "/private/files/legacy.dwg",
    });
    expect(legacy).toHaveLength(1);
    expect(legacy[0].fileUrl).toContain("legacy.dwg");
  });

  it("pickEngineeringDocs merges part name + attachments", () => {
    const docs = pickEngineeringDocs({
      custom_part_name: "Handle Rev A",
      custom_2d_drawing: "/private/files/one.pdf",
      custom_engineering_attachments: serializeEngineeringAttachments([
        {
          id: "1",
          fileName: "one.pdf",
          fileUrl: "/private/files/one.pdf",
          fileType: "pdf",
          fileSize: 100,
          uploadedAt: "",
        },
        {
          id: "2",
          fileName: "two.step",
          fileUrl: "/private/files/two.step",
          fileType: "step",
          fileSize: 200,
          uploadedAt: "",
        },
      ]),
    });
    expect(docs.part_name).toBe("Handle Rev A");
    expect(docs.attachments).toHaveLength(2);
    expect(docs.drawing_2d_url).toContain("one.pdf");
  });

  it("buildItemAttachmentMeta exposes file_name, file_url, and count", () => {
    const meta = buildItemAttachmentMeta([
      {
        id: "1",
        fileName: "drawing.pdf",
        fileUrl: "/private/files/drawing.pdf",
        fileType: "pdf",
        fileSize: 100,
        uploadedAt: "",
      },
    ]);
    expect(meta.attachment_count).toBe(1);
    expect(meta.file_name).toBe("drawing.pdf");
    expect(meta.file_url).toContain("drawing.pdf");
  });

  it("defaults missing visibility to supplier and filters internal", () => {
    expect(normalizeAttachmentVisibility(undefined)).toBe("supplier");
    expect(normalizeAttachmentVisibility("internal")).toBe("internal");
    expect(isSupplierVisibleAttachment({ visibility: undefined })).toBe(true);
    expect(isSupplierVisibleAttachment({ visibility: "internal" })).toBe(false);

    const filtered = filterSupplierVisibleAttachments([
      {
        id: "1",
        fileName: "spec.pdf",
        fileUrl: "/private/files/spec.pdf",
        fileType: "pdf",
        fileSize: 1,
        uploadedAt: "",
        visibility: "supplier",
      },
      {
        id: "2",
        fileName: "cost.xlsx",
        fileUrl: "/private/files/cost.xlsx",
        fileType: "xlsx",
        fileSize: 1,
        uploadedAt: "",
        visibility: "internal",
      },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].fileName).toBe("spec.pdf");
  });

  it("infers document types and enforces path ACL", () => {
    expect(inferDocumentTypeFromFileName("RFQ_Specification.pdf")).toBe(
      "RFQ Specification",
    );
    expect(inferDocumentTypeFromFileName("part_2d.dwg")).toBe("2D Drawing");
    expect(
      supplierMayAccessAttachmentPath("/private/files/cost.xlsx", [
        {
          fileUrl: "/private/files/cost.xlsx",
          visibility: "internal",
        },
      ]),
    ).toBe(false);
    expect(
      supplierMayAccessAttachmentPath("/private/files/spec.pdf", [
        {
          fileUrl: "/private/files/spec.pdf",
          visibility: "supplier",
        },
      ]),
    ).toBe(true);
  });
});
