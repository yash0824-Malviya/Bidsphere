import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { issueInternalAccessToken, type AppRole } from "./rbacAuth";

const mocks = vi.hoisted(() => ({
  createPrFromEcrCore: vi.fn(),
}));

vi.mock("./createPrFromEcrCore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./createPrFromEcrCore")>();
  return { ...original, createPrFromEcrCore: mocks.createPrFromEcrCore };
});

import handler from "./create-pr-from-ecr";
import { CreatePrFromEcrError } from "./createPrFromEcrCore";

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

describe("POST /api/create-pr-from-ecr", () => {
  beforeEach(() => {
    process.env.BIDSPHERE_SESSION_SECRET = "create-pr-route-test-secret";
    mocks.createPrFromEcrCore.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it.each(["procurement_team", "procurement", "admin"] as AppRole[])(
    "authorizes %s and delegates only the ECR identifier plus authenticated principal",
    async (role) => {
      mocks.createPrFromEcrCore.mockResolvedValue({
        success: true,
        prName: "PR-2026-00001",
        created: true,
        replayed: false,
        message: "created",
      });
      const { res, status, json } = response();

      await handler(request(role, {
        ecr_name: "ECR-2026-100001",
        requisition_title: "forged client title",
        ecr_reference: "ECR-OTHER",
      }), res);

      expect(status).toHaveBeenCalledWith(201);
      expect(mocks.createPrFromEcrCore).toHaveBeenCalledWith({
        ecrName: "ECR-2026-100001",
        principal: expect.objectContaining({
          typ: "internal",
          role,
          email: `${role}@netlink.com`,
        }),
      });
      expect(json).toHaveBeenCalledWith({
        data: expect.objectContaining({ prName: "PR-2026-00001", created: true }),
      });
    },
  );

  it("returns 200 for an idempotent replay", async () => {
    mocks.createPrFromEcrCore.mockResolvedValue({
      success: true,
      prName: "PR-2026-00001",
      created: false,
      replayed: true,
      message: "already linked",
    });
    const { res, status } = response();
    await handler(request("procurement_team"), res);
    expect(status).toHaveBeenCalledWith(200);
  });

  it("rejects a non-procurement role before invoking the core", async () => {
    const { res, status, json } = response();
    await handler(request("engineer"), res);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringMatching(/permission/i),
    }));
    expect(mocks.createPrFromEcrCore).not.toHaveBeenCalled();
  });

  it("returns structured partial-repair information", async () => {
    mocks.createPrFromEcrCore.mockRejectedValue(new CreatePrFromEcrError(
      "PR exists but the ECR transition failed.",
      409,
      "partial",
      { prName: "PR-2026-00009" },
    ));
    const { res, status, json } = response();
    await handler(request("procurement_team"), res);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: "PR exists but the ECR transition failed.",
      code: "partial",
      pr_name: "PR-2026-00009",
    });
  });

  it("supports preflight and rejects every non-POST method", async () => {
    const options = request("procurement_team");
    options.method = "OPTIONS";
    const optionsResponse = response();
    await handler(options, optionsResponse.res);
    expect(optionsResponse.status).toHaveBeenCalledWith(204);
    expect(optionsResponse.end).toHaveBeenCalled();

    const get = request("procurement_team");
    get.method = "GET";
    const getResponse = response();
    await handler(get, getResponse.res);
    expect(getResponse.status).toHaveBeenCalledWith(405);
  });
});
