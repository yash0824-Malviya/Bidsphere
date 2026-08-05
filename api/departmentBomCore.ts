/**
 * Department BOM Submit — Material Request + Temporary Item Store.
 * Procurement RFQ creation is intentionally NOT part of this flow.
 */
import {
  BomError,
  readErpAdminConfig,
  type BomParsedRow,
  type CreateBomRfqInput,
} from "./bomCore.js";
import { createTemporaryItemsFromBomRows } from "./temporaryItemStoreCore.js";

export interface SubmitDepartmentBomInput {
  rows: BomParsedRow[];
  uploaded_by?: string;
  department?: string;
  project?: string;
  program?: string;
  bom_version?: string;
  remarks?: string;
  company?: string;
  file_name?: string;
  file_base64?: string;
  file_mime?: string;
}

export interface SubmitDepartmentBomResult {
  success: true;
  uploaded_bom_name: string;
  material_request?: string;
  temporary_items_created: number;
  existing_items_in_mr: number;
  pending_master_data: number;
  status: string;
}

async function erpFetch<T = unknown>(
  cfg: ReturnType<typeof readErpAdminConfig>,
  path: string,
  init?: { method?: string; body?: unknown; formData?: FormData },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `token ${cfg.key}:${cfg.secret}`,
    Accept: "application/json",
  };
  let body: BodyInit | undefined;
  if (init?.formData) {
    body = init.formData as unknown as BodyInit;
  } else if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${cfg.baseUrl}/api/${path}`, {
    method: init?.method ?? "GET",
    headers,
    body,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (data as { message?: string; exc?: string })?.message ||
      (data as { exc?: string })?.exc ||
      text ||
      `ERPNext request failed (${res.status})`;
    throw new BomError(String(msg).slice(0, 500), res.status >= 500 ? 502 : 400);
  }
  return data as T;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function lookupDefaultWarehouse(
  cfg: ReturnType<typeof readErpAdminConfig>,
  company: string,
): Promise<string> {
  try {
    const rows = await erpFetch<Array<{ name: string }>>(
      cfg,
      `resource/Warehouse?fields=${encodeURIComponent(JSON.stringify(["name"]))}&filters=${encodeURIComponent(
        JSON.stringify([["company", "=", company], ["is_group", "=", 0]]),
      )}&limit_page_length=1`,
    );
    return rows?.[0]?.name ?? "";
  } catch {
    return "";
  }
}

function buildAuditMeta(input: SubmitDepartmentBomInput): string {
  return JSON.stringify({
    department: input.department || "",
    project: input.project || "",
    program: input.program || "",
    bom_version: input.bom_version || "1.0",
    workflow: "department_bom",
  });
}

export async function submitDepartmentBom(
  input: SubmitDepartmentBomInput,
): Promise<SubmitDepartmentBomResult> {
  const cfg = readErpAdminConfig();
  if (!input.rows?.length) throw new BomError("No BOM items provided.");

  const usable = input.rows.filter(
    (r) => r.status !== "invalid" && r.status !== "duplicate" && r.qty > 0 && r.item_name,
  );
  if (!usable.length) throw new BomError("No valid items in this BOM.");

  const existingRows = usable.filter((r) => r.exists_in_erp && r.item_code);
  const newRows = usable.filter((r) => !r.exists_in_erp);

  const uploadLabel = input.file_name || `BOM-${Date.now()}`;
  let uploadedBomName = "";

  // Audit record first (best-effort)
  try {
    const bomDoc = {
      doctype: "Uploaded BOM",
      bom_number: `DEPT-BOM-${Date.now()}`,
      uploaded_by: input.uploaded_by || "Department",
      upload_date: todayIso(),
      status: "Processing",
      total_items: usable.length,
      remarks: [input.remarks || "", buildAuditMeta(input), `file:${uploadLabel}`]
        .filter(Boolean)
        .join("\n"),
      items: usable.map((r) => ({
        doctype: "Uploaded BOM Item",
        item_code: r.item_code || r.item_name,
        item_name: r.item_name,
        qty: r.qty,
        uom: r.uom || "Nos",
        description: r.description,
        exists_in_erp: r.exists_in_erp ? 1 : 0,
      })),
    };
    const created = await erpFetch<{ name?: string }>(cfg, "resource/Uploaded%20BOM", {
      method: "POST",
      body: bomDoc,
    });
    uploadedBomName = created?.name || "";

    if (uploadedBomName && input.file_base64 && input.file_name) {
      try {
        const bin = Buffer.from(input.file_base64, "base64");
        const form = new FormData();
        const blob = new Blob([new Uint8Array(bin)], {
          type:
            input.file_mime ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        form.append("file", blob, input.file_name);
        form.append("is_private", "1");
        form.append("doctype", "Uploaded BOM");
        form.append("docname", uploadedBomName);
        form.append("fieldname", "original_file");
        await erpFetch(cfg, "method/upload_file", { method: "POST", formData: form });
      } catch {
        /* optional attach */
      }
    }
  } catch {
    uploadedBomName = uploadedBomName || "";
  }

  const tempItems = await createTemporaryItemsFromBomRows({
    rows: newRows,
    sourceUpload: uploadedBomName || uploadLabel,
    department: input.department,
    project: input.project,
    program: input.program,
    uploadedBy: input.uploaded_by,
  });

  let mrName = "";
  if (existingRows.length > 0) {
    const company =
      input.company ||
      process.env.VITE_COMPANY ||
      process.env.COMPANY_NAME ||
      "";
    const warehouse = company ? await lookupDefaultWarehouse(cfg, company) : "";

    const mrItems = existingRows.map((row) => {
      const schedule =
        row.required_date && /^\d{4}-\d{2}-\d{2}/.test(row.required_date)
          ? row.required_date.slice(0, 10)
          : todayIso();
      return {
        doctype: "Material Request Item",
        item_code: row.item_code,
        item_name: row.item_name || row.item_code,
        description: row.description || row.item_name,
        qty: row.qty,
        uom: row.uom || "Nos",
        stock_uom: row.uom || "Nos",
        conversion_factor: 1,
        warehouse: warehouse || undefined,
        schedule_date: schedule,
      };
    });

    const mrDoc = {
      doctype: "Material Request",
      material_request_type: "Material Issue",
      transaction_date: todayIso(),
      schedule_date: todayIso(),
      company: company || undefined,
      custom_department: input.department || undefined,
      remarks: [
        `Department BOM upload: ${uploadLabel}`,
        input.project ? `Project: ${input.project}` : "",
        input.program ? `Program: ${input.program}` : "",
        uploadedBomName ? `Uploaded BOM: ${uploadedBomName}` : "",
        tempItems.length ? `${tempItems.length} item(s) pending Master Data review.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      items: mrItems,
    };

    try {
      const saved = await erpFetch<{ name?: string }>(cfg, "method/frappe.client.save", {
        method: "POST",
        body: { doc: mrDoc },
      });
      mrName = saved?.name || "";
      if (mrName) {
        await erpFetch(cfg, "method/frappe.client.submit", {
          method: "POST",
          body: { doc: { doctype: "Material Request", name: mrName } },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BomError(`Failed to create Material Request: ${msg}`, 502);
    }
  }

  const status =
    tempItems.length > 0 && !mrName
      ? "Pending Master Data Review"
      : tempItems.length > 0
        ? "Partial — MR Created, Items Pending Review"
        : mrName
          ? "Material Request Created"
          : "Validated";

  if (uploadedBomName) {
    try {
      await erpFetch(cfg, `resource/Uploaded%20BOM/${encodeURIComponent(uploadedBomName)}`, {
        method: "PUT",
        body: {
          status,
          remarks: [
            input.remarks || "",
            buildAuditMeta(input),
            mrName ? `material_request:${mrName}` : "",
            `temp_items:${tempItems.length}`,
            `file:${uploadLabel}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      });
    } catch {
      /* best-effort */
    }
  }

  return {
    success: true,
    uploaded_bom_name: uploadedBomName,
    material_request: mrName || undefined,
    temporary_items_created: tempItems.length,
    existing_items_in_mr: existingRows.length,
    pending_master_data: tempItems.length,
    status,
  };
}

/** @deprecated Procurement path — kept for backward compatibility only. */
export type LegacyCreateBomRfqInput = CreateBomRfqInput;
