import { canonicalErpFilePath } from "./fileProxyCore.js";
import {
  requireRoles,
  type AccessPrincipal,
  type AppRole,
} from "./rbacAuth.js";

const FILE_DOCTYPE = "File";
const ECR_DOCTYPE = "Engineering Change Request";
const BUSINESS_NEED_DOCTYPE = "Business Need";
const BUSINESS_CASE_DOCTYPE = "Business Case";

const BUSINESS_INTAKE_ROLES: AppRole[] = [
  "department",
  "finance",
  "finance_executive",
  "legal",
  "procurement",
  "procurement_team",
];

const REQUEST_FIELDS = new Set([
  "source_file_name",
  "target_doctype",
  "target_docname",
]);

export type InternalFileLinkPrincipal = Extract<
  AccessPrincipal,
  { typ: "internal" }
>;

export interface PersistedFileLink extends Record<string, unknown> {
  name?: string;
  file_name?: string;
  file_url?: string;
  file_size?: number | string;
  is_private?: number | boolean | string;
  is_folder?: number | boolean | string;
  folder?: string;
  content_hash?: string;
  attached_to_doctype?: string;
  attached_to_name?: string;
  attached_to_field?: string;
}

export interface FileLinkCopyDependencies {
  loadDocument: (
    doctype: string,
    name: string,
  ) => Promise<Record<string, unknown>>;
  findTargetLinks: (input: {
    targetDoctype: string;
    targetDocname: string;
    fileUrl: string;
  }) => Promise<PersistedFileLink[]>;
  insertTargetLink: (
    payload: Record<string, unknown>,
  ) => Promise<PersistedFileLink>;
}

export interface FileLinkCopyResult {
  created: boolean;
  source_file_name: string;
  target_doctype: typeof BUSINESS_CASE_DOCTYPE;
  target_docname: string;
  file: PersistedFileLink;
}

export class FileLinkCopyError extends Error {
  status: number;
  code:
    | "validation"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "erp"
    | "config";
  fieldErrors?: Record<string, string>;
  details?: unknown;

  constructor(
    message: string,
    status = 400,
    code: FileLinkCopyError["code"] = "validation",
    options: {
      fieldErrors?: Record<string, string>;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "FileLinkCopyError";
    this.status = status;
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}

type CopyRequest = {
  sourceFileName: string;
  targetDoctype: typeof BUSINESS_CASE_DOCTYPE;
  targetDocname: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidIdentifier(value: unknown): boolean {
  return (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 255 ||
    /[\0\r\n]/.test(value)
  );
}

function parseRequest(payload: unknown): CopyRequest {
  if (!isRecord(payload)) {
    throw new FileLinkCopyError(
      "A JSON object is required.",
      422,
      "validation",
    );
  }

  const fieldErrors: Record<string, string> = {};
  for (const key of Object.keys(payload)) {
    if (!REQUEST_FIELDS.has(key)) {
      fieldErrors[key] = "This field is not accepted by the scoped File link endpoint.";
    }
  }

  if (invalidIdentifier(payload.source_file_name)) {
    fieldErrors.source_file_name = "A valid persisted source File name is required.";
  }
  if (invalidIdentifier(payload.target_doctype)) {
    fieldErrors.target_doctype = "A valid target DocType is required.";
  }
  if (invalidIdentifier(payload.target_docname)) {
    fieldErrors.target_docname = "A valid target document name is required.";
  }

  const targetDoctype = clean(payload.target_doctype);
  if (targetDoctype === ECR_DOCTYPE) {
    throw new FileLinkCopyError(
      "Engineering Change Request files cannot be copied or linked through this endpoint.",
      403,
      "forbidden",
      { fieldErrors: { target_doctype: "ECR targets are forbidden." } },
    );
  }
  if (targetDoctype && targetDoctype !== BUSINESS_CASE_DOCTYPE) {
    fieldErrors.target_doctype =
      "Only the Business Need to Business Case attachment flow is supported.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new FileLinkCopyError(
      "The File link request is invalid.",
      422,
      "validation",
      { fieldErrors },
    );
  }

  return {
    sourceFileName: clean(payload.source_file_name),
    targetDoctype: BUSINESS_CASE_DOCTYPE,
    targetDocname: clean(payload.target_docname),
  };
}

function normalizedFlag(value: unknown): 0 | 1 | null {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  return null;
}

function exactDocument(
  document: Record<string, unknown>,
  doctype: string,
  requestedName: string,
): void {
  const actualName = clean(document.name);
  if (!actualName || actualName !== requestedName) {
    throw new FileLinkCopyError(
      `ERPNext returned an invalid ${doctype} document.`,
      502,
      "erp",
    );
  }
}

function principalIdentities(principal: InternalFileLinkPrincipal): Set<string> {
  return new Set(
    [principal.sub, principal.email]
      .map((identity) => clean(identity).toLowerCase())
      .filter(Boolean),
  );
}

function assertSourceAuthorization(
  principal: InternalFileLinkPrincipal,
  sourceNeed: Record<string, unknown>,
): void {
  if (principal.role !== "department") return;
  const identities = principalIdentities(principal);
  const owned = [
    sourceNeed.requester,
    sourceNeed.requester_email,
    sourceNeed.business_owner_email,
    sourceNeed.owner,
  ]
    .map((identity) => clean(identity).toLowerCase())
    .filter(Boolean)
    .some((identity) => identities.has(identity));
  if (!owned) {
    throw new FileLinkCopyError(
      "Access denied. Department users can link files only from their own Business Needs.",
      403,
      "forbidden",
    );
  }
}

function uniqueReferences(
  document: Record<string, unknown>,
  fields: string[],
): string[] {
  return [...new Set(fields.map((field) => clean(document[field])).filter(Boolean))];
}

function assertBusinessNeedCaseRelationship(
  sourceNeed: Record<string, unknown>,
  targetCase: Record<string, unknown>,
  sourceNeedName: string,
  targetCaseName: string,
): void {
  const targetSources = uniqueReferences(targetCase, [
    "business_need",
    "business_need_id",
  ]);
  if (targetSources.length !== 1 || targetSources[0] !== sourceNeedName) {
    throw new FileLinkCopyError(
      "The target Business Case is not linked to the source Business Need.",
      403,
      "forbidden",
      {
        fieldErrors: {
          target_docname: "The target must be the Business Case created from the source Business Need.",
        },
      },
    );
  }

  // The backlink is populated after initial case creation, so an empty value
  // is valid. A conflicting populated value is not.
  const sourceCases = uniqueReferences(sourceNeed, [
    "business_case",
    "linked_business_case_id",
  ]);
  if (
    sourceCases.length > 1 ||
    (sourceCases.length === 1 && sourceCases[0] !== targetCaseName)
  ) {
    throw new FileLinkCopyError(
      "The source Business Need is linked to a different Business Case.",
      409,
      "conflict",
    );
  }
}

type ValidatedSourceFile = {
  source: PersistedFileLink;
  sourceNeedName: string;
  fileName: string;
  fileUrl: string;
  canonicalFileUrl: string;
  isPrivate: 0 | 1;
  fileSize: number;
};

function validateSourceFile(
  source: PersistedFileLink,
  requestedName: string,
): ValidatedSourceFile {
  exactDocument(source, FILE_DOCTYPE, requestedName);
  const sourceDoctype = clean(source.attached_to_doctype);
  if (sourceDoctype === ECR_DOCTYPE) {
    throw new FileLinkCopyError(
      "Engineering Change Request files cannot be copied or linked through this endpoint.",
      403,
      "forbidden",
      { fieldErrors: { source_file_name: "ECR source files are forbidden." } },
    );
  }
  if (sourceDoctype !== BUSINESS_NEED_DOCTYPE) {
    throw new FileLinkCopyError(
      "The source File must be attached to a Business Need.",
      403,
      "forbidden",
      {
        fieldErrors: {
          source_file_name: "Only persisted Business Need attachments are supported.",
        },
      },
    );
  }
  const sourceNeedName = clean(source.attached_to_name);
  if (!sourceNeedName) {
    throw new FileLinkCopyError(
      "The source File does not have a valid Business Need attachment target.",
      422,
      "validation",
      { fieldErrors: { source_file_name: "The source attachment target is missing." } },
    );
  }
  if (normalizedFlag(source.is_folder) === 1) {
    throw new FileLinkCopyError(
      "Folder records cannot be linked as Business Case attachments.",
      422,
      "validation",
      { fieldErrors: { source_file_name: "The source must be a file, not a folder." } },
    );
  }

  const fileName = clean(source.file_name);
  const fileUrl = clean(source.file_url);
  const canonicalFileUrl = canonicalErpFilePath(fileUrl);
  const isPrivate = normalizedFlag(source.is_private);
  if (!fileName || !fileUrl || !canonicalFileUrl || isPrivate === null) {
    throw new FileLinkCopyError(
      "The persisted source File is missing valid security metadata.",
      422,
      "validation",
      { fieldErrors: { source_file_name: "The source File metadata is incomplete." } },
    );
  }
  if (
    (isPrivate === 1 && !canonicalFileUrl.startsWith("/private/files/")) ||
    (isPrivate === 0 && !canonicalFileUrl.startsWith("/files/"))
  ) {
    throw new FileLinkCopyError(
      "The persisted source File privacy flag does not match its storage path.",
      409,
      "conflict",
      { fieldErrors: { source_file_name: "The source File privacy metadata is inconsistent." } },
    );
  }

  const parsedSize = Number(source.file_size ?? 0);
  const fileSize = Number.isFinite(parsedSize) && parsedSize >= 0
    ? Math.floor(parsedSize)
    : 0;
  return {
    source,
    sourceNeedName,
    fileName,
    fileUrl,
    canonicalFileUrl,
    isPrivate,
    fileSize,
  };
}

function targetLink(
  candidates: PersistedFileLink[],
  source: ValidatedSourceFile,
  targetDocname: string,
): PersistedFileLink | null {
  const unique = new Map<string, PersistedFileLink>();
  for (const candidate of candidates) {
    const name = clean(candidate.name);
    if (!name) {
      throw new FileLinkCopyError(
        "ERPNext returned an invalid target File link.",
        502,
        "erp",
      );
    }
    unique.set(name, candidate);
  }
  if (unique.size > 1) {
    throw new FileLinkCopyError(
      "Multiple File links already point to this Business Case attachment. Resolve the duplicate records before retrying.",
      409,
      "conflict",
    );
  }
  const candidate = [...unique.values()][0];
  if (!candidate) return null;

  const candidateUrl = clean(candidate.file_url);
  const candidateCanonicalUrl = canonicalErpFilePath(candidateUrl);
  const candidatePrivacy = normalizedFlag(candidate.is_private);
  if (
    clean(candidate.attached_to_doctype) !== BUSINESS_CASE_DOCTYPE ||
    clean(candidate.attached_to_name) !== targetDocname ||
    normalizedFlag(candidate.is_folder) === 1 ||
    candidateUrl !== source.fileUrl ||
    candidateCanonicalUrl !== source.canonicalFileUrl ||
    candidatePrivacy !== source.isPrivate
  ) {
    throw new FileLinkCopyError(
      "The existing Business Case File link has conflicting attachment or security metadata.",
      409,
      "conflict",
    );
  }
  return candidate;
}

function targetInsertPayload(
  source: ValidatedSourceFile,
  targetDocname: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    file_name: source.fileName,
    file_url: source.fileUrl,
    file_size: source.fileSize,
    is_private: source.isPrivate,
    is_folder: 0,
    attached_to_doctype: BUSINESS_CASE_DOCTYPE,
    attached_to_name: targetDocname,
  };
  const folder = clean(source.source.folder);
  const contentHash = clean(source.source.content_hash);
  if (folder) payload.folder = folder;
  if (contentHash) payload.content_hash = contentHash;
  return payload;
}

function result(
  created: boolean,
  sourceFileName: string,
  targetDocname: string,
  file: PersistedFileLink,
): FileLinkCopyResult {
  return {
    created,
    source_file_name: sourceFileName,
    target_doctype: BUSINESS_CASE_DOCTYPE,
    target_docname: targetDocname,
    file,
  };
}

function extractErpMessage(payload: unknown, fallback: string): string {
  const value = (payload ?? {}) as {
    message?: string | { message?: string };
    exception?: string;
    exc_type?: string;
    _server_messages?: string;
  };
  if (value._server_messages) {
    try {
      const messages = JSON.parse(value._server_messages) as string[];
      const first = messages[0]
        ? JSON.parse(messages[0]) as { message?: string }
        : null;
      if (first?.message) return first.message;
    } catch {
      // Fall through to the other Frappe error shapes.
    }
  }
  if (typeof value.message === "string" && value.message.trim()) {
    return value.message.trim();
  }
  if (value.message && typeof value.message === "object" && value.message.message) {
    return value.message.message;
  }
  if (value.exception) return value.exception.replace(/^[^:]+:\s*/, "").trim();
  if (value.exc_type) return value.exc_type;
  return fallback;
}

type ErpConfig = { baseUrl: string; key: string; secret: string };

function readConfig(): ErpConfig {
  const baseUrl = (
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL ??
    ""
  ).trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!baseUrl || !key || !secret) {
    throw new FileLinkCopyError(
      "The File link backend is missing ERPNext configuration.",
      500,
      "config",
    );
  }
  return { baseUrl, key, secret };
}

async function erpRequest<T>(
  config: ErpConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${config.baseUrl}/api/${path}`, {
    method,
    headers: {
      Authorization: `token ${config.key}:${config.secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new FileLinkCopyError(
      extractErpMessage(
        payload,
        text || `ERPNext request failed (${response.status}).`,
      ),
      response.status || 502,
      "erp",
      { details: payload },
    );
  }
  const envelope = payload as { data?: T; message?: T };
  return envelope.data !== undefined
    ? envelope.data
    : envelope.message !== undefined
      ? envelope.message
      : payload as T;
}

function createDefaultDependencies(): FileLinkCopyDependencies {
  const config = readConfig();
  const resource = (doctype: string, name?: string) =>
    `resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`;
  return {
    loadDocument: (doctype, name) => erpRequest(
      config,
      "GET",
      resource(doctype, name),
    ),
    findTargetLinks: async ({ targetDoctype, targetDocname, fileUrl }) => {
      const query = new URLSearchParams({
        fields: JSON.stringify([
          "name",
          "file_name",
          "file_url",
          "file_size",
          "is_private",
          "is_folder",
          "folder",
          "content_hash",
          "attached_to_doctype",
          "attached_to_name",
          "attached_to_field",
        ]),
        filters: JSON.stringify([
          ["attached_to_doctype", "=", targetDoctype],
          ["attached_to_name", "=", targetDocname],
          ["file_url", "=", fileUrl],
          ["is_folder", "=", 0],
        ]),
        limit_page_length: "2",
      });
      return erpRequest<PersistedFileLink[]>(
        config,
        "GET",
        `${resource(FILE_DOCTYPE)}?${query.toString()}`,
      );
    },
    insertTargetLink: (payload) => erpRequest(
      config,
      "POST",
      resource(FILE_DOCTYPE),
      payload,
    ),
  };
}

/**
 * Trusted, narrowly scoped File-reference creation for the existing Business
 * Need -> Business Case flow. The browser supplies identifiers only; all file
 * metadata and the source/target relationship are loaded from ERPNext.
 */
export async function copyBusinessNeedFileToCaseCore(
  input: {
    payload: unknown;
    principal: InternalFileLinkPrincipal;
  },
  dependencies?: FileLinkCopyDependencies,
): Promise<FileLinkCopyResult> {
  requireRoles(input.principal, BUSINESS_INTAKE_ROLES);
  const request = parseRequest(input.payload);
  const deps = dependencies ?? createDefaultDependencies();

  let rawSource: Record<string, unknown>;
  try {
    rawSource = await deps.loadDocument(FILE_DOCTYPE, request.sourceFileName);
  } catch (error) {
    if (error instanceof FileLinkCopyError && error.status === 404) {
      throw new FileLinkCopyError(
        "The source File was not found.",
        404,
        "not_found",
        { fieldErrors: { source_file_name: "The persisted source File does not exist." } },
      );
    }
    throw error;
  }
  const source = validateSourceFile(
    rawSource as PersistedFileLink,
    request.sourceFileName,
  );

  const sourceNeed = await deps.loadDocument(
    BUSINESS_NEED_DOCTYPE,
    source.sourceNeedName,
  );
  exactDocument(sourceNeed, BUSINESS_NEED_DOCTYPE, source.sourceNeedName);
  assertSourceAuthorization(input.principal, sourceNeed);

  const targetCase = await deps.loadDocument(
    request.targetDoctype,
    request.targetDocname,
  );
  exactDocument(targetCase, BUSINESS_CASE_DOCTYPE, request.targetDocname);
  assertBusinessNeedCaseRelationship(
    sourceNeed,
    targetCase,
    source.sourceNeedName,
    request.targetDocname,
  );

  const lookup = () => deps.findTargetLinks({
    targetDoctype: request.targetDoctype,
    targetDocname: request.targetDocname,
    fileUrl: source.fileUrl,
  });
  const existing = targetLink(await lookup(), source, request.targetDocname);
  if (existing) {
    return result(false, request.sourceFileName, request.targetDocname, existing);
  }

  try {
    await deps.insertTargetLink(targetInsertPayload(source, request.targetDocname));
  } catch (error) {
    // A committed write whose response was lost, or a concurrent retry, is a
    // successful replay only when exactly one persisted target link now exists.
    const replay = targetLink(await lookup(), source, request.targetDocname);
    if (replay) {
      return result(false, request.sourceFileName, request.targetDocname, replay);
    }
    throw error;
  }

  const verified = targetLink(await lookup(), source, request.targetDocname);
  if (!verified) {
    throw new FileLinkCopyError(
      "ERPNext did not persist the Business Case File link.",
      502,
      "erp",
    );
  }
  return result(true, request.sourceFileName, request.targetDocname, verified);
}
