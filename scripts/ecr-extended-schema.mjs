/** Additive schema contract; never sets a default version on historical ECRs. */
export const EXTENDED_VERSION = "extended_v1";
export const EXTENDED_ECR_FIELDS = [
  { fieldname: "ecr_workflow_version", label: "ECR Workflow Version", fieldtype: "Data", read_only: 1, hidden: 1, no_copy: 1 },
  { fieldname: "ecr_business_case", label: "Linked ECR Business Case", fieldtype: "Long Text", read_only: 1, hidden: 1, no_copy: 1, allow_on_submit: 1 },
  { fieldname: "rfq_required", label: "RFQ Required", fieldtype: "Select", options: "\nYes\nNo", read_only: 1, no_copy: 1, allow_on_submit: 1 },
  { fieldname: "rfq_decision_reason", label: "RFQ Decision Reason", fieldtype: "Small Text", read_only: 1, no_copy: 1, allow_on_submit: 1 },
];
export const EXTENDED_ECR_STATES = [
  "Technical Approved", "Business Case Preparation", "Business Case Submitted",
  "Finance Review", "Procurement BC Review", "Quality Review", "Business Case Approved",
  "Final ECR Approval", "ECR Approved", "Procurement Decision",
];

const REVIEW_STAGES = ["Finance Review", "Procurement BC Review", "Quality Review"];
const EDGE_DEFINITIONS = [
  ["Engineering Review", "Approve", "Technical Approved"],
  ["Engineering Review", "Approve Technical", "Technical Approved"],
  ...["Technical Approved", "Business Case Preparation", "Business Case Submitted"].flatMap((state) =>
    ["Finance Review", "Procurement BC Review"].map((next) => [state, "Submit Business Case", next])),
  ["Finance Review", "Approve Business Case", "Procurement BC Review"],
  ["Procurement BC Review", "Approve Business Case", "Quality Review"],
  ["Procurement BC Review", "Approve Business Case", "Business Case Approved"],
  ["Quality Review", "Approve Business Case", "Business Case Approved"],
  ...REVIEW_STAGES.flatMap((state) => [
    [state, "Send Back Business Case", "Technical Approved"],
    [state, "Reject Business Case", "Rejected"],
  ]),
  ["Business Case Approved", "Start Final Review", "Final ECR Approval"],
  ["Final ECR Approval", "Approve ECR", "ECR Approved"],
  ["Final ECR Approval", "Send Back ECR", "Technical Approved"],
  ["Final ECR Approval", "Reject ECR", "Rejected"],
  ["ECR Approved", "Record Procurement Decision", "Procurement Decision"],
  ["ECR Approved", "Record Procurement Decision", "Closed"],
  ["ECR Approved", "Request Sourcing Revision", "Draft"],
  ["Procurement Decision", "Create RFQ", "RFQ"],
];

export function appendSelectOptions(options, values) {
  return [...new Set([...String(options ?? "").split("\n"), ...values])].join("\n");
}

export function extendEcrDocType(document) {
  const result = structuredClone(document);
  result.fields ??= [];
  for (const spec of EXTENDED_ECR_FIELDS) {
    const existing = result.fields.find((field) => field.fieldname === spec.fieldname);
    if (existing) {
      if (existing.fieldtype !== spec.fieldtype) throw new Error(`Unexpected type for ${spec.fieldname}; inspect the existing schema before applying.`);
      Object.assign(existing, spec);
      // A version default would silently migrate copied or manually created legacy records.
      if (spec.fieldname === "ecr_workflow_version" && existing.default) existing.default = "";
    } else result.fields.push({ ...spec });
  }
  const status = result.fields.find((field) => field.fieldname === "select_pxfp");
  if (!status || status.fieldtype !== "Select") throw new Error("Run the existing ECR DocType setup first; select_pxfp must be a Select field.");
  status.options = appendSelectOptions(status.options, EXTENDED_ECR_STATES);
  const mirrorStatus = result.fields.find((field) => field.fieldname === "status");
  if (mirrorStatus?.fieldtype === "Select") mirrorStatus.options = appendSelectOptions(mirrorStatus.options, EXTENDED_ECR_STATES);
  return result;
}

export function extendEcrWorkflow(document, serviceRole) {
  const result = structuredClone(document);
  if (result.document_type !== "Engineering Change Request" || result.workflow_state_field !== "select_pxfp") {
    throw new Error("The active workflow does not match BidSphere's ECR schema.");
  }
  result.states ??= [];
  result.transitions ??= [];
  if (result.transitions.some((row) => row.allowed !== serviceRole) || result.states.some((row) => row.allow_edit !== serviceRole)) {
    throw new Error("Install the secured ECR workflow first; all existing states and transitions must use the exclusive workflow service role.");
  }
  for (const state of EXTENDED_ECR_STATES) {
    const existing = result.states.find((row) => row.state === state);
    if (existing && Number(existing.doc_status) !== 0) {
      throw new Error(`Existing ${state} uses a submitted document state. Reconcile that legacy workflow before enabling extended ECRs.`);
    }
    if (!existing) result.states.push({ state, doc_status: "0", allow_edit: serviceRole, is_optional_state: 0 });
  }
  for (const transition of result.transitions) {
    if (transition.state === "Engineering Review" && transition.next_state === "Procurement Review") {
      const guard = `doc.ecr_workflow_version != '${EXTENDED_VERSION}'`;
      if (!String(transition.condition ?? "").includes(guard)) {
        transition.condition = transition.condition ? `(${transition.condition}) and ${guard}` : guard;
      }
    }
  }
  for (const [state, action, next_state] of EDGE_DEFINITIONS) {
    const existing = result.transitions.find((row) => row.state === state && row.action === action && row.next_state === next_state);
    if (existing) {
      const guard = `doc.ecr_workflow_version == '${EXTENDED_VERSION}'`;
      if (!String(existing.condition ?? "").includes(guard)) existing.condition = existing.condition ? `(${existing.condition}) and ${guard}` : guard;
      continue;
    }
    result.transitions.push({ state, action, next_state, allowed: serviceRole, allow_self_approval: 1, condition: `doc.ecr_workflow_version == '${EXTENDED_VERSION}'` });
  }
  result.states.forEach((row, index) => { row.idx = index + 1; });
  result.transitions.forEach((row, index) => { row.idx = index + 1; });
  return result;
}
