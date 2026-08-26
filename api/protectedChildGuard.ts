export const PROTECTED_CHILD_DOCTYPES = [
  "Request for Quotation Item",
  "Request for Quotation Supplier",
  "Purchase Order Item",
  "ECR Affected Part",
  "ECR Supplier Response Requirement",
  "ECR Approval",
  "Purchase Requisition Item",
] as const;

const protectedChildDoctypes = new Set<string>(PROTECTED_CHILD_DOCTYPES);
const SAFE_RESOURCE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const READ_ONLY_GENERIC_DOCUMENT_METHODS = new Set([
  "method/frappe.client.get",
  "method/frappe.client.get_list",
  "method/frappe.client.get_value",
  "method/frappe.client.get_count",
]);

function normalizedApiPath(apiPath: string): string {
  try {
    return decodeURIComponent(apiPath.replace(/^\/+/, "").replace(/\+/g, " "));
  } catch {
    return apiPath.replace(/^\/+/, "");
  }
}

export function isProtectedChildDoctype(doctype: unknown): boolean {
  return protectedChildDoctypes.has(String(doctype ?? "").trim());
}

export function protectedChildResourceDoctype(apiPath: string): string | null {
  const path = normalizedApiPath(apiPath);
  for (const doctype of PROTECTED_CHILD_DOCTYPES) {
    const resourcePath = `resource/${doctype}`;
    if (path === resourcePath || path.startsWith(`${resourcePath}/`)) return doctype;
  }
  return null;
}

export function protectedChildRequestDoctype(
  apiPath: string,
  requestDoctype: unknown,
): string | null {
  const resourceDoctype = protectedChildResourceDoctype(apiPath);
  if (resourceDoctype) return resourceDoctype;

  const path = normalizedApiPath(apiPath);
  const genericDoctype = String(requestDoctype ?? "").trim();
  return path.startsWith("method/") && isProtectedChildDoctype(genericDoctype)
    ? genericDoctype
    : null;
}

/** Return the first protected child targeted by a singular or bulk Frappe RPC. */
export function protectedChildRequestDoctypeFromMany(
  apiPath: string,
  requestDoctypes: readonly unknown[],
): string | null {
  const resourceDoctype = protectedChildResourceDoctype(apiPath);
  if (resourceDoctype) return resourceDoctype;
  for (const doctype of requestDoctypes) {
    const matched = protectedChildRequestDoctype(apiPath, doctype);
    if (matched) return matched;
  }
  return null;
}

export type ProtectedChildAccessDenial = "supplier" | "mutation" | "sensitive-read";

export function protectedChildAccessMessage(
  denial: ProtectedChildAccessDenial,
): string {
  if (denial === "supplier") {
    return "Direct workflow child-record access is not available in the Supplier Portal.";
  }
  if (denial === "sensitive-read") {
    return "Direct ECR approval-task access is disabled. Read approval history through the authorized parent ECR.";
  }
  return "Direct workflow child-record mutations are disabled. Update the authorized parent document instead.";
}

export function protectedChildAccessDenial(input: {
  apiPath: string;
  requestDoctype?: unknown;
  method: string;
  principalType: string;
}): ProtectedChildAccessDenial | null {
  const path = normalizedApiPath(input.apiPath);
  const resourceDoctype = protectedChildResourceDoctype(path);
  const childDoctype = resourceDoctype || protectedChildRequestDoctype(
    path,
    input.requestDoctype,
  );
  if (!childDoctype) return null;
  if (input.principalType === "supplier") return "supplier";

  // Approval-task rows contain assignees, decisions, comments, and audit
  // timestamps. They are exposed only through the secured parent ECR read so
  // callers cannot enumerate another request's workflow history directly.
  if (childDoctype === "ECR Approval") return "sensitive-read";

  if (resourceDoctype) {
    return SAFE_RESOURCE_METHODS.has(input.method.toUpperCase()) ? null : "mutation";
  }
  return READ_ONLY_GENERIC_DOCUMENT_METHODS.has(path) ? null : "mutation";
}
