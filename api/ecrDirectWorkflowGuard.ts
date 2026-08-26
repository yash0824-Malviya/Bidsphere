function record(value: unknown): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === "string") {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return parsed && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return candidate && typeof candidate === "object"
    ? candidate as Record<string, unknown>
    : {};
}

function decodedPath(value: string): string {
  try {
    return decodeURIComponent(value.replace(/^\/+/, ""));
  } catch {
    return value.replace(/^\/+/, "");
  }
}

function parsedValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function documentRecords(value: unknown): Record<string, unknown>[] {
  const parsed = parsedValue(value);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry) => documentRecords(entry));
  }
  if (!parsed || typeof parsed !== "object") return [];
  const candidate = parsed as Record<string, unknown>;
  if (candidate.doctype || candidate.dt) return [candidate];
  return Object.values(candidate).flatMap((entry) => documentRecords(entry));
}

/**
 * Frappe's v1 resource handlers accept a second, JSON-encoded `data` envelope.
 * Reject that alternate shape for ECR writes so mutation-field RBAC always
 * inspects the exact document that ERPNext will persist.
 */
export function hasFrappeResourceDataWrapper(body: unknown, query: unknown): boolean {
  const payload = record(body);
  const queryPayload = record(query);
  return Object.prototype.hasOwnProperty.call(payload, "data") ||
    Object.prototype.hasOwnProperty.call(queryPayload, "data");
}

/** Detect direct ECR workflow calls regardless of whether Frappe args are in the body or query. */
export function isDirectEcrWorkflowRequest(
  apiPath: string,
  body: unknown,
  query: unknown,
): boolean {
  if (decodedPath(apiPath) !== "method/frappe.model.workflow.apply_workflow") return false;
  return requestDoctypeFromBodyOrQuery(body, query) === "Engineering Change Request";
}

/** Resolve Frappe's document type even when a caller moves `doc` into the query string. */
export function requestDoctypeFromBodyOrQuery(body: unknown, query: unknown): string {
  return requestDoctypesFromBodyOrQuery(body, query)[0] || "";
}

/**
 * Resolve every Frappe document type, including bulk_update/insert_many `docs`
 * arrays. The generic proxy runs with a service credential, so overlooking one
 * bulk entry would bypass the protected parent/child mutation guards.
 */
export function requestDoctypesFromBodyOrQuery(body: unknown, query: unknown): string[] {
  const payload = record(body);
  const queryPayload = record(query);
  const document = record(payload.doc);
  const queryDocument = record(queryPayload.doc);
  const doctypes = [
    document.doctype,
    document.reference_doctype,
    document.attached_to_doctype,
    payload.doctype,
    payload.dt,
    payload.reference_doctype,
    payload.attached_to_doctype,
    queryDocument.doctype,
    queryDocument.reference_doctype,
    queryDocument.attached_to_doctype,
    queryPayload.doctype,
    queryPayload.dt,
    queryPayload.reference_doctype,
    queryPayload.attached_to_doctype,
  ].map((value) => String(value || ""));
  for (const candidate of [payload.docs, queryPayload.docs]) {
    for (const bulkDocument of documentRecords(candidate)) {
      doctypes.push(String(bulkDocument.doctype || bulkDocument.dt || ""));
    }
  }
  return [...new Set(doctypes.map((value) => value.trim()).filter(Boolean))];
}
