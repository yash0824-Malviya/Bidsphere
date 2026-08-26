import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./file-proxy";
import {
  issueInternalAccessToken,
  issueSupplierAccessToken,
  type AppRole,
} from "./rbacAuth";

const ORIGINAL_ENV = { ...process.env };

function internalToken(
  role: AppRole = "engineer",
  email = "engineer@netlink.com",
): string {
  return issueInternalAccessToken({ sub: email, email, role });
}

function request(input: {
  path: string | string[];
  token?: string;
  method?: "GET" | "HEAD";
  query?: Record<string, string | string[]>;
}): VercelRequest {
  return {
    method: input.method || "GET",
    headers: input.token ? { "x-bidsphere-access-token": input.token } : {},
    query: { path: input.path, ...(input.query || {}) },
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
    send: ReturnType<typeof vi.fn>;
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ECR_FILE = {
  name: "FILE-001",
  file_name: "drawing.pdf",
  file_url: "/private/files/drawing.pdf",
  is_private: 1,
  is_folder: 0,
  attached_to_doctype: "Engineering Change Request",
  attached_to_name: "ECR-2026-100001",
  attached_to_field: "engineering_drawing",
};

describe("GET /api/file-proxy authorization", () => {
  beforeEach(() => {
    process.env.BIDSPHERE_SESSION_SECRET = "file-proxy-handler-test-secret";
    process.env.ERPNEXT_URL = "https://erp.test";
    process.env.ERP_API_KEY = "service-key";
    process.env.ERP_API_SECRET = "service-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it("never performs metadata or byte reads for an anonymous request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const res = response();

    await handler(request({ path: ECR_FILE.file_url }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves metadata and authorizes the ECR owner before sending bytes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [ECR_FILE] }))
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "ECR-2026-100001",
        select_pxfp: "Engineering Review",
        ecr_owner: "engineer@netlink.com",
      } }))
      .mockResolvedValueOnce(new Response(Buffer.from("%PDF-secure"), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }));
    const res = response();

    await handler(request({
      path: ECR_FILE.file_url,
      token: internalToken(),
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/resource/File?");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/api/resource/Engineering%20Change%20Request/ECR-2026-100001",
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://erp.test/private/files/drawing.pdf",
    );
  });

  it("denies another engineer before the binary request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [ECR_FILE] }))
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "ECR-2026-100001",
        select_pxfp: "Draft",
        ecr_owner: "owner@netlink.com",
      } }));
    const res = response();

    await handler(request({
      path: ECR_FILE.file_url,
      token: internalToken("engineer", "other@netlink.com"),
    }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringMatching(/permission/i),
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows a supplier only when the persisted non-ECR target is owned", async () => {
    const supplierFile = {
      ...ECR_FILE,
      name: "FILE-RFQ",
      file_url: "/private/files/rfq.pdf",
      attached_to_doctype: "Request for Quotation",
      attached_to_name: "RFQ-001",
      attached_to_field: undefined,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [supplierFile] }))
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "RFQ-001",
        suppliers: [{ supplier: "SUP-001" }],
      } }))
      .mockResolvedValueOnce(new Response(Buffer.from("%PDF-rfq"), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }));
    const res = response();

    await handler(request({
      path: supplierFile.file_url,
      token: issueSupplierAccessToken({ supplier: "SUP-001" }),
    }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails closed on ambiguous metadata and encoded traversal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        data: [ECR_FILE, { ...ECR_FILE, name: "FILE-002" }],
      }));
    const ambiguous = response();
    await handler(request({
      path: ECR_FILE.file_url,
      token: internalToken("admin"),
    }), ambiguous);
    expect(ambiguous.status).toHaveBeenCalledWith(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    const traversal = response();
    await handler(request({
      path: "/private/files/%252e%252e/site_config.json",
      token: internalToken("admin"),
    }), traversal);
    expect(traversal.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
