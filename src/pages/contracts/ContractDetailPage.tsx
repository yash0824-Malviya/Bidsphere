import { Link, useParams } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import ClmRecordWorkspace from "../../components/contracts/ClmRecordWorkspace";
import { CLM_BUTTON } from "../../components/contracts/ClmFields";
import { CLM_RELATED_DOCTYPES } from "../../api/clm";

export default function ContractDetailPage({ doctype = "Contract", supplier = false }: { doctype?: string; supplier?: boolean }) {
  const params = useParams(); const name = params.name || params.id || "";
  const effectiveDoctype = params.recordType ? (CLM_RELATED_DOCTYPES as readonly string[]).includes(params.recordType) ? params.recordType : null : doctype;
  return <div className="mx-auto w-full min-w-0 max-w-7xl space-y-4 p-4 sm:p-6"><PageHeader actions={<Link className={CLM_BUTTON} to={supplier ? "/supplier/contracts" : effectiveDoctype === "Contract Request" ? "/contract-requests" : "/contracts"}>Back to {effectiveDoctype === "Contract Request" ? "requests" : "contracts"}</Link>} />{effectiveDoctype ? <ClmRecordWorkspace key={`${effectiveDoctype}-${name}`} doctype={effectiveDoctype} name={name} supplier={supplier} initialTab={effectiveDoctype === "Contract Request" ? "Request details" : undefined} /> : <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Unsupported contract record type.</p>}</div>;
}
