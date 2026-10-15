import { describe, expect, it } from "vitest";

import {
  computeApprovalWorkflowCounters,
  deriveWorkflowStage,
  filterByWorkflowStage,
  filterFinancePendingQueue,
  toWorkflowRecord,
  isRfqReadyForFinance,
  isRfqReadyForPurchaseOrder,
} from "./approvalWorkflow";
import type { LegalDocumentSet } from "./legalDocs";
import { createEmptyEnvelope, DEFAULT_SIGNATURE_BOX } from "../types/legalEsign";

function signedFields(): Partial<LegalDocumentSet> {
  const hash = "a".repeat(64);
  const envelope = createEmptyEnvelope({ documentKey: "terms", documentName: "Terms", documentNumber: "LDR-1", documentHash: hash });
  Object.assign(envelope, {
    sourceFileId: "FILE-1", sourceFileUrl: "/private/files/terms.pdf", viewedBy: "legal@example.test", viewedAt: "2026-09-10 10:00:00",
    approvedHash: hash, signedFileHash: "b".repeat(64), signedFileUrl: "/private/files/signed.pdf",
    signatureRequest: { id: "SIGN-1", sourceHash: hash, sourceFileId: "FILE-1", signerId: "legal@example.test", startedAt: "2026-09-10 10:00:00", completedAt: "2026-09-10 10:01:00" },
    signatures: [{ id: "SIGN-1", typedName: "Legal Reviewer", reviewerId: "legal@example.test", reviewerName: "Legal Reviewer", role: "legal", status: "signed", sequence: 1, signedAt: "2026-09-10 10:01:00", fontId: "cursive", placement: { page: 1, xNorm: 0.1, yNorm: 0.1, ...DEFAULT_SIGNATURE_BOX } }],
  });
  return { terms_file_url: "/private/files/terms.pdf", terms_approved: 1, esign_envelope: JSON.stringify({ schemaVersion: 2, documents: { terms: envelope } }) };
}

function doc(partial: Partial<LegalDocumentSet>): LegalDocumentSet {
  return {
    sq_name: "PUR-SQTN-2026-00100",
    rfq_name: "PUR-RFQ-2026-00051",
    supplier: "Acme",
    review_status: "Pending",
    ...partial,
  };
}

describe("RFQ signature → Finance → Procurement handoff", () => {
  it("derives Legal Review for pending legal status", () => {
    expect(deriveWorkflowStage(doc({ review_status: "Pending" }))).toBe("Legal Review");
  });

  it("moves the SAME record to Finance Review after persisted legal signature", () => {
    const approved = doc({
      ...signedFields(),
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

  it("does not invent a Finance handoff when persisted finance_status is blank", () => {
    const record = toWorkflowRecord(
      doc({
        ...signedFields(),
        name: "LDR-blank",
        review_status: "Approved",
        finance_status: "",
        workflow_state: "Finance Review",
      }),
    );
    expect(record.workflowStage).toBe("Legal Review");
    expect(filterFinancePendingQueue([record])).toHaveLength(0);
  });

  it("filters Legal and Finance queues from one dataset without duplication", () => {
    const records = [
      toWorkflowRecord(doc({ name: "LDR-1", review_status: "Pending" })),
      toWorkflowRecord(
        doc({
          ...signedFields(),
          name: "LDR-2",
          review_status: "Approved",
          finance_status: "Pending",
          workflow_state: "Finance Review",
        }),
      ),
      toWorkflowRecord(
        doc({
          ...signedFields(),
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
    const completed = filterByWorkflowStage(records, "Procurement");
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

  it("does not trust legacy Finance/Legal approved statuses without signatures", () => {
    const unsigned = doc({ review_status: "Approved", finance_status: "Approved", workflow_state: "Completed" });
    expect(deriveWorkflowStage(unsigned)).toBe("Legal Review");
    expect(isRfqReadyForFinance(unsigned)).toBe(false);
    expect(isRfqReadyForPurchaseOrder(unsigned)).toBe(false);
  });

  it("allows Finance only after signature, then unlocks Procurement only after Finance", () => {
    const signed = doc({ ...signedFields(), review_status: "Approved", finance_status: "Pending", workflow_state: "Finance Review" });
    expect(isRfqReadyForFinance(signed)).toBe(true);
    expect(isRfqReadyForPurchaseOrder(signed)).toBe(false);
    const approved = { ...signed, finance_status: "Approved" as const, workflow_state: "Completed" };
    expect(isRfqReadyForFinance(approved)).toBe(false);
    expect(isRfqReadyForPurchaseOrder(approved)).toBe(true);
    expect(deriveWorkflowStage(approved)).toBe("Procurement");
  });

  it("a replaced current document invalidates both downstream gates", () => {
    const changed = doc({ ...signedFields(), terms_file_url: "/private/files/replaced.pdf", review_status: "Approved", finance_status: "Approved", workflow_state: "Completed" });
    expect(isRfqReadyForFinance(changed)).toBe(false);
    expect(isRfqReadyForPurchaseOrder(changed)).toBe(false);
  });
});
