import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringChangeRequest } from "../types/erpnext";
import { refreshECRQueries } from "./ecrQueryCache";

const fixture = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../api/ecr", () => ({ fetchECRList: fixture.fetch }));
import { engineeringECRQueryOptions } from "./engineeringECRQuery";

const clients: QueryClient[] = [];
const subscriptions: Array<() => void> = [];
function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(value);
  return value;
}
function records(stage: string): EngineeringChangeRequest[] {
  return [{ name: "ECR-EXISTING", select_pxfp: stage, ecr_workflow_version: "extended_v1" }] as EngineeringChangeRequest[];
}
beforeEach(() => { fixture.fetch.mockReset(); });
afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  clients.splice(0).forEach((value) => value.clear());
});

describe("Engineering Manager shared ECR query", () => {
  it("reuses the same hydrated API response when navigating from dashboard to a queue", async () => {
    const qc = client();
    const saved = records("Engineering Review");
    fixture.fetch.mockResolvedValue(saved);

    const dashboard = await qc.fetchQuery(engineeringECRQueryOptions());
    const queue = await qc.fetchQuery(engineeringECRQueryOptions());

    expect(dashboard).toEqual(saved);
    expect(queue).toBe(dashboard);
    expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith({ limit: 300 });
    expect(qc.getQueryCache().getAll()).toHaveLength(1);
    expect(qc.getQueryCache().getAll()[0].queryKey).toEqual(["ecr-list", "engineering", "all"]);
  });

  it("keeps dashboard and list snapshots synchronized after either manual refresh and workflow invalidation", async () => {
    const qc = client();
    fixture.fetch.mockResolvedValue(records("Engineering Review"));
    await qc.fetchQuery(engineeringECRQueryOptions());
    const dashboard = new QueryObserver(qc, engineeringECRQueryOptions());
    const queue = new QueryObserver(qc, engineeringECRQueryOptions());
    subscriptions.push(dashboard.subscribe(() => undefined), queue.subscribe(() => undefined));

    for (const [observer, stage] of [[dashboard, "Procurement Review"], [queue, "RFQ Pending"]] as const) {
      const saved = records(stage);
      fixture.fetch.mockResolvedValue(saved);
      await observer.refetch();
      expect(dashboard.getCurrentResult().data).toEqual(saved);
      expect(queue.getCurrentResult().data).toBe(dashboard.getCurrentResult().data);
    }

    const saved = records("Closed");
    fixture.fetch.mockResolvedValue(saved);
    await refreshECRQueries(qc, ["ECR-EXISTING"]);
    expect(dashboard.getCurrentResult().data).toEqual(saved);
    expect(queue.getCurrentResult().data).toBe(dashboard.getCurrentResult().data);
    expect(fixture.fetch).toHaveBeenCalledTimes(4);
    expect(qc.getQueryCache().getAll()).toHaveLength(1);
  });

  it("reports refresh failures to both views instead of retaining independent successful snapshots", async () => {
    const qc = client();
    const saved = records("Engineering Review");
    fixture.fetch.mockResolvedValue(saved);
    await qc.fetchQuery(engineeringECRQueryOptions());
    const dashboard = new QueryObserver(qc, engineeringECRQueryOptions());
    const queue = new QueryObserver(qc, engineeringECRQueryOptions());
    subscriptions.push(dashboard.subscribe(() => undefined), queue.subscribe(() => undefined));

    fixture.fetch.mockRejectedValue(new Error("ECR service unavailable"));
    await dashboard.refetch();

    expect(dashboard.getCurrentResult().isError).toBe(true);
    expect(queue.getCurrentResult().isError).toBe(true);
    expect(queue.getCurrentResult().error?.message).toBe("ECR service unavailable");
    expect(dashboard.getCurrentResult().data).toEqual(saved);
    expect(queue.getCurrentResult().data).toBe(dashboard.getCurrentResult().data);
  });
});
