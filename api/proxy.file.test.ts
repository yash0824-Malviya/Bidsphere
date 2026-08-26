import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./proxy";
import { issueInternalAccessToken, type AppRole } from "./rbacAuth";

const ORIGINAL_ENV = { ...process.env };

function accessToken(role: AppRole, email = `${role}@netlink.com`): string {
  return issueInternalAccessToken({ sub: email, email, role });
}

function request(input: {
  method?: string;
  path: string;
  role?: AppRole;
  email?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | string[]>;
}): VercelRequest {
  const headers = input.role
    ? { "x-bidsphere-access-token": accessToken(input.role, input.email) }
    : {};
  return {
    method: input.method || "GET",
    headers,
    query: { path: input.path, ...(input.query || {}) },
    body: input.body,
  } as unknown as VercelRequest;
}

function response() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as VercelResponse & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ERP proxy File resources", () => {
  beforeEach(() => {
    process.env.BIDSPHERE_SESSION_SECRET = "file-resource-proxy-test-secret";
    process.env.ERPNEXT_URL = "https://erp.test";
    process.env.ERP_API_KEY = "service-key";
    process.env.ERP_API_SECRET = "service-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it("requires authentication before any named File read", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const res = response();

    await handler(request({ path: "resource/File/FILE-001" }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/authenticated/i) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the persisted File and ECR before forwarding an authorized owner read", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "FILE-001",
        attached_to_doctype: "Engineering Change Request",
        attached_to_name: "ECR-2026-100001",
        attached_to_field: "engineering_drawing",
        is_private: 1,
      } }))
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "ECR-2026-100001",
        select_pxfp: "Engineering Review",
        ecr_owner: "engineer@netlink.com",
      } }))
      .mockResolvedValueOnce(jsonResponse({ data: { name: "FILE-001" } }));
    const res = response();

    await handler(request({
      path: "resource/File/FILE-001",
      role: "engineer",
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: { name: "FILE-001" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/resource/File/FILE-001");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/api/resource/Engineering%20Change%20Request/ECR-2026-100001",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "token service-key:service-secret",
    });
  });

  it("does not forward another engineer's ECR File read", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "FILE-001",
        attached_to_doctype: "Engineering Change Request",
        attached_to_name: "ECR-2026-100001",
        attached_to_field: "engineering_drawing",
      } }))
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "ECR-2026-100001",
        select_pxfp: "Draft",
        ecr_owner: "owner@netlink.com",
      } }));
    const res = response();

    await handler(request({
      path: "resource/File/FILE-001",
      role: "engineer",
      email: "other@netlink.com",
    }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringMatching(/own ECRs/i) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("denies File collection writes and loads a named File before rejecting relink", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "FILE-OTHER",
        attached_to_doctype: "Item",
        attached_to_name: "ITEM-001",
      } }));
    const collectionRes = response();
    await handler(request({
      path: "resource/File",
      method: "POST",
      role: "admin",
      body: { file_name: "bypass.pdf" },
    }), collectionRes);
    expect(collectionRes.status).toHaveBeenCalledWith(403);
    expect(fetchMock).not.toHaveBeenCalled();

    const namedRes = response();
    await handler(request({
      path: "resource/File/FILE-OTHER",
      method: "PATCH",
      role: "admin",
      body: {
        attached_to_doctype: "Engineering Change Request",
        attached_to_name: "ECR-2026-100001",
      },
    }), namedRes);
    expect(namedRes.status).toHaveBeenCalledWith(403);
    expect(namedRes.json).toHaveBeenCalledWith({ error: expect.stringMatching(/cannot be relinked/i) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
