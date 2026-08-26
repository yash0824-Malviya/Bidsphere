/**
 * ECR Document & Attachment Persistence API
 *
 * Handles file validation, upload to Frappe File DocType via /api/method/upload_file,
 * metadata tracking, and persistence mapping for ECR document categories:
 * - Engineering Drawing
 * - 3D CAD Model
 * - Specification Document
 * - Supporting Documents (supports multiple)
 * - Validation Documents
 */

import { apiDelete, apiGet, buildResourceUrl } from "./erpnext";
import { getFullFileUrl, uploadFileToERPNextDetailed, type UploadedErpFile } from "./legalDocsStorage";
import type { EngineeringChangeRequest } from "../types/erpnext";
import { updateECR } from "./ecr";

export type ECRAttachmentCategory =
  | "Engineering Drawing"
  | "3D CAD Model"
  | "Specification Document"
  | "Supporting Documents"
  | "Validation Documents";

export type ECRDocumentField =
  | "engineering_drawing"
  | "3d_cad_file"
  | "specification"
  | "supporting_documents"
  | "validation_documents";

export interface ECRAttachment {
  id: string;
  ecr_id: string;
  category: ECRAttachmentCategory;
  field_name: ECRDocumentField;
  file_name: string;
  file_url: string;
  full_url: string;
  file_size?: number;
  formatted_size: string;
  mime_type?: string;
  uploaded_by?: string;
  uploaded_at?: string;
}

const LOCAL_STORAGE_PREFIX = "bidsphere_ecr_attachments_";

export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== "number" || isNaN(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function inferCategoryFromFieldName(fieldName?: string, fileName?: string): ECRAttachmentCategory {
  if (fieldName === "engineering_drawing") return "Engineering Drawing";
  if (fieldName === "3d_cad_file") return "3D CAD Model";
  if (fieldName === "specification") return "Specification Document";
  if (fieldName === "validation_documents") return "Validation Documents";
  if (fieldName === "supporting_documents") return "Supporting Documents";

  const ext = (fileName || "").split(".").pop()?.toLowerCase();
  if (["step", "stp", "iges", "igs", "stl", "sldprt", "catpart", "dwg"].includes(ext || "")) {
    return "3D CAD Model";
  }
  return "Supporting Documents";
}

export function inferFieldNameFromCategory(category: ECRAttachmentCategory): ECRDocumentField {
  switch (category) {
    case "Engineering Drawing":
      return "engineering_drawing";
    case "3D CAD Model":
      return "3d_cad_file";
    case "Specification Document":
      return "specification";
    case "Validation Documents":
      return "validation_documents";
    case "Supporting Documents":
    default:
      return "supporting_documents";
  }
}

export function getAttachmentsFromLocalStore(ecrName: string): ECRAttachment[] {
  if (!ecrName || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${ecrName}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAttachmentsToLocalStore(ecrName: string, attachments: ECRAttachment[]): void {
  if (!ecrName || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${ecrName}`, JSON.stringify(attachments));
  } catch {
    // ignore quota errors
  }
}

interface FrappeFileDoc {
  name: string;
  file_name?: string;
  file_url: string;
  file_size?: number;
  attached_to_doctype?: string;
  attached_to_name?: string;
  attached_to_field?: string;
  owner?: string;
  creation?: string;
  modified?: string;
  is_private?: number | boolean;
}

/**
 * Fetch all attachments associated with an ECR record.
 * Queries Frappe File DocType and reconciles with local store & direct DocType fields across all ECR aliases.
 */
export async function fetchECRAttachments(
  ecrName: string,
  ecrDoc?: Partial<EngineeringChangeRequest> | null,
): Promise<ECRAttachment[]> {
  if (!ecrName && !ecrDoc?.name && !ecrDoc?.ecr_number) return [];

  const aliases = Array.from(
    new Set(
      [ecrName, ecrDoc?.name, ecrDoc?.ecr_number].filter(Boolean) as string[],
    ),
  );

  const localSaved: ECRAttachment[] = [];
  for (const alias of aliases) {
    const fromStore = getAttachmentsFromLocalStore(alias);
    for (const item of fromStore) {
      if (!localSaved.some((s) => s.id === item.id || s.file_url === item.file_url)) {
        localSaved.push(item);
      }
    }
  }

  const result: ECRAttachment[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();

  // 1. Fetch live File records from Frappe File DocType
  for (const targetName of aliases) {
    try {
      const params = {
        fields: JSON.stringify([
          "name",
          "file_name",
          "file_url",
          "file_size",
          "attached_to_doctype",
          "attached_to_name",
          "attached_to_field",
          "owner",
          "creation",
          "modified",
          "is_private",
        ]),
        filters: JSON.stringify([
          ["attached_to_doctype", "=", "Engineering Change Request"],
          ["attached_to_name", "=", targetName],
          ["is_folder", "=", 0],
        ]),
        limit_page_length: 100,
        order_by: "creation asc",
      };

      const res = await apiGet<{ data: FrappeFileDoc[] } | FrappeFileDoc[]>(
        buildResourceUrl("File"),
        { params },
      );
      const files: FrappeFileDoc[] = Array.isArray(res)
        ? res
        : (res as { data: FrappeFileDoc[] })?.data || [];

      for (const f of files) {
        if (!f.file_url) continue;
        const fileUrl =
          f.file_url.startsWith("/") || /^https?:\/\//i.test(f.file_url)
            ? f.file_url
            : `/${f.file_url}`;
        if (seenUrls.has(fileUrl)) continue;

        const fileName = f.file_name || fileUrl.split("/").pop() || "Document";
        const fieldName =
          (f.attached_to_field as ECRDocumentField) ||
          inferFieldNameFromCategory(
            inferCategoryFromFieldName(f.attached_to_field, fileName),
          );
        const category = inferCategoryFromFieldName(fieldName, fileName);

        const attachment: ECRAttachment = {
          id: f.name || fileUrl,
          ecr_id: ecrName || targetName,
          category,
          field_name: fieldName,
          file_name: fileName,
          file_url: fileUrl,
          full_url: getFullFileUrl(fileUrl, f.name),
          file_size: f.file_size,
          formatted_size: formatFileSize(f.file_size),
          uploaded_by: f.owner || "Engineer",
          uploaded_at: f.creation || f.modified || new Date().toISOString(),
        };

        result.push(attachment);
        seenIds.add(attachment.id);
        seenUrls.add(attachment.file_url);
      }
    } catch (err) {
      console.warn(`[ECRAttachments] Could not fetch Frappe File records for ${targetName}:`, err);
    }
  }

  // 2. Merge with local store (preserves files uploaded in mock, dev, or recent save sessions)
  for (const local of localSaved) {
    if (!seenIds.has(local.id) && !seenUrls.has(local.file_url)) {
      result.push({
        ...local,
        full_url: getFullFileUrl(local.file_url, local.id),
      });
      seenIds.add(local.id);
      seenUrls.add(local.file_url);
    }
  }

  // 3. Merge with direct fields on the ECR doc if not already present
  if (ecrDoc) {
    const directFieldMappings: Array<{ field: ECRDocumentField; category: ECRAttachmentCategory }> = [
      { field: "engineering_drawing", category: "Engineering Drawing" },
      { field: "3d_cad_file", category: "3D CAD Model" },
      { field: "specification", category: "Specification Document" },
      { field: "supporting_documents", category: "Supporting Documents" },
      { field: "validation_documents", category: "Validation Documents" },
    ];

    for (const mapping of directFieldMappings) {
      const urlValue = ecrDoc[mapping.field];
      if (urlValue && typeof urlValue === "string" && urlValue.trim()) {
        const trimmed = urlValue.trim();
        const urls = trimmed.includes(",") ? trimmed.split(",").map((s) => s.trim()) : [trimmed];
        for (const u of urls) {
          if (!u || seenUrls.has(u)) continue;
          const cleanUrl = u.startsWith("/") || /^https?:\/\//i.test(u) ? u : `/${u}`;
          const fileName = cleanUrl.split("/").pop() || mapping.category;
          const directAttachment: ECRAttachment = {
            id: `direct-${mapping.field}-${cleanUrl}`,
            ecr_id: ecrName || ecrDoc.name || ecrDoc.ecr_number || "",
            category: mapping.category,
            field_name: mapping.field,
            file_name: fileName,
            file_url: cleanUrl,
            full_url: getFullFileUrl(cleanUrl),
            formatted_size: "—",
            uploaded_by: ecrDoc.ecr_owner || ecrDoc.owner || "Engineer",
            uploaded_at: ecrDoc.creation || new Date().toISOString(),
          };
          result.push(directAttachment);
          seenIds.add(directAttachment.id);
          seenUrls.add(cleanUrl);
        }
      }
    }
  }

  // Keep local store synchronized across all aliases
  for (const alias of aliases) {
    saveAttachmentsToLocalStore(alias, result);
  }
  return result;
}

/**
 * Upload a document attachment for an ECR and associate it both in Frappe File DocType and ECR record.
 */
export async function uploadECRAttachment(
  file: File,
  ecrName: string,
  category: ECRAttachmentCategory,
  fieldName?: ECRDocumentField,
  uploadedBy?: string,
): Promise<ECRAttachment> {
  const resolvedField = fieldName || inferFieldNameFromCategory(category);

  // 1. Upload file via ERPNext multipart upload
  const uploaded: UploadedErpFile = await uploadFileToERPNextDetailed(
    file,
    "Engineering Change Request",
    ecrName,
    {
      fileName: file.name,
      fieldname: resolvedField,
      isPrivate: true,
    },
  );

  const fileUrl = uploaded.file_url.startsWith("/") || /^https?:\/\//i.test(uploaded.file_url)
    ? uploaded.file_url
    : `/${uploaded.file_url}`;

  const attachment: ECRAttachment = {
    id: uploaded.file_id || uploaded.file_name || `att-${Date.now()}`,
    ecr_id: ecrName,
    category,
    field_name: resolvedField,
    file_name: file.name || uploaded.file_name,
    file_url: fileUrl,
    full_url: getFullFileUrl(fileUrl, uploaded.file_id),
    file_size: file.size || uploaded.file_size,
    formatted_size: formatFileSize(file.size || uploaded.file_size),
    mime_type: file.type,
    uploaded_by: uploadedBy || "Engineer",
    uploaded_at: new Date().toISOString(),
  };

  // 2. Update local store
  const existing = getAttachmentsFromLocalStore(ecrName);
  const filtered = existing.filter((item) => {
    if (category !== "Supporting Documents" && category !== "Validation Documents") {
      return item.category !== category;
    }
    return item.file_name !== file.name && item.file_url !== fileUrl;
  });
  filtered.push(attachment);
  saveAttachmentsToLocalStore(ecrName, filtered);

  // 3. Update the corresponding ECR DocType field so standard ERPNext forms and queries have it
  try {
    if (category === "Supporting Documents") {
      const supportingUrls = filtered
        .filter((a) => a.category === "Supporting Documents")
        .map((a) => a.file_url)
        .join(",");
      await updateECR(ecrName, { supporting_documents: supportingUrls });
    } else {
      await updateECR(ecrName, { [resolvedField]: fileUrl });
    }
  } catch (err) {
    console.warn(`[ECRAttachments] Could not update ECR field ${resolvedField}:`, err);
  }

  return attachment;
}

/**
 * Delete an attachment from an ECR record.
 */
export async function deleteECRAttachment(
  attachmentId: string,
  ecrName: string,
  category?: ECRAttachmentCategory,
  fieldName?: ECRDocumentField,
): Promise<boolean> {
  // 1. Remove from local store
  const existing = getAttachmentsFromLocalStore(ecrName);
  const remaining = existing.filter((item) => item.id !== attachmentId);
  saveAttachmentsToLocalStore(ecrName, remaining);

  // 2. Try to delete the File record in ERPNext if not a synthetic ID
  if (!attachmentId.startsWith("direct-") && !attachmentId.startsWith("att-")) {
    try {
      await apiDelete(buildResourceUrl("File", attachmentId));
    } catch (err) {
      console.warn(`[ECRAttachments] Could not delete Frappe File ${attachmentId}:`, err);
    }
  }

  // 3. Update ECR document field if necessary
  const resolvedField = fieldName || (category ? inferFieldNameFromCategory(category) : undefined);
  if (resolvedField && ecrName) {
    try {
      if (category === "Supporting Documents") {
        const supportingUrls = remaining
          .filter((a) => a.category === "Supporting Documents")
          .map((a) => a.file_url)
          .join(",");
        await updateECR(ecrName, { supporting_documents: supportingUrls || "" });
      } else {
        const hasOtherInCategory = remaining.some((a) => a.field_name === resolvedField);
        if (!hasOtherInCategory) {
          await updateECR(ecrName, { [resolvedField]: "" });
        }
      }
    } catch (err) {
      console.warn(`[ECRAttachments] Could not clear ECR field ${resolvedField}:`, err);
    }
  }

  return true;
}
