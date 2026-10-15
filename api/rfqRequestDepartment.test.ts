import { describe, expect, it, vi } from "vitest";
import { ClmError, type ClmDeps } from "./clmCore";
import { resolveInitialRequestDepartment } from "./rfqRequestDepartment";
import type { ClmRecord } from "../src/types/clm";

function fixture() {
  const rfq: ClmRecord = { name: "RFQ98", company: "Netlink", items: [{ item_code: "AP001", material_request: "MR38", material_request_item: "LINE38" }] };
  const mr: ClmRecord = { name: "MR38", company: "Bidsphere", custom_department: "Production", items: [{ name: "LINE38", item_code: "AP001" }] };
  const departments = [{ name: "Production - B", department_name: "Production", company: "Bidsphere" }, { name: "Production - N", department_name: "Production", company: "Netlink" }];
  const deps = { load: vi.fn(async (dt, name) => { const row = dt === "Material Request" && name === mr.name ? mr : departments.find(row => row.name === name); if (!row) throw new ClmError("Not found", 404); return row; }), list: vi.fn(async () => departments) } as unknown as ClmDeps;
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
});
