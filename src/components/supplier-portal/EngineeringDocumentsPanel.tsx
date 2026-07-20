/**
 * Supplier RFQ — read-only engineering attachments per line item.
 * View / download only (no upload or delete).
 */

import {
  resolveEngineeringAttachments,
  type EngineeringAttachment,
} from "../../utils/materialRequestItemFiles";
import EngineeringAttachmentsView from "../attachments/EngineeringAttachmentsView";

export interface EngineeringDocumentsPanelProps {
  partName?: string | null;
  drawing2dUrl?: string | null;
  attachments?: EngineeringAttachment[] | null;
}

/**
 * Card under each Supplier RFQ item. Hidden when there is no part name and
 * no attachments (backward compatible empty RFQs).
 */
export default function EngineeringDocumentsPanel({
  partName,
  drawing2dUrl,
  attachments,
}: EngineeringDocumentsPanelProps) {
  const hasPart = !!partName?.trim();
  const list = resolveEngineeringAttachments({
    attachments,
    custom_2d_drawing: drawing2dUrl,
    drawing_2d_url: drawing2dUrl,
  });
  const hasFiles = list.length > 0;

  if (!hasPart && !hasFiles) return null;

  return (
    <div className="mt-2.5 rounded-lg border border-neutral-200 bg-white p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
          Engineering Documents
        </p>
        {hasFiles && (
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 ring-1 ring-inset ring-sky-100">
            {list.length} Attachment{list.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {hasPart && (
        <div className="mt-2">
          <p className="text-[10px] font-medium text-neutral-500">Part Name</p>
          <p className="mt-0.5 text-xs font-semibold text-neutral-800">
            {partName!.trim()}
          </p>
        </div>
      )}

      {!hasFiles ? (
        <p className="mt-2 text-xs text-neutral-500">
          No attachments available
        </p>
      ) : (
        <div className="mt-2">
          <EngineeringAttachmentsView
            attachments={list}
            compact
            emptyLabel="No attachments available"
          />
        </div>
      )}
    </div>
  );
}
