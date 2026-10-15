import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RFQ } from "../types/erpnext";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("./sourcing", () => ({ getRFQ: mocks.get, updateRFQ: mocks.update }));
vi.mock("./rfqTargetPriceAudit", () => ({ logRfqTargetPriceAudit: mocks.audit }));
vi.mock("../utils/materialRequestItemFiles", () => ({ sanitizeItemAttachmentsForSupplier: (value: unknown) => value }));
import { persistRfqTargetPricing } from "./rfqTargetPricingPersist";

const rfq: RFQ = { name: "RFQ-98", modified: "2026-09-24 12:30:00.123456", transaction_date: "2026-09-24", contract_required: "Yes", items: [{ name: "RFQ-ITEM-1", item_code: "STEEL", qty: 20, uom: "Kg", custom_target_price: 0, custom_show_target_price_to_supplier: 0 }], suppliers: [], custom_show_target_price_to_supplier: 0 };
const input = { rfqName: "RFQ-98", linesByItemCode: new Map([["STEEL", { target_price: 12.5, show_to_supplier: true }]]), audit: true };
function priced(value: number | null = 12.5, show = true): RFQ { return { ...structuredClone(rfq), custom_show_target_price_to_supplier: show ? 1 : 0, items: rfq.items!.map(item => ({ ...item, custom_target_price: value, custom_show_target_price_to_supplier: show ? 1 : 0 })) }; }
const routingError = { response: { data: { code: "RFQ_CLM_REQUEST_NOT_ROUTED", message: "RFQ saved, Contract Request schema needs attention", saved_rfq: { name: "RFQ-98" } } } };

describe("RFQ target pricing persistence", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue(structuredClone(rfq)); mocks.update.mockResolvedValue({}); mocks.audit.mockResolvedValue(undefined); });
  it("writes the exact ERP fields and re-fetches them, preserving RFQ row data", async () => {
    mocks.get.mockResolvedValueOnce(rfq).mockResolvedValueOnce(priced());
    await persistRfqTargetPricing(input);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith("RFQ-98", { modified: rfq.modified, custom_show_target_price_to_supplier: 1, items: [expect.objectContaining({ name: "RFQ-ITEM-1", item_code: "STEEL", qty: 20, uom: "Kg", custom_target_price: 12.5, custom_show_target_price_to_supplier: 1 })] });
    expect(mocks.get).toHaveBeenCalledTimes(2); expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("verifies prices already persisted during creation without another RFQ write or CLM routing attempt", async () => {
    mocks.get.mockResolvedValue(priced());
    await persistRfqTargetPricing(input);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.get).toHaveBeenCalledOnce();
  });
  it("confirms real pricing and returns an independent post-save CLM error for the caller to display", async () => {
    mocks.get.mockResolvedValueOnce(rfq).mockResolvedValueOnce(priced()); mocks.update.mockRejectedValue(routingError);
    await expect(persistRfqTargetPricing(input)).resolves.toEqual({ contractRequirementWarning: routingError.response.data.message });
    expect(mocks.update).toHaveBeenCalledOnce(); expect(mocks.get).toHaveBeenCalledTimes(2); expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("does not suppress actual pricing loss when the post-save CLM action failed", async () => {
    mocks.get.mockResolvedValueOnce(rfq).mockResolvedValueOnce(priced(0)); mocks.update.mockRejectedValue(routingError);
    await expect(persistRfqTargetPricing(input)).rejects.toThrow("Expected 12.5, got empty");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("keeps optional blank target pricing valid and avoids unnecessary writes", async () => {
    mocks.get.mockResolvedValue({ ...rfq, contract_required: "No" });
    await persistRfqTargetPricing({ ...input, linesByItemCode: new Map([["STEEL", { target_price: null, show_to_supplier: false }]]) });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("persists optional targets on Contract Required No without changing its workflow decision", async () => {
    mocks.get.mockResolvedValueOnce({ ...rfq, contract_required: "No" }).mockResolvedValueOnce({ ...priced(), contract_required: "No" });
    await persistRfqTargetPricing(input);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("contract_required");
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("verifies clearing a previous optional target rather than accepting a stale value", async () => {
    mocks.get.mockResolvedValue(priced(12.5, false));
    await expect(persistRfqTargetPricing({ ...input, linesByItemCode: new Map([["STEEL", { target_price: null, show_to_supplier: false }]]) })).rejects.toThrow("Expected empty, got 12.5");
    expect(mocks.update).toHaveBeenCalledOnce(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects a missing RFQ row before writing rather than silently dropping its target", async () => {
    await expect(persistRfqTargetPricing({ ...input, linesByItemCode: new Map([["MISSING", { target_price: 20, show_to_supplier: false }]]) })).rejects.toThrow("no saved item MISSING");
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("preserves header visibility for a saved line outside a partial edit", async () => {
    const existing = { ...rfq, custom_show_target_price_to_supplier: 1 as const, items: [...rfq.items!, { name: "OTHER-1", item_code: "OTHER", qty: 5, custom_target_price: 40, custom_show_target_price_to_supplier: 1 as const }] };
    mocks.get.mockResolvedValueOnce(existing).mockResolvedValueOnce({ ...existing, items: [{ ...existing.items[0], custom_target_price: 12.5 }, existing.items[1]] });
    await persistRfqTargetPricing({ ...input, linesByItemCode: new Map([["STEEL", { target_price: 12.5, show_to_supplier: false }]]) });
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ custom_show_target_price_to_supplier: 1, items: [expect.objectContaining({ custom_target_price: 12.5, custom_show_target_price_to_supplier: 0 }), existing.items[1]] });
  });
  it("does not accept a header fallback when ERP omitted the requested per-line visibility field", async () => {
    const saved = priced(); delete saved.items![0].custom_show_target_price_to_supplier; mocks.get.mockResolvedValueOnce(rfq).mockResolvedValueOnce(saved);
    await expect(persistRfqTargetPricing(input)).rejects.toThrow("Show Target Price for STEEL was not saved");
  });
  it("does not accept a legacy alias when ERP omitted the custom_target_price field written by this flow", async () => {
    const saved = priced(); delete saved.items![0].custom_target_price; saved.items![0].target_price = 12.5; mocks.get.mockResolvedValueOnce(rfq).mockResolvedValueOnce(saved);
    await expect(persistRfqTargetPricing(input)).rejects.toThrow("Expected 12.5, got empty");
  });
  it("retains actual write validation failures without reporting success", async () => {
    mocks.update.mockRejectedValue(new Error("Item Target Price is read-only"));
    await expect(persistRfqTargetPricing(input)).rejects.toThrow("Item Target Price is read-only");
    expect(mocks.get).toHaveBeenCalledOnce(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("keeps duplicate-code lines' targets and visibility distinct and verifies saved row identities", async () => {
    const first = { ...rfq.items![0], idx: 1 };
    const second = { ...first, name: "RFQ-ITEM-2", idx: 2, qty: 7 };
    const fresh = { ...rfq, items: [first, second] };
    const savedFirst = { ...first, custom_target_price: 12.5, custom_show_target_price_to_supplier: 1 as const };
    const savedSecond = { ...second, custom_target_price: 18, custom_show_target_price_to_supplier: 0 as const };
    mocks.get.mockResolvedValueOnce(fresh).mockResolvedValueOnce({ ...fresh, custom_show_target_price_to_supplier: 1, items: [savedSecond, savedFirst] });
    await persistRfqTargetPricing({ rfqName: rfq.name, lines: [{ item_code: "STEEL", target_price: 12.5, show_to_supplier: true }, { item_code: "STEEL", target_price: 18, show_to_supplier: false }], audit: true });
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ custom_show_target_price_to_supplier: 1, items: [savedFirst, savedSecond] });
    expect(mocks.audit.mock.calls[0][0].content).toBe("Line targets: Row 1 STEEL=12.5 (shown); Row 2 STEEL=18 (hidden)");
  });
  it("rejects missing duplicate rows before writing instead of assigning their target to another line", async () => {
    await expect(persistRfqTargetPricing({ rfqName: rfq.name, lines: [{ item_code: "STEEL", target_price: 12.5, show_to_supplier: true }, { item_code: "STEEL", target_price: 18, show_to_supplier: false }] })).rejects.toThrow("saved 1 item rows but 2 Target Pricing rows");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects an ordered line mismatch before writing", async () => {
    await expect(persistRfqTargetPricing({ rfqName: rfq.name, lines: [{ item_code: "OTHER", target_price: 12.5, show_to_supplier: true }] })).rejects.toThrow("item row 1 does not match OTHER");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
