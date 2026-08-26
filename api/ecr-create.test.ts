import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./ecr-create";
import { issueInternalAccessToken, type AppRole } from "./rbacAuth";

const ORIGINAL_ENV = { ...process.env };

function accessToken(role: AppRole): string {
  return issueInternalAccessToken({
    sub: `${role}@netlink.com`,
    email: `${role}@netlink.com`,
    role,
  });
}

function request(role: AppRole, body: Record<string, unknown>): VercelRequest {
  return {
    method: "POST",
    headers: { "x-bidsphere-access-token": accessToken(role) },
    body,
  } as unknown as VercelRequest;
}

function response(): {
  res: VercelResponse;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const end = vi.fn();
  const res = { status: vi.fn(), json, end };
  res.status.mockReturnValue(res);
  return {
    res: res as unknown as VercelResponse,
    status: res.status,
    json,
  };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotency_key: "ecr-create-route-test-0001",
    ecr_title: "Door latch redesign",
    ecr_type: "Design Change",
    priority: "High",
    ecr_owner: "forged@netlink.com",
    requesting_department: "Engineering",
    plant: "Plant 1",
    target_implementation_date: "2026-09-30",
    chnage_description: "Update the latch geometry.",
    reason_for_change: "Durability improvement.",
    supplier_response_required: "No",
    procurement_reference_type: "None",
    affected_parts: [],
    ...overrides,
  };
}

describe("POST /api/ecr-create", () => {
  beforeEach(() => {
    process.env.BIDSPHERE_SESSION_SECRET = "ecr-create-route-test-secret";
    process.env.ERPNEXT_URL = "https://erp.test";
    process.env.ERP_API_KEY = "service-key";
    process.env.ERP_API_SECRET = "service-secret";
    process.env.COMPANY = "Netlink";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it("authenticates the Engineer and inserts through ERP service credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [{
          name: "engineer@netlink.com",
          email: "engineer@netlink.com",
          enabled: 1,
        }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [{ name: "Engineering", department_name: "Engineering" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [{ name: "Plant 1", floor_name: "Plant 1" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [{
          name: "SUP-APEX",
          supplier_name: "Apex Fasteners Ltd",
          disabled: 0,
        }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ data: [{
          name: "LAT-4401",
          item_code: "LAT-4401",
          item_name: "Door Latch",
          disabled: 0,
        }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ data: {
          name: "ECR-2026-00046",
          ecr_owner: "engineer@netlink.com",
          select_pxfp: "Draft",
          docstatus: 0,
          approval_requirements: [],
        } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    const { res, status, json } = response();

    await handler(request("engineer", validPayload({
      suggested_supplier: "Apex Fasteners Ltd",
      affected_parts: [{ partitem: "Door Latch", quantity: 1, uom: "Nos" }],
    })), res);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "ECR-2026-00046",
        ecr_number: "ECR-2026-00046",
        ecr_owner: "engineer@netlink.com",
        select_pxfp: "Draft",
        docstatus: 0,
        approval_requirements: [],
        create_replayed: false,
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(7);
    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(lookupUrl)).toContain("bidsphere_create_idempotency_key");
    expect(lookupInit?.headers).toMatchObject({
      Authorization: "token service-key:service-secret",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/resource/User?");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/api/resource/Department?");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("/api/resource/Plant%20Floor?");
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("/api/resource/Supplier?");
    expect(String(fetchMock.mock.calls[5]?.[0])).toContain("/api/resource/Item?");
    const [url, init] = fetchMock.mock.calls[6] ?? [];
    expect(url).toBe("https://erp.test/api/resource/Engineering%20Change%20Request");
    expect(init?.headers).toMatchObject({
      Authorization: "token service-key:service-secret",
    });
    const inserted = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(inserted).not.toHaveProperty("ecr_number");
    expect(inserted).toMatchObject({
      ecr_owner: "engineer@netlink.com",
      suggested_supplier: "SUP-APEX",
      affected_parts: [{ partitem: "LAT-4401", quantity: 1, uom: "Nos" }],
      status: "Draft",
      select_pxfp: "Draft",
      docstatus: 0,
      approval_requirements: [],
    });
  });

  it("rejects a non-Engineer internal role before contacting ERPNext", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { res, status, json } = response();

    await handler(request("engineering", validPayload()), res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: expect.stringMatching(/permission/i),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replays the persisted ECR after an ERP unique-key race", async () => {
    const jsonResponse = (body: unknown, status = 200) => new Response(
      JSON.stringify(body),
      { status, headers: { "Content-Type": "application/json" } },
    );
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{
        name: "engineer@netlink.com",
        email: "engineer@netlink.com",
        enabled: 1,
      }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{
        name: "Engineering",
        department_name: "Engineering",
      }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{
        name: "Plant 1",
        floor_name: "Plant 1",
      }] }))
      .mockResolvedValueOnce(jsonResponse({
        exc_type: "UniqueValidationError",
        exception: "frappe.exceptions.UniqueValidationError: Create Idempotency Key must be unique",
      }, 409))
      .mockResolvedValueOnce(jsonResponse({ data: [{ name: "ECR-2026-00048" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: {
        name: "ECR-2026-00048",
        ecr_owner: "engineer@netlink.com",
        select_pxfp: "Engineering Review",
        docstatus: 1,
        approval_requirements: [{
          approval_role: "Engineering Manager",
          status: "Pending",
        }],
      } }));
    const { res, status, json } = response();

    await handler(request("engineer", validPayload()), res);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "ECR-2026-00048",
        ecr_number: "ECR-2026-00048",
        select_pxfp: "Engineering Review",
        docstatus: 1,
        approval_requirements: [{
          approval_role: "Engineering Manager",
          status: "Pending",
        }],
        create_replayed: true,
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("rejects a client-supplied workflow field before contacting ERPNext", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { res, status, json } = response();

    await handler(request("engineer", validPayload({ select_pxfp: "Approved" })), res);

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: "validation",
      field_errors: {
        select_pxfp: expect.stringMatching(/server-managed/i),
      },
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
