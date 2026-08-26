import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sanitizeErpPayloadDates } from "./erpDateSanitize.js";
import {
  enforceEcrMutationRbac,
  enforcePayablesMutationRbac,
  enforcePrMutationRbac,
  RbacError,
  requireAnyAuth,
  requireInternalAuth,
  requireRoles,
  type AccessPrincipal,
} from "./rbacAuth.js";
import {
  assertEcrLinkedPrUsesTrustedEndpoint,
  assertEcrProcurementRelationships,
  EcrProcurementValidationError,
  purchaseRequisitionEcrReferenceForCreate,
  type EcrProcurementDocument,
} from "./ecrProcurementValidation.js";
import {
  hasProtectedRfqTraceMutation,
  PROTECTED_RFQ_TRACE_MUTATION_MESSAGE,
} from "./rfqTraceGuard.js";
import {
  protectedChildAccessDenial,
  protectedChildAccessMessage,
  protectedChildRequestDoctypeFromMany,
} from "./protectedChildGuard.js";
import {
  isReadOnlyGenericDocumentMethod,
  sanitizeSupplierProcurementDocument,
  supplierOwnsProcurementDocument,
  supplierSafeProcurementFields,
  supplierScopedProcurementFilters,
  type ProcurementReadDoctype,
} from "./procurementReadScope.js";
import {
  assertSupportedErpProxyPath,
  canonicalizeProxyApiPath,
  ProxyPathError,
} from "./proxyPathGuard.js";
import {
  hasFrappeResourceDataWrapper,
  isDirectEcrWorkflowRequest,
  requestDoctypeFromBodyOrQuery,
  requestDoctypesFromBodyOrQuery,
} from "./ecrDirectWorkflowGuard.js";
import { multipartProxyPolicy } from "./multipartProxyGuard.js";
import {
  assertErpProxySecurityBoundary,
  ErpProxySecurityError,
} from "./erpProxySecurityGuard.js";
import {
  assertSecureEcrUpload,
  isTemporaryQuotationDocname,
  parseSecureUpload,
  SecureUploadError,
  supplierOwnsUploadTarget,
  type ParsedSecureUpload,
} from "./secureUploadGuard.js";
import {
  assertNoGenericFileAccess,
  authorizeFileResourceRequest,
  fileResourceRoute,
} from "./fileResourceGuard.js";
import {
  assertSafeProxyBody,
  assertSafeProxyQuery,
  ProxyRequestError,
} from "./proxyRequestGuard.js";
import { buildEngineerEcrReadScope } from "./ecrReadScope.js";

console.log("[erpnext-proxy] module loaded");

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-encoding",
  "content-security-policy",
  "x-frame-options",
]);

function readErpnextBaseUrl(): string {
  const raw =
    process.env.ERPNEXT_URL ??
    process.env.VITE_PROXY_TARGET ??
    process.env.VITE_ERPNEXT_URL;

  if (!raw?.trim()) {
    throw new Error(
      "Missing ERPNEXT_URL. Set it in Vercel → Project → Settings → Environment Variables."
    );
  }

  return raw.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function readApiCredentials(): { key: string; secret: string } | null {
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY ?? "";
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET ?? "";
  if (!key || !secret) return null;
  return { key, secret };
}

/**
 * The ERPNext path comes from the `path` query param injected by the
 * vercel.json rewrite (`/api/(.*)` → `/api/proxy?path=$1`).
 */
function apiPathFromQuery(query: VercelRequest["query"]): string {
  const segments = query.path;
  const raw = Array.isArray(segments)
    ? segments.map(String).join("/")
    : typeof segments === "string"
      ? segments
      : "";
  const canonical = canonicalizeProxyApiPath(raw);
  if (canonical) assertSupportedErpProxyPath(canonical);
  return canonical;
}

/**
 * Re-create the upstream query string from every param EXCEPT `path`
 * (which is the routing param, not part of the real ERPNext request).
 */
function buildSearch(query: VercelRequest["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else if (value !== undefined) {
      params.append(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

function buildTargetUrl(query: VercelRequest["query"], apiPath: string): string {
  const base = readErpnextBaseUrl();
  return `${base}/api/${apiPath}${buildSearch(query)}`;
}

function upstreamHeaders(req: VercelRequest): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const contentType = req.headers["content-type"];
  if (typeof contentType === "string") {
    headers["Content-Type"] = contentType;
  } else if (req.method !== "GET" && req.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }

  const creds = readApiCredentials();
  if (creds) {
    headers.Authorization = `token ${creds.key}:${creds.secret}`;
  }

  return headers;
}

function serializeBody(req: VercelRequest, method: string): string | undefined {
  if (method === "GET" || method === "HEAD") return undefined;

  // Convert ISO-8601 date/datetime strings before they reach MariaDB
  // (OperationalError 1292). Applies to every mutating ERP proxy write.
  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body) as unknown;
      return JSON.stringify(sanitizeErpPayloadDates(parsed));
    } catch {
      return req.body;
    }
  }
  if (req.body !== undefined && req.body !== null) {
    return JSON.stringify(sanitizeErpPayloadDates(req.body));
  }
  return undefined;
}

function normalizedApiPath(apiPath: string): string {
  try {
    return decodeURIComponent(apiPath.replace(/^\/+/, "").replace(/\+/g, " "));
  } catch {
    return apiPath.replace(/^\/+/, "");
  }
}

function ecrResourceName(apiPath: string): string | null {
  const path = normalizedApiPath(apiPath);
  const prefix = "resource/Engineering Change Request/";
  return path.startsWith(prefix) ? path.slice(prefix.length).split("/")[0] || null : null;
}

function prResourceName(apiPath: string): string | null {
  const path = normalizedApiPath(apiPath);
  const prefix = "resource/Purchase Requisition/";
  return path.startsWith(prefix) ? path.slice(prefix.length).split("/")[0] || null : null;
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function ecrReferenceFromRequest(
  apiPath: string,
  body: unknown,
  query: VercelRequest["query"],
): string | null {
  const resourceName = ecrResourceName(apiPath);
  if (resourceName) return resourceName;
  const path = normalizedApiPath(apiPath);
  const payload = bodyRecord(body);
  const doc = bodyRecord(payload.doc);
  if (
    path === "method/frappe.model.workflow.apply_workflow" &&
    String(doc.doctype || "") === "Engineering Change Request"
  ) {
    return String(doc.name || "") || null;
  }
  if (
    path === "resource/Comment" &&
    String(payload.reference_doctype || "") === "Engineering Change Request"
  ) {
    return String(payload.reference_name || "") || null;
  }
  if (path === "method/frappe.model.workflow.get_transitions") {
    try {
      const raw = Array.isArray(query.doc) ? query.doc[0] : query.doc;
      const transitionDoc = JSON.parse(String(raw || "{}")) as { doctype?: string; name?: string };
      return transitionDoc.doctype === "Engineering Change Request" ? transitionDoc.name || null : null;
    } catch {
      return null;
    }
  }
  return null;
}

interface EcrSecuritySnapshot {
  name: string;
  select_pxfp?: string;
  ecr_owner?: string;
  amended_from?: string;
  owner?: string;
}

async function readErpResource<T extends object>(
  doctype: string,
  name: string,
): Promise<T> {
  const creds = readApiCredentials();
  if (!creds) throw new Error("ERP API credentials are not configured.");
  const response = await fetch(
    `${readErpnextBaseUrl()}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `token ${creds.key}:${creds.secret}`,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new RbacError(`${doctype} not found.`, 403);
  const payload = (await response.json()) as { data?: T };
  if (!payload.data) throw new RbacError(`${doctype} not found.`, 403);
  return payload.data;
}

async function readEcrSecuritySnapshot(name: string): Promise<EcrSecuritySnapshot> {
  const creds = readApiCredentials();
  if (!creds) throw new Error("ERP API credentials are not configured.");
  const fields = encodeURIComponent(JSON.stringify(["name", "select_pxfp", "ecr_owner", "amended_from", "owner"]));
  const response = await fetch(
    `${readErpnextBaseUrl()}/api/resource/${encodeURIComponent("Engineering Change Request")}/${encodeURIComponent(name)}?fields=${fields}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `token ${creds.key}:${creds.secret}`,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new RbacError("Engineering Change Request not found.", 403);
  const payload = (await response.json()) as { data?: EcrSecuritySnapshot };
  if (!payload.data) throw new RbacError("Engineering Change Request not found.", 403);
  return payload.data;
}

async function validateEcrProcurementDocument(
  document: Record<string, unknown>,
): Promise<void> {
  await assertEcrProcurementRelationships(
    document,
    (doctype, name) => readErpResource<EcrProcurementDocument>(doctype, name),
  );
}

function isEcrOwner(
  principal: Extract<AccessPrincipal, { typ: "internal" }>,
  snapshot: EcrSecuritySnapshot,
): boolean {
  const identities = new Set([principal.sub, principal.email].map((value) => value.trim().toLowerCase()));
  return [snapshot.ecr_owner, snapshot.amended_from, snapshot.owner]
    .filter(Boolean)
    .some((value) => identities.has(String(value).trim().toLowerCase()));
}

function appendEngineerOwnerFilter(
  req: VercelRequest,
  principal: Extract<AccessPrincipal, { typ: "internal" }>,
): void {
  try {
    const scope = buildEngineerEcrReadScope(req.query.filters, principal);
    req.query.filters = scope.filters;
    req.query.or_filters = scope.orFilters;
  } catch (error) {
    throw new RbacError(
      error instanceof Error ? error.message : "Invalid ECR filters.",
      403,
    );
  }
}

function responseHeaders(upstream: Response): Record<string, string> {
  const out: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    // Never forward ERPNext session cookies to the SPA browser. Cookies are
    // host-scoped (not port-scoped), so a Set-Cookie for `sid` on the app
    // origin would overwrite ERP Desk's session on the same host.
    if (lower === "set-cookie") return;
    out[key] = value;
  });
  return out;
}

async function readMultipartBody(req: VercelRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) throw new SecureUploadError("The multipart upload body is unavailable.");
  return raw;
}

async function authorizeMultipartUpload(
  principal: AccessPrincipal,
  upload: ParsedSecureUpload,
): Promise<void> {
  assertErpProxySecurityBoundary({
    apiPath: "method/upload_file",
    method: "POST",
    principalRole: principal.typ === "internal" ? principal.role : undefined,
    requestDoctypes: upload.doctype ? [upload.doctype] : [],
  });
  if (!upload.doctype) return;

  if (upload.doctype === "Engineering Change Request") {
    if (principal.typ !== "internal") {
      throw new RbacError("Forbidden. Internal authentication required for ECR uploads.", 403);
    }
    assertSecureEcrUpload(upload);
    const snapshot = await readEcrSecuritySnapshot(upload.docname);
    enforceEcrMutationRbac(
      principal,
      `resource/Engineering Change Request/${encodeURIComponent(upload.docname)}`,
      "PUT",
      { [upload.fieldname]: `/private/files/${upload.fileName}` },
      snapshot.select_pxfp,
      snapshot,
    );
    return;
  }

  if (principal.typ === "supplier") {
    let target: Record<string, unknown> | null = null;
    const isolatedTemporaryQuotation =
      upload.doctype === "Supplier Quotation" &&
      isTemporaryQuotationDocname(upload.docname, principal.supplier);
    if (!isolatedTemporaryQuotation) {
      target = await readErpResource<Record<string, unknown>>(upload.doctype, upload.docname);
    }
    if (!supplierOwnsUploadTarget(principal.supplier, upload, target)) {
      throw new RbacError("Access denied. This upload target is not assigned to your supplier account.", 403);
    }
    return;
  }

  // Internal uploads may target ordinary business records, but the target must
  // exist; security metadata was already blocked above.
  await readErpResource<Record<string, unknown>>(upload.doctype, upload.docname);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  let apiPath: string;
  try {
    apiPath = apiPathFromQuery(req.query);
  } catch (error) {
    const message = error instanceof ProxyPathError
      ? error.message
      : "Invalid ERPNext API path.";
    res.status(400).json({ error: message });
    return;
  }

  // ── TEMPORARY DIAGNOSTICS (remove once deployment is confirmed) ──────────
  // Proves the function is invoked and shows the route Vercel funneled in.
  console.log(`[erpnext-proxy] invoked: ${req.method ?? "GET"} /api/${apiPath}`);

  // Health check that does NOT touch ERPNext — confirms routing reaches this
  // function. GET /api/method/ping → {message:"pong"}
  if (apiPath === "method/ping") {
    res.status(200).json({ message: "pong" });
    return;
  }

  // Browser session login/logout must never go through this proxy — Frappe
  // would Set-Cookie `sid` and collide with ERP Desk on the same host.
  // Use /api/auth/login and /api/auth/logout instead.
  if (apiPath === "method/login" || apiPath === "method/logout") {
    res.status(410).json({
      error:
        "Browser session login is disabled. Use /api/auth/login instead.",
    });
    return;
  }

  // RBAC: mutating ERP proxy calls require a BidSphere access token.
  // GET/HEAD may proceed without one so pre-login pages (e.g. supplier
  // company picker) still work; custom APIs enforce stricter role checks.
  const method = (req.method ?? "GET").toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const isFileRequest =
    fileResourceRoute(apiPath).isFileResource ||
    requestDoctypesFromBodyOrQuery(req.body, req.query).includes("File");
  try {
    assertSafeProxyQuery({
      apiPath,
      method,
      query: req.query as Record<string, unknown>,
    });
    assertSafeProxyBody({ apiPath, method, body: req.body });
  } catch (error) {
    const status = error instanceof ProxyRequestError ? error.status : 400;
    res.status(status).json({
      error: error instanceof Error ? error.message : "Invalid ERP query parameters.",
    });
    return;
  }
  let principal: AccessPrincipal | null = null;
  let multipartRawBody: Buffer | undefined;
  if (isMutation || isFileRequest) {
    try {
      principal = requireAnyAuth(
        req.headers as Record<string, unknown>,
        typeof req.body === "object" && req.body
          ? (req.body as Record<string, unknown>)
          : undefined,
        req.query as Record<string, unknown>,
      );
      // Finance payables: invoice / payment / voucher mutations are role-gated.
      enforcePayablesMutationRbac(principal, apiPath, method, req.body);
    } catch (err) {
      if (err instanceof RbacError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(401).json({ error: "Not authenticated." });
      return;
    }
  } else {
    // Prefer validating token when present (rejects expired/forged tokens)
    const headerToken =
      (req.headers["x-bidsphere-access-token"] as string | undefined) ||
      (req.headers["X-Bidsphere-Access-Token"] as string | undefined);
    if (headerToken) {
      try {
        principal = requireAnyAuth(req.headers as Record<string, unknown>);
      } catch (err) {
        if (err instanceof RbacError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
      }
    }
  }

  const multipartPolicy = multipartProxyPolicy(apiPath, req.headers["content-type"]);
  if (multipartPolicy === "reject") {
    res.status(415).json({
      error: "Multipart payloads are allowed only for the authenticated file upload endpoint.",
    });
    return;
  }
  if (multipartPolicy === "authenticated-upload") {
    try {
      if (!principal) throw new RbacError("Not authenticated.", 401);
      multipartRawBody = await readMultipartBody(req);
      const upload = await parseSecureUpload(
        new Uint8Array(multipartRawBody),
        String(req.headers["content-type"] || ""),
      );
      await authorizeMultipartUpload(principal, upload);
    } catch (error) {
      const status = error instanceof RbacError || error instanceof SecureUploadError
        ? error.status
        : 400;
      res.status(status).json({
        error: error instanceof Error ? error.message : "Invalid file upload.",
      });
      return;
    }
  }

  // ECR reads and writes always require an internal identity. The ERP proxy
  // uses a service credential upstream, so ownership and workflow checks must
  // happen here before forwarding the request.
  try {
    const normalizedPath = normalizedApiPath(apiPath);
    const requestPayload = bodyRecord(req.body);
    const requestDocument = bodyRecord(requestPayload.doc);
    const requestQuery = bodyRecord(req.query);
    const isFileResource =
      normalizedPath === "resource/File" || normalizedPath.startsWith("resource/File/");
    if (isFileResource) {
      if (!principal) throw new RbacError("Not authenticated.", 401);
      await authorizeFileResourceRequest({
        apiPath: normalizedPath,
        method,
        principal,
        body: requestPayload,
        query: req.query as Record<string, unknown>,
        loadDocument: (doctype, name) =>
          readErpResource<Record<string, unknown>>(doctype, name),
      });
    }
    const requestTransitionDocument = bodyRecord(
      Array.isArray(requestQuery.doc) ? requestQuery.doc[0] : requestQuery.doc,
    );
    let commentReadDoctype = "";
    let commentReadName = "";
    if (!isMutation && normalizedPath === "resource/Comment") {
      try {
        const filters = JSON.parse(String(requestQuery.filters || "[]")) as unknown[];
        for (const filter of filters) {
          if (!Array.isArray(filter)) continue;
          const field = String(filter.length >= 4 ? filter[1] : filter[0] || "");
          const operator = String(filter.length >= 4 ? filter[2] : filter[1] || "");
          const value = String(filter.length >= 4 ? filter[3] : filter[2] || "");
          if (operator !== "=") continue;
          if (field === "reference_doctype") commentReadDoctype = value;
          if (field === "reference_name") commentReadName = value;
        }
      } catch {
        // The authenticated Comment guard below returns a consistent denial.
      }
    }
    const requestDoctypes = requestDoctypesFromBodyOrQuery(req.body, req.query);
    const requestDoctype = requestDoctypeFromBodyOrQuery(req.body, req.query) ||
      String(requestTransitionDocument.doctype || "");
    assertNoGenericFileAccess(normalizedPath, [requestDoctype, ...requestDoctypes]);
    if (isMutation && principal) {
      assertErpProxySecurityBoundary({
        apiPath: normalizedPath,
        method,
        principalRole: principal.typ === "internal" ? principal.role : undefined,
        requestDoctypes: [requestDoctype, ...requestDoctypes],
      });
    }
    if (isDirectEcrWorkflowRequest(apiPath, req.body, req.query)) {
      throw new RbacError(
        "ECR workflow actions must use the secured /api/ecr-workflow-action endpoint.",
        403,
      );
    }
    const isAllowedEcrMethod = [
      "method/frappe.model.workflow.get_transitions",
    ].includes(normalizedPath);
    const isEcrGenericRequest =
      normalizedPath.startsWith("method/") &&
      !isAllowedEcrMethod &&
      (requestDoctype === "Engineering Change Request" ||
        requestDoctypes.includes("Engineering Change Request"));
    const isEcrResource =
      normalizedPath === "resource/Engineering Change Request" ||
      normalizedPath.startsWith("resource/Engineering Change Request/");
    if (isMutation && isEcrResource && hasFrappeResourceDataWrapper(req.body, req.query)) {
      throw new RbacError(
        "Wrapped data payloads are not allowed for Engineering Change Request mutations.",
        403,
      );
    }
    const isRfqResource =
      normalizedPath === "resource/Request for Quotation" ||
      normalizedPath.startsWith("resource/Request for Quotation/");
    const isPurchaseOrderResource =
      normalizedPath === "resource/Purchase Order" ||
      normalizedPath.startsWith("resource/Purchase Order/");
    const isRfqGenericRequest =
      normalizedPath.startsWith("method/") &&
      requestDoctype === "Request for Quotation";
    const isReadOnlyGenericDocumentRequest =
      isReadOnlyGenericDocumentMethod(normalizedPath);
    const isPurchaseOrderGenericRequest =
      normalizedPath.startsWith("method/") &&
      requestDoctype === "Purchase Order";
    const isPrResource =
      normalizedPath === "resource/Purchase Requisition" ||
      normalizedPath.startsWith("resource/Purchase Requisition/");
    const isPrWorkflow =
      normalizedPath === "method/frappe.model.workflow.apply_workflow" &&
      requestDoctype === "Purchase Requisition";
    const isPrGenericRequest =
      normalizedPath.startsWith("method/") &&
      !isPrWorkflow &&
      requestDoctype === "Purchase Requisition";
    const isPrCommentMutation =
      normalizedPath === "resource/Comment" &&
      String(requestPayload.reference_doctype || "") === "Purchase Requisition";
    const isPrCommentRead =
      !isMutation &&
      normalizedPath === "resource/Comment" &&
      commentReadDoctype === "Purchase Requisition";
    const protectedChildDoctype = protectedChildRequestDoctypeFromMany(
      normalizedPath,
      [requestDoctype, ...requestDoctypes],
    );

    if (protectedChildDoctype) {
      const childPrincipal = requireAnyAuth(
        req.headers as Record<string, unknown>,
        requestPayload,
        req.query as Record<string, unknown>,
      );
      const denial = protectedChildAccessDenial({
        apiPath: normalizedPath,
        requestDoctype: protectedChildDoctype,
        method,
        principalType: childPrincipal.typ,
      });
      if (denial) throw new RbacError(protectedChildAccessMessage(denial), 403);
      principal = childPrincipal;
    }

    if (!isMutation && normalizedPath === "resource/Comment") {
      const commentPrincipal = requireAnyAuth(
        req.headers as Record<string, unknown>,
        requestPayload,
        req.query as Record<string, unknown>,
      );
      if (commentPrincipal.typ === "supplier") {
        throw new RbacError(
          "Supplier comment access must use a supplier-scoped portal endpoint.",
          403,
        );
      }
      if (!commentReadDoctype || !commentReadName) {
        throw new RbacError(
          "Comment reads require exact reference_doctype and reference_name filters.",
          403,
        );
      }
      principal = commentPrincipal;
    }

    if (
      isPrResource ||
      isPrWorkflow ||
      isPrGenericRequest ||
      isPrCommentMutation ||
      isPrCommentRead
    ) {
      const prPrincipal = requireInternalAuth(
        req.headers as Record<string, unknown>,
        requestPayload,
        req.query as Record<string, unknown>,
      );
      requireRoles(
        prPrincipal,
        isMutation
          ? ["procurement_team", "procurement"]
          : [
              "engineer",
              "engineering",
              "operations",
              "quality",
              "program_manager",
              "procurement_team",
              "procurement",
            ],
      );
      principal = prPrincipal;
      if (isMutation) {
        const sourceEcrName = purchaseRequisitionEcrReferenceForCreate(
          normalizedPath,
          method,
          requestPayload,
          requestDocument,
        );
        if (sourceEcrName) {
          assertEcrLinkedPrUsesTrustedEndpoint(sourceEcrName);
        }

        let currentPrStatus: string | undefined;
        if (isPrWorkflow) {
          const prName = String(requestDocument.name || "").trim();
          if (!prName) throw new RbacError("Purchase Requisition is required.", 403);
          const pr = await readErpResource<{ status?: string }>(
            "Purchase Requisition",
            prName,
          );
          currentPrStatus = pr.status;
        } else if (["PUT", "PATCH", "DELETE"].includes(method)) {
          const prName = prResourceName(apiPath);
          if (!prName) throw new RbacError("Purchase Requisition is required.", 403);
          const pr = await readErpResource<{ status?: string }>(
            "Purchase Requisition",
            prName,
          );
          currentPrStatus = pr.status;
        }
        enforcePrMutationRbac(
          prPrincipal,
          apiPath,
          method,
          req.body,
          currentPrStatus,
        );
      }
    }

    if (
      principal?.typ === "supplier" &&
      ((!isMutation && (isPurchaseOrderResource || isRfqResource)) ||
        (isReadOnlyGenericDocumentRequest &&
          (isPurchaseOrderGenericRequest || isRfqGenericRequest)))
    ) {
      const doctype: ProcurementReadDoctype =
        isRfqResource || isRfqGenericRequest
          ? "Request for Quotation"
          : "Purchase Order";
        const resourcePrefix = `resource/${doctype}/`;
        const resourceName = normalizedPath.startsWith(resourcePrefix)
          ? normalizedPath.slice(resourcePrefix.length).split("/")[0] || ""
          : "";
        const genericName = isReadOnlyGenericDocumentRequest
          ? String(requestPayload.name || requestQuery.name || "").trim()
          : "";
        const documentName = resourceName || genericName;
        if (documentName) {
          const document = await readErpResource<Record<string, unknown>>(
            doctype,
            documentName,
          );
          if (!supplierOwnsProcurementDocument(doctype, document, principal.supplier)) {
            throw new RbacError("Access denied. This procurement document is not assigned to your supplier account.", 403);
          }
          const sanitized = sanitizeSupplierProcurementDocument(
            doctype,
            document,
            principal.supplier,
          );
          if (method === "HEAD") {
            res.status(200).end();
          } else if (resourceName) {
            res.status(200).json({ data: sanitized });
          } else {
            res.status(200).json({ message: sanitized });
          }
          return;
        } else {
          const scopedFilters = supplierScopedProcurementFilters(
            doctype,
            principal.supplier,
            isMutation ? requestPayload.filters : requestQuery.filters,
          );
          const requestedFields = isMutation
            ? requestPayload.fields || requestPayload.fieldname
            : requestQuery.fields || requestQuery.fieldname;
          const safeFields = supplierSafeProcurementFields(doctype, requestedFields);
          if (isMutation) {
            req.body = {
              ...requestPayload,
              filters: scopedFilters,
              ...(normalizedPath === "method/frappe.client.get_value"
                ? { fieldname: safeFields.length === 1 ? safeFields[0] : safeFields }
                : normalizedPath === "method/frappe.client.get_count"
                  ? {}
                  : { fields: safeFields }),
            };
          } else {
            req.query.filters = JSON.stringify(scopedFilters);
            if (normalizedPath === "method/frappe.client.get_value") {
              req.query.fieldname = JSON.stringify(safeFields);
            } else if (normalizedPath !== "method/frappe.client.get_count") {
              req.query.fields = JSON.stringify(safeFields);
            }
          }
        }
    }
    if (
      (isMutation && isRfqResource) ||
      (isRfqGenericRequest && !isReadOnlyGenericDocumentRequest)
    ) {
      const rfqPrincipal = requireInternalAuth(
        req.headers as Record<string, unknown>,
        requestPayload,
        req.query as Record<string, unknown>,
      );
      requireRoles(rfqPrincipal, ["procurement", "procurement_team", "admin"]);
      principal = rfqPrincipal;
      if (hasProtectedRfqTraceMutation(requestPayload, requestDocument, requestQuery)) {
        throw new RbacError(
          PROTECTED_RFQ_TRACE_MUTATION_MESSAGE,
          403,
        );
      }
    }
    if (
      (isMutation && isPurchaseOrderResource) ||
      (isPurchaseOrderGenericRequest && !isReadOnlyGenericDocumentRequest)
    ) {
      const poPrincipal = requireInternalAuth(
        req.headers as Record<string, unknown>,
        requestPayload,
        req.query as Record<string, unknown>,
      );
      requireRoles(poPrincipal, ["procurement_team"]);
      principal = poPrincipal;
    }
    const transitionEcrName = ecrReferenceFromRequest(apiPath, req.body, req.query);
    const isEcrCommentRead =
      method === "GET" &&
      normalizedPath === "resource/Comment" &&
      commentReadDoctype === "Engineering Change Request";

    const touchesEcr =
      isEcrResource || Boolean(transitionEcrName) || isEcrCommentRead || isEcrGenericRequest;
    if (touchesEcr) {
      const internal = requireInternalAuth(
        req.headers as Record<string, unknown>,
        typeof req.body === "object" && req.body
          ? (req.body as Record<string, unknown>)
          : undefined,
        req.query as Record<string, unknown>,
      );
      principal = internal;
      requireRoles(internal, [
        "engineer",
        "engineering",
        "operations",
        "quality",
        "program_manager",
        "procurement_team",
        "procurement",
      ]);

      if (isEcrGenericRequest) {
        throw new RbacError(
          "Generic ERP document methods are disabled for Engineering Change Requests. Use the secured ECR resource endpoint.",
          403,
        );
      }

      if (isEcrResource && method === "GET" && !ecrResourceName(apiPath) && internal.role === "engineer") {
        appendEngineerOwnerFilter(req, internal);
      }

      const securedName = transitionEcrName || commentReadName || ecrResourceName(apiPath);
      let snapshot: EcrSecuritySnapshot | null = null;
      if (securedName) {
        snapshot = await readEcrSecuritySnapshot(securedName);
        if (internal.role === "engineer" && !isEcrOwner(internal, snapshot)) {
          throw new RbacError("Access denied. Engineers can access only their own ECRs.", 403);
        }
      }

      if (isMutation) {
        // Do not allow a creator to assign a new ECR to another identity.
        if (
          normalizedPath === "resource/Engineering Change Request" &&
          method === "POST" &&
          internal.role === "engineer" &&
          req.body && typeof req.body === "object"
        ) {
          const owner = (internal.email || internal.sub).trim();
          (req.body as Record<string, unknown>).ecr_owner = owner.includes("@")
            ? owner.toLowerCase()
            : owner;
          delete (req.body as Record<string, unknown>).amended_from;
        }
        enforceEcrMutationRbac(
          internal,
          apiPath,
          method,
          req.body,
          snapshot?.select_pxfp,
          snapshot,
        );

        const mutationBody = req.body && typeof req.body === "object"
          ? req.body as Record<string, unknown>
          : {};
        const resourceName = ecrResourceName(apiPath);
        const isEcrDocumentWrite = isEcrResource && ["POST", "PUT", "PATCH"].includes(method);
        if (isEcrDocumentWrite) {
          const candidate = resourceName
            ? {
                ...await readErpResource<Record<string, unknown>>(
                  "Engineering Change Request",
                  resourceName,
                ),
                ...mutationBody,
              }
            : mutationBody;
          await validateEcrProcurementDocument(candidate);
        }

        const workflowAction = typeof mutationBody.action === "string"
          ? mutationBody.action
          : "";
        if (
          transitionEcrName &&
          ["Submit ECR", "Re-Submit after Revision"].includes(workflowAction)
        ) {
          const currentEcr = await readErpResource<Record<string, unknown>>(
            "Engineering Change Request",
            transitionEcrName,
          );
          await validateEcrProcurementDocument(currentEcr);
        }
      }
    } else if (isMutation && principal) {
      // Purchase Requisition creation and other ECR-adjacent mutations do not
      // carry an ECR reference in the URL but are still role-gated.
      enforceEcrMutationRbac(principal, apiPath, method, req.body);
    }
  } catch (err) {
    if (err instanceof EcrProcurementValidationError) {
      res.status(err.status).json({
        error: err.message,
        message: err.message,
        field_errors: err.fieldErrors,
      });
      return;
    }
    if (err instanceof RbacError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof ErpProxySecurityError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(403).json({ error: "Unable to verify ECR access." });
    return;
  }

  let targetUrl: string;
  try {
    if (!apiPath) {
      res.status(400).json({ error: "Missing ERPNext API path." });
      return;
    }
    targetUrl = buildTargetUrl(req.query, apiPath);
    // TEMPORARY: shows the resolved ERPNEXT_URL + full upstream target.
    console.log(`[erpnext-proxy] forwarding to: ${targetUrl}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy misconfigured.";
    console.error("[erpnext-proxy] config:", message);
    res.status(500).json({ error: message });
    return;
  }

  const body = multipartRawBody ?? serializeBody(req, method);

  if (
    method === "POST" &&
    (apiPath === "resource/Budget" || apiPath.startsWith("resource/Budget/"))
  ) {
    let parsedBody: unknown = req.body;
    if (typeof parsedBody === "string") {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        /* keep raw string */
      }
    }
    console.log("[erpnext-proxy] Budget POST body → ERPNext:", JSON.stringify(parsedBody));
  }

  // Structured resource-list diagnostics (DocType / fields / filters).
  const resourceMatch = /^resource\/([^/?]+)/.exec(apiPath);
  if (resourceMatch && method === "GET") {
    const doctype = decodeURIComponent(resourceMatch[1].replace(/\+/g, " "));
    const q = req.query as Record<string, string | string[] | undefined>;
    const rawFields = q.fields;
    const rawFilters = q.filters;
    let fields: unknown = rawFields;
    let filters: unknown = rawFilters;
    try {
      if (typeof rawFields === "string") fields = JSON.parse(rawFields);
    } catch {
      /* keep raw */
    }
    try {
      if (typeof rawFilters === "string") filters = JSON.parse(rawFilters);
    } catch {
      /* keep raw */
    }
    console.log("[erpnext-proxy] ERP list query", {
      doctype,
      fields,
      filters,
      order_by: q.order_by ?? null,
      path: apiPath,
    });
  }

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers: upstreamHeaders(req),
      body,
      signal: AbortSignal.timeout(30_000),
    });

    const headers = responseHeaders(upstream);

    // TEMPORARY: the EXACT set of header names forwarded to the browser.
    // `content-encoding` and `content-length` must NOT appear here.
    console.log("[DOWNSTREAM HEADERS]", Object.keys(headers));

    // Apply ONLY the filtered headers. Nothing below re-adds content-encoding;
    // res.json()/res.send() set a fresh, correct content-length themselves.
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }

    // `fetch` has already decompressed the body. For JSON, re-send a parsed
    // object; otherwise forward the (already-decompressed) raw bytes.
    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await upstream.json();
      console.log(
        "[JSON RESPONSE]",
        upstream.status,
        upstream.headers.get("content-encoding")
      );
      const errText = JSON.stringify(data);
      if (
        !upstream.ok &&
        /Field not permitted in query/i.test(errText)
      ) {
        console.error("[erpnext-proxy] INVALID FIELD in ERP query", {
          status: upstream.status,
          path: apiPath,
          targetUrl,
          response: data,
        });
      } else if (resourceMatch && method === "GET") {
        const rows = (data as { data?: unknown })?.data;
        console.log("[erpnext-proxy] ERP response", {
          doctype: decodeURIComponent(resourceMatch[1].replace(/\+/g, " ")),
          status: upstream.status,
          count: Array.isArray(rows) ? rows.length : rows ? 1 : 0,
        });
      }
      res.status(upstream.status).json(data);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    console.log(
      "[BUFFER RESPONSE]",
      upstream.status,
      buffer.length,
      upstream.headers.get("content-encoding")
    );
    res.status(upstream.status).send(buffer);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy request failed.";
    console.error("[erpnext-proxy] upstream unreachable", {
      targetUrl,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(502).json({
      error:
        "Unable to reach the application server. Please try again in a few seconds.",
      exc_type: "ProxyUpstreamError",
    });
  }
}
