import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Settings2 } from "lucide-react";
import PageHeader from "../../components/PageHeader";
import ClmAlerts from "../../components/contracts/ClmAlerts";
import { CLM_BUTTON, CLM_INPUT, CLM_PRIMARY } from "../../components/contracts/ClmFields";
import { clmError, clmViewerKey, clmRecordRoute, clmStatus, clmTitle, getClmList, getClmMetadata, type ClmRecord } from "../../api/clm";
import { rfqClmRequestValue, rfqClmRequestWorkflowView, rfqClmWorkflowView } from "../../utils/rfqClmWorkflow";

export function contractKpis(records: ClmRecord[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const due = (row: ClmRecord) => {
    const end = String(row.end_date || ""); const days = Number(row.custom_renewal_notice_days || 0);
    return Boolean(end && end >= today && Number.isFinite(days) && (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000 <= days);
  };
  return [
    ["Total contracts", records.length], ["Draft", records.filter(row => { const workflow = rfqClmWorkflowView(row); return workflow ? workflow.phase === "draft" : clmStatus(row) === "Draft"; }).length],
    ["Pending review / approval", records.filter(row => { const workflow = rfqClmWorkflowView(row); return workflow ? ["legal_review", "finance_review"].includes(workflow.phase) : ["Under Review", "Pending Approval", "Pending Legal", "Pending Finance"].includes(clmStatus(row)); }).length],
    ["Pending signatures", records.filter(row => { const workflow = rfqClmWorkflowView(row); return workflow ? workflow.phase === "signature" : clmStatus(row) === "Pending Signature"; }).length],
    ["Active", records.filter(row => clmStatus(row) === "Active").length],
    ["Renewal notice due", records.filter(row => clmStatus(row) === "Active" && due(row)).length],
    ["High / critical risk", records.filter(row => ["High", "Critical"].includes(String(row.custom_risk_level))).length],
    ["Completed", records.filter(row => rfqClmWorkflowView(row)?.phase === "completed").length],
  ] as const;
}
export default function ContractsPage({ doctype = "Contract", supplier = false }: { doctype?: string; supplier?: boolean }) {
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("");
  const query = useQuery({ queryKey: ["clm", "list", doctype, supplier, clmViewerKey()], queryFn: () => getClmList(doctype), staleTime: 20_000, refetchInterval: 30_000 });
  const metadata = useQuery({ queryKey: ["clm", "metadata", clmViewerKey()], queryFn: getClmMetadata, enabled: !supplier, staleTime: 60_000 });
  const records = query.data?.records || [];
  const allowed = query.data?.allowedCreate || query.data?.allowed_create || metadata.data?.allowedCreate || metadata.data?.allowed_create || [];
  const requests = doctype === "Contract Request";
  const showWorkflow = !supplier;
  const workflowFor = (row: ClmRecord) => requests ? rfqClmRequestWorkflowView(row) : rfqClmWorkflowView(row);
  const displayStatus = (row: ClmRecord) => showWorkflow ? workflowFor(row)?.status || clmStatus(row) : clmStatus(row);
  const filtered = useMemo(() => records.filter(row => {
    const workflow = showWorkflow ? workflowFor(row) : undefined;
    return (!status || (workflow?.status || clmStatus(row)) === status) && `${row.name} ${clmTitle(row)} ${row.custom_supplier || row.supplier || row.party_name || ""} ${showWorkflow ? String(row.custom_rfq || "") : ""} ${workflow?.award || ""} ${workflow?.stage || ""} ${workflow?.owner || ""}`.toLowerCase().includes(search.toLowerCase());
  }), [records, search, status, showWorkflow, requests]);
  return <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5 p-4 sm:p-6">
    <PageHeader actions={<><button className={CLM_BUTTON} disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="h-4 w-4" />Refresh</button>
      {!supplier && ["Contract Approval Matrix", "Contract Clause", "Contract Template"].some(type => allowed.includes(type)) && <Link className={CLM_BUTTON} to="/contracts/settings"><Settings2 className="h-4 w-4" />Configuration</Link>}
      {!supplier && allowed.includes(doctype) && <Link className={CLM_PRIMARY} to={requests ? "/contract-requests/new" : "/contracts/new"}><Plus className="h-4 w-4" />{requests ? "New request" : "New contract"}</Link>}</>} />
    <div><h1 className="text-2xl font-bold text-slate-900">{requests ? "Contract Requests" : "Contracts"}</h1><p className="mt-1 text-sm text-slate-500">{supplier ? "Contracts assigned to your organization." : requests ? "Request and validate a contract before authoring." : "Track contract decisions, signatures, commitments and closure."}</p></div>
    {!supplier && requests && query.data && !query.isError && <p className="text-sm font-semibold text-slate-700">Pending CLM Requests: {records.filter(row => !!rfqClmRequestWorkflowView(row)).length}</p>}
    {!supplier && !requests && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[...contractKpis(records), ...(query.data?.kpis?.overdueObligations !== undefined ? [["Overdue obligations", query.data.kpis.overdueObligations] as const] : []), ...(query.data?.kpis?.slaBreaches !== undefined ? [["SLA breaches", query.data.kpis.slaBreaches] as const] : [])].map(([label, count]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{query.data && !query.isError ? count : "—"}</p></div>)}</div>}
    {!supplier && <ClmAlerts alerts={query.data?.alerts || []} />}
    {!supplier && <nav className="flex flex-wrap gap-4 text-sm font-semibold" aria-label="Contract workspace"><Link className="text-blue-700 hover:underline" to="/contracts">Contracts</Link><Link className="text-blue-700 hover:underline" to="/contract-requests">Contract Requests</Link></nav>}
    <div className="flex flex-wrap gap-3"><input className={`${CLM_INPUT} min-w-0 flex-1 basis-64`} aria-label="Search contracts" placeholder={showWorkflow ? "Search contract, supplier, RFQ, award or owner" : "Search reference, title or supplier"} value={search} onChange={e => setSearch(e.target.value)} /><select className={`${CLM_INPUT} sm:w-56`} aria-label="Filter by contract status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{[...new Set(records.map(displayStatus))].sort().map(value => <option key={value}>{value}</option>)}</select></div>
    {query.isError ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{clmError(query.error)}</div> : query.isLoading ? <p role="status" className="p-8 text-center text-slate-500">Loading contracts…</p> : <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="max-w-full overflow-x-auto" role="region" aria-label="Contracts table" tabIndex={0}><table className={`w-full ${showWorkflow ? "min-w-[1200px]" : "min-w-[680px]"} text-left text-sm`}><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Reference", "Title / purpose", "Supplier", ...(showWorkflow ? ["RFQ", "Award"] : []), "Status", ...(showWorkflow ? ["Current Stage"] : []), "Value", ...(showWorkflow ? ["Start Date"] : []), "End Date", ...(showWorkflow ? ["Owner"] : []), "Action"].map((label, index) => <th key={index} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(row => {
      const workflow = showWorkflow ? workflowFor(row) : undefined;
      const requestWorkflow = requests && workflow?.phase === "procurement_team" ? workflow : undefined;
      const value = requests ? rfqClmRequestValue(row) : row.custom_contract_value ?? row.contract_value;
      return <tr key={row.name}><td className="break-words px-4 py-3 font-mono text-xs"><Link className="font-semibold text-blue-700 hover:underline" to={clmRecordRoute(doctype, row.name, supplier)}>{row.name}</Link></td><td className="max-w-xs break-words px-4 py-3 font-medium">{clmTitle(row)}{requestWorkflow?.initialRequest && <dl className="mt-2 space-y-1 text-xs font-normal text-slate-500">{[["Department", requestWorkflow.department || "—"], ["Requester", requestWorkflow.requester || "—"], ["Contract Required", requestWorkflow.contractRequired || "—"]].map(([label, value]) => <div key={label}><dt className="inline">{label}: </dt><dd className="inline">{value}</dd></div>)}</dl>}</td><td className="max-w-[180px] break-words px-4 py-3">{String(row.custom_supplier || row.supplier || row.party_name || requestWorkflow?.supplier || (requestWorkflow?.initialRequest ? "Not yet awarded" : "—"))}</td>
        {showWorkflow && <><td className="max-w-[160px] break-words px-4 py-3 text-xs">{String(row.custom_rfq || "—")}</td><td className="max-w-[150px] break-words px-4 py-3 text-xs">{workflow?.award || (requestWorkflow?.initialRequest ? "Pending" : "—")}</td></>}
        <td className="px-4 py-3"><span className="inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{displayStatus(row)}</span>{workflow?.phase === "completed" && <span className="mt-1 block text-xs text-slate-500">Contract: {clmStatus(row)}</span>}</td>
        {showWorkflow && <td className="px-4 py-3">{workflow?.stage || "—"}</td>}
        <td className="whitespace-nowrap px-4 py-3">{value !== undefined ? `${String(row.custom_currency || row.currency || "")} ${Number(value).toLocaleString()}`.trim() : "—"}</td>
        {showWorkflow && <td className="whitespace-nowrap px-4 py-3">{String(row.start_date || row.contract_start_date || "—")}</td>}
        <td className="whitespace-nowrap px-4 py-3">{String(row.end_date || row.contract_end_date || "—")}</td>{showWorkflow && <td className="px-4 py-3">{workflow?.owner || String(row.custom_current_approver || "—")}</td>}
        <td className="px-4 py-3"><Link className="font-semibold text-blue-700 hover:underline" to={clmRecordRoute(doctype, row.name, supplier)}>{requestWorkflow?.initialRequest && !requestWorkflow.award ? "Open request" : requests && workflow?.phase === "procurement_team" ? "Review & Create Contract" : "Open"}</Link></td></tr>;
    })}</tbody></table></div>{!filtered.length && <p className="p-10 text-center text-sm text-slate-500">No {requests ? "contract requests" : "contracts"} match this view.</p>}</div>}
  </div>;
}
