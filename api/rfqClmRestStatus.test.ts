import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeRfqClmRestContract, encodeRfqClmRestContract } from "./rfqClmRestStatus";
import { clmErpRequest, createClmDependencies, listClmErp } from "./clmErp";
import { parseClmData } from "./clmCore";
import type { ClmRecord } from "../src/types/clm";

function record(status: string, phase: string): ClmRecord {
  return { name: "CON-95", custom_rfq: "RFQ-95", custom_contract_status: status, custom_clm_data: JSON.stringify({ ...parseClmData(null), persistence: "erpnext_rest_v1", rfq_workflow: { version: 1, phase }, rfq_context: { rfq_id: "RFQ-95", contract_required: "Yes", contract_status: status } }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("REST-only RFQ Contract status transport", () => {
  it.each([
    ["Pending Legal", "legal_review", "Under Review"], ["Pending Finance", "finance_review", "Pending Signature"],
    ["Rejected", "rejected", "Draft"], ["Draft", "draft", "Draft"], ["Approved", "signature", "Approved"],
    ["Pending Signature", "signature", "Pending Signature"], ["Executed", "procurement", "Executed"], ["Active", "completed", "Active"],
    ["Expired", "completed", "Expired"], ["Terminated", "completed", "Terminated"], ["Closed", "completed", "Closed"],
    ["Under Review", "legal_review", "Under Review"],
  ])("stores %s using existing native %s with unchanged audited runtime", (status, phase, native) => {
    const canonical = record(status, phase), encoded = encodeRfqClmRestContract(canonical);
    expect(encoded.custom_contract_status).toBe(native);
    expect(encoded.custom_clm_data).toBe(canonical.custom_clm_data);
    expect(decodeRfqClmRestContract(encoded)).toEqual(canonical);
    expect(canonical.custom_contract_status).toBe(status);
  });
  it.each([["Pending Legal", "legal_review"], ["Pending Finance", "finance_review"], ["Rejected", "rejected"]])("also reads already-supported canonical native %s", (status, phase) => {
    const saved = record(status, phase);
    expect(decodeRfqClmRestContract(saved)).toEqual(saved);
  });
  it("does not change standalone or extension-backed native Contracts", () => {
    const standalone = { ...record("Pending Legal", "legal_review"), custom_rfq: "" };
    const extension = record("Pending Legal", "legal_review"), data = parseClmData(extension.custom_clm_data); delete data.persistence;
    extension.custom_clm_data = JSON.stringify(data);
    for (const saved of [standalone, extension]) {
      expect(encodeRfqClmRestContract(saved)).toBe(saved);
      expect(decodeRfqClmRestContract(saved)).toBe(saved);
    }
  });
  it.each(["Draft", "Approved", "Executed", undefined])("rejects native %s with saved Finance evidence rather than inventing a display state", native => {
    const saved = { ...record("Pending Finance", "finance_review"), custom_contract_status: native };
    expect(() => decodeRfqClmRestContract(saved)).toThrow("does not match");
  });
  it("does not synthesize an Executed status when the native field is missing", () => {
    expect(() => decodeRfqClmRestContract({ ...record("Executed", "procurement"), custom_contract_status: undefined })).toThrow("does not match");
  });
  it.each([
    ["Pending Finance", "legal_review"], ["Executed", "finance_review"], ["Pending Legal", "draft"], ["Rejected", "signature"],
  ])("rejects canonical %s inconsistent with persisted phase %s", (status, phase) => {
    expect(() => encodeRfqClmRestContract(record(status, phase))).toThrow("does not match");
    expect(() => decodeRfqClmRestContract(record(status, phase))).toThrow("does not match");
  });
  it("requires its RFQ context to match the native link", () => {
    const saved = record("Pending Legal", "legal_review"); saved.custom_rfq = "FOREIGN";
    expect(() => encodeRfqClmRestContract(saved)).toThrow("does not match");
  });
  it("preserves the existing native Finance send-back/reject transition Pending Signature to Draft", () => {
    expect(encodeRfqClmRestContract(record("Pending Finance", "finance_review")).custom_contract_status).toBe("Pending Signature");
    expect(encodeRfqClmRestContract(record("Draft", "draft")).custom_contract_status).toBe("Draft");
    expect(encodeRfqClmRestContract(record("Rejected", "rejected")).custom_contract_status).toBe("Draft");
  });
  it("maps standard Contract create, load and list traffic without modifying Contract Request responses", async () => {
    vi.stubEnv("ERPNEXT_URL", "https://rest-status.test"); vi.stubEnv("ERP_API_KEY", "fixture"); vi.stubEnv("ERP_API_SECRET", "fixture");
    const canonical = record("Pending Legal", "legal_review"), native = encodeRfqClmRestContract(canonical);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "https://rest-status.test") throw new Error("Unexpected nonfixture host");
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual(native);
        return new Response(JSON.stringify({ data: native }));
      }
      return new Response(JSON.stringify({ data: url.pathname.endsWith("/Contract") ? [native] : native }));
    });
    expect(await createClmDependencies().create("Contract", canonical)).toEqual(canonical);
    expect(await createClmDependencies().load("Contract", "CON-95")).toEqual(canonical);
    expect(await listClmErp("Contract")).toEqual([canonical]);
    expect(await clmErpRequest("GET", "resource/Contract%20Request/CR-95")).toEqual(native);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("maps the Contract save request and response with no changes to revisions or runtime bytes", async () => {
    vi.stubEnv("ERPNEXT_URL", "https://rest-status.test"); vi.stubEnv("ERP_API_KEY", "fixture"); vi.stubEnv("ERP_API_SECRET", "fixture");
    const canonical = { ...record("Pending Finance", "finance_review"), doctype: "Contract", modified: "2026-09-23 12:00:00.123456" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.doc).toEqual({ ...canonical, custom_contract_status: "Pending Signature" });
      return new Response(JSON.stringify({ message: body.doc }));
    });
    expect(await clmErpRequest("POST", "method/frappe.client.save", { doc: canonical }, { preservePayload: true })).toEqual(canonical);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
