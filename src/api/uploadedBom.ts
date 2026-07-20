/**
 * Frontend client for Procurement BOM Reader APIs.
 *
 * Calls same-origin `/api/bom/*` via fetch (no credentials / no sid cookies),
 * matching the Legal Review gateway pattern. Excel is parsed on the server.
 */

export type BomRowStatus =
  | "exists"
  | "new"
  | "missing_uom"
  | "duplicate"
  | "invalid";

export interface BomParsedRow {
  row_number: number;
  item_code: string;
  item_name: string;
  description: string;
  qty: number;
  uom: string;
  required_date: string;
  commodity: string;
  category: string;
  manufacturer: string;
  manufacturer_part_number: string;
  drawing_number: string;
  revision: string;
  remarks: string;
  status: BomRowStatus;
  status_label: string;
  exists_in_erp: boolean;
  erp_item_group?: string;
  errors: string[];
}

export interface BomUploadSummary {
  total_rows: number;
  existing_items: number;
  new_items: number;
  warnings: number;
  invalid_rows: number;
}

export interface RecommendedSupplier {
  name: string;
  supplier_name: string;
  supplier_group: string;
  country?: string;
  score: number;
  reasons: string[];
}

export interface BomUploadResult {
  success: true;
  rows: BomParsedRow[];
  summary: BomUploadSummary;
  recommended_suppliers: RecommendedSupplier[];
  supplier_categories: string[];
  file_name: string;
  warnings: string[];
  supplier_recommendation?: {
    bom_categories: string[];
    bom_commodities: string[];
    bom_item_groups: string[];
    supplier_groups_in_erp: string[];
    matched_supplier_groups: string[];
    active_suppliers_queried: number;
    category_matched_suppliers: number;
    returned_suppliers: number;
    fallback_used: boolean;
    fallback_reason: string;
    query_notes: string[];
  };
}

export interface CreateBomRfqPayload {
  rows: BomParsedRow[];
  suppliers: Array<{ supplier: string; supplier_name?: string }>;
  uploaded_by?: string;
  remarks?: string;
  message_for_supplier?: string;
  company?: string;
  file_name?: string;
  file_base64?: string;
  file_mime?: string;
}

export interface CreateBomRfqResult {
  success: true;
  rfq_name: string;
  uploaded_bom_name: string;
  items_ensured: string[];
}

export interface BomHistoryRow {
  name: string;
  bom_number: string;
  uploaded_by: string;
  upload_date: string;
  status: string;
  total_items: number;
  rfq: string;
  remarks: string;
  original_file: string;
}

async function callBomApi<T>(
  action: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers || {});
  try {
    const token =
      sessionStorage.getItem("bidsphere-access-token") ||
      localStorage.getItem("bidsphere-access-token-remember");
    if (token) headers.set("X-Bidsphere-Access-Token", token);
  } catch {
    /* ignore */
  }

  const res = await fetch(`/api/bom/${action}`, {
    ...init,
    headers,
    // Never send ERP Desk cookies
    credentials: "omit",
  });

  // Sample download returns binary — callers handle separately
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("spreadsheet") || contentType.includes("octet-stream")) {
    throw new Error("Unexpected binary response.");
  }

  let json: { success?: boolean; error?: string } & Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok || json.success === false) {
    const message =
      (typeof json.error === "string" && json.error) ||
      `BOM request failed (${res.status}).`;
    throw new Error(message);
  }

  return json as T;
}

/** Upload Excel → server parses & returns preview JSON. */
export async function uploadBomFile(file: File): Promise<BomUploadResult> {
  if (!file) throw new Error("No file selected.");
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
    throw new Error("Unsupported file. Please upload .xlsx or .xls.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("File is too large. Maximum size is 20 MB.");
  }

  const form = new FormData();
  form.append("file", file, file.name);

  return callBomApi<BomUploadResult>("upload", {
    method: "POST",
    body: form,
  });
}

/** Create ERPNext RFQ from reviewed BOM rows + selected suppliers. */
export async function createRfqFromUploadedBom(
  payload: CreateBomRfqPayload,
): Promise<CreateBomRfqResult> {
  return callBomApi<CreateBomRfqResult>("create-rfq", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** List Uploaded BOM history from ERPNext. */
export async function getUploadedBomHistory(): Promise<BomHistoryRow[]> {
  const data = await callBomApi<{ success?: boolean; history?: BomHistoryRow[] }>(
    "history",
    { method: "GET" },
  );
  return data.history ?? [];
}

/** Trigger browser download of the sample BOM Excel template. */
export async function downloadSampleBomTemplate(): Promise<void> {
  const headers: Record<string, string> = {};
  try {
    const token =
      sessionStorage.getItem("bidsphere-access-token") ||
      localStorage.getItem("bidsphere-access-token-remember");
    if (token) headers["X-Bidsphere-Access-Token"] = token;
  } catch {
    /* ignore */
  }
  const res = await fetch("/api/bom/sample", {
    method: "GET",
    credentials: "omit",
    headers,
  });
  if (!res.ok) {
    throw new Error(`Could not download sample template (${res.status}).`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "BidSphere_BOM_Sample_Template.xlsx";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read a File as base64 (no data: prefix) for optional server-side attach. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}
