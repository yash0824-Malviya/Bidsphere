import { describe, expect, it, vi } from "vitest";
import { ClmError, type ClmDeps } from "./clmCore";
import { resolveInitialRequestDepartment } from "./rfqRequestDepartment";
import type { ClmRecord } from "../src/types/clm";

function fixture() {
  const rfq: ClmRecord = { name: "RFQ98", company: "Netlink", items: [{ item_code: "AP001", material_request: "MR38", material_request_item: "LINE38" }] };
  const mr: ClmRecord = { name: "MR38", company: "Bidsphere", custom_department: "Production", items: [{ name: "LINE38", item_code: "AP001" }] };
  const departments = [{ name: "Production - B", department_name: "Production", company: "Bidsphere" }, { name: "Production - N", department_name: "Production", company: "Netlink" }];
  const deps = { load: vi.fn(async (dt, name) => { const row = dt === "Material Request" && name === mr.name ? mr : departments.find(row => row.name === name); if (!row) throw new ClmError("Not found", 404); return row; }), list: vi.fn(async (_dt, filters) => {
    if (filters?.[0]?.[0] === "department_name") {
      const val = filters[0][2];
      return departments.filter(d => d.department_name === val);
    }
    return departments;
  }) } as unknown as ClmDeps;
  return { rfq, mr, departments, deps, run: () => resolveInitialRequestDepartment(rfq, deps) };
}
describe("initial RFQ Contract Request Department", () => {
  it("resolves the linked MR label in the RFQ company without needing an award", async () => { const m = fixture(); expect(await m.run()).toBe("Production - N"); });
  it("copies a valid direct RFQ Department without reading MR", async () => { const m = fixture(); m.rfq.custom_department = "Production - N"; expect(await m.run()).toBe("Production - N"); expect(m.deps.load).not.toHaveBeenCalledWith("Material Request", "MR38"); });
  it("does not carry a source company's Department Link into the RFQ company", async () => { const m = fixture(); m.mr.custom_department = "Production - B"; expect(await m.run()).toBe("Production - N"); });
  it("rejects a source item that does not belong to its MR", async () => { const m = fixture(); m.mr.items = [{ name: "OTHER", item_code: "AP001" }]; await expect(m.run()).rejects.toThrow("does not belong"); });
  it("rejects cancelled source data", async () => { const m = fixture(); m.mr.docstatus = 2; await expect(m.run()).rejects.toThrow("cancelled Material Request"); });
  it("rejects missing Department instead of defaulting one", async () => { const m = fixture(); m.mr.custom_department = ""; await expect(m.run()).rejects.toThrow("Department is required"); });
  it("rejects ambiguous target departments", async () => { const m = fixture(); m.departments.push({ name: "Production Other - N", department_name: "Production", company: "Netlink" }); await expect(m.run()).rejects.toThrow("one active Department"); });
  it("normalizes equivalent department labels and IDs across linked Material Requests", async () => {
    const m = fixture(), load = m.deps.load;
    (m.rfq.items as ClmRecord[]).push({ item_code: "AP001", material_request: "MR39", material_request_item: "LINE39" });
    m.deps.load = vi.fn((dt, name) => dt === "Material Request" && name === "MR39" ? Promise.resolve({ name: "MR39", department: "Production - N", items: [{ name: "LINE39", item_code: "AP001" }] }) : load(dt, name));
    expect(await m.run()).toBe("Production - N");
  });
  it("resolves Department from shortfall origin MR when linked MR lacks direct department", async () => {
    const m = fixture(), load = m.deps.load;
    m.mr.custom_department = "";
    m.mr.items = [{ name: "LINE38", item_code: "AP001", description: "Widget [Shortfall from MR-ORIGIN]" }];
    const originMr: ClmRecord = { name: "MR-ORIGIN", company: "Netlink", custom_department: "Production", docstatus: 1 };
    m.deps.load = vi.fn((dt, name) => {
      if (dt === "Material Request" && name === "MR-ORIGIN") return Promise.resolve(originMr);
      return load(dt, name);
    });
    expect(await m.run()).toBe("Production - N");
  });
  it("rejects cancelled origin Material Request referenced in shortfall", async () => {
    const m = fixture(), load = m.deps.load;
    m.mr.custom_department = "";
    m.mr.items = [{ name: "LINE38", item_code: "AP001", description: "Widget [Shortfall from MR-CANCELLED]" }];
    const originMr: ClmRecord = { name: "MR-CANCELLED", company: "Netlink", custom_department: "Production", docstatus: 2 };
    m.deps.load = vi.fn((dt, name) => {
      if (dt === "Material Request" && name === "MR-CANCELLED") return Promise.resolve(originMr);
      return load(dt, name);
    });
    await expect(m.run()).rejects.toThrow("cancelled Material Request");
  });
  it("rejects missing department when both linked MR and shortfall origin MR lack department", async () => {
    const m = fixture(), load = m.deps.load;
    m.mr.custom_department = "";
    m.mr.items = [{ name: "LINE38", item_code: "AP001", description: "Widget [Shortfall from MR-NODEP]" }];
    const originMr: ClmRecord = { name: "MR-NODEP", company: "Netlink", custom_department: "", docstatus: 1 };
    m.deps.load = vi.fn((dt, name) => {
      if (dt === "Material Request" && name === "MR-NODEP") return Promise.resolve(originMr);
      return load(dt, name);
    });
    await expect(m.run()).rejects.toThrow("Department is required");
  });
  it("resolves Department from originating ECR when RFQ and MR lack department", async () => {
    const m = fixture();
    m.rfq.items = [{ item_code: "AP001" }]; // No MR link
    m.rfq.custom_ecr_reference = "ECR-100";
    const ecr: ClmRecord = { name: "ECR-100", company: "Netlink", department: "Engineering - N", docstatus: 1 };
    m.departments.push({ name: "Engineering - N", department_name: "Engineering", company: "Netlink" });
    const load = m.deps.load;
    m.deps.load = vi.fn(async (dt, name) => {
      if (dt === "Engineering Change Request" && name === "ECR-100") return ecr;
      return load(dt, name);
    });
    expect(await m.run()).toBe("Engineering - N");
  });
  it("resolves Department from originating Business Case when RFQ and MR lack department", async () => {
    const m = fixture();
    m.rfq.items = [{ item_code: "AP001" }]; // No MR link
    m.rfq.custom_business_case_id = "BC-001";
    const bc: ClmRecord = { name: "BC-001", company: "Netlink", department: "Accounts - N", docstatus: 1 };
    m.departments.push({ name: "Accounts - N", department_name: "Accounts", company: "Netlink" });
    const load = m.deps.load;
    m.deps.load = vi.fn(async (dt, name) => {
      if (dt === "Business Case" && name === "BC-001") return bc;
      return load(dt, name);
    });
    expect(await m.run()).toBe("Accounts - N");
  });
  it("resolves Department from originating Purchase Requisition when RFQ and MR lack department", async () => {
    const m = fixture();
    m.rfq.items = [{ item_code: "AP001" }]; // No MR link
    m.rfq.custom_purchase_requisition = "PR-001";
    const pr: ClmRecord = { name: "PR-001", company: "Netlink", requesting_department: "Operations - N", docstatus: 1 };
    m.departments.push({ name: "Operations - N", department_name: "Operations", company: "Netlink" });
    const load = m.deps.load;
    m.deps.load = vi.fn(async (dt, name) => {
      if (dt === "Purchase Requisition" && name === "PR-001") return pr;
      return load(dt, name);
    });
    expect(await m.run()).toBe("Operations - N");
  });
  it("rejects conflicting departments with actionable error instead of guessing", async () => {
    const m = fixture(), load = m.deps.load;
    m.departments.push({ name: "Engineering - N", department_name: "Engineering", company: "Netlink" });
    (m.rfq.items as ClmRecord[]).push({ item_code: "AP002", material_request: "MR-ENG", material_request_item: "LINE-ENG" });
    m.deps.load = vi.fn(async (dt, name) => {
      if (dt === "Material Request" && name === "MR-ENG") {
        return { name: "MR-ENG", company: "Netlink", department: "Engineering - N", items: [{ name: "LINE-ENG", item_code: "AP002" }] };
      }
      return load(dt, name);
    });
    await expect(m.run()).rejects.toThrow(/Multiple conflicting requesting Departments identified/);
  });
  it("resolves Production department from Raw Materials Procurement template and item master", async () => {
    const m = fixture();
    m.rfq.message_for_supplier = "Title: Raw Materials Procurement\nValid Till: 2026-10-20";
    (m.rfq.items as ClmRecord[])[0] = { item_code: "DIR-ALU-001", qty: 10 };
    const load = m.deps.load;
    m.deps.load = vi.fn(async (dt, name) => {
      if (dt === "Item" && name === "DIR-ALU-001") {
        return { name: "DIR-ALU-001", custom_procurement_category: "Raw Material", custom_procurement_type: "Direct", include_item_in_manufacturing: 1 };
      }
      return load(dt, name);
    });
    expect(await m.run()).toBe("Production - N");
  });
});
