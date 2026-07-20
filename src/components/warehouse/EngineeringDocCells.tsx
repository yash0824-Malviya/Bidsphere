/**
 * Read-only Part Name / Attachments cells for Warehouse / Procurement grids.
 * View, preview, and download only — never edit/replace/delete.
 */

import { useMemo } from "react";

import EngineeringAttachmentsView from "../attachments/EngineeringAttachmentsView";
import {
  resolveEngineeringAttachments,
  type EngineeringAttachment,
} from "../../utils/materialRequestItemFiles";

export function PartNameCell({ value }: { value?: string | null }) {
  const text = value?.trim();
  if (!text) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <span className="block max-w-[12rem] truncate text-slate-700" title={text}>
      {text}
    </span>
  );
}

/**
 * Multi-file read-only attachments cell with count badge + full metadata.
 * Falls back to a single legacy URL when `attachments` is empty.
 */
export function AttachmentsCell({
  attachments,
  url,
}: {
  attachments?: EngineeringAttachment[] | null;
  /** Legacy single file URL when JSON attachments are absent. */
  url?: string | null;
}) {
  const list = useMemo(() => {
    if (attachments && attachments.length > 0) return attachments;
    return resolveEngineeringAttachments({
      custom_2d_drawing: url,
      drawing_2d_url: url,
    });
  }, [attachments, url]);

  return (
    <EngineeringAttachmentsView
      attachments={list}
      compact
      emptyLabel="No attachments available"
    />
  );
}

/** @deprecated Prefer AttachmentsCell — kept for call sites that pass a single URL. */
export function Drawing2dCell({
  url,
  attachments,
}: {
  url?: string | null;
  attachments?: EngineeringAttachment[] | null;
}) {
  return <AttachmentsCell url={url} attachments={attachments} />;
}
