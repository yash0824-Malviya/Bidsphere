import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), award: vi.fn(), read: vi.fn(), decision: vi.fn() }));
vi.mock("./reverseBidding", () => ({ getReverseBidding: mocks.current, isApproved: (doc: { approved?: boolean }) => !!doc.approved, sendAuctionWinnerToReview: mocks.award, sameSupplier: (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() }));
vi.mock("./legalDocs", () => ({ getLegalDocsByRfq: mocks.read }));
vi.mock("./clm", () => ({ recordRfqAwardDecision: mocks.decision }));
import { confirmReverseAuctionContractDecision } from "./reverseAuctionContractDecision";

const input = { auction: "RB-1", rfq: "RFQ-1", supplier: "Supplier-1", finalAwardValue: 48500, submittedBy: "manager@test.invalid" };
const award = { name: "LDC-1", rfq_name: "RFQ-1", sq_name: "SQ-1", supplier: "Supplier-1", grand_total: 48500 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current.mockResolvedValue({ name: "RB-1", rfq: "RFQ-1" });
  mocks.award.mockResolvedValue({ name: "RB-1", rfq: "RFQ-1", winning_supplier: "Supplier-1", winner_price: 48500 });
  mocks.read.mockResolvedValue(award);
  mocks.decision.mockResolvedValue({ created: true, request: { doctype: "Contract Request", record: { name: "CTRQ-1" } }, summary: { decision: "Yes" } });
});

describe("reverse auction award contract decision", () => {
  it("applies the saved RFQ requirement only after the existing award API and saved LDC readback", async () => {
    const result = await confirmReverseAuctionContractDecision(input);
    expect(mocks.award).toHaveBeenCalledExactlyOnceWith("RB-1", "manager@test.invalid", undefined);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith("RFQ-1");
    expect(mocks.decision).toHaveBeenCalledExactlyOnceWith({ rfq: "RFQ-1", award_id: "LDC-1", quotation_id: "SQ-1", supplier_id: "Supplier-1" });
    expect(mocks.award.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]);
    expect(mocks.read.mock.invocationCallOrder[0]).toBeLessThan(mocks.decision.mock.invocationCallOrder[0]);
    expect(result.result.request?.record.name).toBe("CTRQ-1");
  });
  it("uses the backend-confirmed saved No requirement without creating a Contract locally", async () => {
    mocks.decision.mockResolvedValue({ created: false, summary: { decision: "No" } });
    const result = await confirmReverseAuctionContractDecision(input);
    expect(mocks.decision).toHaveBeenCalledExactlyOnceWith({ rfq: "RFQ-1", award_id: "LDC-1", quotation_id: "SQ-1", supplier_id: "Supplier-1" });
    expect(result.result.summary.decision).toBe("No");
    expect(result.result.request).toBeUndefined();
  });
  it("preserves the existing manual winner and negotiated final award amount", async () => {
    const override = { supplier: "Supplier-1", price: 48500 };
    await confirmReverseAuctionContractDecision({ ...input, override });
    expect(mocks.award).toHaveBeenCalledWith("RB-1", "manager@test.invalid", override);
    expect(mocks.decision.mock.calls[0][0]).not.toHaveProperty("contract_value");
  });
  it.each([null, { ...award, name: "" }, { ...award, sq_name: "" }, { ...award, rfq_name: "OTHER" }, { ...award, supplier: "OTHER" }])("never submits a decision for missing/mismatched persisted award %j", async saved => {
    mocks.read.mockResolvedValue(saved);
    await expect(confirmReverseAuctionContractDecision(input)).rejects.toThrow("award was not saved");
    expect(mocks.decision).not.toHaveBeenCalled();
  });
  it.each([50000, undefined, NaN])("does not replace the final negotiated amount with stale quotation value %s", async grand_total => {
    mocks.read.mockResolvedValue({ ...award, grand_total });
    await expect(confirmReverseAuctionContractDecision(input)).rejects.toThrow("saved award value does not match");
    expect(mocks.decision).not.toHaveBeenCalled();
  });
  it("keeps the real backend failure and reuses the saved award on retry", async () => {
    mocks.decision.mockRejectedValueOnce(new Error("ERPNext denied Request persistence."));
    await expect(confirmReverseAuctionContractDecision(input)).rejects.toThrow("ERPNext denied Request persistence.");
    mocks.current.mockResolvedValue({ name: "RB-1", rfq: "RFQ-1", approved: true });
    await confirmReverseAuctionContractDecision(input);
    expect(mocks.award).toHaveBeenCalledTimes(1);
    expect(mocks.decision.mock.calls.map(([payload]) => payload.award_id)).toEqual(["LDC-1", "LDC-1"]);
  });
  it("rejects another RFQ's auction before any award mutation", async () => {
    mocks.current.mockResolvedValue({ name: "RB-1", rfq: "OTHER" });
    await expect(confirmReverseAuctionContractDecision(input)).rejects.toThrow("auction does not belong");
    expect(mocks.award).not.toHaveBeenCalled();
    expect(mocks.decision).not.toHaveBeenCalled();
  });
  it("does not claim routing success when the existing award API fails", async () => {
    mocks.award.mockRejectedValueOnce(new Error("Winner changed."));
    await expect(confirmReverseAuctionContractDecision(input)).rejects.toThrow("Winner changed.");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.decision).not.toHaveBeenCalled();
  });
});
