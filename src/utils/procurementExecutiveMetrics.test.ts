import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_RFQ_STAGES,
  buildOperationalHealthCards,
  computeCategorySpendDistribution,
  computeEnterpriseRfqPipeline,
  computeMonthlyPoSpend,
  computePoYtdSpend,
  resolveActiveRfqPipelineStages,
} from "./procurementExecutiveMetrics";

describe("computePoYtdSpend", () => {
  it("sums YTD PO spend", () => {
    const year = new Date().getFullYear();
    const result = computePoYtdSpend([
      {
        name: "PO-1",
        supplier: "A",
        grand_total: 100,
        transaction_date: `${year}-01-15`,
      },
      {
        name: "PO-2",
        supplier: "B",
        grand_total: 200,
        transaction_date: `${year}-02-10`,
      },
    ]);
    expect(result.ytdSpend).toBe(300);
  });
});

describe("resolveActiveRfqPipelineStages", () => {
  it("hides Technical / Commercial Review by default", () => {
    const stages = resolveActiveRfqPipelineStages({ workflowStages: [] });
    expect(stages).toEqual([...ENTERPRISE_RFQ_STAGES]);
    expect(stages).not.toContain("Technical Review");
    expect(stages).not.toContain("Commercial Review");
  });

  it("shows optional stages when enabled in workflow config", () => {
    const stages = resolveActiveRfqPipelineStages({
      workflowStages: [
        { name: "technical_review", enabled: true },
        { name: "commercial_review", enabled: true },
      ],
    });
    expect(stages).toContain("Technical Review");
    expect(stages).toContain("Commercial Review");
  });
});

describe("computeEnterpriseRfqPipeline", () => {
  it("returns only active workflow stages", () => {
    const stages = computeEnterpriseRfqPipeline({
      rfqs: [
        { name: "RFQ-1", status: "Draft" },
        { name: "RFQ-2", status: "Open" },
        { name: "RFQ-3", status: "Closed" },
      ],
      openRfqsCount: 1,
      quoteCounts: new Map([["RFQ-2", 0]]),
      supplierCounts: new Map([["RFQ-2", 2]]),
      workflowStages: [],
    });
    expect(stages.map((s) => s.stage)).toEqual([...ENTERPRISE_RFQ_STAGES]);
    expect(stages.find((s) => s.stage === "Technical Review")).toBeUndefined();
    expect(stages.find((s) => s.stage === "Draft")?.count).toBe(1);
    expect(stages.find((s) => s.stage === "Invited")?.count).toBe(1);
    expect(stages.find((s) => s.stage === "Closed")?.count).toBe(1);
  });

  it("buckets Quoted when quote counts exist", () => {
    const stages = computeEnterpriseRfqPipeline({
      rfqs: [{ name: "RFQ-Q", status: "Open" }],
      openRfqsCount: 1,
      quoteCounts: new Map([["RFQ-Q", 3]]),
      supplierCounts: new Map([["RFQ-Q", 4]]),
      workflowStages: [],
    });
    expect(stages.find((s) => s.stage === "Quoted")?.count).toBe(1);
    expect(stages.find((s) => s.stage === "Invited")?.count).toBe(0);
  });
});

describe("computeCategorySpendDistribution", () => {
  it("groups spend by Item Group and tracks purchase order counts", () => {
    const points = computeCategorySpendDistribution([
      {
        item_group: "Raw Materials",
        base_amount: 500,
        parent: "PO-1",
      },
      {
        item_group: "Raw Materials",
        base_amount: 100,
        parent: "PO-2",
      },
      {
        item_group: "Packaging Materials",
        base_amount: 200,
        parent: "PO-1",
      },
    ]);
    const raw = points.find((p) => p.category === "Raw Materials");
    expect(raw?.spend).toBe(600);
    expect(raw?.orderCount).toBe(2);
    expect(raw?.pct).toBeCloseTo(75, 0);
    expect(points.some((p) => p.category === "Packaging Materials")).toBe(true);
  });
});

describe("computeMonthlyPoSpend", () => {
  it("returns 12 month slots", () => {
    expect(computeMonthlyPoSpend([])).toHaveLength(12);
  });
});

describe("buildOperationalHealthCards", () => {
  it("shows green no-issues captions for real zero counts", () => {
    const cards = buildOperationalHealthCards({
      overdueRfqs: 0,
      expiringContracts: null,
      highRiskSuppliers: 0,
      pendingOnboarding: 0,
      lateDeliveries: 0,
      blockedSuppliers: 0,
    });
    const overdue = cards.find((c) => c.id === "overdue-rfqs");
    expect(overdue?.level).toBe("ok");
    expect(overdue?.value).toBe(0);
    expect(overdue?.caption).toContain("No overdue");
    const contracts = cards.find((c) => c.id === "expiring-contracts");
    expect(contracts?.level).toBe("unavailable");
    expect(contracts?.caption).toBe("Data not available");
  });

  it("marks elevated counts as warning or critical", () => {
    const cards = buildOperationalHealthCards({
      overdueRfqs: 8,
      expiringContracts: null,
      highRiskSuppliers: 2,
      pendingOnboarding: 1,
      lateDeliveries: 5,
      blockedSuppliers: 0,
    });
    expect(cards.find((c) => c.id === "overdue-rfqs")?.level).toBe("critical");
    expect(cards.find((c) => c.id === "high-risk")?.level).toBe("warning");
    expect(cards.find((c) => c.id === "blocked")?.level).toBe("ok");
  });
});

describe("buildSupplierPerformanceBars", () => {
  it("returns Top 5 sorted by overall score descending", async () => {
    const { buildSupplierPerformanceBars } = await import(
      "./procurementExecutiveMetrics"
    );
    const candidates = [
      { supplier: "Low", spend: 900 },
      { supplier: "High", spend: 100 },
      { supplier: "Mid", spend: 500 },
      { supplier: "A", spend: 50 },
      { supplier: "B", spend: 40 },
      { supplier: "C", spend: 30 },
    ];
    const perf = Object.fromEntries(
      candidates.map((c, i) => [
        c.supplier,
        {
          supplier_name: c.supplier,
          total_pos: 1,
          completed_pos: 1,
          cancelled_pos: 0,
          total_po_value: c.spend,
          total_grns: 1,
          on_time_deliveries: 1,
          late_deliveries: 0,
          avg_delay_days: 0,
          total_ordered_qty: 1,
          total_received_qty: 1,
          total_rejected_qty: 0,
          qty_accuracy_pct: 100,
          total_invoices: 1,
          invoices_on_time: 1,
          delivery_score: c.supplier === "High" ? 95 : 50 + i,
          quality_score: c.supplier === "High" ? 90 : 40 + i,
          reliability_score: c.supplier === "High" ? 88 : 35 + i,
          has_sufficient_data: true,
          data_sources: ["PO"],
          data_points_count: 3,
        },
      ]),
    );
    const rows = buildSupplierPerformanceBars(candidates, perf, 5);
    expect(rows).toHaveLength(5);
    expect(rows[0].supplier).toBe("High");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
    }
  });
});
