/** Explicit read-only probe. Normal tests never contact ERPNext or write records. */
import { expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { assertSupplierAwardEligible, assertSupplierSelectionRequest, createSupplierAwardEligibilityDependencies } from "./supplierAwardEligibilityGuard";
import type { AccessPrincipal } from "./rbacAuth";
import { applyEvaluationDecisionProjection } from "../src/utils/aiEvaluationDecision";
import type { AIRecommendation } from "../src/types/erpnext";

it.skipIf(process.env.RUN_LIVE_APEX_ELIGIBILITY !== "1")("enforces the exact RFQ95 Apex/Blue Ridge/Redwood case from persisted ERP data without writes", async () => {
  const clientModule = await import(/* @vite-ignore */ `${process.cwd().replaceAll("\\", "/")}/scripts/ecr-schema-erp-client.mjs`);
  clientModule.createEcrSchemaErpClient();
  const dependencies = createSupplierAwardEligibilityDependencies();
  const rfqId = "PUR-RFQ-2026-00095";
  const results = await dependencies.listDocuments("Supplier Scoring Result", {
    filters: [["rfq", "=", rfqId]], fields: ["name"], order_by: "scored_at desc, creation desc", limit_page_length: 1,
  });
  const result = await dependencies.loadDocument("Supplier Scoring Result", String(results[0].name));
  const snapshot = typeof result.analysis_snapshot === "string" ? JSON.parse(result.analysis_snapshot) : result.analysis_snapshot;
  const analysis = applyEvaluationDecisionProjection((snapshot.analysis ?? snapshot) as AIRecommendation);
  const cases = [
    { supplierId: "Apex Fasteners Ltd", quotationId: "PUR-SQTN-2026-00271", rank: 1, score: 88, risk: "High", verdict: "QUOTE INCOMPLETE", allowed: false },
    { supplierId: '"Blue Ridge Manufacturing Inc"', quotationId: "PUR-SQTN-2026-00270", rank: 2, score: 85, risk: "Low", verdict: "GOOD OPTION", allowed: true },
    { supplierId: '"Redwood Supply Chain Partners"', quotationId: "PUR-SQTN-2026-00272", rank: 3, score: 81, risk: "Medium", verdict: "GOOD OPTION", allowed: true },
  ];
  const evidence: Record<string, unknown> = { checked_at: new Date().toISOString(), read_only: true, mutation_performed: false, rfq: rfqId, evaluation: result.name, rows: [] };
  for (const item of cases) {
    const row = analysis.supplier_analysis.find(row => row.supplier_id === item.supplierId);
    expect(row).toMatchObject({ rank: item.rank, score: { overall: item.score }, risk: item.risk, verdict: item.verdict, awardEligible: item.allowed });
    let error: { message?: string; status?: number } | undefined;
    try { await assertSupplierAwardEligible({ rfqId, supplierId: item.supplierId, quotationId: item.quotationId }, dependencies); }
    catch (failure) { error = failure as typeof error; }
    (evidence.rows as unknown[]).push({ ...item, blocked: Boolean(error), status: error?.status, reason: error?.message });
    if (item.allowed) expect(error).toBeUndefined();
    else { expect(error?.status).toBe(403); expect(error?.message).toBe("Quote incomplete. Complete the supplier quotation before selection."); }
  }
  expect(analysis.recommendation_summary).toContain("Highest numerical score: 88/100. Stored risk: High. The quotation is incomplete");
  const principal: AccessPrincipal = { typ: "internal", sub: "read-only-guard-probe", email: "", role: "procurement", exp: 0, iat: 0 };
  const request = (supplierIds: string[]) => ({ apiPath: "method/frappe.client.insert", method: "POST", principal,
    body: { doc: { doctype: "Reverse Bidding", rfq: rfqId, invited_suppliers: supplierIds.map(supplier => ({ supplier, awardEligible: true, verdict: "GOOD OPTION" })), auction_status: "Draft" } } });
  // Call the production guard, but never forward the proposed mutation to ERPNext.
  await expect(assertSupplierSelectionRequest(request([cases[0].supplierId, cases[1].supplierId]), dependencies)).rejects.toThrow("Quote incomplete.");
  await expect(assertSupplierSelectionRequest(request([cases[1].supplierId, cases[2].supplierId]), dependencies)).resolves.toBeUndefined();
  evidence.reverse_bidding_guard = { apex_and_blue_ridge: "blocked", blue_ridge_and_redwood: "allowed by eligibility; existing workflow gates still apply" };
  evidence.summary = analysis.recommendation_summary;
  writeFileSync("scratch/apex-award-eligibility-live.json", JSON.stringify(evidence, null, 2));
}, 90_000);

it.skipIf(process.env.RUN_LIVE_AWARD_ELIGIBILITY !== "1")("enforces RFQ94 eligibility using current ERPNext records without business writes", async () => {
  const clientModule = await import(/* @vite-ignore */ `${process.cwd().replaceAll("\\", "/")}/scripts/ecr-schema-erp-client.mjs`);
  // Load configuration internally; no credentials are printed or saved.
  clientModule.createEcrSchemaErpClient();
  const dependencies = createSupplierAwardEligibilityDependencies();
  const evidence: Record<string, unknown> = { checked_at: new Date().toISOString(), read_only: true, rfq: "PUR-RFQ-2026-00094", rows: [] };
  const cases = [
    { supplierId: '\"Atlantic Precision Manufacturing.\"', quotationId: "PUR-SQTN-2026-00265", allowed: false },
    { supplierId: "FEMSA", quotationId: "PUR-SQTN-2026-00267", allowed: true },
    { supplierId: '\"Blue Ridge Manufacturing Inc\"', quotationId: "PUR-SQTN-2026-00269", allowed: true },
  ];
  for (const item of cases) {
    let error: { message?: string; status?: number } | undefined;
    try { await assertSupplierAwardEligible({ rfqId: String(evidence.rfq), ...item }, dependencies); }
    catch (failure) { error = failure as typeof error; }
    (evidence.rows as unknown[]).push({ ...item, blocked: Boolean(error), status: error?.status, reason: error?.message });
    if (item.allowed) expect(error).toBeUndefined();
    else { expect(error?.status).toBe(403); expect(error?.message).toContain("AVOID"); }
  }
  const principal: AccessPrincipal = { typ: "internal", sub: "read-only-guard-probe", email: "", role: "procurement", exp: 0, iat: 0 };
  const request = (supplierIds: string[]) => ({ apiPath: "method/frappe.client.save", method: "POST", principal,
    body: { doc: { doctype: "Reverse Bidding", rfq: evidence.rfq, invited_suppliers: supplierIds.map(supplier => ({ supplier })), auction_status: "Draft" } } });
  // Invoke only validation functions: these perform GET requests and never forward a mutation.
  await expect(assertSupplierSelectionRequest(request([cases[0].supplierId, cases[1].supplierId]), dependencies)).rejects.toThrow("AVOID");
  await expect(assertSupplierSelectionRequest(request([cases[1].supplierId, cases[2].supplierId]), dependencies)).resolves.toBeUndefined();
  evidence.reverse_bidding_guard = { atlantic_and_femsa: "blocked", femsa_and_blue_ridge: "allowed by eligibility; existing workflow gates still apply" };
  writeFileSync("scratch/supplier-award-eligibility-live.json", JSON.stringify(evidence, null, 2));
}, 90_000);
