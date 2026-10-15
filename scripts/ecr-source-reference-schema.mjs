import { ecrSchemaResource as resource, listAllEcrSchemaRows } from "./ecr-schema-erp-client.mjs";

export const ECR_SOURCE_DOCTYPE = "ECR Affected Part";
export const ECR_SOURCE_FIELD = "source_reference_type";
export const ECR_SOURCE_OPTIONAL_SETTINGS = {
  options: "\nRFQ\nPurchase Order",
  reqd: 0,
  default: "",
  mandatory_depends_on: "",
};

/** A source type alone must never be selected by the database for a manual item. */
export function optionalEcrSourceReferenceField(field) {
  if (field?.fieldname !== ECR_SOURCE_FIELD || field.fieldtype !== "Select") {
    throw new Error(`Expected ${ECR_SOURCE_DOCTYPE}.${ECR_SOURCE_FIELD} to be a Select field.`);
  }
  const choices = String(field.options ?? "").split(/\r?\n/).filter((choice) => choice.trim());
  for (const required of ["RFQ", "Purchase Order"]) if (!choices.includes(required)) choices.push(required);
  return { ...field, ...ECR_SOURCE_OPTIONAL_SETTINGS, options: ["", ...choices].join("\n") };
}

/** Compare schema settings, allowing Frappe's equivalent null/blank optional-field values. */
export function ecrSourceSchemaSettings(value) {
  if (Array.isArray(value)) return value.map(ecrSourceSchemaSettings);
  if (!value || typeof value !== "object") return value;
  const normalized = value.fieldname === ECR_SOURCE_FIELD ? {
    ...value,
    reqd: Number(value.reqd || 0),
    default: value.default ?? "",
    mandatory_depends_on: value.mandatory_depends_on ?? "",
  } : value;
  return Object.fromEntries(Object.keys(normalized).sort()
    .filter((key) => !["modified", "modified_by"].includes(key))
    .map((key) => [key, ecrSourceSchemaSettings(normalized[key])]));
}

const same = (left, right) => JSON.stringify(ecrSourceSchemaSettings(left)) === JSON.stringify(ecrSourceSchemaSettings(right));

export function planEcrSourceReferenceSchema(schema) {
  const { doctype, customFields } = schema;
  if (doctype?.name !== ECR_SOURCE_DOCTYPE || !Array.isArray(doctype.fields)) {
    throw new Error(`Expected the existing ${ECR_SOURCE_DOCTYPE} schema.`);
  }
  const nativeFields = doctype.fields.filter((field) => field.fieldname === ECR_SOURCE_FIELD);
  if (nativeFields.length > 1) throw new Error("Duplicate native source reference fields require manual inspection.");
  if (!nativeFields.length && !customFields.length) throw new Error("Source reference field is missing; run the ECR schema installer first.");
  for (const field of customFields) {
    if (field.dt !== ECR_SOURCE_DOCTYPE || field.fieldname !== ECR_SOURCE_FIELD) {
      throw new Error("Unexpected Custom Field in the source reference repair.");
    }
  }
  const nextDoctype = {
    ...doctype,
    fields: doctype.fields.map((field) => field.fieldname === ECR_SOURCE_FIELD ? optionalEcrSourceReferenceField(field) : { ...field }),
  };
  const optionalCustomFields = customFields.map(optionalEcrSourceReferenceField);
  // Frappe rejects ordinary Custom Field saves when a native field has the same
  // name. Preserve pre-existing duplicates: the application sends explicit blank
  // source fields for unreferenced items, which prevents Frappe default insertion.
  const customFieldsPreservedDueToDuplicate = nativeFields.length
    ? customFields.map((field) => field.name)
    : [];
  const nextCustomFields = customFieldsPreservedDueToDuplicate.length
    ? customFields.map((field) => ({ ...field }))
    : optionalCustomFields;
  const nativeChanged = !same(doctype, nextDoctype);
  if (nativeChanged && Number(doctype.custom) !== 1) {
    throw new Error("Refusing to modify a standard DocType through the ECR source reference repair.");
  }
  return {
    before: schema,
    after: { doctype: nextDoctype, customFields: nextCustomFields },
    nativeChanged,
    customFieldsPreservedDueToDuplicate,
    customChanges: nextCustomFields.filter((field, index) => !same(field, customFields[index])),
  };
}

export async function loadEcrSourceReferenceSchema(api) {
  const [doctype, customRows] = await Promise.all([
    api("GET", resource("DocType", ECR_SOURCE_DOCTYPE)),
    listAllEcrSchemaRows(api, "Custom Field", ["name"], [["dt", "=", ECR_SOURCE_DOCTYPE], ["fieldname", "=", ECR_SOURCE_FIELD]]),
  ]);
  const customFields = await Promise.all(customRows.map((row) => api("GET", resource("Custom Field", row.name))));
  return { doctype, customFields };
}

/** Only these two definitions of the same optional child field may be changed. */
export async function applyEcrSourceReferenceSchemaPlan(api, plan) {
  if (plan.nativeChanged) {
    await api("POST", "method/frappe.client.save", { doc: plan.after.doctype });
  }
  for (const field of plan.customChanges) {
    await api("PUT", resource("Custom Field", field.name), {
      ...Object.fromEntries(Object.keys(ECR_SOURCE_OPTIONAL_SETTINGS).map((key) => [key, field[key]])),
      modified: field.modified,
    });
  }
}

export function assertEcrSourceReferenceSchemaApplied(plan, installed) {
  if (!same(plan.after, installed)) {
    throw new Error("Source reference schema differs from the targeted repair. Inspect the saved schema backup.");
  }
}

/** Both installers use safe optional defaults and preserve pre-existing duplicate metadata. */
export async function ensureOptionalEcrSourceReferenceSchema(api) {
  const plan = planEcrSourceReferenceSchema(await loadEcrSourceReferenceSchema(api));
  await applyEcrSourceReferenceSchemaPlan(api, plan);
  assertEcrSourceReferenceSchemaApplied(plan, await loadEcrSourceReferenceSchema(api));
  return {
    nativeChanged: plan.nativeChanged,
    customFieldsChanged: plan.customChanges.length,
    customFieldsPreservedDueToDuplicate: plan.customFieldsPreservedDueToDuplicate,
  };
}
