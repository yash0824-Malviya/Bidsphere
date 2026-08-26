import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { issueInternalAccessToken, type AppRole } from "./rbacAuth";

const mocks = vi.hoisted(() => ({ createRfqFromEcrCore: vi.fn() }));

vi.mock("./createRfqFromEcrCore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./createRfqFromEcrCore")>();
  return { ...original, createRfqFromEcrCore: mocks.createRfqFromEcrCore };
});

import handler from "./create-rfq-from-ecr";
import { CreateRfqFromEcrError } from "./createRfqFromEcrCore";

const ORIGINAL_ENV = { ...process.env };

function token(role: AppRole): string {
  return issueInternalAccessToken({
    sub: `${role}@netlink.com`,
    email: `${role}@netlink.com`,
    role,
  });
}

function request(
  role: AppRole,
  body: Record<string, unknown> = { ecr_name: "ECR-2026-100001" },
): VercelRequest {
  return {
    method: "POST",
    headers: { "x-bidsphere-access-token": token(role) },
    body,
  } as unknown as VercelRequest;
}

function response(): {
  res: VercelResponse;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const end = vi.fn();
  const status = vi.fn();
  const res = { status, json, end };
  status.mockReturnValue(res);
  return { res: res as unknown as VercelResponse, status, json, end };
}

describe("POST /api/create-rfq-from-ecr", () => {
  beforeEach(() => {
    process.env.BIDSPHERE_SESSION_SECRET = "create-rfq-from-ecr-test-secret";
    mocks.createRfqFromEcrCore.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("authorizes Procurement Manager and passes only the identifier and signed principal", async () => {
      const role: AppRole = "procurement";
      mocks.createRfqFromEcrCore.mockResolvedValue({
        success: true,
        newStatus: "RFQ",
        rfqName: "PUR-RFQ-2026-00001",
        created: true,
        replayed: false,
        message: "created",
        approvalRequirements: [],
      });
      const { res, status, json } = response();
      await handler(request(role, {
        ecr_name: "ECR-2026-100001",
        suppliers: ["FORGED-SUPPLIER"],
        items: [{ item_code: "FORGED-ITEM" }],
        title: "forged title",
      }), res);

      expect(status).toHaveBeenCalledWith(201);
      expect(mocks.createRfqFromEcrCore).toHaveBeenCalledWith({
        ecrName: "ECR-2026-100001",
        principal: expect.objectContaining({ role, email: `${role}@netlink.com` }),
      });
      expect(json).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rfqName: "PUR-RFQ-2026-00001",
          created: true,
        }),
      });
  });

  it("returns 200 for a replay", async () => {
    mocks.createRfqFromEcrCore.mockResolvedValue({
      success: true,
      newStatus: "RFQ",
      rfqName: "PUR-RFQ-2026-00001",
      created: false,
      replayed: true,
      message: "already linked",
      approvalRequirements: [],
    });
    const { res, status } = response();
    await handler(request("procurement"), res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it.each(["engineer", "engineering", "procurement_team", "admin"] as AppRole[])(
    "rejects unauthorized role %s before invoking the core",
    async (role) => {
      const { res, status } = response();
      await handler(request(role), res);
      expect(status).toHaveBeenCalledWith(403);
      expect(mocks.createRfqFromEcrCore).not.toHaveBeenCalled();
    },
  );

  it("returns structured partial-repair information", async () => {
    mocks.createRfqFromEcrCore.mockRejectedValue(new CreateRfqFromEcrError(
      "RFQ exists but ECR sync failed.",
      409,
      "partial",
      { rfqName: "PUR-RFQ-2026-00009" },
    ));
    const { res, status, json } = response();
    await handler(request("procurement"), res);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: "RFQ exists but ECR sync failed.",
      code: "partial",
      rfq_name: "PUR-RFQ-2026-00009",
    });
  });

  it("supports preflight and rejects non-POST methods", async () => {
    const options = request("procurement");
    options.method = "OPTIONS";
    const optionsResponse = response();
    await handler(options, optionsResponse.res);
    expect(optionsResponse.status).toHaveBeenCalledWith(204);
    expect(optionsResponse.end).toHaveBeenCalled();

    const get = request("procurement");
    get.method = "GET";
    const getResponse = response();
    await handler(get, getResponse.res);
    expect(getResponse.status).toHaveBeenCalledWith(405);
  });
});
