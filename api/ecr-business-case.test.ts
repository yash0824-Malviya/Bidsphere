import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./ecr-business-case";
import { applyEcrBusinessCaseActionCore, fetchEcrBusinessCaseCore } from "./ecrBusinessCaseCore";
import { issueInternalAccessToken } from "./rbacAuth";

vi.mock("./ecrBusinessCaseCore", () => ({
  applyEcrBusinessCaseActionCore: vi.fn(), fetchEcrBusinessCaseCore: vi.fn(),
}));
function response() {
  const res = { status: vi.fn(), json: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as VercelResponse;
}
function request(method: string, body?: unknown, authenticated = true) {
  return {
    method, query: { ecr: "ECR-1" }, body,
    headers: authenticated ? { "x-bidsphere-access-token": issueInternalAccessToken({ sub: "engineer@test.com", email: "engineer@test.com", role: "engineer" }) } : {},
  } as unknown as VercelRequest;
}
const previousSecret = process.env.BIDSPHERE_SESSION_SECRET;
beforeEach(() => { process.env.BIDSPHERE_SESSION_SECRET = "business-case-route-secret"; vi.clearAllMocks(); });
afterEach(() => { if (previousSecret === undefined) delete process.env.BIDSPHERE_SESSION_SECRET; else process.env.BIDSPHERE_SESSION_SECRET = previousSecret; });

describe("/api/ecr-business-case", () => {
  it("requires internal authentication before reading sensitive Business Cases", async () => {
    const res = response();
    await handler(request("GET", undefined, false), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(fetchEcrBusinessCaseCore).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
  it("returns the linked aggregate for GET", async () => {
    vi.mocked(fetchEcrBusinessCaseCore).mockResolvedValueOnce({ ecr: { name: "ECR-1" }, businessCase: null });
    const res = response();
    await handler(request("GET"), res);
    expect(res.json).toHaveBeenCalledWith({ data: { ecr: { name: "ECR-1" }, businessCase: null } });
    expect(fetchEcrBusinessCaseCore).toHaveBeenCalledWith(expect.objectContaining({ ecr_name: "ECR-1", principal: expect.objectContaining({ role: "engineer" }) }));
  });
  it("forwards the optimistic revision and uses the authenticated identity", async () => {
    vi.mocked(applyEcrBusinessCaseActionCore).mockResolvedValueOnce({ ecr: { name: "ECR-1" }, businessCase: { name: "BC-ECR-1" } });
    const res = response();
    await handler(request("POST", { ecr_name: "ECR-1", action: "save", payload: { why_required: "Change" }, expected_modified: "v3", principal: { role: "admin" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(applyEcrBusinessCaseActionCore).toHaveBeenCalledWith(expect.objectContaining({ expected_modified: "v3", principal: expect.objectContaining({ role: "engineer" }) }));
  });
  it.each(["{", "[]", "null"])("rejects malformed JSON payload %s", async (body) => {
    const res = response();
    await handler(request("POST", body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(applyEcrBusinessCaseActionCore).not.toHaveBeenCalled();
  });
});
