/** Manual, explicitly authorized live probe. Never writes to ERP in normal test runs. */
import { expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { createReverseBiddingFromRFQ, getReverseBidding } from "./reverseBidding";
import { getRFQ, getSupplierQuotations } from "./sourcing";
import { getLatestAnalysisSnapshot } from "./supplierScoringResults";
import { selectedReverseBiddingQuotations, validateReverseBiddingSelection } from "../utils/reverseBiddingSelection";
import type { AIRecommendation } from "../types/erpnext";

const transport = vi.hoisted(() => ({ api: null as null | ((method: string, path: string, body?: unknown) => Promise<any>), writes: [] as any[] }));
vi.mock("./erpnext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./erpnext")>();
  const pathFor = (path: string, config?: any) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(config?.params ?? {})) if (value !== undefined) query.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    return path.replace(/^\/api\//, "") + (query.size ? `?${query}` : "");
  };
  return { ...actual,
    apiGet: (path: string, config?: any) => transport.api!("GET", pathFor(path, config)),
    apiPost: (path: string, body: any) => {
      if (path !== "/api/method/frappe.client.save" || body?.doc?.doctype !== "Reverse Bidding" || body.doc.rfq !== "PUR-RFQ-2026-00092" || body.doc.auction_status !== "Draft") throw new Error("Live probe permits only the authorized RFQ 00092 reverse-bidding draft.");
      transport.writes.push({ path, body });
      return transport.api!("POST", pathFor(path), body);
    },
    apiPut: () => { throw new Error("Live probe does not update existing records."); },
  };
});

it.skipIf(process.env.RUN_LIVE_REVERSE_BIDDING_TRACE !== "1")("traces Titan and FEMSA selection through the real RFQ, quotation lookup, ERP creation and readback", async () => {
  const clientModule = await import(/* @vite-ignore */ `${process.cwd().replaceAll("\\", "/")}/scripts/ecr-schema-erp-client.mjs`);
  transport.api = clientModule.createEcrSchemaErpClient();
  const rfqId = "PUR-RFQ-2026-00092";
  const rfq = await getRFQ(rfqId);
  const quotes = await getSupplierQuotations(rfqId);
  const snapshot = await getLatestAnalysisSnapshot<{ analysis: AIRecommendation }>(rfqId);
  const rows = snapshot!.analysis.supplier_analysis!;
  const supplierIds = ['"Titan Industrial Products LLC"', "FEMSA"];
  const checkedIds = new Set(rows.filter((r) => supplierIds.includes(r.supplier_id!)).map((r) => r.quotation_id!));
  const selected = validateReverseBiddingSelection(rfqId, selectedReverseBiddingQuotations(rows, checkedIds), quotes);
  expect(selected).toHaveLength(2);
  expect(selected.map((s) => s.quotation_id).sort()).toEqual(["PUR-SQTN-2026-00258", "PUR-SQTN-2026-00261"]);
  const oldAliases = quotes.map((q) => [q.supplier.toLowerCase(), q.supplier_name?.toLowerCase()]);
  expect(oldAliases.filter((aliases) => aliases.some((alias) => [...checkedIds].map((id) => id.toLowerCase()).includes(alias!)))).toHaveLength(0);
  const input = { rfqName: rfqId, selectedQuotations: selected, approvedSuppliers: selected.map((q) => q.supplier_id), activeRoundName: rfq.custom_active_rfq_round ?? null };
  const evidence: any = { input, source_quotations: quotes, selected, before: { rfq, snapshot }, writes: transport.writes, legacy_lookup_matches: 0 };
  try {
    // The supplier has no quotation for this RFQ; it must fail before any save.
    await expect(createReverseBiddingFromRFQ({ rfqName: rfqId, approvedSuppliers: ["Apex Fasteners Ltd"] })).rejects.toThrow(/submitted a quotation/);
    expect(transport.writes).toHaveLength(0);
    evidence.created = await createReverseBiddingFromRFQ(input);
    evidence.persisted = await getReverseBidding(evidence.created.name);
    expect(evidence.persisted.rfq).toBe(rfqId);
    expect(evidence.persisted.auction_status).toBe("Draft");
    expect(evidence.persisted.invited_suppliers).toHaveLength(2);
    expect(evidence.persisted.invited_suppliers.map((s: any) => s.supplier).sort()).toEqual([...supplierIds].sort());
    expect(evidence.persisted.invited_suppliers.every((s: any) => s.initial_quotation_amount === 50 && s.invitation_status === "Pending")).toBe(true);
    expect(evidence.persisted.bid_items).toHaveLength(4);
    expect(evidence.persisted.bid_items.every((i: any) => supplierIds.includes(i.supplier) && i.initial_rate === 25)).toBe(true);
    const otherIds = new Set(rows.filter((r) => r.supplier_id !== "FEMSA").map((r) => r.quotation_id!));
    const reopenedSelection = selectedReverseBiddingQuotations(rows, otherIds);
    expect(reopenedSelection).toHaveLength(2);
    evidence.reopened = await createReverseBiddingFromRFQ({ rfqName: rfqId, selectedQuotations: reopenedSelection });
    expect(evidence.reopened.name).toBe(evidence.created.name);
    expect(transport.writes.length).toBeLessThanOrEqual(1);
    const refreshed = await getSupplierQuotations(rfqId);
    const refreshedRfq = await getRFQ(rfqId);
    const refreshedSnapshot = await getLatestAnalysisSnapshot(rfqId);
    expect(refreshed).toEqual(quotes);
    expect(refreshedRfq).toEqual(rfq);
    expect(refreshedSnapshot).toEqual(snapshot);
    evidence.source_records_unchanged = true;
    evidence.negative_non_quoting_supplier_rejected = true;
  } finally {
    writeFileSync("scratch/reverse-bidding-92-verified.json", JSON.stringify(evidence, null, 2));
  }
}, 120000);
