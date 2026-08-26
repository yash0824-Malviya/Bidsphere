const SECURITY_DOCTYPES = new Set([
  "User",
  "Role",
  "Has Role",
  "Role Profile",
  "User Permission",
  "DocPerm",
  "Custom DocPerm",
  "DocShare",
  "Workflow",
  "Workflow State",
  "Workflow Action Master",
  "DocType",
  "DocField",
  "Custom Field",
  "Property Setter",
  "Server Script",
  "Client Script",
  "OAuth Client",
  "OAuth Bearer Token",
  "API Access Log",
  "System Settings",
]);
const PROTECTED_BULK_DOCTYPES = new Set([
  "Engineering Change Request",
  "ECR Approval",
  "ECR Affected Part",
  "ECR Supplier Response Requirement",
  "Purchase Requisition",
  "Request for Quotation",
  "Purchase Order",
]);

// Every browser-visible Frappe RPC that this application currently uses with
// a non-read HTTP verb. Unknown callbacks stay closed for non-admin users so
// the ERP service credential cannot become a generic privileged dispatcher.
const NON_ADMIN_METHOD_ALLOWLIST = new Set([
  "method/upload_file",
  "method/reference/attachment",
  "method/frappe.auth.get_logged_user",
  "method/frappe.client.cancel",
  "method/frappe.client.delete",
  "method/frappe.client.get_count",
  "method/frappe.client.get_list",
  "method/frappe.client.get_value",
  "method/frappe.client.insert",
  "method/frappe.client.save",
  "method/frappe.client.set_value",
  "method/frappe.client.submit",
  "method/frappe.desk.form.load.getdoctype",
  "method/frappe.desk.form.utils.add_comment",
  "method/frappe.desk.query_report.run",
  "method/frappe.model.workflow.apply_workflow",
  "method/frappe.model.workflow.get_transitions",
  "method/erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_invoice",
  "method/erpnext.setup.utils.get_exchange_rate",
  "method/erpnext.stock.doctype.material_request.material_request.make_stock_entry",
  "method/erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_invoice",
  "method/erpnext.stock.utils.get_stock_balance",
  "method/bidsphere_get_supplier_rfi",
  "method/bidsphere_get_supplier_rfis",
  "method/bidsphere_get_supplier_rfp",
  "method/bidsphere_get_supplier_rfps",
  "method/bidsphere_server_date",
  "method/bidsphere.send_login_otp",
  "method/bidsphere.verify_login_otp",
  "method/ping",
]);

function cleanPath(value: string): string {
  let path = value.replace(/^\/+/, "").replace(/\/+$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // The canonical path guard reports malformed escapes before this guard.
  }
  return path;
}

function resourceDoctype(apiPath: string): string {
  const path = cleanPath(apiPath);
  if (!path.startsWith("resource/")) return "";
  return path.slice("resource/".length).split("/")[0]?.trim() || "";
}

export class ErpProxySecurityError extends Error {
  status = 403;

  constructor(message: string) {
    super(message);
    this.name = "ErpProxySecurityError";
  }
}

export function assertErpProxySecurityBoundary(input: {
  apiPath: string;
  method: string;
  principalRole?: string;
  requestDoctypes?: string[];
}): void {
  const method = input.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  if (input.principalRole === "admin") return;

  const path = cleanPath(input.apiPath);
  const doctypes = new Set([
    resourceDoctype(path),
    ...(input.requestDoctypes ?? []),
  ].map((value) => String(value ?? "").trim()).filter(Boolean));
  const sensitive = [...doctypes].filter((doctype) => SECURITY_DOCTYPES.has(doctype));
  if (sensitive.length > 0) {
    throw new ErpProxySecurityError(
      `Direct ERP security metadata changes are restricted to administrators (${sensitive.join(", ")}).`,
    );
  }
  if (
    doctypes.size > 1 &&
    [...doctypes].some((doctype) => PROTECTED_BULK_DOCTYPES.has(doctype))
  ) {
    throw new ErpProxySecurityError(
      "Mixed bulk mutations of protected procurement or ECR documents are disabled.",
    );
  }

  if (path.startsWith("method/") && !NON_ADMIN_METHOD_ALLOWLIST.has(path)) {
    throw new ErpProxySecurityError(
      "This ERP method is not available through the browser gateway.",
    );
  }
}
