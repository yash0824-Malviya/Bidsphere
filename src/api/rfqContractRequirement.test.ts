import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RFQ } from "../types/erpnext";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./erpnext", () => ({ apiGet: mocks.get, buildResourceUrl: (doctype: string, name: string) => `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}` }));
import { contractRequirementForCreate, savedRfqFromClmRoutingError, validateRfqContractRequestDepartment, verifyCreatedRfqContractRequirement } from "./rfqContractRequirement";
const created = { name: "RFQ-1", items: [], suppliers: [], transaction_date: "2026-09-17" } as RFQ;

describe("RFQ Contract Requirement persistence", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("defaults only omitted inputs to No", () => {
    expect(contractRequirementForCreate(undefined)).toBe("No");
    expect(contractRequirementForCreate("Yes")).toBe("Yes"); expect(contractRequirementForCreate("No")).toBe("No");
  });
  it.each([[true, "Yes"], [false, "No"]] as const)("normalizes boolean %s to the ERP Select value %s", (input, expected) => {
    expect(contractRequirementForCreate(input)).toBe(expected);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each([null, "", "yes", "no", "true", "false", 1, 0, "Yes "])("rejects explicit unsupported value %j", value => {
    expect(() => contractRequirementForCreate(value)).toThrow("must be Yes or No");
  });
  it.each(["Yes", "No"] as const)("re-fetches the created RFQ and confirms %s without a field-restricted list query", async required => {
    mocks.get.mockResolvedValue({ ...created, contract_required: required });
    expect(await verifyCreatedRfqContractRequirement(created, required)).toMatchObject({ name: "RFQ-1", contract_required: required });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("/api/resource/Request%20for%20Quotation/RFQ-1");
  });
  it.each([{}, { contract_required: "No" }, { contract_required: "Yes", name: "RFQ-other" }])("retains the existing RFQ identity on a persistence mismatch", async values => {
    mocks.get.mockResolvedValue({ ...created, ...values });
    const result = await verifyCreatedRfqContractRequirement(created, "Yes");
    expect(result.name).toBe("RFQ-1"); expect(result.items).toEqual(created.items);
    expect(result.contractRequirementWarning).toContain("was created");
  });
  it("retains the created identity when verification cannot reach ERPNext", async () => {
    mocks.get.mockRejectedValue(new Error("Network unavailable"));
    await expect(verifyCreatedRfqContractRequirement(created, "No")).resolves.toMatchObject({ name: "RFQ-1", contractRequirementWarning: expect.stringContaining("could not be verified") });
  });
  it("retains a confirmed insert and its request failure after successful RFQ verification", async () => {
    const error = { response: { data: { code: "RFQ_CLM_REQUEST_NOT_ROUTED", saved_rfq: created, message: "RFQ saved, request permission denied." } } };
    const saved = savedRfqFromClmRoutingError(error)!;
    mocks.get.mockResolvedValue({ ...created, contract_required: "Yes" });
    expect(await verifyCreatedRfqContractRequirement(saved, "Yes")).toEqual({ ...created, contract_required: "Yes", contractRequirementWarning: error.response.data.message });
  });
  it("does not recover an unconfirmed RFQ insert or generic upstream error", () => {
    expect(savedRfqFromClmRoutingError(new Error("Network failed"))).toBeUndefined();
    expect(savedRfqFromClmRoutingError({ response: { data: { saved_rfq: created } } })).toBeUndefined();
    expect(savedRfqFromClmRoutingError({ response: { data: { code: "RFQ_CLM_REQUEST_NOT_ROUTED", saved_rfq: {} } } })).toBeUndefined();
  });
});

describe("RFQ initial Contract Request department selection", () => {
  const input = { contractRequired: "Yes" as const, selectedDepartment: "Production - N", company: "Netlink" };
  beforeEach(() => { vi.clearAllMocks(); });
  it("requires a selected department only for Yes without an inherited department", async () => {
    await expect(validateRfqContractRequestDepartment({ ...input, selectedDepartment: " " })).rejects.toThrow("Select a Department");
    await expect(validateRfqContractRequestDepartment({ ...input, contractRequired: "No", selectedDepartment: "" })).resolves.toBeUndefined();
    await expect(validateRfqContractRequestDepartment({ ...input, inheritedDepartment: "Engineering", selectedDepartment: "" })).resolves.toBeUndefined();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("verifies the real Department and preserves its canonical ID", async () => {
    mocks.get.mockResolvedValue({ name: "Production - N", company: "Netlink", disabled: 0 });
    await expect(validateRfqContractRequestDepartment({ ...input, selectedDepartment: " Production - N " })).resolves.toBe("Production - N");
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("/api/resource/Department/Production%20-%20N");
  });
  it.each([
    [{ name: "Something else" }, "existing Department"],
    [{ name: "Production - N", disabled: 1 }, "active Department"],
    [{ name: "Production - N", company: "Other Company" }, "belonging to Netlink"],
  ])("rejects an unusable Department %j", async (department, message) => {
    mocks.get.mockResolvedValue(department);
    await expect(validateRfqContractRequestDepartment(input)).rejects.toThrow(message as string);
  });
  it("preserves the real lookup failure without substituting a department", async () => {
    const denied = new Error("Department read denied"); mocks.get.mockRejectedValue(denied);
    await expect(validateRfqContractRequestDepartment(input)).rejects.toBe(denied);
  });
});
