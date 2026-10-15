import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RFQ, SupplierQuotation } from "../types/erpnext";
import type { ReverseBidding } from "../types/reverseBidding";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), getRFQ: vi.fn(), getQuotations: vi.fn(),
}));

vi.mock("./erpnext", () => ({
  apiGet: mocks.get,
  apiPost: mocks.post,
  apiPut: mocks.put,
  COMPANY: "Test Company",
  buildResourceUrl: (doctype: string, name?: string) => `${doctype}/${name ?? ""}`,
  buildListConfig: (config: unknown) => config,
  fetchPagedList: vi.fn(),
  withSilent: () => ({}),
}));
vi.mock("./sourcing", () => ({ getRFQ: mocks.getRFQ, getSupplierQuotations: mocks.getQuotations }));
vi.mock("./purchasing", () => ({ createPurchaseOrder: vi.fn() }));
vi.mock("./supplierScoringEngine", () => ({ scoreSuppliers: vi.fn() }));
vi.mock("./supplierPerformance", () => ({ getSupplierPerformance: vi.fn() }));
vi.mock("./supplierScoringResults", () => ({ getLatestScoringResult: vi.fn() }));
vi.mock("./rfqApprovalWorkflow", () => ({ submitForReview: vi.fn() }));
vi.mock("./legalDocs", () => ({ ensureLegalDocumentReviewForSelection: vi.fn() }));
vi.mock("../hooks/useSupplierSession", () => ({ readSupplierSession: vi.fn() }));
vi.mock("./reverseBiddingSubmit", () => ({
  isSupplierPortalBidSession: vi.fn(), submitItemBidsViaServer: vi.fn(),
}));

import { createReverseBiddingFromRFQ } from "./reverseBidding";

const RFQ_ID = "PUR-RFQ-2026-00089";
// Literal quotation marks are part of this real-world Supplier.name format.
const TITAN_ID = '"Titan Industrial Products LLC"';
const FEMSA_ID = "FEMSA";
const ATLANTIC_ID = "SUP-ATLANTIC";
const TITAN_QUOTE = "PUR-SQTN-2026-00253";
const FEMSA_QUOTE = "PUR-SQTN-2026-00256";

function quotation(name: string, supplier: string, rate: number, overrides: Partial<SupplierQuotation> = {}): SupplierQuotation {
  return {
    name, supplier, supplier_name: supplier === TITAN_ID ? "Titan Industrial Products LLC" : supplier,
    docstatus: 1, status: "Submitted", modified: "2026-09-18 10:00:00", transaction_date: "2026-09-18",
    grand_total: rate * 2,
    items: [{ name: `${name}-ITEM`, item_code: "PART-1", item_name: "Part One", qty: 2, rate, amount: rate * 2,
      uom: "Nos", request_for_quotation: RFQ_ID, request_for_quotation_item: "RFQ-ITEM-1" }],
    ...overrides,
  };
}

function selection(quotation_id: string, supplier_id: string, rfq_id = RFQ_ID) {
  return { quotation_id, supplier_id, rfq_id };
}

function selectedPair() {
  return [selection(TITAN_QUOTE, TITAN_ID), selection(FEMSA_QUOTE, FEMSA_ID)];
}

let rfq: RFQ;
let quotations: SupplierQuotation[];

beforeEach(() => {
  vi.clearAllMocks();
  rfq = {
    name: RFQ_ID, company: "Test Company", docstatus: 1, transaction_date: "2026-09-18",
    items: [{ name: "RFQ-ITEM-1", item_code: "PART-1", item_name: "Part One", qty: 2, uom: "Nos" }],
    suppliers: [{ name: "INV-TITAN", supplier: TITAN_ID }, { name: "INV-FEMSA", supplier: FEMSA_ID },
      { name: "INV-ATLANTIC", supplier: ATLANTIC_ID }],
  };
  quotations = [quotation(TITAN_QUOTE, TITAN_ID, 50), quotation(FEMSA_QUOTE, FEMSA_ID, 70),
    quotation("PUR-SQTN-2026-00257", ATLANTIC_ID, 90)];
  mocks.get.mockResolvedValue([]);
  mocks.getRFQ.mockImplementation(async () => rfq);
  mocks.getQuotations.mockImplementation(async () => quotations);
  mocks.post.mockImplementation(async (_url, body: { doc: ReverseBidding }) => ({ ...body.doc, name: "RB-TEST-1" }));
});

function savedDocument(): ReverseBidding {
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.post.mock.calls[0][0]).toBe("/api/method/frappe.client.save");
  return mocks.post.mock.calls[0][1].doc;
}

async function expectInvalid(selectedQuotations = selectedPair(), activeRoundName?: string) {
  await expect(createReverseBiddingFromRFQ({ rfqName: RFQ_ID, selectedQuotations, activeRoundName })).rejects.toThrow();
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.put).not.toHaveBeenCalled();
}

describe("reverse bidding selected Supplier Quotation identities", () => {
  it("rejects a latest AVOID supplier before any auction write, including a score leader", async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === "Supplier Scoring Result/") return [{ name: "SCORE-1" }];
      if (url === "Supplier Scoring Result/SCORE-1") return { rfq: RFQ_ID, analysis_snapshot: JSON.stringify({ analysis: {
        rfq_id: RFQ_ID, supplier_analysis: [{ rfq_id: RFQ_ID, supplier_id: TITAN_ID, quotation_id: TITAN_QUOTE,
          rank: 1, score: { overall: 91 }, risk: "High", verdict: "AVOID" }],
      } }) };
      return [];
    });
    await expect(createReverseBiddingFromRFQ({ rfqName: RFQ_ID, selectedQuotations: selectedPair() })).rejects.toThrow(/AVOID/);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("creates exactly two invited suppliers from the selected quotation identities, retaining literal supplier ID quotes", async () => {
    quotations.reverse();
    const created = await createReverseBiddingFromRFQ({
      rfqName: RFQ_ID, selectedQuotations: selectedPair(), procurementManager: "procurement@example.test",
      currency: "USD", remarks: "Selected two quoted suppliers",
    });
    const doc = savedDocument();
    expect(created.name).toBe("RB-TEST-1");
    expect(mocks.getRFQ).toHaveBeenCalledWith(RFQ_ID);
    expect(mocks.getQuotations.mock.calls[0][0]).toBe(RFQ_ID);
    expect(doc).toMatchObject({ rfq: RFQ_ID, company: "Test Company", currency: "USD", auction_status: "Draft",
      procurement_manager: "procurement@example.test", remarks: "Selected two quoted suppliers", starting_price: 140, lowest_bid: 100 });
    expect(doc.invited_suppliers).toHaveLength(2);
    expect(doc.invited_suppliers).toEqual(expect.arrayContaining([
      expect.objectContaining({ supplier: TITAN_ID, initial_quotation_amount: 100, current_bid: 100, invitation_status: "Pending" }),
      expect.objectContaining({ supplier: FEMSA_ID, initial_quotation_amount: 140, current_bid: 140, invitation_status: "Pending" }),
    ]));
    expect(doc.bid_items).toHaveLength(2);
    expect(doc.bid_items).toEqual(expect.arrayContaining([
      expect.objectContaining({ supplier: TITAN_ID, rfq_item: "RFQ-ITEM-1", item_code: "PART-1", qty: 2, uom: "Nos", initial_rate: 50, current_rate: 50, amount: 100 }),
      expect.objectContaining({ supplier: FEMSA_ID, rfq_item: "RFQ-ITEM-1", item_code: "PART-1", qty: 2, uom: "Nos", initial_rate: 70, current_rate: 70, amount: 140 }),
    ]));
    expect(doc.bid_history).toEqual([]);
  });

  it("seeds rates and totals only from each selected quotation, never a cheaper historical quote from the same supplier", async () => {
    quotations.push(quotation("PUR-SQTN-2026-00100", TITAN_ID, 1, {
      modified: "2026-01-01 10:00:00", transaction_date: "2026-01-01",
    }));
    await createReverseBiddingFromRFQ({ rfqName: RFQ_ID, selectedQuotations: selectedPair() });
    const doc = savedDocument();
    expect(doc.bid_items?.find((row) => row.supplier === TITAN_ID)).toMatchObject({ initial_rate: 50, amount: 100 });
    expect(doc.invited_suppliers?.find((row) => row.supplier === TITAN_ID)).toMatchObject({ initial_quotation_amount: 100 });
  });

  it("rejects a supplier that has genuinely not submitted a quotation rather than silently dropping it", async () => {
    await expectInvalid([selection(TITAN_QUOTE, TITAN_ID), selection("MISSING-QUOTATION", "SUP-NOT-QUOTED")]);
  });

  it("rejects a stale quotation ID even when that supplier has another current quotation", async () => {
    await expectInvalid([selection("PUR-SQTN-TITAN-STALE", TITAN_ID), selection(FEMSA_QUOTE, FEMSA_ID)]);
  });

  it("rejects an older quotation version that still exists when the supplier has submitted a newer version", async () => {
    quotations.push(quotation("PUR-SQTN-2026-00100", TITAN_ID, 10, {
      modified: "2026-01-01 10:00:00", transaction_date: "2026-01-01",
    }));
    await expectInvalid([selection("PUR-SQTN-2026-00100", TITAN_ID), selection(FEMSA_QUOTE, FEMSA_ID)]);
  });

  it("rejects quotation/supplier identity conflicts instead of matching a display name", async () => {
    await expectInvalid([selection(TITAN_QUOTE, FEMSA_ID), selection(FEMSA_QUOTE, FEMSA_ID)]);
  });

  it("rejects display names where the selected object requires a canonical Supplier.name", async () => {
    await expectInvalid([selection(TITAN_QUOTE, "Titan Industrial Products LLC"), selection(FEMSA_QUOTE, FEMSA_ID)]);
  });

  it("rejects an explicitly selected quotation from another RFQ", async () => {
    await expectInvalid([selection(TITAN_QUOTE, TITAN_ID, "PUR-RFQ-OTHER"), selection(FEMSA_QUOTE, FEMSA_ID)]);
  });

  it("verifies the actual quotation RFQ child links even if the requested RFQ identity matches", async () => {
    quotations[0].items[0].request_for_quotation = "PUR-RFQ-OTHER";
    await expectInvalid();
  });

  it.each([
    { docstatus: 0, status: "Draft" },
    { docstatus: 2, status: "Cancelled" },
  ])("rejects selected quotations in $status state", async (state) => {
    Object.assign(quotations[0], state);
    await expectInvalid();
  });

  it("rejects repeated quotation IDs in the selected input before writing", async () => {
    await expectInvalid([selection(TITAN_QUOTE, TITAN_ID), selection(TITAN_QUOTE, TITAN_ID)]);
  });

  it("rejects two selected quotation versions for the same supplier", async () => {
    quotations.push(quotation("PUR-SQTN-TITAN-OTHER", TITAN_ID, 65));
    await expectInvalid([selection(TITAN_QUOTE, TITAN_ID), selection("PUR-SQTN-TITAN-OTHER", TITAN_ID)]);
  });

  it("does not turn an explicitly empty selection into all quoting suppliers", async () => {
    await expectInvalid([]);
  });

  it("accepts selected quotations belonging to the current RFQ round", async () => {
    rfq.custom_active_rfq_round = "RFQ89-ROUND-2";
    rfq.custom_current_round_number = 2;
    quotations[0].custom_rfq_round = rfq.custom_active_rfq_round;
    quotations[1].custom_rfq_round = rfq.custom_active_rfq_round;
    quotations[2].custom_rfq_round = "RFQ89-ROUND-1";
    await createReverseBiddingFromRFQ({ rfqName: RFQ_ID, selectedQuotations: selectedPair(), activeRoundName: rfq.custom_active_rfq_round });
    expect(savedDocument().invited_suppliers?.map((row) => row.supplier).sort()).toEqual([TITAN_ID, FEMSA_ID].sort());
  });

  it("rejects a quotation explicitly stamped for an older RFQ round", async () => {
    rfq.custom_active_rfq_round = "RFQ89-ROUND-2";
    rfq.custom_current_round_number = 2;
    quotations[0].custom_rfq_round = "RFQ89-ROUND-1";
    quotations[1].custom_rfq_round = rfq.custom_active_rfq_round;
    await expectInvalid(selectedPair(), rfq.custom_active_rfq_round);
  });

  it("continues supporting a legacy shortlist containing exact supplier IDs", async () => {
    await createReverseBiddingFromRFQ({ rfqName: RFQ_ID, approvedSuppliers: [TITAN_ID, FEMSA_ID] });
    const doc = savedDocument();
    expect(doc.invited_suppliers).toHaveLength(2);
    expect(doc.invited_suppliers?.map((row) => row.supplier).sort()).toEqual([TITAN_ID, FEMSA_ID].sort());
  });

  it("does not use supplier display names to resolve a legacy shortlist", async () => {
    await expect(createReverseBiddingFromRFQ({ rfqName: RFQ_ID, approvedSuppliers: ["Titan Industrial Products LLC", FEMSA_ID] })).rejects.toThrow();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("rejects a legacy shortlist containing an unquoted supplier even when another selected supplier has quoted", async () => {
    await expect(createReverseBiddingFromRFQ({ rfqName: RFQ_ID, approvedSuppliers: [TITAN_ID, "SUP-NOT-QUOTED"] })).rejects.toThrow();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("handles a quotation repeated by an RFQ child-table join without duplicating suppliers or item bids", async () => {
    quotations.push(structuredClone(quotations[0]));
    await createReverseBiddingFromRFQ({ rfqName: RFQ_ID, selectedQuotations: selectedPair() });
    const doc = savedDocument();
    expect(doc.invited_suppliers).toHaveLength(2);
    expect(doc.bid_items).toHaveLength(2);
    expect(doc.invited_suppliers?.filter((row) => row.supplier === TITAN_ID)).toHaveLength(1);
    expect(doc.invited_suppliers?.find((row) => row.supplier === TITAN_ID)?.initial_quotation_amount).toBe(100);
  });

  it("returns an existing auction idempotently after validating the selected current quotations", async () => {
    const existing: ReverseBidding = { name: "RB-EXISTING-1", rfq: RFQ_ID, auction_status: "Draft" };
    mocks.get.mockImplementation(async (url: string) => url === "Supplier Scoring Result/" ? [] : url === "Reverse Bidding/"
      ? [{ name: existing.name, auction_status: "Draft" }] : existing);
    await expect(createReverseBiddingFromRFQ({ rfqName: RFQ_ID, selectedQuotations: selectedPair() })).resolves.toEqual(existing);
    expect(mocks.getQuotations.mock.calls[0][0]).toBe(RFQ_ID);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("does not let an existing auction bypass validation of an unquoted supplier selection", async () => {
    mocks.get.mockResolvedValue([{ name: "RB-EXISTING-1", auction_status: "Draft" }]);
    await expectInvalid([selection(TITAN_QUOTE, TITAN_ID), selection("MISSING-QUOTATION", "SUP-NOT-QUOTED")]);
  });
});
