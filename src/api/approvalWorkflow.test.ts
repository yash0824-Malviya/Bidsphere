import { describe, expect, it } from "vitest";

import {
  computeApprovalWorkflowCounters,
  deriveWorkflowStage,
  filterByWorkflowStage,
  filterFinancePendingQueue,
  toWorkflowRecord,
} from "./approvalWorkflow";
import type { LegalDocumentSet } from "./legalDocs";

function doc(partial: Partial<LegalDocumentSet>): LegalDocumentSet {
  return {
    sq_name: "PUR-SQTN-2026-00100",
    rfq_name: "PUR-RFQ-2026-00051",
    supplier: "Acme",
    review_status: "Pending",
    ...partial,
  };
}

describe("approvalWorkflow Legal → Finance handoff", () => {
  it("derives Legal Review for pending legal status", () => {
    expect(deriveWorkflowStage(doc({ review_status: "Pending" }))).toBe("Legal Review");
  });

  it("moves the SAME record to Finance Review after legal approve", () => {
    const approved = doc({
      review_status: "Approved",
      finance_status: "Pending",
      workflow_state: "Finance Review",
      current_owner: "Finance Manager",
      next_approver: "Finance Manager",
    });
    expect(deriveWorkflowStage(approved)).toBe("Finance Review");

    const record = toWorkflowRecord(approved);
    expect(record.rfqNumber).toBe("PUR-RFQ-2026-00051");
    expect(record.sqName).toBe("PUR-SQTN-2026-00100");
    expect(record.workflowStage).toBe("Finance Review");
    expect(record.currentOwner).toBe("Finance Manager");
    expect(record.nextApprover).toBe("Finance Manager");
    expect(record.financeStatus).toBe("Pending");
  });

  it("includes legal-approved rows with blank finance_status in Finance queue", () => {
    const record = toWorkflowRecord(
      doc({
        name: "LDR-blank",
        review_status: "Approved",
        finance_status: "",
      }),
    );
    expect(record.workflowStage).toBe("Finance Review");
    expect(filterFinancePendingQueue([record])).toHaveLength(1);
  });

  it("filters Legal and Finance queues from one dataset without duplication", () => {
    const records = [
      toWorkflowRecord(doc({ name: "LDR-1", review_status: "Pending" })),
      toWorkflowRecord(
        doc({
          name: "LDR-2",
          review_status: "Approved",
          finance_status: "Pending",
          workflow_state: "Finance Review",
        }),
      ),
      toWorkflowRecord(
        doc({
          name: "LDR-3",
          review_status: "Approved",
          finance_status: "Approved",
          workflow_state: "Completed",
        }),
      ),
      toWorkflowRecord(
        doc({
          name: "LDR-4",
          review_status: "Rejected",
          workflow_state: "Rejected",
        }),
      ),
    ];

    const legal = filterByWorkflowStage(records, "Legal Review");
    const finance = filterFinancePendingQueue(records);
    const completed = filterByWorkflowStage(records, "Completed");
    const rejected = filterByWorkflowStage(records, "Rejected");

    expect(legal.map((r) => r.id)).toEqual(["LDR-1"]);
    expect(finance.map((r) => r.id)).toEqual(["LDR-2"]);
    expect(completed.map((r) => r.id)).toEqual(["LDR-3"]);
    expect(rejected.map((r) => r.id)).toEqual(["LDR-4"]);

    const counters = computeApprovalWorkflowCounters(records);
    expect(counters.pendingLegal).toBe(1);
    expect(counters.pendingFinance).toBe(1);
    expect(counters.approved).toBe(1);
    expect(counters.rejected).toBe(1);
  });
});
