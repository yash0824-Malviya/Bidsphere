import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReverseBidding } from "../types/reverseBidding";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("./erpnext", () => ({
  apiGet: mocks.get, apiPut: mocks.put, apiPost: vi.fn(), COMPANY: "Test Company",
  buildResourceUrl: (doctype: string, name?: string) => `${doctype}/${name ?? ""}`,
  buildListConfig: (config: unknown) => config, fetchPagedList: vi.fn(), withSilent: () => ({}),
}));
vi.mock("./sourcing", () => ({ getRFQ: vi.fn(), getSupplierQuotations: vi.fn() }));
vi.mock("./purchasing", () => ({ createPurchaseOrder: vi.fn() }));
vi.mock("./supplierScoringEngine", () => ({ scoreSuppliers: vi.fn() }));
vi.mock("./supplierPerformance", () => ({ getSupplierPerformance: vi.fn() }));
vi.mock("./supplierScoringResults", () => ({ getLatestScoringResult: vi.fn() }));
vi.mock("./rfqApprovalWorkflow", () => ({ submitForReview: vi.fn() }));
vi.mock("./legalDocs", () => ({ ensureLegalDocumentReviewForSelection: vi.fn() }));
vi.mock("../hooks/useSupplierSession", () => ({ readSupplierSession: vi.fn() }));
vi.mock("./reverseBiddingSubmit", () => ({
  isSupplierPortalBidSession: () => false, submitItemBidsViaServer: vi.fn(),
}));

import { setItemTargets, submitItemBids } from "./reverseBidding";

function auction(): ReverseBidding {
  return {
    name: "RB-CONCURRENCY", rfq: "RFQ-CONCURRENCY", auction_status: "Live",
    modified: "2026-09-18 12:00:00", start_date_time: "2020-01-01 00:00:00",
    end_date_time: "2099-01-01 00:00:00", lowest_bid: 25, currency: "USD",
    invited_suppliers: [{ name: "INV-A", supplier: "Supplier A", current_bid: 25 },
      { name: "INV-B", supplier: "Supplier B", current_bid: 25 }],
    bid_items: [{ name: "ITEM-A", supplier: "Supplier A", item_code: "COOLANT", qty: 1, current_rate: 25 },
      { name: "ITEM-B", supplier: "Supplier B", item_code: "COOLANT", qty: 1, current_rate: 25 }],
    bid_history: [],
  };
}

describe("reverse auction parent mutations preserve optimistic locking", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not replay stale target child rows using a newer version after another supplier bids", async () => {
    const opened = auction();
    const current = structuredClone(opened);
    current.modified = "2026-09-18 12:00:01";
    current.bid_items![1].current_rate = 23;
    current.bid_history = [{ name: "BID-B", supplier: "Supplier B", item_code: "COOLANT", bid_amount: 23 }];
    mocks.get.mockResolvedValueOnce(opened).mockResolvedValue(current);
    mocks.put.mockRejectedValueOnce(new Error("TimestampMismatchError: Document has been modified after you opened it"))
      .mockResolvedValue(opened);

    await expect(setItemTargets(opened.name, [{ item_code: "COOLANT", target: 20 }]))
      .rejects.toThrow(/auction has been updated.*review the changes/i);

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put.mock.calls[0][1].modified).toBe(opened.modified);
    expect(current.bid_items![1].current_rate).toBe(23);
    expect(current.bid_history).toHaveLength(1);
  });

  it("never retries legacy bid arrays or history with an unvalidated fresh parent timestamp", async () => {
    const opened = auction();
    mocks.get.mockResolvedValue(opened);
    mocks.put.mockRejectedValueOnce(new Error("Document has been modified after you opened it"))
      .mockResolvedValue(opened);

    await expect(submitItemBids({ auctionName: opened.name, supplier: "Supplier A",
      items: [{ item_code: "COOLANT", rate: 24 }] }))
      .rejects.toThrow(/auction has been updated/i);

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledTimes(1);
    const payload = mocks.put.mock.calls[0][1];
    expect(payload.modified).toBe(opened.modified);
    expect(payload.bid_history).toHaveLength(1);
    expect(payload.bid_history[0].bid_amount).toBe(24);
  });

  it("keeps unrelated ERP validation errors unchanged and does not retry them", async () => {
    mocks.get.mockResolvedValue(auction());
    const error = new Error("Target Rate must not be negative");
    mocks.put.mockRejectedValue(error);
    await expect(setItemTargets("RB-CONCURRENCY", [{ item_code: "COOLANT", target: -1 }]))
      .rejects.toBe(error);
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });
});
