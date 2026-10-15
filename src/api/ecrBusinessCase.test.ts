import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), resolve: vi.fn(), notification: vi.fn() }));
vi.mock("./erpnext", () => ({ apiGet: mock.get, apiPost: mock.post, withoutNetworkRetry: () => ({ _disableNetworkRetry: true }) }));
vi.mock("./ecr", () => ({ resolveECRName: mock.resolve, extractECRErrorMessage: (error: Error) => error.message }));
vi.mock("./notifications", () => ({ createNotification: mock.notification, upsertNotification: mock.notification }));
import { applyECRBusinessCaseAction, approveECRBusinessCaseByRole, fetchECRBusinessCase, rejectECRBusinessCase, sendBackECRBusinessCase } from "./ecrBusinessCase";
import { emptyECRBusinessCasePayload } from "../types/ecrBusinessCase";

describe("ECR Business Case API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", {});
  });
  afterEach(() => vi.unstubAllGlobals());
  it("resolves public ECR identifiers before loading their linked aggregate", async () => {
    mock.resolve.mockResolvedValue("private-ecr");
    mock.get.mockResolvedValue({ data: { ecr: { name: "private-ecr" }, businessCase: null } });
    const result = await fetchECRBusinessCase("ECR-2026-00001");
    expect(mock.get).toHaveBeenCalledWith("/api/ecr-business-case?ecr=private-ecr");
    expect(result.businessCase).toBeNull();
  });
  it("accepts responses already unwrapped by the shared ERPNext interceptor", async () => {
    const aggregate = { ecr: { name: "ECR-1", modified: "new" }, businessCase: null };
    mock.resolve.mockResolvedValue("ECR-1"); mock.get.mockResolvedValue(aggregate); mock.post.mockResolvedValue(aggregate);
    await expect(fetchECRBusinessCase("ECR-1")).resolves.toEqual(aggregate);
    await expect(applyECRBusinessCaseAction({ name: "ECR-1", modified: "old" }, "save", { payload: emptyECRBusinessCasePayload() })).resolves.toEqual(aggregate);
  });
  it("fails closed when a response has no linked aggregate", async () => {
    mock.post.mockResolvedValue({ success: true });
    await expect(applyECRBusinessCaseAction({ name: "ECR-1", modified: "old" }, "save")).rejects.toThrow("incomplete Business Case");
  });
  it("sends the parent revision and disables automatic mutation retries", async () => {
    mock.post.mockResolvedValue({ data: { ecr: { name: "ECR-1", modified: "next" }, businessCase: null } });
    const payload = emptyECRBusinessCasePayload();
    await applyECRBusinessCaseAction({ name: "ECR-1", modified: "previous" }, "save", { payload });
    expect(mock.post).toHaveBeenCalledWith("/api/ecr-business-case", { ecr_name: "ECR-1", expected_modified: "previous", action: "save", payload }, { _disableNetworkRetry: true });
  });
  it("requires a loaded parent revision before a review decision", async () => {
    await expect(applyECRBusinessCaseAction({ name: "ECR-1" }, "approve", { role: "finance" })).rejects.toThrow("Refresh the ECR");
    expect(mock.post).not.toHaveBeenCalled();
  });
  it("sends a procurement recommendation as review metadata alongside the current ECR revision", async () => {
    mock.post.mockResolvedValue({ data: { ecr: { name: "ECR-1" }, businessCase: null } });
    await applyECRBusinessCaseAction({ name: "ECR-1", modified: "current" }, "approve", { role: "procurement", comment: "Supplier impact reviewed", rfq_required: "No", rfq_decision_reason: "Current supplier can implement this change." });
    expect(mock.post.mock.calls[0]?.[1]).toEqual({ ecr_name: "ECR-1", expected_modified: "current", action: "approve", role: "procurement", comment: "Supplier impact reviewed", rfq_required: "No", rfq_decision_reason: "Current supplier can implement this change." });
    expect(mock.post.mock.calls[0]?.[1]).not.toHaveProperty("payload");
  });
  it("preserves server conflict messages for stale reviews", async () => {
    mock.post.mockRejectedValue(new Error("This ECR changed. Refresh before reviewing."));
    await expect(applyECRBusinessCaseAction({ name: "ECR-1", modified: "old" }, "approve", { role: "finance" })).rejects.toThrow("This ECR changed");
    expect(mock.post).toHaveBeenCalledTimes(1);
    expect(mock.notification).not.toHaveBeenCalled();
  });
  it.each([
    { action: "approve", review: approveECRBusinessCaseByRole, stage: "Procurement BC Review", recipient: "procurement", suffix: "/business-case" },
    { action: "send_back", review: sendBackECRBusinessCase, stage: "Technical Approved", recipient: "engineer", suffix: "/business-case" },
    { action: "reject", review: rejectECRBusinessCase, stage: "Rejected", recipient: "engineer", suffix: "" },
  ])("sends the Finance $action and notifies the recipient from the persisted $stage assignment", async ({ action, review, stage, recipient, suffix }) => {
    const aggregate = {
      ecr: {
        name: "private-ecr", ecr_number: "ECR-2026-100010", ecr_workflow_version: "extended_v1",
        modified: "saved-revision", select_pxfp: stage, ecr_owner: "owner@test.com", owner: "service-account@test.com",
      },
      businessCase: { name: "BC-ECR-2026-100010", finance_status: action === "approve" ? "Approved" : action === "send_back" ? "Sent Back" : "Rejected" },
    };
    mock.post.mockResolvedValue({ data: aggregate });
    const result = await review({ name: "private-ecr", modified: "reviewed-revision" }, "finance", "Financial rationale");
    expect(mock.post).toHaveBeenCalledExactlyOnceWith("/api/ecr-business-case", {
      ecr_name: "private-ecr", expected_modified: "reviewed-revision", action, role: "finance", comment: "Financial rationale",
    }, { _disableNetworkRetry: true });
    expect(mock.post.mock.calls[0]?.[1]).not.toHaveProperty("payload");
    expect(result).toEqual(aggregate);
    expect(mock.notification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: `ECR-2026-100010 · ${stage}`,
      module: "Engineering Change", target_role: recipient,
      document_type: "Engineering Change Request", document_name: "private-ecr",
      event_type: `ecr_${stage.toLowerCase().replaceAll(" ", "_")}_saved-revision`,
      route_path: `/ecr/ECR-2026-100010${suffix}`,
    }));
    const notification = mock.notification.mock.calls[0]?.[0];
    if (recipient === "engineer") expect(notification.target_user).toBe("owner@test.com");
    else expect(notification).not.toHaveProperty("target_user");
    expect(mock.post.mock.invocationCallOrder[0]).toBeLessThan(mock.notification.mock.invocationCallOrder[0]);
  });
  it("does not notify or retry when Finance approval fails server validation", async () => {
    mock.post.mockRejectedValue(new Error("Complete the required financial information before approving."));
    await expect(approveECRBusinessCaseByRole({ name: "ECR-1", modified: "current" }, "finance", "Reviewed")).rejects.toThrow("required financial information");
    expect(mock.post).toHaveBeenCalledTimes(1);
    expect(mock.notification).not.toHaveBeenCalled();
  });
  it("preserves a successful Finance review when browser notifications cannot be stored", async () => {
    const aggregate = { ecr: { name: "ECR-1", modified: "next", ecr_workflow_version: "extended_v1", select_pxfp: "Procurement BC Review" }, businessCase: null };
    mock.post.mockResolvedValue(aggregate);
    mock.notification.mockImplementation(() => { throw new Error("Storage unavailable"); });
    await expect(approveECRBusinessCaseByRole({ name: "ECR-1", modified: "current" }, "finance", "Reviewed")).resolves.toEqual(aggregate);
    expect(mock.post).toHaveBeenCalledTimes(1);
  });
});
