import {
  enforceEcrMutationRbac,
  RbacError,
  requireRoles,
  type AccessPrincipal,
} from "./rbacAuth.js";
import {
  assertEcrUploadField,
  supplierOwnsUploadTarget,
} from "./secureUploadGuard.js";

const ECR_DOCTYPE = "Engineering Change Request";
const ECR_READ_ROLES = [
  "engineer",
  "engineering",
  "operations",
  "quality",
  "program_manager",
  "procurement_team",
  "procurement",
] as const;
const READ_METHODS = new Set(["GET", "HEAD"]);
const NAMED_METHODS = new Set(["GET", "HEAD", "PUT", "PATCH", "DELETE"]);

export type FileResourceDocument = Record<string, unknown> & {
  name?: string;
  attached_to_doctype?: string;
  attached_to_name?: string;
  attached_to_field?: string;
};

export type FileResourceDocumentLoader = (
  doctype: string,
  name: string,
) => Promise<Record<string, unknown>>;

export interface FileResourceRoute {
  isFileResource: boolean;
  isCollection: boolean;
  name: string;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedPath(value: string): string {
  try {
    return decodeURIComponent(value.replace(/^\/+/, "").replace(/\+/g, " "));
  } catch {
    return value.replace(/^\/+/, "");
  }
}

export function fileResourceRoute(apiPath: string): FileResourceRoute {
  const path = normalizedPath(apiPath).replace(/\/+$/, "");
  if (path === "resource/File") {
    return { isFileResource: true, isCollection: true, name: "" };
  }
  const prefix = "resource/File/";
  if (!path.startsWith(prefix)) {
    return { isFileResource: false, isCollection: false, name: "" };
  }
  const name = clean(path.slice(prefix.length).split("/")[0]);
  return { isFileResource: true, isCollection: !name, name };
}

type AttachmentScope = { doctype: string; docname: string };

function parseFilters(value: unknown): unknown[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** File lists must be tied to one exact attachment target; broad enumeration is disabled. */
export function exactFileAttachmentScope(filters: unknown): AttachmentScope | null {
  let doctype = "";
  let docname = "";
  for (const filter of parseFilters(filters)) {
    if (!Array.isArray(filter)) continue;
    const fourPart = filter.length >= 4;
    const field = clean(filter[fourPart ? 1 : 0]);
    const operator = clean(filter[fourPart ? 2 : 1]).toLowerCase();
    const value = clean(filter[fourPart ? 3 : 2]);
    if (operator !== "=") continue;
    if (field === "attached_to_doctype") {
      if (doctype && doctype !== value) return null;
      doctype = value;
    }
    if (field === "attached_to_name") {
      if (docname && docname !== value) return null;
      docname = value;
    }
  }
  return doctype && docname ? { doctype, docname } : null;
}

function isEcrOwner(
  principal: Extract<AccessPrincipal, { typ: "internal" }>,
  ecr: Record<string, unknown>,
): boolean {
  const identities = new Set(
    [principal.sub, principal.email]
      .map((value) => clean(value).toLowerCase())
      .filter(Boolean),
  );
  return [ecr.ecr_owner, ecr.amended_from, ecr.owner]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean)
    .some((owner) => identities.has(owner));
}

function requireInternalEcrRead(
  principal: AccessPrincipal,
  ecr: Record<string, unknown>,
): Extract<AccessPrincipal, { typ: "internal" }> {
  if (principal.typ !== "internal") {
    throw new RbacError("Forbidden. Internal authentication required for ECR files.", 403);
  }
  requireRoles(principal, [...ECR_READ_ROLES]);
  if (principal.role === "engineer" && !isEcrOwner(principal, ecr)) {
    throw new RbacError("Access denied. Engineers can access only files on their own ECRs.", 403);
  }
  return principal;
}

function ecrAttachmentField(file: FileResourceDocument): string {
  const fieldname = clean(file.attached_to_field);
  try {
    assertEcrUploadField(fieldname);
  } catch {
    throw new RbacError("The ECR File attachment field is not authorized.", 403);
  }
  return fieldname;
}

async function authorizeEcrFile(
  principal: AccessPrincipal,
  method: string,
  file: FileResourceDocument,
  loadDocument: FileResourceDocumentLoader,
): Promise<void> {
  const ecrName = clean(file.attached_to_name);
  if (!ecrName) throw new RbacError("The ECR File attachment target is invalid.", 403);
  const fieldname = ecrAttachmentField(file);
  const ecr = await loadDocument(ECR_DOCTYPE, ecrName);
  const internal = requireInternalEcrRead(principal, ecr);
  if (READ_METHODS.has(method)) return;

  // Removing or replacing an attachment is governed by the owning ECR field,
  // not by the service account's broad File permission.
  enforceEcrMutationRbac(
    internal,
    `resource/${encodeURIComponent(ECR_DOCTYPE)}/${encodeURIComponent(ecrName)}`,
    "PUT",
    { [fieldname]: "" },
    clean(ecr.select_pxfp),
    ecr,
  );

  // The ECR attachment API needs DELETE only. Direct File PUT/PATCH could
  // otherwise make a private upload public or relink it after ECR authorization.
  if (method === "PUT" || method === "PATCH") {
    throw new RbacError(
      "ECR File metadata cannot be changed directly. Upload or delete it through the scoped attachment flow.",
      403,
    );
  }
}

function requestedAttachmentScope(
  body: unknown,
  existing: FileResourceDocument,
): AttachmentScope {
  const payload = record(body);
  return {
    doctype: Object.prototype.hasOwnProperty.call(payload, "attached_to_doctype")
      ? clean(payload.attached_to_doctype)
      : clean(existing.attached_to_doctype),
    docname: Object.prototype.hasOwnProperty.call(payload, "attached_to_name")
      ? clean(payload.attached_to_name)
      : clean(existing.attached_to_name),
  };
}

async function assertSupplierOwnsScope(
  principal: Extract<AccessPrincipal, { typ: "supplier" }>,
  scope: AttachmentScope,
  loadDocument: FileResourceDocumentLoader,
): Promise<void> {
  if (!scope.doctype || !scope.docname || scope.doctype === ECR_DOCTYPE) {
    throw new RbacError("Access denied. This File is not assigned to your supplier account.", 403);
  }
  const uploadTarget = { doctype: scope.doctype, docname: scope.docname };
  if (supplierOwnsUploadTarget(principal.supplier, uploadTarget, null)) return;
  const target = await loadDocument(scope.doctype, scope.docname);
  if (!supplierOwnsUploadTarget(
    principal.supplier,
    uploadTarget,
    target,
  )) {
    throw new RbacError("Access denied. This File is not assigned to your supplier account.", 403);
  }
}

export async function authorizeFileResourceRequest(input: {
  apiPath: string;
  method: string;
  principal: AccessPrincipal;
  body?: unknown;
  query?: Record<string, unknown>;
  loadDocument: FileResourceDocumentLoader;
}): Promise<FileResourceDocument | null> {
  const route = fileResourceRoute(input.apiPath);
  if (!route.isFileResource) return null;
  const method = input.method.toUpperCase();

  if (route.isCollection) {
    if (!READ_METHODS.has(method)) {
      throw new RbacError(
        "Direct File collection writes are disabled. Use the scoped upload endpoint.",
        403,
      );
    }
    if (Array.isArray(input.query?.filters) && input.query.filters.length !== 1) {
      throw new RbacError("Duplicate File collection filters are not allowed.", 403);
    }
    const scope = exactFileAttachmentScope(input.query?.filters);
    if (!scope) {
      throw new RbacError(
        "File collection reads require exact attached_to_doctype and attached_to_name filters.",
        403,
      );
    }
    if (scope.doctype === ECR_DOCTYPE) {
      const ecr = await input.loadDocument(ECR_DOCTYPE, scope.docname);
      requireInternalEcrRead(input.principal, ecr);
    } else if (input.principal.typ === "supplier") {
      await assertSupplierOwnsScope(input.principal, scope, input.loadDocument);
    }
    return null;
  }

  if (!NAMED_METHODS.has(method)) {
    throw new RbacError("This File resource method is not allowed.", 403);
  }
  const file = await input.loadDocument("File", route.name) as FileResourceDocument;
  const existingScope = {
    doctype: clean(file.attached_to_doctype),
    docname: clean(file.attached_to_name),
  };

  if (existingScope.doctype === ECR_DOCTYPE) {
    await authorizeEcrFile(input.principal, method, file, input.loadDocument);
    return file;
  }

  if (input.principal.typ === "supplier") {
    await assertSupplierOwnsScope(input.principal, existingScope, input.loadDocument);
  }

  if (method === "PUT" || method === "PATCH") {
    const payload = record(input.body);
    if (
      Object.prototype.hasOwnProperty.call(payload, "data") ||
      Object.prototype.hasOwnProperty.call(payload, "doc")
    ) {
      throw new RbacError(
        "Wrapped File mutation payloads are disabled.",
        403,
      );
    }
    const requestedScope = requestedAttachmentScope(input.body, file);
    if (requestedScope.doctype === ECR_DOCTYPE) {
      throw new RbacError(
        "ECR files must be created through the scoped multipart upload path and cannot be relinked directly.",
        403,
      );
    }
    if (input.principal.typ === "supplier" && (
      requestedScope.doctype !== existingScope.doctype ||
      requestedScope.docname !== existingScope.docname
    )) {
      await assertSupplierOwnsScope(input.principal, requestedScope, input.loadDocument);
    }
  }
  return file;
}

/** Authorize a byte download from metadata resolved by exact File.file_url. */
export async function authorizePersistedFileRead(input: {
  principal: AccessPrincipal;
  file: FileResourceDocument;
  loadDocument: FileResourceDocumentLoader;
  supplierContextAuthorized?: boolean;
}): Promise<void> {
  const scope = {
    doctype: clean(input.file.attached_to_doctype),
    docname: clean(input.file.attached_to_name),
  };
  if (!clean(input.file.name) || !scope.doctype || !scope.docname) {
    throw new RbacError("The requested File does not have an authorized attachment target.", 403);
  }
  if (scope.doctype === ECR_DOCTYPE) {
    await authorizeEcrFile(input.principal, "GET", input.file, input.loadDocument);
    return;
  }
  if (input.principal.typ === "supplier") {
    if (input.supplierContextAuthorized) return;
    await assertSupplierOwnsScope(input.principal, scope, input.loadDocument);
    return;
  }
  // Internal byte reads retain ordinary-document access, but still fail closed
  // when the persisted attachment target no longer exists.
  await input.loadDocument(scope.doctype, scope.docname);
}

/** Generic Frappe methods must not bypass the inspected File resource routes. */
export function assertNoGenericFileAccess(
  apiPath: string,
  requestDoctypes: string[],
): void {
  if (
    normalizedPath(apiPath).startsWith("method/") &&
    requestDoctypes.some((doctype) => clean(doctype) === "File")
  ) {
    throw new RbacError(
      "Generic ERP methods are disabled for File records. Use an attachment-scoped File resource request.",
      403,
    );
  }
}
