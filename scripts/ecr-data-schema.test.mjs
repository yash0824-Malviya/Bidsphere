import { describe, expect, it } from "vitest";
import { extendEcrDataSchema, assertEcrDataSchemaInstalled, ecrPermissionSettings } from "./ecr-data-schema.mjs";
const baseline = () => ({ name: "Engineering Change Request", custom: 1, autoname: "ECR-.YYYY.-.#####", permissions: [{ role: "Engineer", read: 1, write: 0 }], fields: [{ fieldname: "select_pxfp", fieldtype: "Select", options: "Draft\nEngineering Review\nProcurement Review\nRFQ\nHistorical Status", default: "Draft" }, { fieldname: "custom_existing", fieldtype: "Data", reqd: 1 }] });
describe("ECR schema-only repair", () => {
  it("adds all four optional fields without altering existing permissions, naming or fields", () => {
    const original = baseline(); const result = extendEcrDataSchema(original);
    expect(original.fields).toHaveLength(2);
    expect(result.permissions).toEqual(original.permissions); expect(result.autoname).toBe(original.autoname);
    expect(result.fields.find((field) => field.fieldname === "custom_existing")).toEqual(original.fields[1]);
    for (const name of ["ecr_workflow_version", "ecr_business_case", "rfq_required", "rfq_decision_reason"]) expect(result.fields.find((field) => field.fieldname === name)).toMatchObject({ reqd: 0, read_only: 1, no_copy: 1 });
    expect(result.fields.find((field) => field.fieldname === "ecr_workflow_version").default).toBeUndefined();
    expect(() => assertEcrDataSchemaInstalled(result)).not.toThrow();
  });
  it("retains every previous status and appends permitted legacy/extended values", () => {
    const result = extendEcrDataSchema(baseline());
    expect(result.fields[0].options.split("\n")).toEqual(expect.arrayContaining(["Historical Status", "Draft", "RFQ Pending", "Technical Approved", "Procurement Decision"]));
    expect(result.fields[0].default).toBe("Draft");
  });
  it("is idempotent and clears unsafe required/default version metadata", () => {
    const document = extendEcrDataSchema(baseline());
    expect(extendEcrDataSchema(document)).toEqual(document);
    const version = document.fields.find((field) => field.fieldname === "ecr_workflow_version"); Object.assign(version, { reqd: 1, default: "extended_v1", mandatory_depends_on: "eval:1" });
    expect(extendEcrDataSchema(document).fields.find((field) => field.fieldname === version.fieldname)).toMatchObject({ reqd: 0, default: "", mandatory_depends_on: "" });
  });
  it("refuses duplicate alternatives, Custom Fields and incompatible field types", () => {
    const document = baseline(); document.fields.push({ fieldname: "workflow_version", fieldtype: "Data" });
    expect(() => extendEcrDataSchema(document)).toThrow("alternative workflow-version");
    expect(() => extendEcrDataSchema(baseline(), [{ fieldname: "ecr_workflow_version" }])).toThrow("duplicate");
    const incompatible = baseline(); incompatible.fields.push({ fieldname: "ecr_workflow_version", fieldtype: "Int" });
    expect(() => extendEcrDataSchema(incompatible)).toThrow("Unexpected type");
  });
  it("compares actual permissions independently of Frappe child timestamps", () => {
    const before = [{ role: "Engineer", read: 1, write: 0, modified: "old" }];
    expect(ecrPermissionSettings([{ ...before[0], modified: "new" }])).toEqual(ecrPermissionSettings(before));
    expect(ecrPermissionSettings([{ ...before[0], write: 1 }])).not.toEqual(ecrPermissionSettings(before));
  });
});
