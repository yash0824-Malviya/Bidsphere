import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { clmRecordRoute, type ClmRecord } from "../../api/clm";
import { rfqClmLifecycleView } from "../../utils/rfqClmWorkflow";

/** Saved CLM handoffs only; approvals remain backend-authorized on Contract Detail. */
export default function FinanceContractQueue({ records, loading, error }: { records: ClmRecord[]; loading?: boolean; error?: unknown }) {
  const pending = records.flatMap(record => {
    const lifecycle = rfqClmLifecycleView(record);
    return lifecycle && !lifecycle.paused && lifecycle.current.phase === "finance_review" && record.custom_contract_status === "Pending Finance"
      ? [{ record, workflow: lifecycle.current }] : [];
  });
  return <section aria-label="Contracts awaiting Finance Approval" className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><FileText className="h-5 w-5 shrink-0 text-primary-600" />
        <div><h2 className="text-sm font-semibold text-slate-900">Contracts awaiting Finance Approval <span className="ml-2 tabular-nums">{loading || error ? "—" : pending.length}</span></h2>
          <p className="mt-1 text-xs text-slate-500">Legal Manager-signed contracts assigned to Finance Manager</p></div>
      </div>
      <Link to="/contracts" className="text-xs font-semibold text-primary-700 hover:underline">View Contracts</Link>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error instanceof Error ? error.message : "Unable to load the contract Finance queue. Refresh and try again."}</p>
      : loading ? <p role="status" className="mt-3 text-sm text-slate-500">Loading contracts awaiting Finance Approval…</p>
      : pending.length ? <ul className="mt-3 divide-y divide-slate-100">{pending.map(({ record, workflow }) => <li key={record.name} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-slate-900">{record.name} · {String(record.custom_supplier || record.party_name || "—")}</p>
          <p className="mt-1 break-words text-xs text-slate-500">RFQ: {workflow.rfq} · Award: {workflow.award || "—"}</p>
          <p className="mt-1 break-words text-xs text-slate-500">{workflow.status} · Responsible: {workflow.owner}</p>
        </div>
        <Link to={clmRecordRoute("Contract", record.name)} className="shrink-0 rounded-lg border border-primary-200 px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-50">Review Contract</Link>
      </li>)}</ul>
      : <p className="mt-3 text-sm text-slate-500">No contracts are awaiting Finance Approval.</p>}
  </section>;
}
