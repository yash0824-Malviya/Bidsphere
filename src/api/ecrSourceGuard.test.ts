import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("./erpnext", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  apiPut: mocks.apiPut,
  buildResourceUrl: (doctype: string, name?: string) =>
    `/api/resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`,
  extractErpNextErrorMessage: (_err: unknown, fallback: string) => fallback,
  COMPANY: "Netlink",
}));

import { createPurchaseRequisitionFromECR } from "./ecr";

describe("createPurchaseRequisitionFromECR source guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["RFQ", "PUR-RFQ-2026-00015"],
    ["Purchase Order", "PUR-ORD-2026-00042"],
  ])("handles server guard rejection when the ECR already references a %s", async (referenceType, documentName) => {
    mocks.apiPost.mockRejectedValue({
      response: {
        data: {
          message: `No downstream Purchase Requisition was created because this ECR uses an existing ${referenceType} (${documentName}).`,
        },
      },
    });

    await expect(createPurchaseRequisitionFromECR("ECR-0001", false)).resolves.toMatchObject({
      success: false,
      message: expect.stringMatching(/No downstream Purchase Requisition was created/i),
    });
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/create-pr-from-ecr", { ecr_name: "ECR-0001" });
  });
});
