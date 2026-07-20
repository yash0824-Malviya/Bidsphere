import { describe, expect, it } from "vitest";
import {
  parseEngineeringAttachments,
  pickEngineeringDocs,
  resolveEngineeringAttachments,
  serializeEngineeringAttachments,
  validateMrItemDrawing,
} from "./materialRequestItemFiles";

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
});
