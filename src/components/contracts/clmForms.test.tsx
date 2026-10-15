import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isError: false }) }));
vi.mock("../../api/legalDocsStorage", () => ({ uploadFileToERPNextDetailed: vi.fn() }));
import ClmFields, { clmFormPayload, editableClmFields, fieldLabel } from "./ClmFields";
import ClmActionPanel from "./ClmActionPanel";
import ClmMatrixFields from "./ClmMatrixFields";
import ClmDocuments from "./ClmDocuments";
import type { ClmField } from "../../api/clm";

describe("CLM forms preserve schema and assigned actions", () => {
  it("keeps existing custom fieldnames and filters managed evidence from update payloads", () => {
    const fields: ClmField[] = [{ fieldname: "custom_contract_type", label: "Contract Type", fieldtype: "Select", options: "NDA\nSCA" }, { fieldname: "custom_current_version", fieldtype: "Data" }, { fieldname: "custom_clm_data", fieldtype: "JSON" }];
    const result = clmFormPayload(fields, "Contract", { name: "CON-1", custom_contract_type: "NDA", custom_current_version: "2.0", custom_clm_data: "tamper", party_name: "SUP-1" }, ["custom_contract_type", "party_name"]);
    expect(result).toEqual({ custom_contract_type: "NDA", party_name: "SUP-1" });
    expect(editableClmFields(fields, "Contract").map(field => field.fieldname)).toEqual(["custom_contract_type"]);
  });
  it("uses the existing obligation owne field while showing a readable label", () => {
    const field = { fieldname: "owne", label: "Owne", fieldtype: "Link", options: "User", reqd: 1 };
    expect(fieldLabel(field)).toBe("Owner");
    expect(clmFormPayload([field], "Contract Obligation", { owne: "owner@example.test", owner: "system@example.test" })).toEqual({ owne: "owner@example.test" });
    const html = renderToStaticMarkup(<ClmFields fields={[field]} doctype="Contract Obligation" values={{ owne: "owner@example.test" }} onChange={() => undefined} />);
    expect(html).toContain("Owner *"); expect(html).toContain("owner@example.test"); expect(html).not.toContain("Owne *");
  });
  it("renders exact configured Select values without inventing statuses or thresholds", () => {
    const html = renderToStaticMarkup(<ClmFields fields={[{ fieldname: "custom_contract_type", label: "Contract Type", fieldtype: "Select", options: "NDA\nTooling Agreement", reqd: 1 }, { fieldname: "minimum_contract_value", label: "Minimum Contract Value", fieldtype: "Currency" }]} doctype="Contract Approval Matrix" values={{ custom_contract_type: "NDA", minimum_contract_value: 45000 }} onChange={() => undefined} />);
    expect(html).toContain("Tooling Agreement"); expect(html).toContain('value="45000"'); expect(html).not.toContain("Completed");
  });
  it("does not render workflow actions when the server grants none", () => {
    expect(renderToStaticMarkup(<ClmActionPanel actions={[]} busy={false} onAction={async () => undefined} />)).toBe("");
  });
  it("only renders actions supplied for the current assigned approver", () => {
    const html = renderToStaticMarkup(<ClmActionPanel actions={[{ action: "approve", label: "Approve" }, { action: "send_back", label: "Send Back", requires_comment: true }]} busy={false} onAction={async () => undefined} />);
    expect(html).toContain("Approve"); expect(html).toContain("Send Back"); expect(html).not.toContain("Reject"); expect(html).not.toContain("Sign Contract");
  });
  it("does not expose buyer approval actions to supplier-only action sets", () => {
    const html = renderToStaticMarkup(<ClmActionPanel actions={[{ action: "supplier_accept", label: "Accept Contract" }, { action: "supplier_redline", label: "Submit Redline", requires_comment: true }]} busy={false} onAction={async () => undefined} />);
    expect(html).toContain("Accept Contract"); expect(html).toContain("Submit Redline"); expect(html).not.toContain(">Approve<");
  });
  it("supports configured hybrid approval stages without creating new roles", () => {
    const html = renderToStaticMarkup(<ClmMatrixFields values={{ custom_conditions: JSON.stringify({ business_unit: "Manufacturing", new_supplier: true }), custom_approval_stages: JSON.stringify([{ role: "procurement", stage: 1 }, { role: "finance", stage: 2 }, { role: "legal", stage: 2 }]) }} onChange={() => undefined} />);
    expect(html).toContain("Manufacturing"); expect(html).toContain("Finance Manager"); expect(html).toContain("same stage number act in parallel"); expect(html).not.toContain("CCB"); expect(html).not.toContain("Implementation Team");
  });
  it("never renders saved HTML as executable markup", () => {
    const html = renderToStaticMarkup(<ClmFields fields={[{ fieldname: "contract_terms", label: "Contract Terms", fieldtype: "Text Editor" }]} doctype="Contract" values={{ contract_terms: '<img src=x onerror="alert(1)">' }} onChange={() => undefined} />);
    expect(html).not.toContain("<img"); expect(html).toContain("&lt;img");
  });
  it("shows verified supplier supporting documents with preview and download controls", () => {
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={{ name: "CON-1" }} fields={[]} supportingDocuments={[{ file_id: "FILE-1", file_url: "/private/files/proposal.pdf", file_name: "Supplier proposed terms.pdf", by: "supplier@example.test", at: "2026-09-17 12:00:00", version: "1.2" }]} />);
    expect(html).toContain("Supplier proposed terms.pdf"); expect(html).toContain("supplier@example.test"); expect(html).toContain("Version 1.2"); expect(html).toContain("Preview"); expect(html).toContain("Download");
    expect(html).not.toContain('href="/private/files');
  });
  it("shows persisted supplier and Legal signature PDF receipts through existing document controls", () => {
    const signatures = (["supplier", "inteva"] as const).map(party => ({ party, role: party === "inteva" ? "legal" : undefined, typed_name: `${party} signer`, by: `${party}@example.test`, at: "2026-09-28 10:00:00", version: "1.0", file_id: `${party}-FILE`, file_url: `/private/files/${party}.pdf`, hash: "a".repeat(64) }));
    const html = renderToStaticMarkup(<ClmDocuments doctype="Contract" record={{ name: "CON-1" }} fields={[]} signatures={signatures} />);
    expect(html).toContain("Signed Contract — Supplier"); expect(html).toContain("Signed Contract — Legal Manager"); expect(html).toContain("CON-1-inteva-signed.pdf"); expect(html).toContain("Version:"); expect(html).toContain("1.0"); expect(html).toContain("Signed By:"); expect(html).not.toContain('src="/private/files');
  });
});
