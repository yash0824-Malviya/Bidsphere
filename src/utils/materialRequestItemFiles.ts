/**
 * Per-item engineering attachments on Material Request Item rows.
 * Multi-file JSON (`custom_engineering_attachments`) with legacy
 * `custom_2d_drawing` kept as the primary URL for backward compatibility.
 */

import {
  getFullFileUrl,
  uploadFileToERPNext,
} from "../api/legalDocsStorage";
import { apiGet, apiPut, buildListConfig, buildResourceUrl } from "../api/erpnext";
import { getMaterialRequest } from "../api/purchasing";
import type { MaterialRequestDraftLine } from "../components/material-requests/MaterialRequestItemLineRow";
import {
  fileLabelFromUrl,
  filterSupplierVisibleAttachments,
  inferDocumentTypeFromFileName,
  isSupplierVisibleAttachment,
  normalizeAttachmentVisibility,
  parseAttachmentVisibilityRows,
  RFQ_DOCUMENT_TYPES,
  type AttachmentVisibility,
  type RfqDocumentType,
} from "./rfqAttachmentVisibility";

export {
  fileLabelFromUrl,
  filterSupplierVisibleAttachments,
  inferDocumentTypeFromFileName,
  isSupplierVisibleAttachment,
  normalizeAttachmentVisibility,
  RFQ_DOCUMENT_TYPES,
  type AttachmentVisibility,
  type RfqDocumentType,
};

export const MR_ITEM_PART_NAME_FIELD = "custom_part_name";
export const MR_ITEM_2D_FIELD = "custom_2d_drawing";
export const MR_ITEM_ATTACHMENTS_FIELD = "custom_engineering_attachments";

export const MR_ITEM_FILE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export const MR_ITEM_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".dwg",
  ".dxf",
  ".step",
  ".stp",
  ".iges",
  ".igs",
  ".stl",
  ".png",
  ".jpg",
  ".jpeg",
  ".zip",
] as const;

/** @deprecated Prefer MR_ITEM_ATTACHMENT_EXTENSIONS */
export const MR_ITEM_2D_EXTENSIONS = MR_ITEM_ATTACHMENT_EXTENSIONS;

export type EngineeringAttachmentSource = "department" | "procurement";

export interface EngineeringAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedBy?: string;
  uploadedAt: string;
  /** Who originated the file — department MR vs procurement RFQ add-on. */
  source?: EngineeringAttachmentSource;
  /** Monotonic version; defaults to 1. */
  version?: number;
  /**
   * Supplier Visible (default) vs Internal Only.
   * Existing RFQs without this field remain supplier-visible.
   */
  visibility?: AttachmentVisibility;
  /** Human document classification shown in Supplier Portal. */
  documentType?: string;
}

export interface PendingAttachment {
  id: string;
  file: File;
  localUrl: string;
  progress?: number;
  error?: string;
  visibility?: AttachmentVisibility;
  documentType?: string;
}

function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function newAttachmentId(): string {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function validateMrItemDrawing(file: File): string | null {
  if (file.size > MR_ITEM_FILE_MAX_BYTES) {
    return "File must be 50 MB or smaller.";
  }
  const ext = fileExtension(file.name);
  if (
    !MR_ITEM_ATTACHMENT_EXTENSIONS.includes(
      ext as (typeof MR_ITEM_ATTACHMENT_EXTENSIONS)[number],
    )
  ) {
    return "Supported formats: PDF, DOC, DOCX, XLS, XLSX, DWG, DXF, STEP, STP, IGES, IGS, STL, PNG, JPG, JPEG, ZIP.";
  }
  return null;
}

export function acceptAttrForMrItemDrawing(): string {
  return MR_ITEM_ATTACHMENT_EXTENSIONS.join(",");
}

export function isPreviewable2dUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return /\.(png|jpe?g|pdf)$/i.test(path);
}

export function isPreviewableAttachment(
  fileNameOrUrl: string,
  fileType?: string,
): boolean {
  const path = fileNameOrUrl.split("?")[0]?.toLowerCase() ?? "";
  if (/\.(png|jpe?g|pdf)$/i.test(path)) return true;
  const t = (fileType ?? "").toLowerCase();
  return t.includes("pdf") || t.startsWith("image/");
}

/**
 * Browser-loadable href for MR item attachments.
 * Always routes `/files/*` and `/private/files/*` through `/api/file-proxy`
 * (authenticated download) — never bare relative ERP paths or Desk sid cookies.
 */
export function resolveMrItemFileHref(url: string): string {
  const imageUrl = getFullFileUrl(url);
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[MR attachment URL]", {
      file_url: url,
      imageUrl,
      viaProxy: imageUrl.includes("/api/file-proxy"),
    });
  }
  return imageUrl;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function legacyAttachmentFromUrl(url: string): EngineeringAttachment {
  const fileName = fileLabelFromUrl(url);
  const ext = fileExtension(fileName).replace(".", "");
  return {
    id: `legacy_${fileName}`,
    fileName,
    fileUrl: url,
    fileType: ext || "file",
    fileSize: 0,
    uploadedAt: "",
    source: "department",
    version: 1,
    visibility: "supplier",
    documentType: inferDocumentTypeFromFileName(fileName),
  };
}

export function normalizeAttachmentSource(
  raw: unknown,
): EngineeringAttachmentSource {
  return raw === "procurement" ? "procurement" : "department";
}

export function parseEngineeringAttachments(
  raw: unknown,
): EngineeringAttachment[] {
  return parseAttachmentVisibilityRows(raw).map((r) => ({
    id: String(r.id ?? newAttachmentId()),
    fileName: r.fileName || fileLabelFromUrl(r.fileUrl),
    fileUrl: r.fileUrl,
    fileType: r.fileType || "file",
    fileSize: r.fileSize ?? 0,
    uploadedBy: r.uploadedBy,
    uploadedAt: r.uploadedAt || "",
    source: normalizeAttachmentSource(r.source),
    version: r.version ?? 1,
    visibility: normalizeAttachmentVisibility(r.visibility),
    documentType:
      r.documentType || inferDocumentTypeFromFileName(r.fileName || r.fileUrl),
  }));
}

export function serializeEngineeringAttachments(
  attachments: EngineeringAttachment[],
): string {
  return JSON.stringify(attachments);
}

/**
 * Strip Internal Only attachments from an RFQ / MR item payload before
 * returning it to a supplier client. Existing docs without a visibility
 * flag remain supplier-visible.
 */
export function sanitizeItemAttachmentsForSupplier<T extends {
  custom_2d_drawing?: string | null;
  custom_engineering_attachments?: string | null;
  drawing_2d_url?: string | null;
  attachments?: EngineeringAttachment[] | null;
  attachment_name?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
}>(item: T): T {
  const all = resolveEngineeringAttachments(item);
  if (all.length === 0) return item;
  const visible = filterSupplierVisibleAttachments(all);
  if (visible.length === all.length) {
    /* Still normalize JSON so visibility/documentType are present for clients. */
    const primary = visible[0]?.fileUrl ?? String(item.custom_2d_drawing ?? "").trim();
    return {
      ...item,
      custom_2d_drawing: primary || item.custom_2d_drawing,
      custom_engineering_attachments: serializeEngineeringAttachments(visible),
      drawing_2d_url: primary || item.drawing_2d_url,
      attachments: visible,
      attachment_url: primary || item.attachment_url,
      attachment_name: visible[0]?.fileName ?? item.attachment_name,
      attachment_type: visible[0]?.fileType ?? item.attachment_type,
    };
  }
  const primary = visible[0]?.fileUrl ?? "";
  return {
    ...item,
    custom_2d_drawing: primary,
    custom_engineering_attachments: serializeEngineeringAttachments(visible),
    drawing_2d_url: primary || undefined,
    attachments: visible,
    attachment_url: primary || undefined,
    attachment_name: visible[0]?.fileName,
    attachment_type: visible[0]?.fileType,
  };
}

type ErpFileRow = {
  name?: string;
  file_name?: string;
  file_url?: string;
  file_size?: number;
};

/**
 * Files attached to a Material Request Item via ERPNext File DocType
 * (upload_file with attached_to_*). Used when `custom_engineering_attachments`
 * JSON was never written but binaries still exist on the child row.
 */
export async function fetchAttachedEngineeringFiles(
  childDocName: string,
  attachedToDoctype = "Material Request Item",
): Promise<EngineeringAttachment[]> {
  const name = String(childDocName || "").trim();
  if (!name) return [];
  const doctype = String(attachedToDoctype || "Material Request Item").trim();
  try {
    const rows = await apiGet<ErpFileRow[]>(
      buildResourceUrl("File"),
      buildListConfig({
        fields: ["name", "file_name", "file_url", "file_size"],
        filters: [
          ["attached_to_doctype", "=", doctype],
          ["attached_to_name", "=", name],
          ["is_folder", "=", 0],
        ],
        limit_page_length: 50,
        order_by: "creation asc",
      }),
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const out: EngineeringAttachment[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const fileUrl = String(row.file_url || "").trim();
      if (!fileUrl || seen.has(fileUrl)) continue;
      seen.add(fileUrl);
      const fileName = String(
        row.file_name || fileLabelFromUrl(fileUrl),
      ).trim();
      const resolvedName = fileName || fileLabelFromUrl(fileUrl);
      out.push({
        id: String(row.name || newAttachmentId()),
        fileName: resolvedName,
        fileUrl,
        fileType: fileExtension(fileName).replace(".", "") || "file",
        fileSize: Number(row.file_size ?? 0) || 0,
        uploadedAt: "",
        source: "department",
        version: 1,
        visibility: "supplier",
        documentType: inferDocumentTypeFromFileName(resolvedName),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Merge JSON/legacy docs with File DocType attachments (no duplicates by URL).
 */
export async function hydrateEngineeringDocsFromChild(
  source: {
    name?: string | null;
    custom_part_name?: string | null;
    custom_2d_drawing?: string | null;
    custom_engineering_attachments?: string | null;
    part_name?: string | null;
    drawing_2d_url?: string | null;
    attachments?: EngineeringAttachment[] | null;
  } | null | undefined,
  options?: { attachedToDoctype?: string },
): Promise<EngineeringDocs> {
  const docs = pickEngineeringDocs(source);
  const childName = String(source?.name || "").trim();
  if (!childName) return docs;

  const fromFiles = await fetchAttachedEngineeringFiles(
    childName,
    options?.attachedToDoctype ?? "Material Request Item",
  );
  if (fromFiles.length === 0) return docs;

  const seen = new Set(docs.attachments.map((a) => a.fileUrl));
  const merged = [...docs.attachments];
  for (const f of fromFiles) {
    if (seen.has(f.fileUrl)) continue;
    seen.add(f.fileUrl);
    merged.push(f);
  }
  return {
    ...docs,
    attachments: merged,
    drawing_2d_url: docs.drawing_2d_url || merged[0]?.fileUrl,
  };
}

export function resolveEngineeringAttachments(source: {
  custom_engineering_attachments?: string | null;
  custom_2d_drawing?: string | null;
  attachments?: EngineeringAttachment[] | null;
  drawing_2d_url?: string | null;
} | null | undefined): EngineeringAttachment[] {
  if (!source) return [];
  if (Array.isArray(source.attachments) && source.attachments.length > 0) {
    return source.attachments;
  }
  const fromJson = parseEngineeringAttachments(
    source.custom_engineering_attachments,
  );
  if (fromJson.length > 0) return fromJson;
  const legacy = String(
    source.custom_2d_drawing ?? source.drawing_2d_url ?? "",
  ).trim();
  return legacy ? [legacyAttachmentFromUrl(legacy)] : [];
}

export type EngineeringDocs = {
  part_name?: string;
  drawing_2d_url?: string;
  attachments: EngineeringAttachment[];
};

/** Normalize optional engineering fields from an MR/RFQ item row. */
export function pickEngineeringDocs(source: {
  custom_part_name?: string | null;
  custom_2d_drawing?: string | null;
  custom_engineering_attachments?: string | null;
  part_name?: string | null;
  drawing_2d_url?: string | null;
  attachments?: EngineeringAttachment[] | null;
} | null | undefined): EngineeringDocs {
  if (!source) return { attachments: [] };
  const part = String(
    source.custom_part_name ?? source.part_name ?? "",
  ).trim();
  const attachments = resolveEngineeringAttachments(source);
  const d2 =
    attachments[0]?.fileUrl ||
    String(source.custom_2d_drawing ?? source.drawing_2d_url ?? "").trim() ||
    undefined;
  return {
    part_name: part || undefined,
    drawing_2d_url: d2,
    attachments,
  };
}

/** ERP child-row fields for RFQ Item / MR Item payloads (omit empties). */
export function engineeringCustomFieldsForErp(source: {
  custom_part_name?: string | null;
  custom_2d_drawing?: string | null;
  custom_engineering_attachments?: string | null;
  part_name?: string | null;
  drawing_2d_url?: string | null;
  attachments?: EngineeringAttachment[] | null;
} | null | undefined): {
  custom_part_name?: string;
  custom_2d_drawing?: string;
  custom_engineering_attachments?: string;
} {
  const docs = pickEngineeringDocs(source);
  const out: {
    custom_part_name?: string;
    custom_2d_drawing?: string;
    custom_engineering_attachments?: string;
  } = {};
  if (docs.part_name) out.custom_part_name = docs.part_name;
  if (docs.drawing_2d_url) out.custom_2d_drawing = docs.drawing_2d_url;
  if (docs.attachments.length > 0) {
    out.custom_engineering_attachments = serializeEngineeringAttachments(
      docs.attachments,
    );
  }
  return out;
}

/** Normalized attachment summary for MR item API responses. */
export type MaterialRequestItemAttachmentMeta = {
  file_name: string;
  file_url: string;
  attachment_count: number;
  attachments: EngineeringAttachment[];
};

/** Build display metadata from a hydrated attachment list. */
export function buildItemAttachmentMeta(
  attachments: EngineeringAttachment[],
): MaterialRequestItemAttachmentMeta {
  const list = attachments ?? [];
  const primary = list[0];
  return {
    file_name: primary?.fileName ?? "",
    file_url: primary?.fileUrl ?? "",
    attachment_count: list.length,
    attachments: list,
  };
}

async function loadMaterialRequestItemChildRow(
  item: {
    name?: string | null;
    item_code?: string;
    custom_part_name?: string | null;
    custom_2d_drawing?: string | null;
    custom_engineering_attachments?: string | null;
  },
  mrName?: string,
): Promise<typeof item & { name?: string }> {
  let childName = String(item.name ?? "").trim();
  if (!childName && mrName && item.item_code) {
    try {
      const rows = await apiGet<Array<{ name?: string }>>(
        buildResourceUrl("Material Request Item"),
        buildListConfig({
          fields: ["name"],
          filters: [
            ["parent", "=", mrName],
            ["item_code", "=", item.item_code],
          ],
          limit_page_length: 1,
        }),
      );
      childName = String(rows?.[0]?.name ?? "").trim();
    } catch {
      /* keep empty */
    }
  }
  if (!childName) return item;

  try {
    const full = await apiGet<{
      name?: string;
      custom_part_name?: string;
      custom_2d_drawing?: string;
      custom_engineering_attachments?: string;
    }>(buildResourceUrl("Material Request Item", childName));
    return {
      ...item,
      name: childName,
      custom_part_name: full.custom_part_name ?? item.custom_part_name,
      custom_2d_drawing: full.custom_2d_drawing ?? item.custom_2d_drawing,
      custom_engineering_attachments:
        full.custom_engineering_attachments ?? item.custom_engineering_attachments,
    };
  } catch {
    return { ...item, name: childName };
  }
}

/**
 * Attachments are owned by Material Request Item child rows (JSON + File DocType).
 * Parent get_doc may omit custom_* fields; this re-loads each child and merges
 * File DocType links so downstream screens show uploaded files.
 */
export async function hydrateMaterialRequestItemsWithAttachments<
  T extends {
    name?: string | null;
    item_code: string;
    custom_part_name?: string | null;
    custom_2d_drawing?: string | null;
    custom_engineering_attachments?: string | null;
    attachments?: EngineeringAttachment[] | null;
    attachment_count?: number;
    attachment_file_name?: string;
    attachment_file_url?: string;
  },
>(mrName: string, items: T[]): Promise<T[]> {
  return Promise.all(
    items.map(async (item) => {
      const loaded = await loadMaterialRequestItemChildRow(item, mrName);
      const eng = await hydrateEngineeringDocsFromChild({
        ...loaded,
        name: loaded.name,
      });
      const meta = buildItemAttachmentMeta(eng.attachments);
      return {
        ...item,
        ...loaded,
        custom_part_name: eng.part_name ?? loaded.custom_part_name,
        custom_2d_drawing: eng.drawing_2d_url ?? loaded.custom_2d_drawing,
        custom_engineering_attachments:
          meta.attachment_count > 0
            ? serializeEngineeringAttachments(meta.attachments)
            : loaded.custom_engineering_attachments,
        attachments: meta.attachments,
        attachment_count: meta.attachment_count,
        attachment_file_name: meta.file_name,
        attachment_file_url: meta.file_url,
      };
    }),
  );
}

/** Map draft-line engineering fields onto an ERP Material Request Item payload. */
export function engineeringFieldsForPayload(line: MaterialRequestDraftLine): {
  custom_part_name?: string;
  custom_2d_drawing?: string;
  custom_engineering_attachments?: string;
} {
  const out: {
    custom_part_name?: string;
    custom_2d_drawing?: string;
    custom_engineering_attachments?: string;
  } = {};
  const part = line.part_name?.trim();
  if (part) out.custom_part_name = part;

  const persisted = line.attachments ?? [];
  const hasPending = (line.pendingAttachments?.length ?? 0) > 0;
  const touched =
    line.attachmentsDirty === true ||
    hasPending ||
    !!line.drawing_2d_file ||
    line.drawing_2d_clear === true ||
    persisted.length > 0;

  // Untouched empty lines must not wipe ERP attachment fields on save.
  if (!touched) return out;

  if (persisted.length === 0 && !hasPending) {
    out.custom_2d_drawing = "";
    out.custom_engineering_attachments = "[]";
    return out;
  }

  if (persisted.length > 0) {
    out.custom_2d_drawing = persisted[0].fileUrl;
    out.custom_engineering_attachments =
      serializeEngineeringAttachments(persisted);
  }
  return out;
}

/**
 * After MR create/update, upload pending per-row attachments onto the
 * matching Material Request Item child (matched by item_code).
 * Downstream documents only store references to these URLs.
 */
export async function syncMaterialRequestItemEngineeringFiles(
  mrName: string,
  lines: MaterialRequestDraftLine[],
  uploadedBy?: string,
): Promise<Partial<Record<string, Partial<MaterialRequestDraftLine>>>> {
  const doc = await getMaterialRequest(mrName);
  const children = doc.items ?? [];
  const patches: Partial<
    Record<string, Partial<MaterialRequestDraftLine>>
  > = {};

  for (const line of lines) {
    const code = line.item_code?.trim();
    if (!code) continue;
    const child = children.find((it) => it.item_code === code);
    if (!child?.name) continue;

    const pending = line.pendingAttachments ?? [];
    const current = [...(line.attachments ?? [])];
    const needsSync =
      pending.length > 0 ||
      line.attachmentsDirty === true ||
      !!line.drawing_2d_file ||
      !!line.drawing_2d_clear;

    if (!needsSync) continue;

    // Legacy single-file pending (older draft shape) → treat as one pending.
    const pendingQueue: PendingAttachment[] = [...pending];
    if (line.drawing_2d_file && pendingQueue.length === 0) {
      pendingQueue.push({
        id: newAttachmentId(),
        file: line.drawing_2d_file,
        localUrl: line.drawing_2d_local_url || URL.createObjectURL(line.drawing_2d_file),
      });
    }

    for (const item of pendingQueue) {
      const url = await uploadFileToERPNext(
        item.file,
        "Material Request Item",
        child.name,
        // Do not bind to custom_2d_drawing — multi-file list is stored in JSON.
      );
      current.push({
        id: item.id || newAttachmentId(),
        fileName: item.file.name,
        fileUrl: url,
        fileType: fileExtension(item.file.name).replace(".", "") || "file",
        fileSize: item.file.size,
        uploadedBy: uploadedBy || undefined,
        uploadedAt: new Date().toISOString(),
        source: "department",
        version: 1,
        visibility: normalizeAttachmentVisibility(item.visibility),
        documentType:
          item.documentType?.trim() ||
          inferDocumentTypeFromFileName(item.file.name),
      });
      if (item.localUrl) {
        try {
          URL.revokeObjectURL(item.localUrl);
        } catch {
          /* ignore */
        }
      }
    }

    if (line.drawing_2d_clear && current.length === 0) {
      // already empty
    }

    const primary = current[0]?.fileUrl ?? "";
    await apiPut(buildResourceUrl("Material Request Item", child.name), {
      [MR_ITEM_2D_FIELD]: primary,
      [MR_ITEM_ATTACHMENTS_FIELD]: serializeEngineeringAttachments(current),
    });

    patches[line.id] = {
      attachments: current,
      pendingAttachments: [],
      attachmentsDirty: false,
      drawing_2d_url: primary || undefined,
      drawing_2d_file: undefined,
      drawing_2d_local_url: undefined,
      drawing_2d_clear: false,
    };
  }

  return patches;
}
