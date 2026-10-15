import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clmEditableFields, clmSnapshotHash } from "../../../api/clmCore";

const fixtures = JSON.parse(readFileSync(new URL("./contract-hashes.json", import.meta.url), "utf8"));
describe("ERP and gateway share the same approved Contract hash", () => {
  it("keeps the ERP snapshot field vocabulary aligned with the gateway", () => {
    const python = readFileSync(new URL("../bidsphere_workflows/rfq_clm.py", import.meta.url), "utf8");
    const fields = python.match(/_CONTRACT_FIELDS = "([^"]+)"\.split\(\)/)![1].split(" ");
    expect(fields).toEqual(clmEditableFields("Contract").filter(field => !["clause_ids", "non_standard_clause"].includes(field)));
  });
  for (const fixture of fixtures) it(fixture.name, () => {
    const data = { schema: 1, approvals: [], versions: [], audit: [], signatures: [], sla: [], ...fixture.runtime };
    expect(clmSnapshotHash("Contract", { ...fixture.record, custom_clm_data: JSON.stringify(data) })).toBe(fixture.locked_hash);
  });
});
