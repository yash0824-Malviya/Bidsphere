import { describe, expect, it } from "vitest";

import {
  createPaymentAttachment,
  formatAttachmentUploadTime,
  isAllowedPaymentAttachment,
} from "./paymentAttachmentUtils";

describe("isAllowedPaymentAttachment", () => {
  it("accepts pdf and image extensions", () => {
    expect(
      isAllowedPaymentAttachment(
        new File(["x"], "check.pdf", { type: "application/pdf" })
      )
    ).toBe(true);
    expect(
      isAllowedPaymentAttachment(
        new File(["x"], "scan.png", { type: "image/png" })
      )
    ).toBe(true);
    expect(
      isAllowedPaymentAttachment(
        new File(["x"], "photo.jpg", { type: "image/jpeg" })
      )
    ).toBe(true);
  });

  it("rejects unsupported types", () => {
    expect(
      isAllowedPaymentAttachment(
        new File(["x"], "doc.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        })
      )
    ).toBe(false);
  });
});

describe("createPaymentAttachment", () => {
  it("stores metadata and object url", () => {
    const file = new File(["hello"], "remittance.pdf", {
      type: "application/pdf",
    });
    const att = createPaymentAttachment("remittance_advice", file);
    expect(att.fileName).toBe("remittance.pdf");
    expect(att.mimeType).toBe("application/pdf");
    expect(att.uploadedAt).toBeTruthy();
    expect(att.objectUrl).toMatch(/^blob:/);
  });
});

describe("formatAttachmentUploadTime", () => {
  it("formats in US locale", () => {
    const formatted = formatAttachmentUploadTime("2026-06-15T14:30:00.000Z");
    expect(formatted).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
