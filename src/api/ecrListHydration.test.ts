import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock("./erpnext", () => ({
  apiGet: mocks.apiGet,
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  buildResourceUrl: (doctype: string, name?: string) =>
    `/api/resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`,
  extractErpNextErrorMessage: () => "",
  withSilent: () => ({}),
  withoutNetworkRetry: () => ({}),
}));

import { fetchECRList, resolveECRName } from "./ecr";
import { formatECRNumber } from "../config/ecrRoles";
import type { EngineeringChangeRequest } from "../types/erpnext";

function row(
  name: string,
  select_pxfp: EngineeringChangeRequest["select_pxfp"],
): EngineeringChangeRequest {
  return {
    name,
    ecr_number: name,
    ecr_title: name,
    ecr_type: "Part Change",
    priority: "Medium",
    ecr_owner: "engineer@netlink.com",
    requesting_department: "Engineering",
    plant: "Main Plant",
    target_implementation_date: "2026-09-01",
    chnage_description: "Change",
    reason_for_change: "Reason",
    select_pxfp,
  };
}

function detail(
  source: EngineeringChangeRequest,
  approvalRole: string,
): EngineeringChangeRequest {
  return {
    ...source,
    approval_requirements: [{
      name: `TASK-${source.name}`,
      approval_role: approvalRole,
      status: "Pending",
      required: 1,
    }],
  };
}

describe("ECR actionable-list detail hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates only actionable stages and preserves list order", async () => {
    const rows = [
      row("DRAFT-1", "Draft"),
      row("ENG-1", "Engineering Review"),
      row("TEAM-1", "Procurement Review"),
      row("MANAGER-1", "RFQ Pending"),
      row("RFQ-1", "RFQ"),
    ];
    const details = new Map([
      ["ENG-1", detail(rows[1], "Engineering Manager")],
      ["TEAM-1", detail(rows[2], "Procurement Team")],
      ["MANAGER-1", detail(rows[3], "Procurement Manager")],
    ]);
    mocks.apiGet.mockImplementation(async (url: string) => {
      const detailName = [...details.keys()].find((name) =>
        url.startsWith(`/api/resource/Engineering%20Change%20Request/${name}?`),
      );
      return detailName ? { data: details.get(detailName) } : { data: rows };
    });

    const result = await fetchECRList({ limit: 50 });

    expect(result.map(({ name }) => name)).toEqual(rows.map(({ name }) => name));
    expect(result[0].approval_requirements).toBeUndefined();
    expect(result[1].approval_requirements?.[0]?.approval_role).toBe("Engineering Manager");
    expect(result[2].approval_requirements?.[0]?.approval_role).toBe("Procurement Team");
    expect(result[3].approval_requirements?.[0]?.approval_role).toBe("Procurement Manager");
    expect(result[4].approval_requirements).toBeUndefined();
    expect(mocks.apiGet).toHaveBeenCalledTimes(4);
  });

  it("bounds concurrent detail requests", async () => {
    const rows = Array.from({ length: 14 }, (_, index) =>
      row(`TEAM-${index + 1}`, "Procurement Review"),
    );
    let active = 0;
    let maxActive = 0;
    mocks.apiGet.mockImplementation(async (url: string) => {
      if (!url.includes("/Engineering%20Change%20Request/")) return { data: rows };
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const encodedName = url.split("/Engineering%20Change%20Request/")[1]?.split("?")[0] ?? "";
      const name = decodeURIComponent(encodedName);
      const source = rows.find((item) => item.name === name)!;
      return { data: detail(source, "Procurement Team") };
    });

    const result = await fetchECRList();

    expect(result.every((item) => item.approval_requirements?.length === 1)).toBe(true);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(6);
  });

  it("keeps the legacy name compatibility scan raw and non-recursive", async () => {
    const legacy = row("private-frappe-name", "Procurement Review");
    legacy.ecr_number = undefined;
    const businessNumber = formatECRNumber(legacy);
    mocks.apiGet
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new Error("direct resource not found"))
      .mockResolvedValueOnce({ data: [legacy] });

    await expect(resolveECRName(businessNumber)).resolves.toBe("private-frappe-name");
    expect(mocks.apiGet).toHaveBeenCalledTimes(3);
    const compatibilityUrl = String(mocks.apiGet.mock.calls[2]?.[0]);
    expect(compatibilityUrl).not.toContain("/private-frappe-name");
  });

  it("keeps an unhydrated row non-actionable when its detail request fails", async () => {
    const review = row("TEAM-FAIL", "Procurement Review");
    mocks.apiGet
      .mockResolvedValueOnce({ data: [review] })
      .mockRejectedValueOnce(new Error("detail unavailable"));

    await expect(fetchECRList()).resolves.toEqual([review]);
  });
});
