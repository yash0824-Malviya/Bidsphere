/** Persisted RFP -> supplier response -> File authorization for preview and download. */
import { RbacError, requireRoles, type AccessPrincipal } from "./rbacAuth.js";
import { canonicalErpFilePath, type FileProxyFileRecord } from "./fileProxyCore.js";
import { supplierOwnsUploadTarget } from "./secureUploadGuard.js";
import type { FileResourceDocument, FileResourceDocumentLoader } from "./fileResourceGuard.js";

const RESPONSE_DOCTYPE = "RFP Response";
type Document = Record<string, unknown>;
const clean = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const pathOf = (value: unknown): string | null => canonicalErpFilePath(clean(value));
const record = (value: unknown): Document => value && typeof value === "object" && !Array.isArray(value) ? value as Document : {};

export interface RfpResponseAttachmentContext {
  rfpName: string;
  responseName: string;
  documentId: string;
}

function invalidContext(): Error & { status: number } {
  return Object.assign(new Error("A single rfp, rfp_response and response_document are required."), { status: 400 });
}

/** A context is atomic; competing legal/RFQ scopes cannot change its authority. */
export function parseRfpResponseAttachmentContext(query: Record<string, unknown>): RfpResponseAttachmentContext | null {
  const keys = ["rfp", "rfp_response", "response_document"] as const;
  if (!keys.some(key => query[key] !== undefined)) return null;
  if (keys.some(key => typeof query[key] !== "string" || !clean(query[key])) ||
      ["legal_review", "document_key", "rfq", "erp_supplier_id"].some(key => query[key] !== undefined)) {
    throw invalidContext();
  }
  return { rfpName: clean(query.rfp), responseName: clean(query.rfp_response), documentId: clean(query.response_document) };
}

function responseDocuments(response: Document): Document[] {
  try {
    const raw: unknown = typeof response.documents_json === "string"
      ? JSON.parse(response.documents_json) : response.documents_json;
    return Array.isArray(raw) ? raw.map(record) : [];
  } catch { return []; }
}

async function authorizedResponse(input: {
  principal: AccessPrincipal;
  responseName: string;
  rfpName?: string;
  loadDocument: FileResourceDocumentLoader;
}): Promise<Document> {
  // RFP pages currently belong to Procurement Manager/Admin. Finance, Legal
  // and Procurement Team retain their existing separate RFQ/CLM permissions.
  if (input.principal.typ === "internal") requireRoles(input.principal, ["procurement"]);
  const response = await input.loadDocument(RESPONSE_DOCTYPE, input.responseName);
  const rfpName = clean(response.rfp);
  if (clean(response.name) !== input.responseName || !rfpName || input.rfpName && input.rfpName !== rfpName) {
    throw new RbacError("The supplier response does not belong to the requested RFP.", 403);
  }
  if (input.principal.typ === "supplier" && !supplierOwnsUploadTarget(input.principal.supplier,
    { doctype: RESPONSE_DOCTYPE, docname: input.responseName }, response)) {
    throw new RbacError("This supplier response is not assigned to your supplier account.", 403);
  }
  const rfp = await input.loadDocument("RFP", rfpName);
  if (clean(rfp.name) !== rfpName) throw new RbacError("The RFP attachment parent is invalid.", 403);
  if (input.principal.typ === "supplier" && !supplierOwnsUploadTarget(input.principal.supplier,
    { doctype: "RFP", docname: rfpName }, rfp)) {
    throw new RbacError("This RFP is not assigned to your supplier account.", 403);
  }
  return response;
}

function assertSelectedFile(file: FileResourceDocument, responseName: string, document: Document): void {
  const stored = record(document.file);
  if (!clean(file.name) || file.is_folder || file.attached_to_doctype !== RESPONSE_DOCTYPE ||
      clean(file.attached_to_name) !== responseName || !pathOf(stored.file_url) ||
      pathOf(stored.file_url) !== pathOf(file.file_url) ||
      clean(stored.file_id) && clean(stored.file_id) !== clean(file.name)) {
    throw new RbacError("The requested File is not the selected supplier-response attachment.", 403);
  }
}

/** Resolve by saved File ID, never by choosing an arbitrary duplicate file_url. */
export async function resolveRfpResponseFile(input: RfpResponseAttachmentContext & {
  principal: AccessPrincipal;
  requestedPath: string;
  requestedFileId?: string;
  loadDocument: FileResourceDocumentLoader;
  /** Legacy metadata without File IDs must retain the strict unique-path lookup. */
  resolveFileByPath?: (path: string) => Promise<FileProxyFileRecord>;
}): Promise<FileProxyFileRecord> {
  const response = await authorizedResponse(input);
  const matches = responseDocuments(response).filter(document => clean(document.document_id) === input.documentId);
  if (matches.length !== 1) throw new RbacError("The selected supplier-response document is not valid.", 403);
  const document = matches[0]!;
  const stored = record(document.file);
  if (!pathOf(input.requestedPath) || pathOf(stored.file_url) !== pathOf(input.requestedPath)) {
    throw new RbacError("The requested path is not the selected supplier-response attachment.", 403);
  }
  const storedId = clean(stored.file_id);
  const requestedId = clean(input.requestedFileId);
  if (storedId && requestedId && storedId !== requestedId) {
    throw new RbacError("The requested File ID is not the selected supplier-response attachment.", 403);
  }
  const fileId = storedId || requestedId;
  if (!fileId && !input.resolveFileByPath) throw Object.assign(new Error("Document not found."), { status: 404 });
  const file = fileId
    ? await input.loadDocument("File", fileId) as FileResourceDocument
    : await input.resolveFileByPath!(pathOf(stored.file_url)!);
  if (fileId && clean(file.name) !== fileId) throw new RbacError("The requested File ID does not match its persisted record.", 403);
  assertSelectedFile(file, input.responseName, document);
  return file as FileProxyFileRecord;
}

/** Context stripping/direct File IDs must still enforce the same parent policy. */
export async function authorizeRfpResponseFileIfApplicable(input: {
  principal: AccessPrincipal;
  file: FileResourceDocument;
  loadDocument: FileResourceDocumentLoader;
}): Promise<boolean> {
  if (clean(input.file.attached_to_doctype) !== RESPONSE_DOCTYPE) return false;
  const responseName = clean(input.file.attached_to_name);
  if (!responseName) throw new RbacError("The supplier-response attachment parent is invalid.", 403);
  const response = await authorizedResponse({ ...input, responseName });
  const matches = responseDocuments(response).filter(document => {
    const stored = record(document.file);
    return clean(document.document_id) && pathOf(stored.file_url) &&
      pathOf(stored.file_url) === pathOf(input.file.file_url) &&
      (!clean(stored.file_id) || clean(stored.file_id) === clean(input.file.name));
  });
  if (!matches.length) throw new RbacError("The File is not a saved supplier-response document.", 403);
  for (const document of matches) assertSelectedFile(input.file, responseName, document);
  return true;
}
