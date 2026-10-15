/** Server-side CLM file authorization, shared by production and Vite. */
import { RbacError, type AccessPrincipal } from "./rbacAuth.js";
import { supplierOwnsUploadTarget } from "./secureUploadGuard.js";
import { canonicalErpFilePath, type FileProxyFileRecord } from "./fileProxyCore.js";
import type { FileResourceDocument, FileResourceDocumentLoader } from "./fileResourceGuard.js";

const REVIEW = "Legal Document Review";
const QUOTATION = "Supplier Quotation";
const DOCUMENT_FIELDS = {
  terms: "terms_file_url",
  warranty: "warranty_file_url",
  insurance: "insurance_file_url",
  signed: "esign_signed_file_url",
} as const;
const QUOTATION_FIELDS = ["custom_terms__condition", "custom_terms_condition", "custom_warenty_certificate", "custom_warranty_certificate", "custom_insurance_certificate"];
type Doc = Record<string, unknown>;
type ListDocuments = (doctype: string, filters: string[][], fields: string[]) => Promise<Doc[]>;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const pathOf = (value: unknown) => canonicalErpFilePath(clean(value));

async function listDocuments(doctype: string, filters: string[][], fields: string[]): Promise<Doc[]> {
  // Same server-only ERP configuration as the file-proxy adapter. Do not
  // import the write-capable workflow engine just to read attachment metadata.
  const baseUrl = (process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL ?? "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!baseUrl || !key || !secret) throw new Error("ERP attachment service is not configured.");
  const params = new URLSearchParams({ filters: JSON.stringify(filters), fields: JSON.stringify(fields), limit_page_length: "100" });
  const response = await fetch(`${baseUrl}/api/resource/${encodeURIComponent(doctype)}?${params}`, {
    headers: { Authorization: `token ${key}:${secret}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Object.assign(new Error("Unable to verify legal attachment metadata."), { status: response.status >= 500 ? 502 : response.status });
  const payload = await response.json() as { data?: Doc[] };
  if (!Array.isArray(payload.data) || payload.data.length >= 100) {
    throw Object.assign(new Error("Legal attachment metadata is incomplete or exceeds the verification limit."), { status: 502 });
  }
  return payload.data;
}

function identityMatches(principal: AccessPrincipal, ...values: unknown[]): boolean {
  if (principal.typ !== "internal") return false;
  const identities = [principal.sub, principal.email].map(value => clean(value).toLowerCase()).filter(Boolean);
  return values.some(value => identities.includes(clean(value).toLowerCase()));
}

function assignedUsers(doc: Doc): string[] {
  try {
    const assigned: unknown = JSON.parse(clean(doc._assign) || "[]");
    return Array.isArray(assigned) ? assigned.filter((value): value is string => typeof value === "string") : [];
  } catch { return []; }
}

/** Uses the existing canonical app roles and persisted workflow/assignment fields. */
export function assertLegalReviewFileAccess(principal: AccessPrincipal, review: Doc, quotation: Doc): void {
  if (principal.typ !== "internal") throw new RbacError("Internal legal documents are not available to suppliers.", 403);
  if (principal.role === "admin") return;
  if (identityMatches(principal, review.owner, quotation.owner, ...assignedUsers(review), ...assignedUsers(quotation),
    review.current_owner, review.next_approver, review.approved_by, review.esign_signed_by, review.finance_approved_by)) return;
  if ((principal.role === "procurement" || principal.role === "procurement_team") &&
      identityMatches(principal, review.procurement_manager)) return;
  const state = clean(review.workflow_state);
  if (principal.role === "legal" &&
      (review.review_status === "Pending" || state === "Pending Signature") &&
      ["", "Pending Review", "Legal Review", "Ready for Signature", "Pending Signature"].includes(state)) return;
  if ((principal.role === "finance" || principal.role === "finance_executive") && state === "Finance Review" && review.finance_status === "Pending") return;
  if (principal.role === "procurement_team" && state === "Completed" && review.review_status === "Approved" &&
      review.finance_status === "Approved" && clean(review.sq_name) === clean(quotation.name) &&
      (!review.company || !quotation.company || review.company === quotation.company)) return;
  throw new RbacError("You are not authorized to view this legal review attachment.", 403);
}

function reviewPaths(review: Doc): string[] {
  const paths = Object.values(DOCUMENT_FIELDS).map(field => pathOf(review[field])).filter((path): path is string => Boolean(path));
  // Signed versions are persisted in the existing e-sign envelope, not a new status system.
  try {
    const envelope = JSON.parse(clean(review.esign_envelope) || "{}");
    for (const document of Object.values(envelope.documents || {}) as Doc[]) {
      const path = pathOf(document.signedFileUrl);
      if (path) paths.push(path);
    }
  } catch { /* Malformed envelope grants no additional access. */ }
  return paths;
}

async function quotationReviews(name: string, loadDocument: FileResourceDocumentLoader, list: ListDocuments): Promise<Doc[]> {
  const rows = await list(REVIEW, [["sq_name", "=", name]], ["name"]);
  return Promise.all(rows.map(row => loadDocument(REVIEW, clean(row.name))));
}

/** Protect the old generic file-id route too; a scoped URL is not an ACL bypass. */
export async function authorizeLegalFileIfApplicable(input: {
  principal: AccessPrincipal; file: FileResourceDocument; loadDocument: FileResourceDocumentLoader;
  list?: ListDocuments;
}): Promise<boolean> {
  const { principal, file, loadDocument } = input;
  const path = pathOf(file.file_url);
  const doctype = clean(file.attached_to_doctype);
  if (doctype === REVIEW) {
    const review = await loadDocument(REVIEW, clean(file.attached_to_name));
    const quotation = await loadDocument(QUOTATION, clean(review.sq_name));
    assertLegalReviewFileAccess(principal, review, quotation);
    return true;
  }
  if (doctype !== QUOTATION || !path) return false;
  const quotation = await loadDocument(QUOTATION, clean(file.attached_to_name));
  const reviews = await quotationReviews(clean(file.attached_to_name), loadDocument, input.list || listDocuments);
  const linked = reviews.filter(review => reviewPaths(review).includes(path));
  if (linked.length) {
    for (const review of linked) {
      try { assertLegalReviewFileAccess(principal, review, quotation); return true; }
      catch (error) { if (!(error instanceof RbacError)) throw error; }
    }
    throw new RbacError("You are not authorized to view this legal review attachment.", 403);
  }
  // Historical/temporary File rows may point at the same private bytes. They
  // must not provide an alternate route around the current CLM parent ACL.
  const references = await Promise.all(Object.values(DOCUMENT_FIELDS).map(field =>
    (input.list || listDocuments)(REVIEW, [[field, "=", path]], ["name"])));
  if (references.some(rows => rows.length)) {
    if (principal.typ === "internal" && principal.role === "admin") return true;
    throw new RbacError("Open this attachment through its current legal-review parent.", 403);
  }
  if (QUOTATION_FIELDS.includes(clean(file.attached_to_field)) || QUOTATION_FIELDS.some(field => pathOf(quotation[field]) === path)) {
    // An authorized supplier may view compliance attachments on their own quotation
    if (principal.typ === "supplier" && supplierOwnsUploadTarget(principal.supplier, { doctype: QUOTATION, docname: clean(quotation.name) }, quotation)) {
      return true;
    }
    // A replacement upload may be verified before its URL is copied onto the
    // review. Require parent ownership/assignment or the assigned buyer.
    if (principal.typ === "internal" && (principal.role === "admin" ||
        identityMatches(principal, quotation.owner, ...assignedUsers(quotation)) ||
        (principal.role === "procurement" || principal.role === "procurement_team") &&
          reviews.some(review => identityMatches(principal, review.procurement_manager)))) return true;
    throw new RbacError("You are not authorized to view this internal contract attachment.", 403);
  }
  return false;
}

/** Resolve duplicate file URLs only within a verified, persisted legal-review parent. */
export async function resolveLegalReviewFile(input: {
  principal: AccessPrincipal; reviewName: string; documentKey: string; requestedPath: string;
  loadDocument: FileResourceDocumentLoader; list?: ListDocuments;
}): Promise<FileProxyFileRecord> {
  if (input.principal.typ !== "internal") throw new RbacError("Internal legal documents are not available to suppliers.", 403);
  if (!Object.hasOwn(DOCUMENT_FIELDS, input.documentKey)) {
    throw Object.assign(new Error("Invalid legal document key."), { status: 400 });
  }
  const review = await input.loadDocument(REVIEW, input.reviewName);
  const quotationName = clean(review.sq_name);
  if (!quotationName || clean(review.name) !== input.reviewName) throw new RbacError("Invalid legal-review parent.", 403);
  const quotation = await input.loadDocument(QUOTATION, quotationName);
  assertLegalReviewFileAccess(input.principal, review, quotation);
  const path = pathOf(review[DOCUMENT_FIELDS[input.documentKey as keyof typeof DOCUMENT_FIELDS]]);
  if (!path || path !== pathOf(input.requestedPath)) throw new RbacError("The requested file is not the selected attachment on this legal review.", 403);
  const list = input.list || listDocuments;
  for (const [doctype, name] of [[REVIEW, input.reviewName], [QUOTATION, quotationName]]) {
    const rows = await list("File", [["file_url", "=", path], ["attached_to_doctype", "=", doctype], ["attached_to_name", "=", name]],
      ["name", "file_name", "file_url", "is_private", "is_folder", "attached_to_doctype", "attached_to_name", "attached_to_field"]);
    const candidates = rows.filter(row => clean(row.name) && !row.is_folder && pathOf(row.file_url) === path &&
      row.attached_to_doctype === doctype && row.attached_to_name === name);
    if (candidates.length) {
      // Multiple File rows for the SAME bytes and SAME authorized parent are
      // equivalent. Never choose among other quotations or temporary targets.
      candidates.sort((a, b) => Number(Boolean(b.attached_to_field)) - Number(Boolean(a.attached_to_field)) || clean(a.name).localeCompare(clean(b.name)));
      return candidates[0] as FileProxyFileRecord;
    }
  }
  throw Object.assign(new Error("Document not found."), { status: 404 });
}
