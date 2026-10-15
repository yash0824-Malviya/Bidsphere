import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../types/erpnext";
import { recoverECRWorkflowState, refreshECRQueries } from "./ecrQueryCache";

const clients: QueryClient[] = [];
const subscriptions: Array<() => void> = [];
function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  clients.push(value);
  return value;
}
function record(stage = "Draft"): EngineeringChangeRequest {
  return {
    name: "internal-ecr-id", ecr_number: "ECR-2026-100010", select_pxfp: stage,
    ecr_workflow_version: "extended_v1", modified: "2026-09-15 12:30:00",
    approval_requirements: stage === "Draft" ? [] : [{ approval_role: "Engineering Manager", status: "Pending", required: 1 }],
  } as EngineeringChangeRequest;
}
afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  clients.splice(0).forEach((value) => value.clear());
});

describe("ECR workflow cache recovery", () => {
  it.each(["extended_v1", undefined])("refreshes active detail and counter data after a possibly committed action (%s)", async (version) => {
    const qc = client();
    const saved = { ...record("Engineering Review"), ecr_workflow_version: version };
    const keys = [
      ["ecr", saved.ecr_number], ["ecr-comments", saved.name], ["ecr-business-case", saved.name],
      ["ecr-list", "engineer"], ["ecr-dashboard", "engineering"], ["ecr-urgent-dashboard-list"],
      ["ecr-badge-counts"],
      ["procurement-team-ecrs-secondary"], ["ecr-notifications", "engineering"],
    ];
    for (const queryKey of keys) {
      qc.setQueryData(queryKey, record());
      const observer = new QueryObserver(qc, { queryKey, queryFn: async () => saved });
      subscriptions.push(observer.subscribe(() => undefined));
    }
    qc.setQueryData(["rfqs"], ["existing-rfq"]);
    qc.setQueryData(["procurement-team-pos-main"], ["existing-po"]);

    await refreshECRQueries(qc, [saved.name, saved.ecr_number]);

    for (const key of keys) expect(qc.getQueryData(key)).toEqual(saved);
    expect(qc.getQueryData(["ecr", saved.ecr_number])).toMatchObject({
      select_pxfp: "Engineering Review",
      approval_requirements: [{ approval_role: "Engineering Manager", status: "Pending" }],
    });
    expect(qc.getQueryState(["rfqs"])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(["procurement-team-pos-main"])?.isInvalidated).toBe(false);
  });

  it("recovers canonical and public detail aliases with one read and invalidates inactive counters", async () => {
    const qc = client();
    const persisted = record("Engineering Review");
    const read = vi.fn(async () => persisted);
    qc.setQueryData(["ecr", persisted.ecr_number], record());
    qc.setQueryData(["ecr-list", "engineer"], [record()]);

    await expect(recoverECRWorkflowState(qc, [persisted.name, persisted.ecr_number], read)).resolves.toEqual(persisted);

    expect(read).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(["ecr", persisted.name])).toEqual(persisted);
    expect(qc.getQueryData(["ecr", persisted.ecr_number])).toEqual(persisted);
    expect(qc.getQueryState(["ecr-list", "engineer"])?.isInvalidated).toBe(true);
  });

  it("does not invent a successful transition when the follow-up read fails", async () => {
    const qc = client();
    const draft = record();
    qc.setQueryData(["ecr", draft.name], draft);
    qc.setQueryData(["ecr-notifications", "engineering"], []);
    const read = vi.fn(async () => { throw new Error("Network unavailable"); });

    await expect(recoverECRWorkflowState(qc, [draft.name], read)).resolves.toBeUndefined();

    expect(read).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(["ecr", draft.name])).toEqual(draft);
    expect(qc.getQueryState(["ecr", draft.name])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["ecr-notifications", "engineering"])?.isInvalidated).toBe(true);
  });

  it("preserves the original action outcome when one refresh fails", async () => {
    const qc = client();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    invalidate.mockRejectedValueOnce(new Error("Refresh unavailable"));
    await expect(refreshECRQueries(qc, ["internal-ecr-id"])).resolves.toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ecr", "internal-ecr-id"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ecr-notifications"] });
  });
});
