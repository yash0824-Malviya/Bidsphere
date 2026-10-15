import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./clm-monitor";
import { ClmError } from "./clmCore";

const monitoring = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./clmNotifications.js", () => ({ runClmMonitoring: monitoring.run }));
async function call(authorization?: unknown, method = "GET", query: Record<string, unknown> = {}) {
  const req = { method, headers: { authorization }, query } as unknown as VercelRequest;
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() }; res.status.mockReturnValue(res);
  await handler(req, res as unknown as VercelResponse); return res;
}
describe("protected CLM scheduled-monitoring endpoint", () => {
  beforeEach(() => { vi.stubEnv("CRON_SECRET", "fixture-only-monitor-secret"); monitoring.run.mockReset(); monitoring.run.mockResolvedValue({ contracts: 2, alerts: 3, created: 1, existing: 2, denied: 0 }); });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "", "Bearer incorrect", "fixture-only-monitor-secret", ["Bearer fixture-only-monitor-secret"]])("denies invalid/missing header %j before scanning ERP", async authorization => {
    const res = await call(authorization); expect(res.status).toHaveBeenCalledWith(401); expect(monitoring.run).not.toHaveBeenCalled();
  });

  it("fails closed when deployment has no CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", ""); const res = await call("Bearer "); expect(res.status).toHaveBeenCalledWith(401); expect(monitoring.run).not.toHaveBeenCalled();
  });

  it("does not accept secrets from query parameters", async () => {
    const res = await call(undefined, "GET", { secret: "fixture-only-monitor-secret", access_token: "fixture-only-monitor-secret" });
    expect(res.status).toHaveBeenCalledWith(401); expect(monitoring.run).not.toHaveBeenCalled();
  });

  it("runs authorized GET monitoring with no-store responses", async () => {
    const res = await call("Bearer fixture-only-monitor-secret"); expect(res.status).toHaveBeenCalledWith(200); expect(monitoring.run).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store"); expect(res.json).toHaveBeenCalledWith({ data: { contracts: 2, alerts: 3, created: 1, existing: 2, denied: 0 } });
  });

  it("rejects unsupported methods without dispatching work", async () => {
    const res = await call("Bearer fixture-only-monitor-secret", "POST"); expect(res.status).toHaveBeenCalledWith(405); expect(monitoring.run).not.toHaveBeenCalled();
  });

  it("keeps unexpected internals private while preserving meaningful domain errors", async () => {
    monitoring.run.mockRejectedValueOnce(new Error("SECRET database stack")); let res = await call("Bearer fixture-only-monitor-secret");
    expect(res.status).toHaveBeenCalledWith(500); expect(JSON.stringify(res.json.mock.calls)).not.toContain("SECRET");
    monitoring.run.mockRejectedValueOnce(new ClmError("Saved Contract SLA data is invalid.", 409)); res = await call("Bearer fixture-only-monitor-secret");
    expect(res.status).toHaveBeenCalledWith(409); expect(res.json).toHaveBeenCalledWith({ message: "Saved Contract SLA data is invalid." });
  });
});
