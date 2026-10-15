type RecordData = Record<string, unknown>;
type ReviewData = { rfq_name?: unknown; name?: unknown; sq_name?: unknown; supplier?: unknown };
export type InitialClmDocumentLoader = (doctype: string, name: string) => Promise<RecordData>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const same = (left: unknown, right: unknown) => text(left).replace(/^(["'])(.*)\1$/, "$2").toLowerCase() === text(right).replace(/^(["'])(.*)\1$/, "$2").toLowerCase();
export class InitialClmHoldError extends Error { status = 409; }
function object(value: unknown, label: string): RecordData {
  if (value == null || value === "") return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as RecordData;
  } catch { /* Return an actionable saved-evidence error below. */ }
  throw new InitialClmHoldError(`The saved ${label} could not be verified. Refresh the RFQ and inspect its CLM decision before continuing.`);
}
function inconsistent(): never {
  throw new InitialClmHoldError("The saved RFQ CLM request assignment or award links are inconsistent. Inspect the RFQ and Contract Request before continuing Legal or Finance review.");
}

/** Pause only a real award-linked Request, without rewriting the legacy LDR. */
export async function rfqInitialClmHold(review: ReviewData, load: InitialClmDocumentLoader): Promise<string | undefined> {
  const rfqName = text(review.rfq_name);
  if (!rfqName) return undefined;
  const rfq = await load("Request for Quotation", rfqName);
  if (rfq.name !== rfqName) return inconsistent();
  const approval = object(rfq.custom_approval_data, "RFQ approval data");
  const initial = object(approval.clm_initial_request, "initial RFQ Contract Request");
  const invalidatedPreaward = rfq.contract_required === "No" && ["awaiting_award", "awaiting_supplier_award"].includes(text(initial.phase));
  if (initial.version === 1 && text(initial.request) && !invalidatedPreaward) {
    const request = await load("Contract Request", text(initial.request));
    const data = object(request.custom_clm_data, "Contract Request lifecycle evidence");
    const route = object(data.rfq_request_workflow, "Contract Request assignment"), source = object(data.rfq_source, "Contract Request source");
    const awardSource = text(source.award) ? source : object(source.available_award, "Contract Request award");
    // Superseded pre-award intake cannot become a Legal/Finance gate merely
    // because the RFQ has since received quotations or a supplier selection.
    const preawardOnly = source.stage === "rfq_created" && !text(awardSource.award) && !data.contract;
    if (!preawardOnly && (data.contract && object(approval.contract_decision, "RFQ CLM decision").contract !== data.contract || !data.contract && route.phase !== "procurement_team")) return inconsistent();
    if (!preawardOnly && !data.contract && route.phase === "procurement_team") {
      if (text(initial.award) && initial.award !== awardSource.award || text(initial.quotation) && initial.quotation !== awardSource.quotation || text(awardSource.rfq) && awardSource.rfq !== rfqName) return inconsistent();
      if (text(awardSource.legal_review || awardSource.award) && text(awardSource.legal_review || awardSource.award) !== text(review.name)) return undefined;
      const approvals = Array.isArray(data.approvals) ? data.approvals.map(row => object(row, "Contract Request approval")) : [];
      const audit = Array.isArray(data.audit) ? data.audit.map(row => object(row, "Contract Request audit")) : [];
      if (data.schema !== 1 || rfq.contract_required !== "Yes" || request.name !== initial.request || request.custom_rfq !== rfqName || Number(request.docstatus) === 2 || !["Draft", "Pending Review", "Approved"].includes(text(request.request_status)) || !["rfq_created", "rfq_awarded"].includes(text(source.stage)) || source.rfq !== rfqName || source.contract_required !== true || !text(awardSource.award) || awardSource.quotation !== review.sq_name || request.custom_supplier_quotation !== awardSource.quotation || !same(awardSource.supplier, review.supplier) || !same(request.supplier, awardSource.supplier) || route.version !== 1 || route.assigned_role !== "procurement_team" || route.status !== "Pending" || route.current_stage !== "Procurement" || approvals.length !== 1 || approvals[0].role !== "procurement_team" || approvals[0].stage !== 0 || approvals[0].status !== "Pending" || text(approvals[0].user) || !audit.some(row => row.action === "procurement_team_assigned" && row.new_status === "Pending" && text(row.by) && text(row.at) && ["procurement", "procurement_team", "admin"].includes(text(row.role)))) return inconsistent();
      return `RFQ ${rfqName} has a Pending Contract Request assigned to Procurement Team. The team must create its Contract before Legal or Finance review can continue.`;
    }
  }
  if (!approval.contract_decision) return undefined;
  const decision = object(approval.contract_decision, "RFQ CLM decision");
  if (decision.decision !== "Yes" || text(decision.contract)) return undefined;
  // Historical reviews for another award retain their existing read behavior.
  if (text(decision.legal_review) && decision.legal_review !== review.name) return undefined;
  const requestName = text(decision.request);
  if (!requestName) return inconsistent();
  const request = await load("Contract Request", requestName);
  const data = object(request.custom_clm_data, "Contract Request lifecycle evidence");
  if (!data.rfq_request_workflow) return undefined; // Existing legacy request flow.
  const route = object(data.rfq_request_workflow, "Contract Request assignment");
  const source = object(data.rfq_source, "Contract Request source");
  const approvals = Array.isArray(data.approvals) ? data.approvals.map(row => object(row, "Contract Request approval")) : [];
  const audit = Array.isArray(data.audit) ? data.audit.map(row => object(row, "Contract Request audit")) : [];
  if (data.schema !== 1 || request.name !== requestName || request.custom_rfq !== rfqName || source.rfq !== rfqName ||
      !["Draft", "Pending Review", "Approved"].includes(text(request.request_status)) || Number(request.docstatus) === 2 ||
      route.version !== 1 || route.phase !== "procurement_team" || route.assigned_role !== "procurement_team" || text(data.contract) ||
      !text(decision.quotation) || decision.quotation !== review.sq_name || request.custom_supplier_quotation !== decision.quotation || source.quotation !== decision.quotation ||
      !text(decision.supplier) || !same(decision.supplier, review.supplier) || !same(request.supplier, decision.supplier) || !same(source.supplier, decision.supplier) ||
      text(decision.award) && source.award !== decision.award || text(source.legal_review) && source.legal_review !== review.name ||
      approvals.length !== 1 || approvals[0].role !== "procurement_team" || approvals[0].stage !== 0 || approvals[0].status !== "Pending" || !!approvals[0].user ||
      !audit.some(row => row.action === "procurement_team_assigned" && text(row.by) && text(row.at) && (row.role === "procurement_team" && row.new_status === "Pending Procurement Team" || ["rfq_created", "rfq_awarded"].includes(text(source.stage)) && ["procurement", "procurement_team", "admin"].includes(text(row.role)) && row.new_status === "Pending"))) return inconsistent();
  return `RFQ ${rfqName} is Pending Procurement Team. Procurement Team must create its Contract before Legal or Finance review can continue.`;
}

/** Reuses each parent read within one queue request; never caches across requests. */
export async function withoutInitialClmHeldReviews<T extends ReviewData>(reviews: T[], load: InitialClmDocumentLoader): Promise<T[]> {
  const loaded = new Map<string, Promise<RecordData>>();
  const cached: InitialClmDocumentLoader = (doctype, name) => {
    const key = `${doctype}/${name}`;
    let document = loaded.get(key);
    if (!document) { document = load(doctype, name); loaded.set(key, document); }
    return document;
  };
  const holds = await Promise.all(reviews.map(review => rfqInitialClmHold(review, cached)));
  return reviews.filter((_, index) => !holds[index]);
}
