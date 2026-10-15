import { Link } from "react-router-dom";
import type { ClmRecord } from "../../api/clm";
import { formatCurrencyIn } from "../../utils/format";
import { rfqClmWorkflowView } from "../../utils/rfqClmWorkflow";
import { CLM_BUTTON } from "./ClmFields";

/** Display only the saved completion receipt; opening a Contract never finalizes it. */
export default function ClmPurchaseOrderSummary({ record }: { record: ClmRecord }) {
  const workflow = rfqClmWorkflowView(record);
  if (workflow?.phase !== "completed" || !workflow.purchaseOrder) return null;
  let completion: Record<string, unknown> = {};
  try {
    const data = typeof record.custom_clm_data === "string" ? JSON.parse(record.custom_clm_data) : record.custom_clm_data;
    completion = data?.procurement_completion || {};
  } catch { return null; }
  return <section aria-label="Created Purchase Order" className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
    <h2 className="text-sm font-semibold text-emerald-900">PO Created Successfully</h2>
    <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div className="min-w-0"><dt className="text-xs text-slate-500">Purchase Order</dt><dd className="mt-1 break-words font-semibold">{workflow.purchaseOrder}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">Supplier</dt><dd className="mt-1 break-words">{String(completion.supplier_name || completion.supplier || "—")}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">PO Value</dt><dd className="mt-1">{formatCurrencyIn(completion.grand_total as number | undefined, String(completion.currency || ""))}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">Created Date</dt><dd className="mt-1 break-words">{String(completion.created_at || "—")}</dd></div>
    </dl>
    <Link className={`${CLM_BUTTON} mt-3 inline-flex`} to={`/p2p/purchase-orders/${encodeURIComponent(workflow.purchaseOrder)}`}>View Purchase Order</Link>
  </section>;
}
