import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./reverse-bidding-submit-item-bids";
import { ReverseBiddingSubmitError } from "./reverseBiddingSubmitCore";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), auth: vi.fn() }));
vi.mock("./reverseBiddingSubmitCore", async (original) => ({
  ...await original<typeof import("./reverseBiddingSubmitCore")>(), submitItemBidsCore: mocks.submit,
}));
vi.mock("./rbacAuth", async (original) => ({
  ...await original<typeof import("./rbacAuth")>(), requireSupplierAuth: mocks.auth,
}));
const call = async (body: unknown) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn() };
  await handler({ method: "POST", headers: {}, body } as VercelRequest, res as unknown as VercelResponse);
  return res;
};
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue({ supplier: "AUTHENTICATED-SUPPLIER", sub: "supplier-user" }); });
describe("reverse bid action endpoint", () => {
  it("forwards the whole batch, including malformed rows, for atomic validation", async () => {
    mocks.submit.mockRejectedValue(new ReverseBiddingSubmitError("Every submitted item must have a valid price", 400));
    const res = await call({ auction_name: "RB", supplier: "SPOOFED", items: [{ item_code: "VALID", rate: 24 }, { item_code: "", rate: "invalid" }] });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ supplier: "AUTHENTICATED-SUPPLIER", items: [{ item_code: "VALID", rate: 24 }, { item_code: "", rate: NaN }] }));
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("returns fresh auction and business conflict details to the live page", async () => {
    const auction = { name: "RB", modified: "2026-09-18 12:00:00.123456", lowest_bid: 46 };
    mocks.submit.mockRejectedValue(new ReverseBiddingSubmitError("Another supplier submitted a lower bid.", 409, { auction, itemCode: "ITEM", latestLowestBid: 23, submittedBid: 24, reasonCode: "outbid" }));
    const res = await call({ auction_name: "RB", items: [{ item_code: "ITEM", rate: 24 }] });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, auction, latest_lowest_bid: 23, item_code: "ITEM", reason_code: "outbid" }));
  });
  it("returns the single transaction result for both items", async () => {
    const auction = { name: "RB", lowest_bid: 48, bid_history: [{ item_code: "A" }, { item_code: "B" }] };
    mocks.submit.mockResolvedValue(auction);
    const res = await call({ auction_name: "RB", items: [{ item_code: "A", rate: 24 }, { item_code: "B", rate: 24 }] });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, auction });
  });
});
