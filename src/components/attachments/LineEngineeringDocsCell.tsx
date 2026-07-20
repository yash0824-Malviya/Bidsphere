/**
 * Resolves and displays engineering attachments for a linked line item
 * (PO / GRN / Invoice / Voucher) via URL references — no re-upload.
 */

import { useQuery } from "@tanstack/react-query";

import {
  resolveItemEngineeringDocs,
  type EngineeringDocsLookup,
} from "../../api/resolveItemEngineeringDocs";
import { PartNameCell } from "../warehouse/EngineeringDocCells";
import EngineeringAttachmentsView from "./EngineeringAttachmentsView";

export default function LineEngineeringDocsCell({
  lookup,
  showPartName = false,
}: {
  lookup: EngineeringDocsLookup;
  showPartName?: boolean;
}) {
  const key = [
    lookup.material_request_item,
    lookup.purchase_order_item,
    lookup.purchase_order,
    lookup.item_code,
    lookup.rfq_name,
  ]
    .filter(Boolean)
    .join("|");

  const query = useQuery({
    queryKey: ["line-engineering-docs", key],
    queryFn: () => resolveItemEngineeringDocs(lookup),
    staleTime: 60_000,
    enabled: !!key,
  });

  if (query.isLoading) {
    return (
      <span className="text-[11px] text-neutral-400">Loading attachments…</span>
    );
  }

  const docs = query.data ?? { attachments: [] };

  return (
    <div className="space-y-1.5">
      {showPartName && <PartNameCell value={docs.part_name} />}
      <EngineeringAttachmentsView
        attachments={docs.attachments}
        compact
        emptyLabel="No attachments available"
      />
    </div>
  );
}
