import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "../../components/PageHeader";
import { clmError, clmViewerKey, clmTitle, getClmList, getClmMetadata } from "../../api/clm";
import { CLM_BUTTON, CLM_INPUT, CLM_PRIMARY } from "../../components/contracts/ClmFields";
import ClmRecordWorkspace, { ClmNewRelated } from "../../components/contracts/ClmRecordWorkspace";
import { useAuthStore } from "../../store/authStore";

export default function ContractSettingsPage() {
  const [params, setParams] = useSearchParams(); const qc = useQueryClient(); const [creating, setCreating] = useState(false);
  const role = useAuthStore(state => state.user?.role);
  const types = ["admin", "procurement"].includes(role || "") ? ["Contract Approval Matrix", "Contract Clause", "Contract Template"] : ["Contract Clause", "Contract Template"];
  const requested = params.get("doctype") || types[0];
  const doctype = types.includes(requested) ? requested : types[0]; const name = doctype === requested ? params.get("name") || "" : "";
  const list = useQuery({ queryKey: ["clm", "list", doctype, clmViewerKey()], queryFn: () => getClmList(doctype), staleTime: 15_000 });
  const metadata = useQuery({ queryKey: ["clm", "metadata", clmViewerKey()], queryFn: getClmMetadata, staleTime: 60_000 });
  const allowed = metadata.data?.allowedCreate || metadata.data?.allowed_create || [];
  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5 p-4 sm:p-6"><PageHeader actions={<Link to="/contracts" className={CLM_BUTTON}>Back to contracts</Link>} /><div><h1 className="text-2xl font-bold text-slate-900">Contract configuration</h1><p className="mt-1 text-sm text-slate-500">Manage policy rules, approved clauses and reusable contract templates.</p></div><div className="flex flex-wrap items-center gap-3"><select className={`${CLM_INPUT} sm:w-72`} aria-label="Configuration type" value={doctype} onChange={e => { setParams({ doctype: e.target.value }); setCreating(false); }}>{types.map(type => <option key={type}>{type}</option>)}</select><select className={`${CLM_INPUT} flex-1 basis-64`} aria-label="Existing configuration record" value={name} onChange={e => { setParams({ doctype, ...(e.target.value ? { name: e.target.value } : {}) }); setCreating(false); }}><option value="">Select a record</option>{list.data?.records.map(row => <option key={row.name} value={row.name}>{clmTitle(row)}</option>)}</select>{allowed.includes(doctype) && <button className={CLM_PRIMARY} onClick={() => { setParams({ doctype }); setCreating(true); }}>New {doctype.replace("Contract ", "").toLowerCase()}</button>}</div>
    {list.isError && <p role="alert" className="text-sm text-rose-700">{clmError(list.error)}</p>}
    {creating ? <div className="rounded-xl border border-slate-200 bg-white p-5"><ClmNewRelated key={doctype} doctype={doctype} onCancel={() => setCreating(false)} onSaved={result => { setParams({ doctype, name: result.record.name }); setCreating(false); void qc.invalidateQueries({ queryKey: ["clm"] }); }} /></div> : name ? <ClmRecordWorkspace key={`${doctype}-${name}`} doctype={doctype} name={name} /> : <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{list.isLoading ? "Loading configuration…" : "Select an existing record or create one using your approved policy."}</div>}
  </div>;
}
