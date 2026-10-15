import { describe, expect, it } from "vitest";
import type { EngineeringChangeRequest } from "../../types/erpnext";
import { getECRQueueSummary } from "../../config/ecrQueues";
import { getEngineeringECRMetrics } from "./engineeringEcrMetrics";
import { matchesVisibleQueueFilter } from "./ecrListPresentation";

const manager = { name: "engineeringmanager@netlink.com", email: "engineeringmanager@netlink.com", username: "engineering_manager", role: "engineering" };
const task = { name: "engineering-task", approval_role: "Engineering Manager", required: 1 as const, status: "Pending" as const };
function ecr(name: string, stage: EngineeringChangeRequest["select_pxfp"], extra: Partial<EngineeringChangeRequest> = {}): EngineeringChangeRequest {
  return { name, ecr_number: name, select_pxfp: stage, owner: "Administrator", ecr_owner: "engineer@netlink.com", approval_requirements: [], ...extra } as EngineeringChangeRequest;
}
const idsFor = (rows: EngineeringChangeRequest[], filter: string) => rows.filter((row) => matchesVisibleQueueFilter(filter, "engineering", row, manager)).map((row) => row.name);

describe("Engineering Manager canonical list metrics", () => {
  it("corrects the reported 11-record shape without changing the list or ownership rules", () => {
    // The persisted legacy aliases represent completed Engineering approvals in the current list.
    const rows = [ecr("legacy-procurement", "Procurement"),
      ...Array.from({ length: 4 }, (_, i) => ecr(`legacy-approved-${i}`, "Approved")),
      ...Array.from({ length: 4 }, (_, i) => ecr(`legacy-implementation-${i}`, "Implementation")),
      ecr("closed-extended", "Closed", { ecr_workflow_version: "extended_v1" }), ecr("draft", "Draft")];
    expect(getECRQueueSummary("engineering", rows, manager).approved).toBe(10);
    expect(getEngineeringECRMetrics(rows, manager)).toEqual({ all: 11, mine: 0, pending: 0, sentBack: 0, approved: 9, closed: 1 });
    expect(idsFor(rows, "approved")).not.toContain("closed-extended");
    expect(idsFor(rows, "closed")).toEqual(["closed-extended"]);
  });

  it("keeps list membership for extended approval and RFQ stages, rather than only subtracting Closed", () => {
    const rows = ["ECR Approved", "Procurement Decision", "Closed", "RFQ"].map((stage) =>
      ecr(stage, stage as EngineeringChangeRequest["select_pxfp"], { ecr_workflow_version: "extended_v1" }));
    rows.push(ecr("legacy-rfq-pending", "RFQ Pending"), ecr("linked-rfq", "Engineering Review", { rfq: "PUR-RFQ-EXISTING" }));
    expect(idsFor(rows, "approved")).toEqual(["RFQ", "legacy-rfq-pending", "linked-rfq"]);
    expect(idsFor(rows, "closed")).toEqual(["Closed", "RFQ", "linked-rfq"]);
    expect(getEngineeringECRMetrics(rows, manager)).toEqual({ all: 6, mine: 0, pending: 0, sentBack: 0, approved: 3, closed: 3 });
  });

  it("preserves established ownership aliases without treating visibility or review assignment as ownership", () => {
    const rows = [
      ecr("owner", "Draft", { ecr_owner: ` ${manager.email.toUpperCase()} ` }),
      ecr("legacy-owner", "Draft", { ecr_owner: undefined, amended_from: manager.username }),
      ecr("creator-fallback", "Draft", { ecr_owner: undefined, owner: manager.name.split("@")[0] }),
      ecr("assigned-review", "Engineering Review", { approval_requirements: [{ ...task, approver: manager.email }] }),
      ecr("different-owner", "Draft"),
    ];
    expect(idsFor(rows, "mine")).toEqual(["owner", "legacy-owner", "creator-fallback"]);
    expect(getEngineeringECRMetrics(rows, manager).mine).toBe(3);
    expect(getEngineeringECRMetrics(rows, null).mine).toBe(0);
  });

  it("counts only the current required Engineering task, excluding stale or ambiguous assignments", () => {
    const rows = [
      ecr("legacy", "Engineering Review", { approval_requirements: [task] }),
      ecr("extended", "Engineering Review", { ecr_workflow_version: "extended_v1", approval_requirements: [{ ...task, approval_role: "engineering_manager" }] }),
      ecr("missing-task", "Engineering Review"),
      ecr("wrong-role", "Engineering Review", { approval_requirements: [{ ...task, approval_role: "Finance Manager" }] }),
      ecr("optional", "Engineering Review", { approval_requirements: [{ ...task, required: 0 }] }),
      ecr("already-reviewed", "Engineering Review", { approval_requirements: [{ ...task, status: "Approved" }] }),
      ecr("ambiguous", "Engineering Review", { approval_requirements: [task, { ...task, name: "other-task" }] }),
      ecr("downstream", "Finance Review", { ecr_workflow_version: "extended_v1", approval_requirements: [task] }),
      ecr("rfq-linked", "Engineering Review", { rfq: "PUR-RFQ-EXISTING", approval_requirements: [task] }),
    ];
    expect(idsFor(rows, "pending-approval")).toEqual(["legacy", "extended"]);
    expect(idsFor(rows, "engineering")).toEqual(idsFor(rows, "pending-approval"));
    expect(getEngineeringECRMetrics(rows, manager).pending).toBe(2);
  });

  it("uses saved Sent Back workflow evidence without inferring it from rejection", () => {
    const rows = [
      ecr("returned-draft", "Draft", { ecr_workflow_version: "extended_v1", approval_requirements: [{ ...task, status: "Sent Back" }] }),
      ecr("returned-technical", "Technical Approved", { ecr_workflow_version: "extended_v1", approval_requirements: [{ ...task, status: "Sent Back" }] }),
      ecr("rejected", "Rejected", { ecr_workflow_version: "extended_v1", approval_requirements: [{ ...task, status: "Rejected" }] }),
      ecr("legacy-status-only", "Sent Back"),
      ecr("resubmitted", "Engineering Review", { ecr_workflow_version: "extended_v1", approval_requirements: [{ ...task, status: "Sent Back" }] }),
    ];
    expect(idsFor(rows, "sent-back")).toEqual(["returned-draft", "returned-technical"]);
    expect(getEngineeringECRMetrics(rows, manager).sentBack).toBe(2);
  });

  it("returns no fabricated counts for an empty successful dataset", () => {
    expect(getEngineeringECRMetrics([], manager)).toEqual({ all: 0, mine: 0, pending: 0, sentBack: 0, approved: 0, closed: 0 });
  });
});
