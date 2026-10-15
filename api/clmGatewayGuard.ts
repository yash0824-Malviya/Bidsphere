import { CLM_DOCTYPES, type ClmRecord } from "../src/types/clm.js";
import { canCoordinateRfqClm, canReadClm, clmStatus, clmSupplierDocuments, isRfqClmContract, parseClmData, toClmAggregate } from "./clmCore.js";
import { RbacError, type AccessPrincipal } from "./rbacAuth.js";
import { canonicalErpFilePath } from "./fileProxyCore.js";
import type { FileResourceDocument, FileResourceDocumentLoader } from "./fileResourceGuard.js";
import type { ParsedSecureUpload } from "./secureUploadGuard.js";

export const isClmDoctype = (value: unknown): boolean => CLM_DOCTYPES.includes(String(value) as typeof CLM_DOCTYPES[number]);
export function assertNoGenericClmAccess(apiPath: string, requestDoctypes: string[]): void {
  const resource = /^resource\/([^/]+)/.exec(apiPath)?.[1];
  if (isClmDoctype(resource) || requestDoctypes.some(isClmDoctype)) {
    throw new RbacError("Contract records must use the secured Contract Lifecycle API.", 403);
  }
}

export async function authorizeClmScope(principal: AccessPrincipal, doctype: string, name: string, load: FileResourceDocumentLoader): Promise<ClmRecord> {
  const record = await load(doctype, name);
  const parent = record.contract && doctype !== "Contract" ? await load("Contract", String(record.contract)) : undefined;
  if (!canReadClm(principal, doctype as typeof CLM_DOCTYPES[number], record, parent)) {
    throw new RbacError(principal.typ === "supplier" ? "Supplier access is restricted to assigned contracts." : "You are not assigned to this Contract.", 403);
  }
  return record;
}

export async function authorizeClmFileIfApplicable(input: { principal: AccessPrincipal; file: FileResourceDocument; loadDocument: FileResourceDocumentLoader }): Promise<boolean> {
  const doctype = String(input.file.attached_to_doctype ?? "");
  if (!isClmDoctype(doctype)) return false;
  const record = await authorizeClmScope(input.principal, doctype, String(input.file.attached_to_name ?? ""), input.loadDocument);
  if (Number(input.file.is_private) !== 1 || input.file.is_folder) throw new RbacError("Contract attachments must remain private.", 403);
  if (input.principal.typ === "supplier") {
    const data = parseClmData(record.custom_clm_data);
    const allowed = [record.custom_contract_document, record.custom_executed_contract, (data.locked_file as { file_url?: string } | undefined)?.file_url, ...data.signatures.map(row => row.file_url), ...data.versions.map(row => row.content.custom_contract_document)];
    const receipts = Array.isArray(data.supplier_uploads) ? data.supplier_uploads as ClmRecord[] : [];
    const supplier = input.principal;
    const ownUploads = receipts.filter(row => String(row.supplier).trim().toLowerCase() === supplier.supplier.trim().toLowerCase() && String(row.by).trim().toLowerCase() === supplier.sub.trim().toLowerCase());
    const allowedEvidence = [...clmSupplierDocuments(data), ...ownUploads];
    const path = canonicalErpFilePath(String(input.file.file_url ?? ""));
    const exactEvidence = allowedEvidence.some(row => row.file_id === input.file.name && canonicalErpFilePath(String(row.file_url ?? "")) === path);
    if (!exactEvidence && !allowed.some(value => typeof value === "string" && canonicalErpFilePath(value) === path)) throw new RbacError("This document is not shared with the supplier.", 403);
  }
  return true;
}

export async function authorizeClmUpload(principal: AccessPrincipal, upload: ParsedSecureUpload, load: FileResourceDocumentLoader): Promise<boolean> {
  if (!isClmDoctype(upload.doctype)) return false;
  const record = await authorizeClmScope(principal, upload.doctype, upload.docname, load);
  if (upload.fields.is_private !== "1") throw new RbacError("Contract attachments must remain private.", 403);
  if (upload.fieldname) throw new RbacError("Upload the attachment without modifying a Contract field; save it through the Contract action.", 403);
  const parent = upload.doctype !== "Contract" && record.contract ? await load("Contract", String(record.contract)) : undefined;
  const rfqParent = parent && isRfqClmContract(parent) ? parent : undefined;
  const rfqLinked = !!rfqParent || ["Contract", "Contract Request"].includes(upload.doctype) && isRfqClmContract(record);
  const actions = rfqLinked ? toClmAggregate(principal, upload.doctype as typeof CLM_DOCTYPES[number], record).actions.map(action => action.action) : [];
  const parentStatus = rfqParent ? clmStatus("Contract", rfqParent) : "";
  const parentAuthoring = !!rfqParent && canReadClm(principal, "Contract", rfqParent) && canCoordinateRfqClm(principal, rfqParent) &&
    (!["Contract Amendment", "Contract Renewal"].includes(upload.doctype) || ["Active", "Expired"].includes(parentStatus));
  const coordinator = principal.typ === "internal" && (rfqLinked
    ? principal.role === "procurement_team" && (rfqParent ? parentAuthoring : clmStatus(upload.doctype, record) === "Draft") && actions.includes("save")
    : ["admin", "procurement", "procurement_team"].includes(principal.role));
  const supplierNegotiation = principal.typ === "supplier" && upload.doctype === "Contract" && record.custom_contract_status === "Negotiation" && (!rfqLinked || actions.includes("supplier_redline"));
  if (!coordinator && !supplierNegotiation) throw new RbacError("You cannot upload documents at this Contract stage.", 403);
  if (Number(record.custom_final_version_locked)) throw new RbacError("The final Contract version is locked. Start a new revision before uploading.", 403);
  return true;
}
