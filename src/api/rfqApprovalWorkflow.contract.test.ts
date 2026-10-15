import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncApprovalStateToErpNext } from "./rfqApprovalWorkflow";
import { getRFQ, updateRFQ } from "./sourcing";
import { getRFQSchema } from "./rfqSchema";
import type { RFQ, RFQApprovalState } from "../types/erpnext";
vi.mock("./sourcing", () => ({ getRFQ: vi.fn(), updateRFQ: vi.fn() }));
vi.mock("./rfqSchema", () => ({ getRFQSchema: vi.fn() }));

const state: RFQApprovalState = { rfq: "RFQ-1", selected_supplier: "SUP-1", selected_supplier_total: 120, workflow_step: "Pending Finance Review", legal_status: "Approved", finance_status: "Pending Finance Review", submitted_by: "procurement@test.example", submitted_at: "2026-09-18 10:00:00", legal_comments: [], finance_comments: [] };
const decision = { decision: "Yes", request: "CR-1", by: "procurement@test.example", at: "2026-09-18 10:01:00" };
const modified = "2026-09-18 10:01:00.123456";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRFQSchema).mockResolvedValue({ allFields: ["custom_approval_data", "custom_workflow_step"], customFields: [], workflowFields: [], hasLegalStatus: true, hasFinanceStatus: true, legalStatusFieldName: "custom_legal_status", financeStatusFieldName: "custom_finance_status" });
  vi.mocked(getRFQ).mockResolvedValue({ name: "RFQ-1", modified, custom_approval_data: JSON.stringify({ rfq: "RFQ-1", contract_decision: decision, server_metadata: "keep" }) } as unknown as RFQ);
  vi.mocked(updateRFQ).mockResolvedValue({ name: "RFQ-1" } as RFQ);
});

describe("RFQ approval sync preserves authoritative contract decision", () => {
  it("merges normal metadata while preserving the fresh server decision and exact modified stamp", async () => {
    await syncApprovalStateToErpNext(state);
    expect(getRFQ).toHaveBeenCalledExactlyOnceWith("RFQ-1");
    const updates = vi.mocked(updateRFQ).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(updates.modified).toBe(modified);
    expect(JSON.parse(String(updates.custom_approval_data))).toEqual({ ...state, contract_decision: decision, server_metadata: "keep" });
    expect(updates.custom_workflow_step).toBe("Pending Finance Review");
    expect(updates.custom_finance_status).toBe("Pending");
  });

  it("ignores any stale or fabricated browser contract decision", async () => {
    await syncApprovalStateToErpNext({ ...state, contract_decision: { decision: "No" } } as RFQApprovalState);
    const updates = vi.mocked(updateRFQ).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(JSON.parse(String(updates.custom_approval_data)).contract_decision).toEqual(decision);
  });

  it("does not manufacture a decision when no persisted decision exists", async () => {
    vi.mocked(getRFQ).mockResolvedValue({ name: "RFQ-1", modified, custom_approval_data: "" } as unknown as RFQ);
    await syncApprovalStateToErpNext({ ...state, contract_decision: decision } as RFQApprovalState);
    const updates = vi.mocked(updateRFQ).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(JSON.parse(String(updates.custom_approval_data))).not.toHaveProperty("contract_decision");
  });

  it.each(["clm_initial_request", "clm_rest_operation"])("preserves fresh server-owned %s during normal workflow sync", async key => {
    const fresh = { version: 1, phase: "complete", request: "CR-1" };
    vi.mocked(getRFQ).mockResolvedValue({ name: "RFQ-1", modified, custom_approval_data: JSON.stringify({ contract_decision: decision, [key]: fresh }) } as unknown as RFQ);
    await syncApprovalStateToErpNext({ ...state, [key]: { version: 1, phase: "saving" } } as RFQApprovalState);
    const updates = vi.mocked(updateRFQ).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(JSON.parse(String(updates.custom_approval_data))).toEqual({ ...state, contract_decision: decision, [key]: fresh });
    expect(updates.modified).toBe(modified);
  });

  it.each(["clm_initial_request", "clm_rest_operation"])("does not inject browser-owned %s when no server operation exists", async key => {
    await syncApprovalStateToErpNext({ ...state, [key]: { version: 1, phase: "complete", request: "CR-fabricated" } } as RFQApprovalState);
    const updates = vi.mocked(updateRFQ).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(JSON.parse(String(updates.custom_approval_data))).not.toHaveProperty(key);
  });

  it("does not retry a stale write using a newer modified stamp", async () => {
    const conflict = new Error("RFQ modified after you opened it");
    vi.mocked(updateRFQ).mockRejectedValue(conflict);
    await expect(syncApprovalStateToErpNext(state)).rejects.toBe(conflict);
    expect(getRFQ).toHaveBeenCalledTimes(1);
    expect(updateRFQ).toHaveBeenCalledTimes(1);
  });

  it.each([{ name: "RFQ-1" }, { name: "RFQ-1", modified, custom_approval_data: "invalid JSON" }])("does not write without a valid fresh snapshot (%j)", async record => {
    vi.mocked(getRFQ).mockResolvedValue(record as RFQ);
    await expect(syncApprovalStateToErpNext(state)).rejects.toThrow();
    expect(updateRFQ).not.toHaveBeenCalled();
  });
});
