const QUERY_PAYLOAD_KEYS = new Set([
  "data",
  "doctype",
  "dt",
  "doc",
  "docs",
  "reference_doctype",
  "attached_to_doctype",
  "select_pxfp",
  "docstatus",
  "approval_requirements",
]);

export class ProxyRequestError extends Error {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ProxyRequestError";
  }
}

function normalizedPath(value: string): string {
  try {
    return decodeURIComponent(value.replace(/^\/+/, "").replace(/\+/g, " "));
  } catch {
    return value.replace(/^\/+/, "");
  }
}

export function assertSafeProxyQuery(input: {
  apiPath: string;
  method: string;
  query?: Record<string, unknown>;
}): void {
  const entries = Object.entries(input.query ?? {});
  const keys = entries.map(([key]) => key.toLowerCase());
  if (keys.includes("cmd")) {
    throw new ProxyRequestError(
      "The legacy cmd query dispatcher is disabled on the ERP gateway.",
    );
  }

  const method = input.method.toUpperCase();
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  for (const [key, value] of entries) {
    if (Array.isArray(value) && value.length > 1 && (mutation || QUERY_PAYLOAD_KEYS.has(key.toLowerCase()))) {
      throw new ProxyRequestError(`Duplicate query parameter '${key}' is not allowed.`);
    }
  }
  if (!mutation) return;

  const path = normalizedPath(input.apiPath);
  const isEcrResource =
    path === "resource/Engineering Change Request" ||
    path.startsWith("resource/Engineering Change Request/");
  const unsafePayloadKeys = keys.filter((key) => QUERY_PAYLOAD_KEYS.has(key));
  if (isEcrResource) {
    const nonRouting = keys.filter((key) => !["path", "access_token", "token"].includes(key));
    if (nonRouting.length > 0) {
      throw new ProxyRequestError(
        "ECR mutation values must be supplied in one inspected JSON body, not query parameters.",
      );
    }
  } else if (unsafePayloadKeys.length > 0) {
    throw new ProxyRequestError(
      `Mutation query payloads are disabled (${unsafePayloadKeys.join(", ")}).`,
    );
  }
}

function parsedBody(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Frappe consults a top-level `cmd` value before normal `/api/...` routing.
 * Never allow the inspected path to be replaced after gateway authorization.
 */
export function assertSafeProxyBody(input: {
  apiPath: string;
  method: string;
  body?: unknown;
}): void {
  const method = input.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  const body = parsedBody(input.body);
  if (!body) return;
  if (Object.keys(body).some((key) => key.toLowerCase() === "cmd")) {
    throw new ProxyRequestError(
      "The legacy cmd body dispatcher is disabled on the ERP gateway.",
    );
  }
}
