import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { CLM_DOCTYPES, type ClmActionInput, type ClmDoctype, type ClmField, type ClmRecord, type RfqClmSourceDocument } from "../src/types/clm.js";
import { applyClmAction, canCoordinateRfqClm, canReadClm, clmEditableFields, clmSupplierDocuments, clmSupplierVisibleFields, ClmError, parseClmData, toClmAggregate } from "./clmCore.js";
import { clmErpRequest, clmResource, createClmDependencies, getClmFields, listClmErp } from "./clmErp.js";
import { requireAnyAuth, RbacError, type AccessPrincipal } from "./rbacAuth.js";
import { authorizeClmFileIfApplicable } from "./clmGatewayGuard.js";
import { canonicalErpFilePath, fetchErpFile } from "./fileProxyCore.js";
import { readErpAuthConfig } from "./authSession.js";
import { clmAlertsForRecords, runClmMonitoring } from "./clmNotifications.js";
import { uploadClmSupplierEvidence } from "./clmSupplierUpload.js";
import { SecureUploadError } from "./secureUploadGuard.js";
import { decideRfqContractRequirement, getRfqClmSummary, guardRfqContractRequestSave, resolveAvailableRfqAward, resolveDesignatedLegalSignatory, type RfqClmDeps } from "./rfqClmCore.js";
import { commitRfqClmDecision } from "./rfqClmErp.js";
import { collectInitialRfqDocuments, collectRfqAwardDocuments } from "./rfqClmDocuments.js";
import { isInitialRfqRequest, isInvalidatedPreawardRequest } from "./rfqInitialClmRequest.js";
import { CONTRACT_REQUEST_REQUIRED_FIELDS } from "./clmRequestValidation.js";
import { canEditRfqRequestDraft, projectRfqRequestDraft, saveRfqRequestDraft } from "./rfqRequestDraft.js";
import { projectRfqRequestSubmission } from "./rfqRequestSubmissionProjection.js";
import { recordRfqAwardClmDecision, type RfqAwardClmDecisionInput } from "./rfqAwardClmDecision.js";
import { clmPdfEvidenceById, clmPdfEvidenceByUrl, currentClmPdfEvidence, lockedClmPdfEvidence, ClmPdfEvidenceError, type ClmPdfEvidence } from "./clmPdfEvidence.js";
import { createClmPurchaseOrder, getClmPurchaseOrder } from "./clmPurchaseOrder.js";
import { createClmPurchaseOrderDependencies } from "./clmPurchaseOrderErp.js";
import { getPurchaseOrderContract } from "./clmPurchaseOrderLink.js";
import { getClmSupplierPoWorkflow } from "./clmSupplierPoWorkflow.js";

// Multipart negotiation evidence is parsed after authentication and parent scope checks.
export const config = { api: { bodyParser: false } };

const relatedTypes: ClmDoctype[] = ["Contract Risk", "Contract Obligation", "Contract Milestone", "Contract Renewal", "Contract Amendment"];
const coordinators = (principal: AccessPrincipal) => principal.typ === "internal" && ["admin", "procurement", "procurement_team"].includes(principal.role);
const rfqClmDependencies = (): RfqClmDeps => ({ ...createClmDependencies(), fields: getClmFields, decide: commitRfqClmDecision });
function editableFields(doctype: ClmDoctype, fields: ClmField[]): string[] {
  const permitted = clmEditableFields(doctype);
  return [...fields.filter(field => !field.read_only && permitted.includes(field.fieldname)).map(field => field.fieldname), ...(doctype === "Contract" ? ["clause_ids", "non_standard_clause"] : [])];
}
function creationTypes(principal: AccessPrincipal): ClmDoctype[] {
  if (principal.typ !== "internal") return [];
  if (principal.role === "admin") return [...CLM_DOCTYPES];
  const allowed: ClmDoctype[] = coordinators(principal) ? ["Contract Request", "Contract", ...relatedTypes] : [];
  if (["legal", "procurement"].includes(principal.role)) allowed.push("Contract Clause", "Contract Template");
  return allowed;
}
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
function single(req: VercelRequest, key: string, fallback = ""): string {
  const value = req.query[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new ClmError(`Supply one ${key}.`, 400);
  return value.trim();
}
function doctypeOf(value: unknown): ClmDoctype {
  if (!CLM_DOCTYPES.includes(value as ClmDoctype)) throw new ClmError("Unsupported Contract document type.", 400);
  return value as ClmDoctype;
}
async function bodyOf(req: VercelRequest): Promise<Record<string, unknown>> {
  let body: unknown = req.body;
  if (body === undefined) {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 2_000_000) throw new ClmError("The Contract request is too large.", 413); chunks.push(bytes); }
    body = Buffer.concat(chunks).toString("utf8");
  }
  if (typeof body === "string" || Buffer.isBuffer(body)) { try { body = JSON.parse(String(body)); } catch { throw new ClmError("Invalid JSON request.", 400); } }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ClmError("A JSON object is required.", 400);
  return body as Record<string, unknown>;
}

async function authorizedRecord(principal: AccessPrincipal, doctype: ClmDoctype, name: string): Promise<ClmRecord> {
  if (!name) throw new ClmError("Select a document.", 400);
  const record = await clmErpRequest("GET", clmResource(doctype, name));
  const parent = record.contract && doctype !== "Contract" ? await clmErpRequest("GET", clmResource("Contract", String(record.contract))) : undefined;
  if (!canReadClm(principal, doctype, record, parent)) throw new ClmError(principal.typ === "supplier" ? "Supplier access is restricted to assigned contracts." : "You are not assigned to this Contract.", 403);
  return doctype === "Contract Request" ? projectRfqRequestSubmission(record, (dt, id) => clmErpRequest("GET", clmResource(dt, id))) : record;
}

/** Filter historical attachment references for display without rewriting signed/audit evidence. */
async function rfqSourceDocumentProjection(record: ClmRecord): Promise<{ record: ClmRecord; warnings: string[]; filePaths?: Record<string, string> }> {
  let data: ReturnType<typeof parseClmData>;
  try { data = parseClmData(record.custom_clm_data); }
  catch { return { record: { ...record, custom_clm_data: "" }, warnings: ["Supporting documents could not be verified because the saved lifecycle evidence is invalid. The stored record has not been changed."] }; }
  const stored = Array.isArray(data.source_documents) ? data.source_documents as ClmRecord[] : [];
  const projected = { ...record, custom_clm_data: JSON.stringify({ ...data, source_documents: [] }) };
  const source = data.rfq_source as ClmRecord | undefined;
  const rfqName = clean(record.custom_rfq), quotationName = clean(record.custom_supplier_quotation);
  const supplierName = clean(record.custom_supplier || record.supplier || record.party_name);
  const unavailable = "Saved supporting documents are hidden because their RFQ award source could not be verified.";
  try {
    if (isInitialRfqRequest(record)) {
      const deps = createClmDependencies(), rfq = await deps.load("Request for Quotation", rfqName);
      if (rfq.name !== rfqName || rfq.contract_required !== "Yes" || Number(rfq.docstatus) === 2) throw new ClmError(unavailable, 409);
      const available = source?.available_award as ClmRecord | undefined;
      const award = available ? await resolveAvailableRfqAward(rfq, { ...deps, fields: getClmFields }) : undefined;
      if (available && (!award || ["award", "quotation", "supplier"].some(key => available[key] !== award.source[key]))) throw new ClmError(unavailable, 409);
      const poName = clean(record.custom_purchase_order || record.purchase_order);
      let po: ClmRecord | undefined;
      if (poName) {
        try { po = await deps.load("Purchase Order", poName); } catch { /* optional */ }
      }
      const verified = award ? await collectRfqAwardDocuments({ rfq, quotation: award.quotation, review: award.review, supplier: await deps.load("Supplier", clean(award.prefill.supplier)), po }, deps) : await collectInitialRfqDocuments(rfq, deps);
      const documents = verified.documents
        .filter(document => stored.some(old => old.file_id === document.file_id && (
          old.source_doctype === document.source_doctype && old.source_name === document.source_name ||
          (old.source_doctype === "Supplier Quotation" && document.source_doctype === "Purchase Order")
        )))
        .map(document => {
          const old = stored.find(oldDoc => oldDoc && oldDoc.file_id === document.file_id);
          if (old && !("document_type" in old) && !("file_url" in old)) return old as RfqClmSourceDocument;
          return { ...old, ...document };
        });
      return { record: { ...projected, custom_clm_data: JSON.stringify({ ...data, source_documents: documents }) }, warnings: verified.warnings, filePaths: Object.fromEntries(documents.map(document => [document.file_id, verified.filePaths[document.file_id]])) };
    }
    if (!quotationName || !supplierName || source && (source.rfq !== rfqName || source.quotation !== quotationName)) throw new ClmError(unavailable, 409);
    const deps = createClmDependencies();
    const poName = clean(record.custom_purchase_order || record.purchase_order);
    let po: ClmRecord | undefined;
    if (poName) {
      try { po = await deps.load("Purchase Order", poName); } catch { /* optional */ }
    }
    const [rfq, quotation, supplier, reviews] = await Promise.all([
      deps.load("Request for Quotation", rfqName), deps.load("Supplier Quotation", quotationName), deps.load("Supplier", supplierName),
      deps.list("Legal Document Review", [["rfq_name", "=", rfqName]]),
    ]);
    if (rfq.name !== rfqName || quotation.name !== quotationName || supplier.name !== supplierName || reviews.length > 1) throw new ClmError(unavailable, 409);
    const review = reviews.length ? await deps.load("Legal Document Review", clean(reviews[0].name)) : undefined;
    if (source?.legal_review && source.legal_review !== review?.name || review && (review.rfq_name !== rfqName || review.sq_name !== quotationName)) throw new ClmError(unavailable, 409);
    const verified = await collectRfqAwardDocuments({ rfq, quotation, review, supplier, po }, deps);
    const documents = verified.documents
      .filter(document => stored.some(old => old &&
        old.file_id === document.file_id && (
          old.source_doctype === document.source_doctype && old.source_name === document.source_name ||
          (old.source_doctype === "Supplier Quotation" && document.source_doctype === "Purchase Order")
        )))
      .map(document => {
        const old = stored.find(oldDoc => oldDoc && oldDoc.file_id === document.file_id);
        if (old && !("document_type" in old) && !("file_url" in old)) return old as RfqClmSourceDocument;
        return { ...old, ...document };
      });
    projected.custom_clm_data = JSON.stringify({ ...data, source_documents: documents });
    const omitted = stored.some(old => !old || !documents.some(document => document.file_id === old.file_id));
    return { record: projected, filePaths: Object.fromEntries(documents.map(document => [document.file_id, verified.filePaths[document.file_id]])), warnings: [...verified.warnings, ...(omitted ? ["Some saved source document references no longer match verified documents for this RFQ award and were omitted from this view."] : [])] };
  } catch {
    // Unavailable optional source metadata must neither expose unverified files
    // nor prevent an authorized user from reading the Contract and its history.
    return { record: projected, warnings: [unavailable] };
  }
}

async function detail(principal: AccessPrincipal, doctype: ClmDoctype, name: string) {
  const record = await authorizedRecord(principal, doctype, name);
  const related: Partial<Record<ClmDoctype, ClmRecord[]>> = {};
  if (doctype === "Contract" && principal.typ === "internal") {
    await Promise.all(relatedTypes.map(async type => { related[type] = (await listClmErp(type, [["contract", "=", name]])).filter(row => canReadClm(principal, type, row, record)); }));
  }
  const parent = relatedTypes.includes(doctype) && record.contract ? await clmErpRequest("GET", clmResource("Contract", clean(record.contract))) : undefined;
  const aggregate = toClmAggregate(principal, doctype, record, related, parent);
  if (doctype === "Contract") aggregate.supplier_workflow = await getClmSupplierPoWorkflow(record, parseClmData(record.custom_clm_data), principal, createClmDependencies());
  if (principal.typ === "internal" && ["Contract", "Contract Request"].includes(doctype) && clean(record.custom_rfq)) {
    const projection = await rfqSourceDocumentProjection(record);
    aggregate.record = { ...aggregate.record, custom_clm_data: projection.record.custom_clm_data };
    aggregate.warnings = [...(aggregate.warnings || []), ...projection.warnings];
  }
  const fields = await getClmFields(doctype);
  const alerts = doctype === "Contract" && principal.typ === "internal" ? await clmAlertsForRecords([record]) : [];
  const canCreateRelated = coordinators(principal) && doctype === "Contract" && (!clean(record.custom_rfq) || canCoordinateRfqClm(principal, record));
  if (doctype === "Contract Request") aggregate.record = projectRfqRequestDraft(aggregate.record);
  return { ...aggregate, alerts, editable_fields: editableFields(doctype, fields), allowed_related: canCreateRelated ? relatedTypes : [],
    ...(doctype === "Contract Request" ? { rfq_request_draft_editable: canEditRfqRequestDraft(principal, record) } : {}) };
}

async function prefill(principal: AccessPrincipal, target: ClmDoctype, sourceType: string, name: string): Promise<ClmRecord> {
  if (!coordinators(principal)) throw new ClmError("Only Contract coordinators can use procurement references.", 403);
  if (!["Contract", "Contract Request"].includes(target) || !["Contract Request", "Request for Quotation", "Supplier Quotation", "Purchase Order", "RFP", "RFP Response", "Contract Template", "Contract Clause"].includes(sourceType)) throw new ClmError("Unsupported Contract source.", 400);
  if (target === "Contract" && sourceType === "Request for Quotation") throw new ClmError("Open the awarded RFQ and use Create Contract from RFQ Award to preserve its context and Contract Required decision.", 409);
  if (target === "Contract Request" && sourceType === "Request for Quotation") {
    const summary = await getRfqClmSummary(principal, name, rfqClmDependencies());
    if (!summary.can_request) throw new ClmError(summary.reason || "Create Contract Request from an eligible awarded RFQ.", 409);
    return summary.prefill;
  }
  const source = CLM_DOCTYPES.includes(sourceType as ClmDoctype) ? await authorizedRecord(principal, sourceType as ClmDoctype, name) : await clmErpRequest("GET", clmResource(sourceType, name));
  if (sourceType === "Contract Template") return { contract_template: name, contract_terms: source.contract_terms, requires_fulfilment: source.requires_fulfilment, fulfilment_terms: (Array.isArray(source.fulfilment_terms) ? source.fulfilment_terms : []).map((term: ClmRecord) => ({ requirement: term.requirement, fulfilled: 0 })) };
  if (sourceType === "Contract Clause") return { contract_terms: source.clause_text, clause_ids: [name], non_standard_clause: source.standard__fallback !== "Standard" };
  const supplier = source.supplier || (sourceType === "Contract Request" ? source.supplier : undefined);
  const data: ClmRecord = target === "Contract" ? {
    ...(supplier ? { party_type: "Supplier", party_name: supplier, custom_supplier: supplier } : {}),
    custom_contract_value: source.contract_value ?? source.grand_total,
    custom_currency: source.currency,
    start_date: source.contract_start_date,
    end_date: source.contract_end_date,
    custom_contract_type: source.contract_type,
    custom_contract_title: source.contract_purpose || source.title,
    custom_business_unit: source.custom_business_unit,
    custom_project: source.custom_project || source.project,
    custom_rfq: source.custom_rfq || source.rfq_name || (sourceType === "Request for Quotation" ? name : undefined),
    custom_supplier_quotation: source.custom_supplier_quotation || (sourceType === "Supplier Quotation" ? name : undefined),
    custom_purchase_order: source.custom_purchase_order || (sourceType === "Purchase Order" ? name : undefined),
    ...(sourceType === "Contract Request" ? { custom_contract_request: name, contract_terms: source.description, custom_payment_terms_description: source.payment_terms, custom_renewal_notice_days: source.notice_period_days, custom_auto_renewal: source.auto_renewal } : {}),
    ...(sourceType === "RFP" ? { custom_rfp: name } : sourceType === "RFP Response" ? { custom_rfp: source.rfp, custom_rfp_response: name } : {}),
  } : { supplier, company: source.company, contract_value: source.grand_total, estimated_contract_value: source.grand_total, currency: source.currency, custom_project: source.project,
    ...(sourceType === "Request for Quotation" ? { custom_rfq: name } : sourceType === "Supplier Quotation" ? { custom_supplier_quotation: name } : sourceType === "Purchase Order" ? { custom_purchase_order: name } : {}) };
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null));
}

async function serveFile(req: VercelRequest, res: VercelResponse, principal: AccessPrincipal, doctype: ClmDoctype): Promise<void> {
  const name = single(req, "name");
  const record = await authorizedRecord(principal, doctype, name);
  const field = single(req, "fieldname");
  const data = parseClmData(record.custom_clm_data);
  const locked = data.locked_file as { file_url?: string; file_id?: string } | undefined;
  if (["current_pdf", "locked_file"].includes(field) && doctype !== "Contract") throw new ClmError("Select a Contract PDF.", 400);
  let pdfEvidence: ClmPdfEvidence | undefined = field === "current_pdf" ? currentClmPdfEvidence(record, data) : field === "locked_file" ? lockedClmPdfEvidence(record, data) : undefined;
  let fileUrl = ["current_pdf", "locked_file"].includes(field) ? pdfEvidence?.file_url : clean(record[field]);
  let fileId = pdfEvidence?.file_id;
  let sourceDocument: RfqClmSourceDocument | undefined;
  if (single(req, "file_id")) {
    const requested = single(req, "file_id");
    if (field === "current_pdf" && requested !== pdfEvidence?.file_id) throw new ClmError("The requested File is not the current Contract PDF. Refresh the Contract or open the historical version explicitly.", 409);
    const uploads = (Array.isArray(data.supplier_uploads) ? data.supplier_uploads as Array<{ file_id: string; file_url: string; supplier?: string; by?: string }> : []).filter(row => principal.typ === "internal" || row.supplier === principal.supplier && row.by === principal.sub);
    pdfEvidence = doctype === "Contract" ? clmPdfEvidenceById(record, data, requested, principal.typ === "internal") : undefined;
    const evidence = pdfEvidence || [locked, ...data.signatures, ...clmSupplierDocuments(data), ...uploads].find(row => row?.file_id === requested);
    if (evidence) { fileId = evidence.file_id; fileUrl = evidence.file_url; }
    else {
      // A reviewer assigned to this Contract can inspect its recorded RFQ
      // supporting evidence, without gaining access to arbitrary RFQ files.
      if (principal.typ !== "internal" || !["Contract", "Contract Request"].includes(doctype) || !clean(record.custom_rfq)) throw new ClmError("The attachment is not part of this Contract.", 403);
      const projection = await rfqSourceDocumentProjection(record);
      const documents = parseClmData(projection.record.custom_clm_data).source_documents;
      sourceDocument = (Array.isArray(documents) ? documents as RfqClmSourceDocument[] : []).find(document => document.file_id === requested);
      if (!sourceDocument) throw new ClmError("The attachment is not verified supporting evidence for this RFQ Contract.", 403);
      const sourceFile = await clmErpRequest("GET", clmResource("File", requested));
      if (sourceFile.name !== requested || sourceFile.attached_to_doctype !== sourceDocument.source_doctype || sourceFile.attached_to_name !== sourceDocument.source_name || Number(sourceFile.is_folder) || canonicalErpFilePath(clean(sourceFile.file_url)) !== projection.filePaths?.[requested]) throw new ClmError("The source attachment changed. Refresh the Contract.", 403);
      fileId = requested; fileUrl = canonicalErpFilePath(clean(sourceFile.file_url)) || undefined;
    }
  } else if (!["locked_file", "current_pdf"].includes(field)) {
    const schema = await getClmFields(doctype);
    if (!schema.some(row => row.fieldname === field && ["Attach", "Attach Image"].includes(row.fieldtype))) throw new ClmError("Select a Contract attachment.", 400);
    if (doctype === "Contract" && fileUrl) { pdfEvidence = clmPdfEvidenceByUrl(record, data, fileUrl); if (pdfEvidence) fileId = pdfEvidence.file_id; }
  }
  if (!fileUrl) throw new ClmError("Document not found.", 404);
  const expectedVersion = single(req, "expected_version");
  if (expectedVersion && (!pdfEvidence || pdfEvidence.version !== expectedVersion)) throw new ClmError("The Contract PDF version changed. Refresh the Contract before previewing or downloading it.", 409);
  const config = readErpAuthConfig();
  const result = await fetchErpFile({ baseUrl: config.baseUrl, apiKey: config.key, apiSecret: config.secret, filePath: fileUrl, fileId,
    authorizeFile: async file => {
      if (sourceDocument) {
        if (file.name !== sourceDocument.file_id || file.attached_to_doctype !== sourceDocument.source_doctype || file.attached_to_name !== sourceDocument.source_name || canonicalErpFilePath(clean(file.file_url)) !== fileUrl || Number(file.is_folder)) throw new ClmError("The source attachment changed. Refresh the Contract.", 403);
        return;
      }
      if (file.attached_to_doctype !== doctype || file.attached_to_name !== name) throw new ClmError("The attachment does not belong to this Contract.", 403);
      await authorizeClmFileIfApplicable({ principal, file, loadDocument: (type, id) => clmErpRequest("GET", clmResource(type, id)) });
    },
  });
  if (!result.ok) throw new ClmError(result.status === 404 ? "Document not found." : result.status === 403 ? "You do not have permission to view this document." : "Unable to load the document. Please try again.", result.status);
  if (pdfEvidence && (result.contentType !== "application/pdf" || result.buffer.subarray(0, 4).toString() !== "%PDF" || createHash("sha256").update(result.buffer).digest("hex") !== pdfEvidence.hash)) {
    throw new ClmError("The versioned Contract PDF failed its integrity check. Its stored document no longer matches the approved evidence.", 409);
  }
  res.setHeader("Content-Type", result.contentType); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Content-Disposition", "inline");
  if (pdfEvidence) { res.setHeader("X-Contract-Version", pdfEvidence.version); res.setHeader("X-Contract-Pdf-SHA256", pdfEvidence.hash); }
  res.status(200).send(result.buffer);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  try {
    const principal = requireAnyAuth(req.headers as Record<string, unknown>);
    if (req.method === "POST") {
      if (single(req, "view") === "supplier_upload") {
        res.status(200).json({ data: await uploadClmSupplierEvidence(req, principal, single(req, "name"), single(req, "expected_modified")) }); return;
      }
      if (single(req, "view") === "monitor") {
        if (!coordinators(principal)) throw new ClmError("Only Contract coordinators can run monitoring.", 403);
        res.status(200).json({ data: await runClmMonitoring() }); return;
      }
      const body = await bodyOf(req);
      if (single(req, "view") === "purchase_order") {
        if (Object.keys(body).some(key => !["name", "expected_modified", "operation", "payload"].includes(key)) || typeof body.name !== "string" || typeof body.expected_modified !== "string" || !["save_draft", "submit"].includes(String(body.operation)) || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) throw new ClmError("Supply the Contract, its revision, PO fields and save_draft or submit operation.", 400);
        res.status(200).json({ data: await createClmPurchaseOrder(principal, { name: body.name.trim(), expected_modified: body.expected_modified, operation: body.operation as "save_draft" | "submit", payload: body.payload as ClmRecord }, createClmPurchaseOrderDependencies()) }); return;
      }
      if (single(req, "view") === "rfq_award_decision") {
        if (Object.keys(body).some(key => !["rfq", "award_id", "quotation_id", "supplier_id", "decision"].includes(key)) || ["rfq", "award_id", "quotation_id", "supplier_id"].some(key => typeof body[key] !== "string" || !String(body[key]).trim()) || body.decision !== undefined && !["Yes", "No"].includes(String(body.decision))) throw new ClmError("Supply the saved RFQ award, quotation and supplier. The saved RFQ determines whether a Contract Request is required.", 400);
        res.status(200).json({ data: await recordRfqAwardClmDecision(principal, body as unknown as RfqAwardClmDecisionInput, rfqClmDependencies()) }); return;
      }
      if (single(req, "view") === "rfq_request_draft") {
        if (Object.keys(body).some(key => !["name", "expected_modified", "payload"].includes(key)) || typeof body.name !== "string" || typeof body.expected_modified !== "string" || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) throw new ClmError("Supply the existing Contract Request, its revision and draft fields.", 400);
        const saved = await saveRfqRequestDraft(principal, { name: body.name.trim(), expected_modified: body.expected_modified, payload: body.payload as ClmRecord }, createClmDependencies());
        res.status(200).json({ data: await detail(principal, "Contract Request", String(saved.name)) }); return;
      }
      if (single(req, "view") === "rfq_initial_request") {
        throw new ClmError("Contract Requests are created only after a saved supplier award when the RFQ's saved Contract Required choice is Yes. Complete the award handoff.", 409);
      }
      if (single(req, "view") === "rfq_contract") {
        if (Object.keys(body).some(key => !["rfq", "expected_modified", "decision", "operation", "payload", "contract_fields"].includes(key)) || typeof body.rfq !== "string" || body.expected_modified !== undefined && typeof body.expected_modified !== "string" || body.decision !== undefined && !["Yes", "No"].includes(String(body.decision)) || body.operation !== undefined && !["request", "create_contract"].includes(String(body.operation)) || [body.payload, body.contract_fields].some(value => value !== undefined && (!value || typeof value !== "object" || Array.isArray(value)))) throw new ClmError("Supply an RFQ, its revision, a Yes/No decision, a valid request or create_contract operation and valid fields.", 400);
        res.status(200).json({ data: await decideRfqContractRequirement(principal, { rfq: body.rfq.trim(), expected_modified: body.expected_modified as string | undefined, decision: body.decision === "No" ? "No" : "Yes", operation: body.operation as "request" | "create_contract" | undefined, payload: body.payload as ClmRecord | undefined, contract_fields: body.contract_fields as ClmRecord | undefined }, rfqClmDependencies()) }); return;
      }
      const input = { ...body, doctype: doctypeOf(body.doctype) } as unknown as ClmActionInput;
      const dependencies = createClmDependencies();
      await guardRfqContractRequestSave(input, principal, dependencies);
      const result = await applyClmAction(input, principal, dependencies);
      // Supplier acceptance can return the document to internal authoring. The
      // saved result remains safe-projected even when the next read is restricted.
      if (principal.typ === "supplier") { res.status(200).json({ data: result }); return; }
      const savedDetail = await detail(principal, result.doctype, String(result.record.name));
      res.status(200).json({ data: { ...savedDetail, warnings: [...(savedDetail.warnings || []), ...(result.warnings || [])] } }); return;
    }
    if (req.method !== "GET") throw new ClmError("Method Not Allowed.", 405);
    const view = single(req, "view", "list");
    if (view === "purchase_order_contract") { res.status(200).json({ data: await getPurchaseOrderContract(principal, single(req, "name"), createClmDependencies()) }); return; }
    if (view === "purchase_order") { res.status(200).json({ data: await getClmPurchaseOrder(principal, single(req, "name"), createClmPurchaseOrderDependencies()) }); return; }
    if (view === "rfq_contract") { res.status(200).json({ data: await getRfqClmSummary(principal, single(req, "rfq"), rfqClmDependencies()) }); return; }
    if (view === "legal_signatory") {
      if (principal.typ !== "internal") throw new ClmError("Supplier access is restricted.", 403);
      res.status(200).json({ data: await resolveDesignatedLegalSignatory(rfqClmDependencies()) }); return;
    }
    if (view === "metadata") {
      if (principal.typ !== "internal") {
        const contractFields = await getClmFields("Contract");
        const visible = clmSupplierVisibleFields();
        res.status(200).json({ data: { fields: { Contract: contractFields.filter(field => visible.includes(field.fieldname)) }, editableFields: {}, allowedCreate: [] } }); return;
      }
      const fields = Object.fromEntries(await Promise.all(CLM_DOCTYPES.map(async type => [type, await getClmFields(type)] as const)));
      // The generic Request editor retains its full requirements. Only the
      // dedicated RFQ intake service can defer fields while awaiting an award.
      fields["Contract Request"] = fields["Contract Request"].map(field => CONTRACT_REQUEST_REQUIRED_FIELDS.includes(field.fieldname as typeof CONTRACT_REQUEST_REQUIRED_FIELDS[number]) ? { ...field, reqd: 1 } : field);
      res.status(200).json({ data: { fields, editableFields: Object.fromEntries(CLM_DOCTYPES.map(type => [type, editableFields(type, fields[type])])), allowedCreate: creationTypes(principal) } }); return;
    }
    if (view === "lookup") {
      if (principal.typ !== "internal") throw new ClmError("Supplier access is restricted to assigned contracts.", 403);
      const type = single(req, "doctype");
      const masters = ["Supplier", "Company", "Department", "Project", "Currency", "User", "Contact", "Address", "Cost Center", "Request for Quotation", "Supplier Quotation", "Purchase Order", "RFP", "RFP Response", ...CLM_DOCTYPES];
      if (!masters.includes(type)) throw new ClmError("Unsupported lookup.", 400);
      if (!coordinators(principal) && !["Contract", "User"].includes(type)) throw new ClmError("You cannot use this Contract lookup.", 403);
      const query = single(req, "query");
      const rows = await listClmErp(type, query ? [["name", "like", `%${query}%`]] : [], CLM_DOCTYPES.includes(type as ClmDoctype) ? ["*"] : ["name"]);
      const records = CLM_DOCTYPES.includes(type as ClmDoctype) ? rows.filter(row => canReadClm(principal, type as ClmDoctype, row)).map(row => ({ name: row.name })) : rows;
      res.status(200).json({ data: { records: records.slice(0, 40) } }); return;
    }
    const doctype = doctypeOf(single(req, "doctype", "Contract"));
    if (view === "file") { await serveFile(req, res, principal, doctype); return; }
    if (view === "detail") { res.status(200).json({ data: await detail(principal, doctype, single(req, "name")) }); return; }
    if (view === "prefill") { res.status(200).json({ data: { payload: await prefill(principal, doctype, single(req, "source_doctype"), single(req, "source_name")) } }); return; }
    if (view !== "list") throw new ClmError("Unknown Contract operation.", 400);
    const rows = await listClmErp(doctype);
    const records: ClmRecord[] = [];
    for (const row of rows) {
      const parent = row.contract && doctype !== "Contract" ? await clmErpRequest("GET", clmResource("Contract", String(row.contract))) : undefined;
      if (canReadClm(principal, doctype, row, parent)) {
        const projected = doctype === "Contract Request" ? await projectRfqRequestSubmission(row, (dt, id) => clmErpRequest("GET", clmResource(dt, id))) : row;
        if (doctype === "Contract Request" && isInvalidatedPreawardRequest(projected)) continue;
        records.push(toClmAggregate(principal, doctype, projected).record);
      }
    }
    const alerts = doctype === "Contract" && principal.typ === "internal" ? await clmAlertsForRecords(records) : [];
    const kpis = principal.typ === "internal" && doctype === "Contract" ? {
      overdueObligations: alerts.filter(row => ["obligation_overdue", "obligation_escalation"].includes(row.kind)).length,
      slaBreaches: alerts.filter(row => row.kind === "sla_breach").length,
    } : undefined;
    res.status(200).json({ data: { records, alerts, kpis, allowedCreate: creationTypes(principal) } });
  } catch (error) {
    const status = error instanceof ClmError || error instanceof RbacError || error instanceof SecureUploadError || error instanceof ClmPdfEvidenceError ? error.status : 500;
    if (req.method === "POST" && req.query.view === "rfq_contract") {
      // Upstream exceptions and validation messages can contain submitted data.
      // Log only a bounded server-owned error category, never the request/error.
      const messages: Record<number, string> = {
        400: "Invalid RFQ Contract Request input.",
        401: "RFQ Contract Request authentication failed.",
        403: "RFQ Contract Request creation was not permitted.",
        404: "An RFQ Contract Request source was not found.",
        409: "RFQ Contract Request source or revision conflict.",
        422: "RFQ Contract Request validation failed.",
        503: "RFQ Contract Request prerequisites are unavailable.",
      };
      console.error("[rfq-clm] Contract Request creation failed", {
        status: status >= 400 && status < 600 ? status : 500,
        message: messages[status] || "RFQ Contract Request creation failed.",
      });
    }
    res.status(status >= 400 && status < 600 ? status : 500).json({ success: false, message: error instanceof ClmError || error instanceof RbacError || error instanceof SecureUploadError || error instanceof ClmPdfEvidenceError ? error.message : "Unable to process the Contract request. Please try again." });
  }
}
