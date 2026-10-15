/** Display the persisted RFQ handoff separately from the Contract's legal lifecycle. */
export type RfqClmPhase = "draft" | "legal_review" | "signature" | "finance_review" | "procurement" | "completed" | "rejected";
const stages = {
  draft: { status: "Draft", stage: "Contract Preparation", owner: "Procurement Team", ownerRole: "procurement_team", instruction: "Correct the contract and submit it for Legal Review." },
  legal_review: { status: "Pending Legal Review", stage: "Legal Review", owner: "Legal Manager", ownerRole: "legal", instruction: "Complete Legal Review before requesting signatures." },
  signature: { status: "Pending Signatures", stage: "E-Signature", owner: "Legal Manager", ownerRole: "legal", instruction: "Complete the Legal Manager signature to proceed to Finance Approval. Supplier signatures are tracked separately." },
  finance_review: { status: "Pending Finance Approval", stage: "Finance Approval", owner: "Finance Manager", ownerRole: "finance", instruction: "Review the Legal Manager-signed contract and record the Finance decision." },
  procurement: { status: "Finance Approved", stage: "Procurement Finalization", owner: "Procurement Team", ownerRole: "procurement_team", instruction: "Action: Create Purchase Order. Review the Contract and award details in the PO form. Successful PO submission completes procurement finalization." },
  completed: { status: "Completed", stage: "Completed", owner: "—", ownerRole: "", instruction: "Procurement finalization is recorded. The Contract's legal lifecycle, dates and obligations continue separately." },
  rejected: { status: "Rejected", stage: "Rejected", owner: "Procurement Team", ownerRole: "procurement_team", instruction: "Review the rejection and audit history. Procurement continuation remains blocked." },
} as const;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const evidenceTime = (value: unknown) => Date.parse(text(value).replace(" ", "T"));
function hasCurrentSignature(record: Record<string, unknown>, data: Record<string, unknown>, party: "supplier" | "inteva"): boolean {
  const version = text(record.custom_current_version);
  const signatures = (Array.isArray(data.signatures) ? data.signatures : []).map(object);
  const approvals = (Array.isArray(data.approvals) ? data.approvals : []).map(object);
  const legal = approvals.find(row => row.role === "legal" && row.stage === 0 && row.status === "Approved" && text(row.by));
  return !!version && !!legal && Number.isFinite(evidenceTime(legal.at)) && signatures.some(row => row.party === party && row.version === version && text(row.by) &&
    Number.isFinite(evidenceTime(row.at)) && evidenceTime(row.at) >= evidenceTime(legal.at) && text(row.file_id) && text(row.file_url).startsWith("/private/files/") && /^[a-f0-9]{64}$/.test(text(row.hash)) &&
    (party !== "inteva" || row.role === "legal" && text(row.by).toLowerCase() === text(record.custom_inteva_signatory).toLowerCase()));
}

/** ERP Currency defaults are not an award value on an RFQ-only request. */
export function rfqClmRequestValue(record: Record<string, unknown>): number | undefined {
  let data: Record<string, unknown>;
  try { data = object(typeof record.custom_clm_data === "string" ? JSON.parse(record.custom_clm_data) : record.custom_clm_data); }
  catch { data = {}; }
  const source = object(data.rfq_source);
  const hasAmount = source.amount !== undefined && source.amount !== null && String(source.amount).trim() !== "" && Number.isFinite(Number(source.amount));
  if (source.stage === "rfq_created" && source.prepared !== true && !hasAmount && !text(record.supplier)) return undefined;
  const value = record.contract_value;
  return value !== undefined && value !== null && String(value).trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

export interface RfqClmWorkflowView {
  phase: RfqClmPhase; status: string; stage: string; owner: string; ownerRole: string; instruction: string;
  rfq: string; award: string; createdBy: string; createdAt: string; purchaseOrder: string;
}
export interface RfqClmRequestWorkflowView extends Omit<RfqClmWorkflowView, "phase"> {
  phase: "procurement_team"; assignedRole: "procurement_team"; assignedUser: string;
  initialRequest: boolean; contractRequired?: "Yes"; department: string; requester: string; supplier: string;
}
/** The request queue follows persisted assignment evidence, never Contract Required alone. */
export function rfqClmRequestWorkflowView(record: Record<string, unknown>): RfqClmRequestWorkflowView | undefined {
  const rfq = text(record.custom_rfq);
  if (!rfq || !["Draft", "Pending Review", "Approved"].includes(text(record.request_status)) || text(record.custom_contract)) return undefined;
  let data: Record<string, unknown>;
  try { data = object(typeof record.custom_clm_data === "string" ? JSON.parse(record.custom_clm_data) : record.custom_clm_data); }
  catch { return undefined; }
  const workflow = object(data.rfq_request_workflow), source = object(data.rfq_source);
  if (workflow.version !== 1 || workflow.phase !== "procurement_team" || workflow.assigned_role !== "procurement_team" || source.rfq !== rfq || text(data.contract)) return undefined;
  const initialRequest = String(source.stage) === "rfq_created";
  const awardedRequest = String(source.stage) === "rfq_awarded";
  if (initialRequest && (source.contract_required !== true || !["Pending", "Pending Procurement Team"].includes(String(workflow.status)) || !["Procurement", "Pending Procurement Team"].includes(String(workflow.current_stage)))) return undefined;
  if (awardedRequest && (source.contract_required !== true || !["Pending", "Pending Procurement Team"].includes(String(workflow.status)))) return undefined;
  const approvals = (Array.isArray(data.approvals) ? data.approvals : []).map(object);
  const assignment = approvals.length === 1 && approvals.find(row => row.role === "procurement_team" && row.stage === 0 && row.status === "Pending");
  if (!assignment || text(assignment.user)) return undefined;
  const requested = (Array.isArray(data.audit) ? data.audit : []).map(object).find(row => ["request_clm", "route_procurement_team", "create_from_rfq_award", "create"].includes(text(row.action)));
  return { phase: "procurement_team", status: initialRequest ? "Pending" : "Pending Procurement Team", stage: initialRequest ? "Procurement" : "Pending Procurement Team", owner: "Procurement Team", ownerRole: "procurement_team", assignedRole: "procurement_team", instruction: "Procurement Team must review this request and create the Contract before Legal Review begins.",
    initialRequest, contractRequired: source.contract_required === true ? "Yes" : undefined, department: text(record.department) || text(source.department), requester: text(record.requester) || text(requested?.by), supplier: text(record.supplier) || text(source.supplier) || text(object(source.available_award).supplier),
    assignedUser: text(assignment.user), rfq, award: text(source.award) || text(source.legal_review) || text(object(source.available_award).award), createdBy: text(record.requester) || text(requested?.by) || text(record.owner), createdAt: text(requested?.at) || text(record.creation), purchaseOrder: "" };
}
export function rfqClmWorkflowView(record: Record<string, unknown>): RfqClmWorkflowView | undefined {
  const rfq = text(record.custom_rfq);
  if (!rfq) return undefined;
  let data: Record<string, unknown>;
  try { data = object(typeof record.custom_clm_data === "string" ? JSON.parse(record.custom_clm_data) : record.custom_clm_data); }
  catch { return undefined; }
  const workflow = object(data.rfq_workflow);
  let phase: RfqClmPhase | undefined;
  if (data.rfq_workflow) {
    if (workflow.version !== 1 || !Object.hasOwn(stages, text(workflow.phase))) return undefined;
    phase = text(workflow.phase) as RfqClmPhase;
  } else {
    const legacy: Record<string, RfqClmPhase> = { Draft: "draft", "Pending Legal": "legal_review", "Under Review": "legal_review", Approved: "signature", "Pending Signature": "signature", "Pending Finance": "finance_review", Rejected: "rejected" };
    phase = legacy[text(record.custom_contract_status)];
  }
  if (!phase) return undefined;
  const source = object(data.rfq_source), context = object(data.rfq_context), completion = object(data.procurement_completion);
  const created = (Array.isArray(data.audit) ? data.audit : []).map(object).find(row => ["create", "create_contract", "clm_created", "create_from_rfq_award", "create_contract_from_rfq_award"].includes(text(row.action)));
  // The backend persists the Finance handoff after the Legal signature. Supplier
  // receipts are independent evidence and never determine stage or responsibility.
  return { phase, ...stages[phase], rfq, award: text(context.award_id) || text(source.award) || text(source.legal_review),
    createdBy: text(created?.by) || text(record.owner), createdAt: text(created?.at) || text(record.creation), purchaseOrder: text(completion.purchase_order) };
}

type LifecyclePhase = Exclude<RfqClmPhase, "rejected">;
export interface RfqClmLifecycleStage {
  phase: LifecyclePhase; status: string; stage: string; owner: string; ownerRole: string;
}
export interface RfqClmLifecycleView {
  current: RfqClmWorkflowView;
  next?: RfqClmLifecycleStage;
  steps: Array<RfqClmLifecycleStage & { state: "completed" | "current" | "next" | "upcoming" | "blocked" }>;
  paused: boolean;
}

// Version 1's existing sequential route. These are presentation labels, never
// persisted statuses or instructions to advance a Contract.
const lifecycleOrder: LifecyclePhase[] = ["draft", "legal_review", "signature", "finance_review", "procurement", "completed"];
function lifecycleStage(phase: LifecyclePhase): RfqClmLifecycleStage {
  const configured = stages[phase];
  return { phase, status: phase === "finance_review" ? "Pending Finance Approval" : phase === "procurement" ? "Pending Procurement Finalization" : configured.status,
    stage: configured.stage, owner: phase === "completed" ? "None / Completed" : configured.owner, ownerRole: configured.ownerRole };
}

/** Contract Detail projection from saved phase; it never changes the underlying workflow. */
export function rfqClmLifecycleView(record: Record<string, unknown>): RfqClmLifecycleView | undefined {
  const workflow = rfqClmWorkflowView(record);
  if (!workflow) return undefined;
  const data = object(typeof record.custom_clm_data === "string" ? JSON.parse(record.custom_clm_data || "{}") : record.custom_clm_data);
  const nativeStatus = text(record.custom_contract_status);
  const terminal = Number(record.docstatus) === 2 || ["Cancelled", "Canceled", "Terminated", "Closed", "Expired"].includes(nativeStatus);
  const termination = !!data.termination;
  const paused = workflow.phase === "rejected" || termination || terminal;
  const index = lifecycleOrder.indexOf(workflow.phase as LifecyclePhase);
  let current = workflow.phase === "rejected" || workflow.phase === "signature" ? workflow : { ...workflow, ...lifecycleStage(workflow.phase) };
  if (termination) current = { ...current, instruction: "A termination review is in progress. Its recorded decision determines what happens next." };
  else if (terminal && workflow.phase !== "completed") current = { ...current, status: Number(record.docstatus) === 2 ? "Cancelled" : nativeStatus, stage: Number(record.docstatus) === 2 ? "Cancelled" : nativeStatus, owner: "None", ownerRole: "", instruction: "This Contract is no longer progressing through procurement. Review its saved status and audit history." };
  const approvals = (Array.isArray(data.approvals) ? data.approvals : []).map(object);
  const legalApproved = approvals.some(row => row.role === "legal" && row.status === "Approved");
  const signed = legalApproved && hasCurrentSignature(record, data, "inteva");
  const financeApproved = signed && approvals.some(row => row.role === "finance" && row.status === "Approved");
  const next = !paused && index >= 0 && index + 1 < lifecycleOrder.length ? lifecycleStage(lifecycleOrder[index + 1]) : undefined;
  const steps = lifecycleOrder.map((phase, stepIndex): RfqClmLifecycleView["steps"][number] => {
    const stage = lifecycleStage(phase);
    if (phase === "signature" && workflow.phase === "signature") Object.assign(stage, { status: current.status, owner: current.owner, ownerRole: current.ownerRole });
    // Once creation has finished this first milestone describes the existing
    // Contract. A send-back uses its real Draft/Preparation stage again.
    if (phase === "draft" && workflow.phase !== "draft") stage.stage = "Procurement Team Creation";
    if (paused && workflow.phase !== "completed") {
      if (termination && phase === workflow.phase) return { ...stage, state: "current" };
      const completed = phase === "draft" && workflow.phase !== "draft" || phase === "legal_review" && legalApproved || phase === "signature" && signed || phase === "finance_review" && financeApproved;
      return { ...stage, state: completed ? "completed" : "blocked" };
    }
    return { ...stage, state: stepIndex < index ? "completed" : stepIndex === index ? "current" : stepIndex === index + 1 ? "next" : "upcoming" };
  });
  return { current, next, steps, paused };
}
