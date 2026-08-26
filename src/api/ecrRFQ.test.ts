import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  requestOptions: { retry: false },
}));

vi.mock("./erpnext", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  apiPut: mocks.apiPut,
  buildResourceUrl: (doctype: string, name?: string) =>
    `/api/resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`,
  extractErpNextErrorMessage: () => "",
  withSilent: () => ({}),
  withoutNetworkRetry: () => mocks.requestOptions,
  COMPANY: "Netlink",
}));

import { createRFQFromECR } from "./ecr";

describe("createRFQFromECR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends only the ECR identifier and accepts the interceptor-unwrapped response", async () => {
    mocks.apiPost.mockResolvedValue({
      success: true,
      rfqName: "PUR-RFQ-2026-00042",
      created: true,
      replayed: false,
      message: "RFQ created.",
    });

    await expect(createRFQFromECR("ECR-2026-0007")).resolves.toEqual({
      success: true,
      rfqName: "PUR-RFQ-2026-00042",
      newStatus: undefined,
      created: true,
      replayed: false,
      message: "RFQ created.",
    });
    expect(mocks.apiPost).toHaveBeenCalledWith(
      "/api/create-rfq-from-ecr",
      { ecr_name: "ECR-2026-0007" },
      mocks.requestOptions,
    );
  });

  it("fails closed when the server does not confirm the created RFQ", async () => {
    mocks.apiPost.mockResolvedValue({ success: true });

    await expect(createRFQFromECR("ECR-2026-0007")).resolves.toEqual({
      success: false,
      rfqName: undefined,
      newStatus: undefined,
      created: undefined,
      replayed: undefined,
      message: "RFQ creation returned an invalid response.",
    });
  });
});
