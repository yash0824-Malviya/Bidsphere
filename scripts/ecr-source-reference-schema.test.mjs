import { describe, expect, it, vi } from "vitest";
import {
  ECR_SOURCE_DOCTYPE,
  ECR_SOURCE_FIELD,
  applyEcrSourceReferenceSchemaPlan,
  assertEcrSourceReferenceSchemaApplied,
  ensureOptionalEcrSourceReferenceSchema,
  optionalEcrSourceReferenceField,
  planEcrSourceReferenceSchema,
} from "./ecr-source-reference-schema.mjs";

function schema() {
  return {
    doctype: {
      name: ECR_SOURCE_DOCTYPE, custom: 1, istable: 1,
      fields: [
        { name: "native-source", fieldname: ECR_SOURCE_FIELD, fieldtype: "Select", options: "RFQ\nPurchase Order", reqd: 0, default: null, hidden: 1, allow_on_submit: 1 },
        { name: "native-supplier", fieldname: "current_supplier", fieldtype: "Link", options: "Supplier", allow_on_submit: 1 },
      ],
      permissions: [{ role: "Engineer", read: 1, write: 0 }],
    },
    customFields: [{ name: `${ECR_SOURCE_DOCTYPE}-${ECR_SOURCE_FIELD}`, dt: ECR_SOURCE_DOCTYPE, fieldname: ECR_SOURCE_FIELD, fieldtype: "Select", options: "RFQ\nPurchase Order", reqd: 0, default: null, hidden: 1 }],
  };
}

describe("optional ECR procurement source schema", () => {
  it("repairs native choices and preserves a pre-existing duplicate Custom Field", () => {
    const before = schema();
    const plan = planEcrSourceReferenceSchema(before);
    expect(plan.nativeChanged).toBe(true);
    expect(plan.customChanges).toEqual([]);
    expect(plan.customFieldsPreservedDueToDuplicate).toEqual([before.customFields[0].name]);
    expect(plan.after.doctype.fields[0]).toMatchObject({ options: "\nRFQ\nPurchase Order", reqd: 0, default: "", mandatory_depends_on: "", hidden: 1 });
    expect(plan.after.customFields).toEqual(before.customFields);
    expect(before.doctype.fields[0].options).toBe("RFQ\nPurchase Order");
    expect(plan.after.doctype.fields[1]).toEqual(before.doctype.fields[1]);
    expect(plan.after.doctype.permissions).toEqual(before.doctype.permissions);
    expect(plan.after.doctype.fields[0].allow_on_submit).toBe(1);
  });

  it("retains historical choices and clears unsafe default and required rules", () => {
    const field = optionalEcrSourceReferenceField({ fieldname: ECR_SOURCE_FIELD, fieldtype: "Select", options: "RFQ\nHistorical Source\n\nPurchase Order", default: "RFQ", reqd: 1, mandatory_depends_on: "eval:doc.current_supplier" });
    expect(field).toMatchObject({ options: "\nRFQ\nHistorical Source\nPurchase Order", default: "", reqd: 0, mandatory_depends_on: "" });
  });

  it("is idempotent with either blank or null persisted optional metadata", () => {
    const corrected = planEcrSourceReferenceSchema(schema()).after;
    corrected.doctype.fields[0].default = null;
    corrected.customFields[0].mandatory_depends_on = null;
    const plan = planEcrSourceReferenceSchema(corrected);
    expect(plan.nativeChanged).toBe(false);
    expect(plan.customChanges).toEqual([]);
    expect(() => assertEcrSourceReferenceSchemaApplied(plan, corrected)).not.toThrow();
  });

  it("allows existing Custom Field-only installations without introducing a duplicate", () => {
    const before = schema();
    before.doctype.fields.shift();
    const plan = planEcrSourceReferenceSchema(before);
    expect(plan.nativeChanged).toBe(false);
    expect(plan.after.doctype.fields).toHaveLength(1);
    expect(plan.customChanges).toHaveLength(1);
    expect(plan.customFieldsPreservedDueToDuplicate).toEqual([]);
    expect(plan.after.customFields[0]).toMatchObject({ options: "\nRFQ\nPurchase Order", reqd: 0, default: "", mandatory_depends_on: "" });
  });

  it("refuses wrong field types and unexpected schema targets", () => {
    const before = schema(); before.doctype.fields[0].fieldtype = "Link";
    expect(() => planEcrSourceReferenceSchema(before)).toThrow("Select field");
    const wrongCustom = schema(); wrongCustom.customFields[0].dt = "Supplier";
    expect(() => planEcrSourceReferenceSchema(wrongCustom)).toThrow("Unexpected Custom Field");
    const wrongDoctype = schema(); wrongDoctype.doctype.custom = 0;
    expect(() => planEcrSourceReferenceSchema(wrongDoctype)).toThrow("standard DocType");
  });

  it("writes only the existing child DocType when Custom Field saves would fail on a duplicate", async () => {
    const api = vi.fn().mockResolvedValue({});
    const plan = planEcrSourceReferenceSchema(schema());
    await applyEcrSourceReferenceSchemaPlan(api, plan);
    expect(api.mock.calls).toEqual([
      ["POST", "method/frappe.client.save", { doc: plan.after.doctype }],
    ]);
  });

  it("updates optional Custom Field metadata when no native duplicate exists", async () => {
    const api = vi.fn().mockResolvedValue({});
    const before = schema(); before.doctype.fields.shift();
    await applyEcrSourceReferenceSchemaPlan(api, planEcrSourceReferenceSchema(before));
    expect(api.mock.calls).toEqual([
      ["PUT", "resource/Custom%20Field/ECR%20Affected%20Part-source_reference_type", {
        options: "\nRFQ\nPurchase Order", reqd: 0, default: "", mandatory_depends_on: "", modified: undefined,
      }],
    ]);
  });

  it("detects unrelated permission/schema changes while tolerating server audit timestamps", () => {
    const plan = planEcrSourceReferenceSchema(schema());
    const installed = structuredClone(plan.after);
    installed.doctype.fields[1].modified = "new audit timestamp";
    expect(() => assertEcrSourceReferenceSchemaApplied(plan, installed)).not.toThrow();
    installed.doctype.permissions[0].write = 1;
    expect(() => assertEcrSourceReferenceSchemaApplied(plan, installed)).toThrow("differs from the targeted repair");
  });

  it.each(["duplicate", "custom-only"])("shared installer handles %s schema and makes no writes on rerun", async (installation) => {
    const stored = schema();
    const duplicate = installation === "duplicate";
    if (!duplicate) stored.doctype.fields.shift();
    const api = vi.fn(async (method, path, body) => {
      if (method === "GET" && path.startsWith("resource/DocType/")) return structuredClone(stored.doctype);
      if (method === "GET" && path.startsWith("resource/Custom%20Field?")) return [{ name: stored.customFields[0].name }];
      if (method === "GET" && path.startsWith("resource/Custom%20Field/")) return structuredClone(stored.customFields[0]);
      if (method === "POST") stored.doctype = structuredClone(body.doc);
      if (method === "PUT") Object.assign(stored.customFields[0], body);
      return {};
    });
    const customFieldsPreservedDueToDuplicate = duplicate ? [stored.customFields[0].name] : [];
    expect(await ensureOptionalEcrSourceReferenceSchema(api)).toEqual({ nativeChanged: duplicate, customFieldsChanged: duplicate ? 0 : 1, customFieldsPreservedDueToDuplicate });
    if (duplicate) expect(api.mock.calls.some(([method]) => method === "PUT")).toBe(false);
    api.mockClear();
    expect(await ensureOptionalEcrSourceReferenceSchema(api)).toEqual({ nativeChanged: false, customFieldsChanged: 0, customFieldsPreservedDueToDuplicate });
    expect(api.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
});
