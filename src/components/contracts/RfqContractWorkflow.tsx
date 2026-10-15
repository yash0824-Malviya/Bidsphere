import type { ClmRecord } from "../../api/clm";
import { ArrowRight, Check, Circle } from "lucide-react";
import { rfqClmLifecycleView, rfqClmWorkflowView } from "../../utils/rfqClmWorkflow";

export const rfqContractPhase = (record: ClmRecord) => rfqClmWorkflowView(record)?.phase;

export default function RfqContractWorkflow({ record }: { record: ClmRecord }) {
  const lifecycle = rfqClmLifecycleView(record);
  if (!lifecycle) return null;
  const { current, next, steps, paused } = lifecycle;
  return <section aria-label="RFQ contract workflow" className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Contract Lifecycle Progress</h2>
        <p className="text-xs text-slate-500">Sequential approval and execution route</p>
      </div>
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
        Stage: {current.stage}
      </span>
    </div>
    <dl aria-live="polite" aria-atomic="true" className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
      <div className="min-w-0"><dt className="text-xs text-slate-500">Current status</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-900">{current.status}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">Current stage</dt><dd className="mt-1 break-words text-sm font-semibold text-blue-800">{current.stage}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">Current responsibility</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-900">{current.owner}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">Next status / stage</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-900">{next?.stage || (current.phase === "completed" ? "No further stages" : "No next stage scheduled")}{next && <><span className="mt-0.5 block text-xs font-normal text-slate-600">{next.status !== next.stage ? next.status : "Final stage"}</span><span className="mt-0.5 block text-xs font-normal text-slate-600">Responsible: {next.owner}</span></>}</dd></div>
    </dl>
    <ol aria-label="Contract lifecycle stages" className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {steps.map(step => {
        const active = step.state === "current";
        const done = step.state === "completed" || active && step.phase === "completed";
        const Icon = done ? Check : active ? ArrowRight : Circle;
        return <li key={step.phase} data-phase={step.phase} data-state={step.state} aria-current={active ? "step" : undefined} className={`flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2.5 transition-colors ${active ? "border-blue-500 bg-blue-50/80 ring-1 ring-blue-200" : done ? "border-emerald-200 bg-emerald-50/40" : step.state === "next" ? "border-blue-200 bg-white" : "border-slate-200 bg-slate-50/50"}`}>
          <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${done ? "text-emerald-600" : active ? "text-blue-700" : "text-slate-400"}`} />
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`break-words text-xs font-semibold ${active ? "text-blue-900" : done ? "text-emerald-950" : "text-slate-800"}`}>{step.stage}</span>{active ? <span className="rounded bg-blue-700 px-1.5 py-0.5 text-[10px] font-bold text-white">CURRENT</span> : step.state === "next" ? <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">NEXT</span> : <span className="sr-only">{step.state === "completed" ? "Completed" : step.state === "blocked" ? "Blocked" : "Upcoming"}</span>}</div><p className="mt-0.5 break-words text-xs text-slate-500">{step.owner}</p></div>
        </li>;
      })}
    </ol>
    <p className={`mt-3 text-xs ${paused ? "text-amber-800" : "text-slate-600"}`}>{current.instruction}</p>
  </section>;
}
