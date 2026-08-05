/**
 * Upload procurement RFQ line attachments after RFQ create.
 * Merges new files with inherited MR references — never deletes inherited URLs.
 */

import { getRFQ } from "./sourcing";
import { uploadFileToERPNext } from "./legalDocsStorage";
import { apiPut, buildResourceUrl } from "./erpnext";
import type { RFQItemLine } from "../components/RFQItemLineRow";
import {
  MR_ITEM_2D_FIELD,
  MR_ITEM_ATTACHMENTS_FIELD,
  newAttachmentId,
  resolveEngineeringAttachments,
  serializeEngineeringAttachments,
  type EngineeringAttachment,
} from "../utils/materialRequestItemFiles";
import {
  inferDocumentTypeFromFileName,
  normalizeAttachmentVisibility,
} from "../utils/rfqAttachmentVisibility";

function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export async function syncRfqItemEngineeringFiles(
  rfqName: string,
  lines: RFQItemLine[],
  uploadedBy?: string,
): Promise<void> {
  const rfq = await getRFQ(rfqName);
  const children = rfq.items ?? [];

  for (const line of lines) {
    const code = line.item_code?.trim();
    if (!code) continue;

    const pending = line.pendingAttachments ?? [];
    const lineAttachments = line.attachments ?? [];
    const needsSync =
      pending.length > 0 ||
      line.attachmentsDirty === true ||
      lineAttachments.length > 0 ||
      !!String(line.drawing_2d_url || "").trim();

    if (!needsSync) continue;

    const child = children.find((it) => it.item_code === code);
    if (!child?.name) continue;

    const existingFromErp = resolveEngineeringAttachments({
      custom_part_name: child.custom_part_name,
      custom_2d_drawing: child.custom_2d_drawing,
      custom_engineering_attachments: child.custom_engineering_attachments,
    }).attachments;

    const byUrl = new Map<string, EngineeringAttachment>();
    for (const att of existingFromErp) {
      byUrl.set(att.fileUrl, att);
    }
    /* Line state wins for visibility / documentType (procurement toggles). */
    for (const att of lineAttachments) {
      const prev = byUrl.get(att.fileUrl);
      byUrl.set(att.fileUrl, prev ? { ...prev, ...att } : att);
    }

    const current = [...byUrl.values()];

    for (const item of pending) {
      const url = await uploadFileToERPNext(
        item.file,
        "Request for Quotation Item",
        child.name,
      );
      current.push({
        id: item.id || newAttachmentId(),
        fileName: item.file.name,
        fileUrl: url,
        fileType: fileExtension(item.file.name).replace(".", "") || "file",
        fileSize: item.file.size,
        uploadedBy: uploadedBy || undefined,
        uploadedAt: new Date().toISOString(),
        source: "procurement",
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

    const mergedJson = serializeEngineeringAttachments(current);
    const primary = current[0]?.fileUrl ?? child.custom_2d_drawing ?? "";

    await apiPut(buildResourceUrl("Request for Quotation Item", child.name), {
      [MR_ITEM_2D_FIELD]: primary,
      [MR_ITEM_ATTACHMENTS_FIELD]: mergedJson,
    });
  }
}
