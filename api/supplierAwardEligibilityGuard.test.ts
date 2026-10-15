import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertSupplierAwardEligible, assertSupplierSelectionRequest, type SupplierAwardEligibilityDependencies } from "./supplierAwardEligibilityGuard";
import type { AccessPrincipal } from "./rbacAuth";

const principal: AccessPrincipal = { typ: "internal", role: "procurement", sub: "buyer@test.example", iat: 0, exp: 9999999999 };
const rfq = { name: "RFQ-94", custom_active_rfq_round: "ROUND-1" };
const scores = [
  { supplier_id: "Atlantic", quotation_id: "SQ-265", score: 91, ranking: 1, risk: "High", verdict: "AVOID", evaluation_run_id: "RUN-CURRENT", rfq_id: "RFQ-94" },
  { supplier_id: "FEMSA", quotation_id: "SQ-267", score: 87, ranking: 2, risk: "Low", verdict: "GOOD OPTION", evaluation_run_id: "RUN-CURRENT", rfq_id: "RFQ-94" },
  { supplier_id: "Blue Ridge", quotation_id: "SQ-269", score: 85, ranking: 3, risk: "Medium", verdict: "GOOD OPTION", evaluation_run_id: "RUN-CURRENT", rfq_id: "RFQ-94" },
];
let documents: Record<string, Record<string, unknown>>;
let resultNames: Record<string, unknown>[];
let dependencies: SupplierAwardEligibilityDependencies;
beforeEach(() => {
  documents = {
    "Request for Quotation/RFQ-94": structuredClone(rfq),
    "Supplier Scoring Result/SCORE-120": { name: "SCORE-120", rfq: "RFQ-94", analysis_snapshot: JSON.stringify({ rfq_name: "RFQ-94", analysis: { rfq_id: "RFQ-94", evaluation_run_id: "RUN-CURRENT", supplier_analysis: scores } }) },
    "Reverse Bidding/RB-1": { name: "RB-1", rfq: "RFQ-94", auction_status: "Draft", invited_suppliers: [{ supplier: "Atlantic", invitation_status: "Pending" }, { supplier: "FEMSA", invitation_status: "Pending" }] },
    ...Object.fromEntries(scores.map(row => [`Supplier Quotation/${row.quotation_id}`, { name: row.quotation_id, supplier: row.supplier_id, docstatus: 1, custom_rfq_round: "ROUND-1", items: [{ request_for_quotation: "RFQ-94" }] }])),
  };
  resultNames = [{ name: "SCORE-120" }];
  dependencies = {
    loadDocument: vi.fn(async (doctype, name) => {
      const document = documents[`${doctype}/${name}`];
      if (!document) throw new Error("Not found");
      return structuredClone(document);
    }),
    listDocuments: vi.fn(async (doctype, options) => {
      if (doctype === "Supplier Scoring Result") return resultNames;
      const supplier = options.filters.find(filter => filter[0] === "supplier")?.[2];
      return scores.filter(row => row.supplier_id === supplier).map(row => ({ name: row.quotation_id }));
    }),
  };
});
const select = (supplierId = "Atlantic", quotationId = "SQ-265") => assertSupplierAwardEligible({ rfqId: "RFQ-94", supplierId, quotationId }, dependencies);
const request = (apiPath: string, body: unknown, method = "POST") => assertSupplierSelectionRequest({ apiPath, body, method, principal }, dependencies);

describe("authoritative supplier award eligibility", () => {
  it("blocks score-91 rank-1 Atlantic using the saved AVOID verdict without changing scores", async () => {
    await expect(select()).rejects.toThrow("marked AVOID due to high risk");
    expect(scores.map(row => [row.score, row.ranking])).toEqual([[91, 1], [87, 2], [85, 3]]);
    expect(dependencies.listDocuments).toHaveBeenCalledWith("Supplier Scoring Result", expect.objectContaining({ filters: [["rfq", "=", "RFQ-94"]], order_by: "scored_at desc, creation desc", limit_page_length: 1 }));
  });
  it.each([["FEMSA", "SQ-267"], ["Blue Ridge", "SQ-269"]])("permits %s subject to the existing workflow gates", async (supplier, quotation) => {
    await expect(select(supplier, quotation)).resolves.toBeUndefined();
  });
  it("keeps legacy manual workflows only when the ERP lookup positively returns no scoring result", async () => {
    resultNames = [];
    await expect(select()).resolves.toBeUndefined();
  });
  it("does not treat a failed lookup as no evaluation", async () => {
    dependencies.listDocuments = vi.fn(async () => { throw new Error("ERP unavailable"); });
    await expect(select()).rejects.toThrow("ERP unavailable");
  });
  it.each(["", "{broken", JSON.stringify({ analysis: { supplier_analysis: [] } })])("fails closed for existing malformed/incomplete evaluation %s", async snapshot => {
    documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot = snapshot;
    await expect(select()).rejects.toThrow("cannot be verified");
  });
  it.each(["RFQ-OTHER", "RUN-OLD", "DUPLICATE"])("rejects mismatched evaluation identity %s", async mismatch => {
    const snapshot = JSON.parse(String(documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot));
    if (mismatch === "RFQ-OTHER") snapshot.analysis.rfq_id = mismatch;
    else if (mismatch === "RUN-OLD") snapshot.analysis.supplier_analysis[0].evaluation_run_id = mismatch;
    else snapshot.analysis.supplier_analysis.push(snapshot.analysis.supplier_analysis[0]);
    documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot = JSON.stringify(snapshot);
    await expect(select()).rejects.toThrow("cannot be verified");
  });
  it("does not bypass an active AVOID using an older quotation for the same supplier", async () => {
    documents["Supplier Quotation/SQ-OLD"] = { ...documents["Supplier Quotation/SQ-265"], name: "SQ-OLD" };
    await expect(select("Atlantic", "SQ-OLD")).rejects.toThrow("AVOID");
  });
  it("fails closed when quotation identity aliases contradict each other", async () => {
    const snapshot = JSON.parse(String(documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot));
    snapshot.analysis.supplier_analysis[1].supplier_quotation_id = "SQ-OTHER";
    documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot = JSON.stringify(snapshot);
    await expect(select("FEMSA", "SQ-267")).rejects.toThrow("cannot be verified");
  });
  it.each([
    { supplier: "Somebody Else" }, { items: [{ request_for_quotation: "RFQ-OTHER" }] }, { docstatus: 0 }, { docstatus: 2 }, { custom_rfq_round: "ROUND-OLD" },
  ])("verifies quotation ownership, RFQ, submission and round: %j", async change => {
    Object.assign(documents["Supplier Quotation/SQ-267"], change);
    await expect(select("FEMSA", "SQ-267")).rejects.toThrow(/quotation/i);
  });
});

describe("generic ERP mutation selection gates", () => {
  it.each([
    ["resource/Reverse Bidding", { rfq: "RFQ-94", invited_suppliers: [{ supplier: "Atlantic" }], awardEligible: true }],
    ["method/frappe.client.save", { doc: { doctype: "Reverse Bidding", rfq: "RFQ-94", invited_suppliers: [{ supplier: "Atlantic" }], verdict: "BEST VALUE" } }],
    ["method/frappe.client.insert", { doc: JSON.stringify({ doctype: "Reverse Bidding", rfq: "RFQ-94", invited_suppliers: [{ supplier: "Atlantic" }] }) }],
  ])("ignores forged browser eligibility and blocks reverse bidding via %s", async (path, body) => {
    await expect(request(path as string, body)).rejects.toThrow("AVOID");
  });
  it("allows only the eligible supplier subset", async () => {
    await expect(request("resource/Reverse Bidding", { rfq: "RFQ-94", invited_suppliers: [{ supplier: "FEMSA" }, { supplier: "Blue Ridge" }] })).resolves.toBeUndefined();
  });
  it.each([
    { auction_status: "Live" }, { auction_status: "Scheduled" }, { winning_supplier: "Atlantic" },
    { invited_suppliers: [{ supplier: "Atlantic", invitation_status: "Sent" }] },
  ])("blocks auction activation/invitation/winner selection for AVOID %j", async patch => {
    await expect(request("resource/Reverse Bidding/RB-1", patch, "PUT")).rejects.toThrow("AVOID");
  });
  it.each([
    { remarks: "[RB:Approved] Procurement | now" }, { remarks: "[RB:WinnerAccepted] Procurement | now" },
    { winning_supplier: "Atlantic" }, { winner_price: 2400 },
    { bid_items: [{ supplier: "Atlantic", item_code: "STEEL", status: "Winner" }] },
  ])("rechecks an unchanged existing auction winner when awarding: %j", async patch => {
    Object.assign(documents["Reverse Bidding/RB-1"], { winning_supplier: "Atlantic", winner_price: 2500, auction_status: "Completed" });
    await expect(request("resource/Reverse Bidding/RB-1", patch, "PUT")).rejects.toThrow("AVOID");
  });
  it("rejects contradictory supplier identity fields instead of trusting the first field", async () => {
    await expect(request("resource/Request for Quotation/RFQ-94", { custom_selected_supplier: "FEMSA", custom_approval_data: JSON.stringify({ selected_supplier: "Atlantic" }) }, "PUT")).rejects.toThrow("same supplier");
  });
  it.each([
    ["resource/Request for Quotation/RFQ-94", { custom_selected_supplier: "Atlantic" }],
    ["method/frappe.client.set_value", { doctype: "Request for Quotation", name: "RFQ-94", fieldname: "custom_selected_supplier", value: "Atlantic" }],
    ["method/frappe.client.save", { doc: { doctype: "Request for Quotation", name: "RFQ-94", custom_approval_data: JSON.stringify({ selected_supplier: "Atlantic" }) } }],
  ])("blocks supplier award via %s", async (path, body) => {
    await expect(request(path as string, body, "PUT")).rejects.toThrow("AVOID");
  });
  it("handles Frappe GET mutation query payloads", async () => {
    await expect(assertSupplierSelectionRequest({ apiPath: "method/frappe.client.save", method: "GET", principal, query: { doc: JSON.stringify({ doctype: "Reverse Bidding", rfq: "RFQ-94", invited_suppliers: [{ supplier: "Atlantic" }] }) } }, dependencies)).rejects.toThrow("AVOID");
  });
  it("preserves read, cancellation, historical auction and downstream Legal/Finance updates", async () => {
    await request("resource/Reverse Bidding/RB-1", {}, "GET");
    await request("resource/Reverse Bidding/RB-1", { auction_status: "Cancelled" }, "PUT");
    await request("resource/Reverse Bidding/RB-1", { remarks: "Historical note" }, "PUT");
    documents["Request for Quotation/RFQ-94"].custom_selected_supplier = "Atlantic";
    await request("resource/Request for Quotation/RFQ-94", { custom_selected_supplier: "Atlantic", custom_legal_status: "Approved" }, "PUT");
    expect(dependencies.listDocuments).not.toHaveBeenCalled();
  });
});

describe("exact incomplete quotation case: Apex 88, Blue Ridge 85, Redwood 81", () => {
  const evaluated = [
    { supplier_id: "Apex Fasteners Ltd", quotation_id: "SQ-APEX", score: { overall: 88 }, rank: 1, risk: "High", verdict: "QUOTE INCOMPLETE", evaluation_status: "complete", quote_price_status: "submitted" },
    { supplier_id: "Blue Ridge Manufacturing Inc", quotation_id: "SQ-BLUE", score: { overall: 85 }, rank: 2, risk: "Low", verdict: "GOOD OPTION", evaluation_status: "complete", quote_price_status: "submitted" },
    { supplier_id: "Redwood Supply Chain Partners", quotation_id: "SQ-REDWOOD", score: { overall: 81 }, rank: 3, risk: "Medium", verdict: "GOOD OPTION", evaluation_status: "complete", quote_price_status: "submitted" },
  ];
  const apex = evaluated[0];
  function setEvaluation(patch: Record<string, unknown> = {}) {
    documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot = JSON.stringify({ rfq_name: "RFQ-94", analysis: {
      rfq_id: "RFQ-94", evaluation_run_id: "RUN-CURRENT",
      supplier_analysis: evaluated.map((row, index) => ({ ...row, evaluation_run_id: "RUN-CURRENT", rfq_id: "RFQ-94", ...(index === 0 ? patch : {}) })),
    } });
  }
  beforeEach(() => {
    setEvaluation();
    for (const row of evaluated) documents[`Supplier Quotation/${row.quotation_id}`] = {
      name: row.quotation_id, supplier: row.supplier_id, docstatus: 1, status: "Submitted", custom_rfq_round: "ROUND-1",
      items: [{ request_for_quotation: "RFQ-94", item_code: "MATERIAL", qty: 10, rate: 250 }], grand_total: 2500,
    };
    documents["Reverse Bidding/RB-1"] = { name: "RB-1", rfq: "RFQ-94", auction_status: "Draft", invited_suppliers: evaluated.map(row => ({ supplier: row.supplier_id, invitation_status: "Pending" })) };
    dependencies.listDocuments = vi.fn(async (doctype, options) => {
      if (doctype === "Supplier Scoring Result") return resultNames;
      const supplier = options.filters.find(filter => filter[0] === "supplier")?.[2];
      return evaluated.filter(row => row.supplier_id === supplier).map(row => ({ name: row.quotation_id }));
    });
  });

  it("blocks Apex despite its submitted priced quotation and leaves the exact scores/ranks intact", async () => {
    const snapshot = documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot;
    await expect(select(apex.supplier_id, apex.quotation_id)).rejects.toMatchObject({ status: 403, message: "Quote incomplete. Complete the supplier quotation before selection." });
    expect(documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot).toBe(snapshot);
    expect(evaluated.map(row => [row.score.overall, row.rank])).toEqual([[88, 1], [85, 2], [81, 3]]);
  });

  it.each(evaluated.slice(1))("allows $supplier_id using its current submitted quotation and complete saved verdict", async row => {
    await expect(select(row.supplier_id, row.quotation_id)).resolves.toBeUndefined();
    expect(dependencies.loadDocument).toHaveBeenCalledWith("Supplier Quotation", row.quotation_id);
    expect(dependencies.loadDocument).toHaveBeenCalledWith("Supplier Scoring Result", "SCORE-120");
  });

  it.each(["resource/Reverse Bidding", "method/frappe.client.save", "method/frappe.client.insert"])("rejects Apex reverse bidding through %s despite forged browser eligibility", async path => {
    const doc = { doctype: "Reverse Bidding", rfq: "RFQ-94", invited_suppliers: [
      { supplier: apex.supplier_id, awardEligible: true, verdict: "GOOD OPTION", evaluation_status: "complete" },
      { supplier: evaluated[1].supplier_id },
    ], awardEligible: true, risk: "Low", verdict: "GOOD OPTION" };
    await expect(request(path, path.startsWith("resource/") ? doc : { doc })).rejects.toMatchObject({ status: 403, message: "Quote incomplete. Complete the supplier quotation before selection." });
  });

  it("accepts precisely Blue Ridge plus Redwood for reverse bidding", async () => {
    await expect(request("resource/Reverse Bidding", { rfq: "RFQ-94", invited_suppliers: evaluated.slice(1).map(row => ({ supplier: row.supplier_id })) })).resolves.toBeUndefined();
    expect(dependencies.loadDocument).toHaveBeenCalledWith("Supplier Quotation", "SQ-BLUE");
    expect(dependencies.loadDocument).toHaveBeenCalledWith("Supplier Quotation", "SQ-REDWOOD");
    expect(dependencies.loadDocument).not.toHaveBeenCalledWith("Supplier Quotation", "SQ-APEX");
  });

  it.each([
    { auction_status: "Live" }, { winning_supplier: apex.supplier_id },
    { bid_items: [{ supplier: apex.supplier_id, item_code: "MATERIAL", status: "Winner" }] },
  ])("rechecks stored incompleteness before auction activation or award: %j", async patch => {
    await expect(request("resource/Reverse Bidding/RB-1", { ...patch, awardEligible: true }, "PUT")).rejects.toThrow("Quote incomplete. Complete the supplier quotation before selection.");
  });

  it("blocks direct RFQ award with a forged GOOD OPTION verdict", async () => {
    await expect(request("resource/Request for Quotation/RFQ-94", { custom_selected_supplier: apex.supplier_id, verdict: "GOOD OPTION", awardEligible: true }, "PUT")).rejects.toThrow("Quote incomplete. Complete the supplier quotation before selection.");
  });

  it.each([
    { verdict: "GOOD OPTION", evaluation_status: "incomplete" },
    { verdict: "GOOD OPTION", quote_price_status: "price_not_provided" },
    { verdict: "GOOD OPTION", quote_price_status: "not_submitted" },
    { verdict: "UNKNOWN" },
  ])("fails closed for stored missing/completeness evidence independently of score: %j", async patch => {
    setEvaluation(patch);
    await expect(select(apex.supplier_id, apex.quotation_id)).rejects.toMatchObject({ status: 403 });
  });

  it("does not introduce a blanket High Risk block when the current verdict is eligible", async () => {
    setEvaluation({ verdict: "GOOD OPTION" });
    await expect(select(apex.supplier_id, apex.quotation_id)).resolves.toBeUndefined();
  });

  it.each([
    ["resource/Request for Quotation/RFQ-94", { custom_selected_supplier: apex.supplier_id }],
    ["method/frappe.client.set_value", { doctype: "Request for Quotation", name: "RFQ-94", fieldname: "custom_selected_supplier", value: apex.supplier_id }],
    ["method/frappe.client.save", { doc: { doctype: "Request for Quotation", name: "RFQ-94", custom_approval_data: JSON.stringify({ selected_supplier: apex.supplier_id }) } }],
  ])("allows High risk with GOOD OPTION and complete submitted evaluation for RFQ selection via %s", async (path, body) => {
    setEvaluation({ verdict: "GOOD OPTION" });
    const saved = documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot;
    await expect(request(path as string, body, "PUT")).resolves.toBeUndefined();
    expect(dependencies.loadDocument).toHaveBeenCalledWith("Supplier Scoring Result", "SCORE-120");
    expect(documents["Supplier Scoring Result/SCORE-120"].analysis_snapshot).toBe(saved);
  });

  it.each(["resource/Reverse Bidding", "method/frappe.client.save", "method/frappe.client.insert"])("allows High risk with GOOD OPTION in reverse bidding creation via %s", async path => {
    setEvaluation({ verdict: "GOOD OPTION" });
    const doc = { doctype: "Reverse Bidding", rfq: "RFQ-94", invited_suppliers: [
      { supplier: apex.supplier_id }, { supplier: evaluated[1].supplier_id },
    ] };
    await expect(request(path, path.startsWith("resource/") ? doc : { doc })).resolves.toBeUndefined();
    expect(dependencies.loadDocument).toHaveBeenCalledWith("Supplier Quotation", apex.quotation_id);
    expect(dependencies.loadDocument).toHaveBeenCalledWith("Supplier Scoring Result", "SCORE-120");
  });

  it.each([
    { auction_status: "Live" }, { auction_status: "Scheduled" },
    { invited_suppliers: [{ supplier: apex.supplier_id, invitation_status: "Sent" }] },
    { winning_supplier: apex.supplier_id },
    { bid_items: [{ supplier: apex.supplier_id, item_code: "MATERIAL", status: "Winner" }] },
  ])("allows High risk with GOOD OPTION in existing reverse bidding actions: %j", async patch => {
    setEvaluation({ verdict: "GOOD OPTION" });
    await expect(request("resource/Reverse Bidding/RB-1", patch, "PUT")).resolves.toBeUndefined();
    expect(dependencies.loadDocument).toHaveBeenCalledWith("Supplier Quotation", apex.quotation_id);
  });

  it.each([{ docstatus: 0 }, { docstatus: 2 }, { status: "Cancelled" }, { supplier: "FOREIGN" }, { items: [{ request_for_quotation: "RFQ-OTHER" }] }, { custom_rfq_round: "ROUND-OLD" }])("does not trust a GOOD OPTION row when its actual quotation is invalid: %j", async patch => {
    Object.assign(documents["Supplier Quotation/SQ-BLUE"], patch);
    await expect(select(evaluated[1].supplier_id, "SQ-BLUE")).rejects.toMatchObject({ status: 403 });
  });
});
