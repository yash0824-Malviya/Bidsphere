import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiGet, apiPost, apiPut } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("./erpnext", () => ({
  apiGet,
  apiPost,
  apiPut,
  buildResourceUrl: (doctype: string, name?: string) =>
    `/api/resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`,
}));

import { createRFQFromPR } from "./purchaseRequisition";

describe("createRFQFromPR", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the secured idempotent backend endpoint", async () => {
    apiPost.mockResolvedValue({
      success: true,
      rfqName: "PUR-RFQ-2026-00015",
      created: false,
      warnings: [],
      message: "Existing RFQ recovered without a duplicate.",
    });

    await expect(createRFQFromPR("PR-0001", {
      suppliers: ["Atlantic Precision Manufacturing."],
    })).resolves.toEqual({
      success: true,
      rfqName: "PUR-RFQ-2026-00015",
      created: false,
      message: "Existing RFQ recovered without a duplicate.",
      warnings: [],
      needsRepair: false,
    });
    expect(apiPost).toHaveBeenCalledWith("/api/create-rfq-from-pr", {
      pr_name: "PR-0001",
      suppliers: ["Atlantic Precision Manufacturing."],
      title: undefined,
      schedule_date: undefined,
    });
  });

  it("returns the trusted backend validation message", async () => {
    apiPost.mockRejectedValue(new Error("No duplicate RFQ was created."));
    await expect(createRFQFromPR("PR-0001", { suppliers: [] })).resolves.toEqual({
      success: false,
      message: "No duplicate RFQ was created.",
      warnings: [],
      needsRepair: false,
    });
  });

  it("preserves backend repair warnings for an idempotent UI retry", async () => {
    apiPost.mockResolvedValue({
      success: true,
      rfqName: "PUR-RFQ-2026-00015",
      created: true,
      warnings: ["ECR link failed: write unavailable"],
      message: "RFQ created, but follow-up is required.",
    });

    await expect(createRFQFromPR("PR-0001", {
      suppliers: ["SUP-001"],
    })).resolves.toEqual({
      success: true,
      rfqName: "PUR-RFQ-2026-00015",
      created: true,
      message: "RFQ created, but follow-up is required.",
      warnings: ["ECR link failed: write unavailable"],
      needsRepair: true,
    });
  });

  it("preserves a partial error's RFQ identity and retry signal", async () => {
    apiPost.mockRejectedValue({
      message: "Request failed",
      response: {
        data: {
          code: "partial",
          rfq_name: "PUR-RFQ-2026-00015",
          message: "RFQ exists but its PR link could not be saved.",
        },
      },
    });

    await expect(createRFQFromPR("PR-0001", {
      suppliers: ["SUP-001"],
    })).resolves.toEqual({
      success: false,
      rfqName: "PUR-RFQ-2026-00015",
      message: "RFQ exists but its PR link could not be saved.",
      warnings: [],
      needsRepair: true,
    });
  });
});
