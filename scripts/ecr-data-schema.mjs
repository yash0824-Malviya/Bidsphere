import { EXTENDED_ECR_FIELDS, EXTENDED_ECR_STATES, appendSelectOptions } from "./ecr-extended-schema.mjs";

/** Schema only: no document rewrite, workflow migration, permission or role changes. */
export function extendEcrDataSchema(document, customFields = []) {
  if (document.name !== "Engineering Change Request" || Number(document.custom) !== 1) {
    throw new Error("Expected the existing custom Engineering Change Request DocType.");
  }
  const result = structuredClone(document);
  result.fields ??= [];
  const canonicalVersion = result.fields.find((field) => field.fieldname === "ecr_workflow_version");
  if (!canonicalVersion && [...result.fields, ...customFields].some((field) =>
    ["workflow_version", "custom_workflow_version", "custom_ecr_workflow_version"].includes(field.fieldname))) {
    throw new Error("An alternative workflow-version field exists. Reconcile the established field before adding another.");
  }
  for (const spec of EXTENDED_ECR_FIELDS) {
    let field = result.fields.find((candidate) => candidate.fieldname === spec.fieldname);
    if (!field && customFields.some((candidate) => candidate.fieldname === spec.fieldname)) {
      throw new Error(`${spec.fieldname} is already installed as a Custom Field. Do not create a duplicate native field.`);
    }
    if (!field) {
      field = { ...spec, reqd: 0 };
      result.fields.push(field);
    } else {
      if (field.fieldtype !== spec.fieldtype) throw new Error(`Unexpected type for ${spec.fieldname}: ${field.fieldtype}. No schema changes were applied.`);
      field.reqd = 0;
      field.read_only = 1;
      field.no_copy = 1;
      if (spec.allow_on_submit) field.allow_on_submit = 1;
      if (spec.options) field.options = appendSelectOptions(field.options, spec.options.split("\n"));
    }
    if (spec.fieldname === "ecr_workflow_version") {
      // Do not let adding this column classify existing rows as extended.
      if (field.default) field.default = "";
      if (field.mandatory_depends_on) field.mandatory_depends_on = "";
    }
  }
  const workflowStatus = result.fields.find((field) => field.fieldname === "select_pxfp");
  if (workflowStatus?.fieldtype !== "Select") throw new Error("The existing select_pxfp field must be a Select field.");
  for (const field of result.fields.filter((field) => ["select_pxfp", "status"].includes(field.fieldname) && field.fieldtype === "Select")) {
    // These are permitted stored values, not workflow transition definitions.
    field.options = appendSelectOptions(field.options, ["RFQ Pending", ...EXTENDED_ECR_STATES]);
  }
  return result;
}

export function assertEcrDataSchemaInstalled(document) {
  const planned = extendEcrDataSchema(document);
  for (const spec of EXTENDED_ECR_FIELDS) {
    const field = document.fields.find((candidate) => candidate.fieldname === spec.fieldname);
    if (!field || field.fieldtype !== spec.fieldtype || Number(field.reqd || 0) !== 0) throw new Error(`Optional field ${spec.fieldname} was not installed correctly.`);
    if (spec.fieldname === "ecr_workflow_version" && (field.default || field.mandatory_depends_on)) throw new Error("Workflow version must have no default or required condition.");
  }
  for (const field of planned.fields.filter((candidate) => ["select_pxfp", "status"].includes(candidate.fieldname))) {
    if (field.options !== document.fields.find((candidate) => candidate.fieldname === field.fieldname)?.options) throw new Error(`Missing allowed ECR statuses in ${field.fieldname}.`);
  }
}

/** Frappe refreshes child timestamps when saving schema; these are not access rules. */
export function ecrPermissionSettings(rows = []) {
  return rows.map(({ modified, modified_by, ...permission }) => permission);
}
