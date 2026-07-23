/**
 * Shared MR → RFQ / PO action control (presentation + rule from mrRfqAction).
 */

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Truck } from "lucide-react";

import {
  resolveMrRfqUiAction,
  type MrRfqUiAction,
} from "../../api/mrRfqAction";
import type { MaterialRequestWorkflowRecord } from "../../api/materialRequestWorkflow";

export function useMrRfqUiAction(mr: MaterialRequestWorkflowRecord | null) {
  return useQuery({
    queryKey: ["mr-rfq-action", mr?.name, mr?.custom_linked_rfq, mr?.modified],
    enabled: !!mr?.name,
    queryFn: () => resolveMrRfqUiAction(mr!),
    staleTime: 30_000,
  });
}

export default function MrRfqActionControl({
  mr,
  /** Optional pre-resolved action (skips inner query). */
  resolved,
  compact = false,
  /** When false, hide Create RFQ (role gate). View RFQ / View PO still show. */
  allowCreate = true,
  createLabel = "Create RFQ",
}: {
  mr: MaterialRequestWorkflowRecord;
  resolved?: MrRfqUiAction | null;
  compact?: boolean;
  allowCreate?: boolean;
  createLabel?: string;
}) {
  const query = useMrRfqUiAction(resolved ? null : mr);
  const action = resolved ?? query.data;

  const btn = compact
    ? "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold no-underline"
    : "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold no-underline";

  if (query.isLoading && !resolved) {
    return (
      <span className={`${btn} border border-neutral-200 bg-white text-neutral-500`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        …
      </span>
    );
  }

  if (!action) return null;

  if (action.action === "view_po" && action.poName) {
    return (
      <Link
        to={`/p2p/purchase-orders/${encodeURIComponent(action.poName)}`}
        className={`${btn} border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50`}
      >
        View Purchase Order
      </Link>
    );
  }

  if (action.action === "view_rfq" && action.rfqName) {
    return (
      <Link
        to={`/sourcing/rfq/${encodeURIComponent(action.rfqName)}`}
        className={`${btn} border border-neutral-200 bg-white text-primary-600 hover:bg-neutral-50`}
      >
        View RFQ
      </Link>
    );
  }

  if (action.action === "create_rfq" && action.canCreate && allowCreate) {
    return (
      <Link
        to={`/sourcing/rfq/new?mr=${encodeURIComponent(mr.name)}`}
        className={`${btn} bg-emerald-600 text-white shadow-sm hover:bg-emerald-700`}
      >
        <Truck className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {createLabel}
      </Link>
    );
  }

  return null;
}
