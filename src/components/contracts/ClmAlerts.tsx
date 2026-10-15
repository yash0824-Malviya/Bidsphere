import { useState } from "react";
import { Link } from "react-router-dom";
import { clmRecordRoute, type ClmAlert } from "../../api/clm";
import { CLM_BUTTON } from "./ClmFields";

export default function ClmAlerts({ alerts }: { alerts: ClmAlert[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!alerts.length) return null;
  const visible = expanded ? alerts : alerts.slice(0, 10);
  return <section aria-label="Contract alerts" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-900">Contract alerts <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{alerts.length}</span></h2><p className="text-xs text-slate-500">Upcoming dates and items requiring attention</p></div>
    <ul className="divide-y divide-slate-100">{visible.map(alert => <li key={alert.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0 flex-1 basis-64"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${["critical", "high", "error", "danger"].includes(alert.severity.toLowerCase()) ? "bg-rose-50 text-rose-700" : alert.severity.toLowerCase() === "warning" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-700"}`}>{alert.kind.replaceAll("_", " ")}</span><span className="break-all font-mono text-xs text-slate-500">{alert.source_name}</span></div><p className="mt-1.5 break-words text-sm text-slate-700">{alert.message}</p>{(alert.due_date || alert.owner) && <p className="mt-1 text-xs text-slate-500">{alert.due_date ? `Due: ${alert.due_date}` : ""}{alert.due_date && alert.owner ? " · " : ""}{alert.owner ? `Owner: ${alert.owner}` : ""}</p>}</div><Link className="shrink-0 text-sm font-semibold text-blue-700 hover:underline" to={clmRecordRoute("Contract", alert.contract)}>Open contract</Link></li>)}</ul>
    {alerts.length > 10 && <button type="button" className={`${CLM_BUTTON} mt-4`} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer alerts" : `View all ${alerts.length} alerts`}</button>}
  </section>;
}
