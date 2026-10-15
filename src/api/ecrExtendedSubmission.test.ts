import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./erpnext", () => ({ apiGet: mock.get, apiPost: mock.post, apiPut: vi.fn(), buildResourceUrl: (doctype: string, name?: string) => `/api/resource/${encodeURIComponent(doctype)}/${name || ""}`, extractErpNextErrorMessage: () => "", withSilent: () => ({}), withoutNetworkRetry: () => ({ _disableNetworkRetry: true }) }));
import { applyECRWorkflowAction, submitECR } from "./ecr";

describe("Extended ECR submission and final decision revisions", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.post.mockResolvedValue({ success: true, newStatus: "Engineering Review" }); });
  it("submits a newly saved extended ECR using the saved document revision", async () => {
    await expect(submitECR("private-ecr", { name: "private-ecr", ecr_workflow_version: "extended_v1", modified: "after-upload" })).resolves.toMatchObject({ success: true });
    expect(mock.post.mock.calls[0]?.[1]).toMatchObject({ action: "Submit ECR", ecr_name: "private-ecr", expected_modified: "after-upload" });
    expect(mock.get).not.toHaveBeenCalled();
  });
  it("fetches a current revision when an existing caller supplies only an identifier", async () => {
    mock.get.mockResolvedValue({ name: "private-ecr", ecr_workflow_version: "extended_v1", modified: "latest" });
    await submitECR("private-ecr");
    expect(mock.get).toHaveBeenCalledTimes(1);
    expect(mock.post.mock.calls[0]?.[1]).toMatchObject({ expected_modified: "latest" });
  });
  it("sends the loaded revision with the final procurement decision", async () => {
    await applyECRWorkflowAction("private-ecr", "Record Procurement Decision", undefined, { name: "private-ecr", ecr_workflow_version: "extended_v1", modified: "approved-revision" }, { "RFQ Required": "No", "Decision Reason": "Current supplier retained" });
    expect(mock.post.mock.calls[0]?.[1]).toMatchObject({ expected_modified: "approved-revision", reviewFields: { "RFQ Required": "No", "Decision Reason": "Current supplier retained" } });
  });
  it("preserves the legacy workflow request shape", async () => {
    await submitECR("legacy-ecr", { name: "legacy-ecr", modified: "legacy-revision" });
    expect(mock.post.mock.calls[0]?.[1]).not.toHaveProperty("expected_modified");
  });
});
