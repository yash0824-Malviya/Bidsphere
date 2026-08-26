export class ProxyPathError extends Error {
  constructor(message = "Invalid ERPNext API path.") {
    super(message);
    this.name = "ProxyPathError";
  }
}

/**
 * Decode and re-encode each path segment once for both authorization and
 * forwarding. Repeated decoding catches double-encoded dot segments before
 * the WHATWG URL parser can collapse them after the guards have run.
 */
export function canonicalizeProxyApiPath(value: unknown): string {
  let decoded = String(value ?? "").trim().replace(/^\/+/, "");
  for (let pass = 0; pass < 4; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new ProxyPathError();
    }
    if (next === decoded) break;
    decoded = next;
  }

  if (!decoded || /[\\\0?#]/.test(decoded)) {
    if (!decoded) return "";
    throw new ProxyPathError();
  }

  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new ProxyPathError("ERPNext API path traversal is not allowed.");
  }
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

/** The generic production proxy intentionally supports only Frappe v1 route families. */
export function assertSupportedErpProxyPath(apiPath: string): void {
  const decoded = decodeURIComponent(apiPath);
  if (!/^(?:resource|method)\//.test(decoded)) {
    throw new ProxyPathError("Unsupported ERPNext API namespace.");
  }
}

export function isVersionedErpApiPath(apiPath: string): boolean {
  try {
    return /^v\d+\//i.test(decodeURIComponent(apiPath));
  } catch {
    return true;
  }
}
