import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), summary: vi.fn() }));
vi.mock("./sourcing", () => ({ submitRFQ: mocks.submit }));
vi.mock("./clm", () => ({ getRfqClmSummary: mocks.summary }));
import { submitRfqWithContractConfirmation } from "./rfqSubmitClm";
describe("RFQ submission is independent from award-only CLM", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(["Yes", "No", undefined])("submits existing requirement %s without requesting or claiming CLM", async required => {
    mocks.submit.mockResolvedValue({ name: "RFQ-1", docstatus: 1, contract_required: required });
    expect((await submitRfqWithContractConfirmation("RFQ-1")).message).toBe("RFQ submitted successfully.");
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith("RFQ-1"); expect(mocks.summary).not.toHaveBeenCalled();
  });
  it("preserves real submission failures", async () => {
    const error = new Error("ERPNext submission denied"); mocks.submit.mockRejectedValue(error);
    await expect(submitRfqWithContractConfirmation("RFQ-1")).rejects.toBe(error);
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it.each([{ name: "RFQ-1", docstatus: 0 }, { name: "OTHER", docstatus: 1 }])("rejects unconfirmed submission %j", async result => {
    mocks.submit.mockResolvedValue(result);
    await expect(submitRfqWithContractConfirmation("RFQ-1")).rejects.toThrow("did not confirm submission");
  });
});
