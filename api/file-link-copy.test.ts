import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./file-link-copy";
import {
  issueInternalAccessToken,
  type AppRole,
} from "./rbacAuth";

const ORIGINAL_ENV = { ...process.env };

const SOURCE_FILE = {
  name: "FILE-BN-001",
  file_name: "technical-specification.pdf",
  file_url: "/private/files/technical-specification.pdf",
  file_size: 4096,
  is_private: 1,
  is_folder: 0,
  folder: "Home/Attachments",
  content_hash: "sha256-source",
  attached_to_doctype: "Business Need",
  attached_to_name: "BN-2026-00001",
};

const TARGET_FILE = {
  ...SOURCE_FILE,
  name: "FILE-BC-001",
  attached_to_doctype: "Business Case",
  attached_to_name: "BC-2026-00001",
};

function accessToken(role: AppRole = "department"): string {
  return issueInternalAccessToken({
    sub: `${role}@netlink.com`,
    email: `${role}@netlink.com`,
    role,
  });
}

function request(
  body: Record<string, unknown>,
  role?: AppRole,
): VercelRequest {
  return {
    method: "POST",
    headers: role
      ? { "x-bidsphere-access-token": accessToken(role) }
      : {},
    body,
  } as unknown as VercelRequest;
}

function response(): VercelResponse & {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as VercelResponse & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source_file_name: "FILE-BN-001",
    target_doctype: "Business Case",
    target_docname: "BC-2026-00001",
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function persistedParents(fetchMock: ReturnType<typeof vi.spyOn>): void {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ data: SOURCE_FILE }))
    .mockResolvedValueOnce(jsonResponse({ data: {
      name: "BN-2026-00001",
      requester: "department@netlink.com",
    } }))
    .mockResolvedValueOnce(jsonResponse({ data: {
      name: "BC-2026-00001",
      business_need: "BN-2026-00001",
    } }));
}

describe("POST /api/file-link-copy", () => {
  beforeEach(() => {
    process.env.BIDSPHERE_SESSION_SECRET = "file-link-copy-route-test-secret";
    process.env.ERPNEXT_URL = "https://erp.test";
    process.env.ERP_API_KEY = "service-key";
    process.env.ERP_API_SECRET = "service-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it("creates and verifies one scoped File link through service credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    persistedParents(fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: TARGET_FILE }))
      .mockResolvedValueOnce(jsonResponse({ data: [TARGET_FILE] }));
    const res = response();

    await handler(request(validPayload(), "department"), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({
        created: true,
        source_file_name: "FILE-BN-001",
        target_doctype: "Business Case",
        target_docname: "BC-2026-00001",
        file: expect.objectContaining({ name: "FILE-BC-001" }),
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({
        Authorization: "token service-key:service-secret",
      });
    }
    const [insertUrl, insertInit] = fetchMock.mock.calls[4] ?? [];
    expect(String(insertUrl)).toBe("https://erp.test/api/resource/File");
    expect(insertInit?.method).toBe("POST");
    expect(JSON.parse(String(insertInit?.body))).toEqual({
      file_name: "technical-specification.pdf",
      file_url: "/private/files/technical-specification.pdf",
      file_size: 4096,
      is_private: 1,
      is_folder: 0,
      folder: "Home/Attachments",
      content_hash: "sha256-source",
      attached_to_doctype: "Business Case",
      attached_to_name: "BC-2026-00001",
    });
  });

  it("replays an existing exact link without inserting another File", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    persistedParents(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [TARGET_FILE] }));
    const res = response();

    await handler(request(validPayload(), "department"), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ created: false }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("recovers when the File insert committed but its response was lost", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    persistedParents(fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(jsonResponse({ data: [TARGET_FILE] }));
    const res = response();

    await handler(request(validPayload(), "department"), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({
        created: false,
        file: expect.objectContaining({ name: "FILE-BC-001" }),
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("requires internal authentication and rejects client-controlled metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const anonymous = response();
    await handler(request(validPayload()), anonymous);
    expect(anonymous.status).toHaveBeenCalledWith(401);
    expect(fetchMock).not.toHaveBeenCalled();

    const forged = response();
    await handler(request(validPayload({
      file_url: "/files/forged.pdf",
      attached_to_doctype: "Engineering Change Request",
    }), "finance"), forged);
    expect(forged.status).toHaveBeenCalledWith(422);
    expect(forged.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: "validation",
      field_errors: expect.objectContaining({
        file_url: expect.stringMatching(/not accepted/i),
        attached_to_doctype: expect.stringMatching(/not accepted/i),
      }),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
