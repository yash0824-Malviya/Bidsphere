import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "./erpnext";
import {
  ecrMasterReferenceError,
  validateECRMasterReferences,
} from "./ecrMasterData";

vi.mock("./erpnext", () => ({
  apiGet: vi.fn(),
}));

const mockedApiGet = vi.mocked(apiGet);

describe("ECR master-data validation", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });

  it("returns independent field errors instead of one concatenated message", async () => {
    mockedApiGet.mockResolvedValue([]);

    const result = await validateECRMasterReferences({
      owner: "missing@netlink.com",
      department: "Missing Department",
      plant: "Missing Plant",
      supplier: "Missing Supplier",
      parts: [{ partitem: "MISSING-ITEM" }],
    });

    expect(Object.keys(result.errors)).toEqual([
      "ecr_owner",
      "requesting_department",
      "plant",
      "suggested_supplier",
      "partitem.0",
    ]);
    expect(result.errors.ecr_owner).toBe(
      "ECR Owner 'missing@netlink.com' does not exist. Please select a valid user.",
    );
    expect(result.errors["partitem.0"]).toBe(
      "Row #1: Part/Item 'MISSING-ITEM' does not exist. Please select a valid item.",
    );
    expect(Object.values(result.errors).every((message) => !message.includes(", Requesting"))).toBe(true);
  });

  it("resolves display values to canonical ERPNext document names", async () => {
    mockedApiGet.mockImplementation(async (url) => {
      if (url.includes("User")) {
        return [{ name: "engineer@netlink.com", email: "engineer@netlink.com", enabled: 1 }];
      }
      if (url.includes("Department")) {
        return [{ name: "Engineering - B", department_name: "Engineering", company: "Bidsphere" }];
      }
      if (url.includes("Plant%20Floor")) {
        return [{ name: "Main Plant", floor_name: "Main Plant", company: "Bidsphere" }];
      }
      if (url.includes("Supplier")) {
        return [{ name: "SUP-APEX", supplier_name: "Apex Fasteners Ltd", disabled: 0 }];
      }
      if (url.includes("Item")) {
        return [{ name: "LAT-4401", item_code: "LAT-4401", item_name: "LAT-4401", disabled: 0 }];
      }
      return [];
    });

    const result = await validateECRMasterReferences({
      owner: "Engineer@netlink.com",
      department: "Engineering",
      plant: "Main Plant",
      supplier: "Apex Fasteners Ltd",
      parts: [{ partitem: "LAT-4401" }],
    });

    expect(result.errors).toEqual({});
    expect(result.canonical).toEqual({
      owner: "engineer@netlink.com",
      department: "Engineering - B",
      plant: "Main Plant",
      supplier: "SUP-APEX",
      parts: ["LAT-4401"],
    });
  });

  it("formats every master error independently", () => {
    expect(ecrMasterReferenceError("department", "Unknown")).toContain("valid department");
    expect(ecrMasterReferenceError("plant", "Unknown")).toContain("valid plant");
    expect(ecrMasterReferenceError("supplier", "Unknown")).toContain("valid supplier");
  });
});
