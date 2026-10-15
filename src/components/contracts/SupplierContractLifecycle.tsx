import type { ClmSupplierWorkflow } from "../../types/clm";
import { Check, Circle } from "lucide-react";

const STEPS = [
  "Pending Supplier Contract Acceptance",
  "Supplier Contract Accepted",
  "Pending Supplier Contract Signature",
  "Supplier Contract Signed",
  "Pending Supplier PO Acceptance",
  "Supplier PO Accepted",
  "Existing PO Processing",
  "Completed",
] as const;

/** This supplier handoff is separate from the already completed internal CLM approvals. */
export default function SupplierContractLifecycle({ workflow }: { workflow: ClmSupplierWorkflow }) {
  const accepted = workflow.acceptance_status === "Accepted";
  const signed = accepted && workflow.signature_status === "Signed";
  const poAccepted = signed && workflow.po_acceptance_status === "Accepted";
  const completed = poAccepted && workflow.shipment_status === "Completed" && workflow.current_stage === "Completed";
  const current = completed ? 7 : poAccepted ? 6 : signed ? 4 : accepted ? 2 : 0;
  return <section aria-label="Supplier Contract lifecycle" className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
    <p className="text-sm font-semibold text-blue-950">{workflow.status}</p>
    <dl className="mt-2 grid gap-3 text-xs sm:grid-cols-3">
      <div><dt className="text-slate-500">Current stage</dt><dd className="mt-1 font-semibold text-slate-900">{workflow.current_stage}</dd></div>
      <div><dt className="text-slate-500">Current responsibility</dt><dd className="mt-1 font-semibold text-slate-900">{workflow.responsible}</dd></div>
      <div><dt className="text-slate-500">Next stage</dt><dd className="mt-1 font-semibold text-slate-900">{workflow.next_stage || "—"}</dd></div>
    </dl>
    <ol aria-label="Supplier acceptance and fulfillment stages" className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
      {STEPS.map((step, index) => {
        const done = index < current || completed && index === 7;
        const active = index === current;
        return <li key={step} data-state={active ? "current" : done ? "completed" : "upcoming"} aria-current={active ? "step" : undefined} className={`flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${active ? completed ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-blue-400 bg-white text-blue-950 ring-1 ring-blue-100" : done ? "border-emerald-100 bg-white/60 text-emerald-800" : "border-slate-200 bg-white/50 text-slate-500"}`}>
          {done ? <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Circle aria-hidden className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? "fill-blue-600 text-blue-600" : "text-slate-300"}`} />}
          <span className="min-w-0 break-words"><span className={active || done ? "font-semibold" : ""}>{step}</span>{active && <span className="mt-0.5 block text-[9px] font-bold tracking-wide">CURRENT</span>}</span>
        </li>;
      })}
    </ol>
    {signed && <p className="mt-2 text-sm font-semibold text-emerald-800">Contract: Fully Signed</p>}
    {workflow.blocked_reason && <p className="mt-2 text-xs text-slate-600">{workflow.blocked_reason}</p>}
  </section>;
}
