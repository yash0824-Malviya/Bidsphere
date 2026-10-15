import { afterEach, describe, expect, it, vi } from "vitest";
import { logRfqClmDiagnostic, rfqClmErrorDiagnostic, rfqClmRequestDiagnostic } from "./rfqClmDiagnostics";

describe("RFQ CLM opt-in server diagnostics", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it.each(["", "0", "false", "off"])("logs nothing with RFQ_CLM_DEBUG=%j", flag => {
    vi.stubEnv("RFQ_CLM_DEBUG", flag); const log = vi.spyOn(console, "info").mockImplementation(() => {});
    logRfqClmDiagnostic("rfq_saved", { rfq_id: "RFQ-98", contract_required: "Yes" });
    expect(log).not.toHaveBeenCalled();
  });
  it("allowlists structural details without logging documents, error text, identities or financial values", () => {
    vi.stubEnv("RFQ_CLM_DEBUG", "true"); const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const record = { name: "CR-98", custom_rfq: "RFQ-98", department: "Production - N", requester: "private@example.test", supplier: "SUP-PRIVATE", description: "PRIVATE-DESCRIPTION", contract_purpose: "PRIVATE-PURPOSE", contract_value: 99123, contract_start_date: "2026-09-24", custom_clm_data: JSON.stringify({ rfq_source: { contract_required: true }, rfq_request_workflow: { phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" }, source_documents: [{ url: "/private/files/SECRET.pdf" }] }) };
    logRfqClmDiagnostic("request_payload", { ...rfqClmRequestDiagnostic(record), authorization: "token PRIVATE-KEY", payload: record, response: record, error_message: "SECRET-ERROR" });
    const details = log.mock.calls[0][1];
    expect(details).toMatchObject({ event: "request_payload", rfq_id: "RFQ-98", request_id: "CR-98", department_id: "Production - N", contract_required: true, assigned_role: "procurement_team", current_stage: "Procurement", status: "Pending", has_supplier: true, has_award: false, has_requester: true, has_contract_start_date: true });
    expect(details).toHaveProperty("payload_fields", expect.arrayContaining(["description", "contract_value"]));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|99123|SECRET|private@example|2026-09-24/);
  });
  it("sanitizes line breaks, unknown error names and unsafe field names", () => {
    vi.stubEnv("RFQ_CLM_DEBUG", "1"); const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = Object.assign(new Error("DO-NOT-LOG"), { name: "secret-in-name", status: 503 });
    logRfqClmDiagnostic("routing_failed", { rfq_id: "RFQ-98\nFORGED", ...rfqClmErrorDiagnostic(error), missing_fields: ["supplier", "secret\nvalue"] });
    expect(log).toHaveBeenCalledWith("[rfq-clm]", { event: "routing_failed", error_name: "UnknownError", error_status: 503, missing_fields: ["supplier"] });
  });
  it("does not let a logging failure change business processing", () => {
    vi.stubEnv("RFQ_CLM_DEBUG", "on"); vi.spyOn(console, "info").mockImplementation(() => { throw new Error("Log sink unavailable"); });
    expect(() => logRfqClmDiagnostic("rfq_saved", { rfq_id: "RFQ-98" })).not.toThrow();
  });
});
