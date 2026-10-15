import { useState } from "react";
import { createRoot } from "react-dom/client";
import RfqContractWorkflow from "../../src/components/contracts/RfqContractWorkflow";
import "../../src/index.css";
const params = new URLSearchParams(location.search);
function Sample({ phase }: { phase: string }) { return <RfqContractWorkflow record={{ name: "VISUAL-SAMPLE", custom_rfq: "RFQ-SAMPLE", custom_contract_status: "Active", custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase } }) }} />; }
function Preview() {
  const [phase, setPhase] = useState("signature"), [mobile, setMobile] = useState(false);
  if (params.has("embedded")) return <div className="p-3"><Sample phase={params.get("phase") || "signature"} /></div>;
  return <main className="p-5"><h1 className="text-lg font-semibold">Isolated lifecycle visual check</h1><p className="mt-1 text-sm text-slate-600">Sample data only. This page has no ERP connection or workflow actions.</p><div className="my-4 flex flex-wrap gap-2">{["signature", "finance_review", "procurement", "completed"].map(value => <button className="rounded border px-3 py-1 text-sm" key={value} onClick={() => setPhase(value)}>{value}</button>)}<button className="rounded border px-3 py-1 text-sm" onClick={() => setMobile(value => !value)}>{mobile ? "Desktop width" : "Mobile width"}</button></div><iframe title="Contract lifecycle preview" src={`/?embedded&phase=${phase}`} style={{ width: mobile ? 375 : "100%", maxWidth: 1320, height: mobile ? 700 : 430, border: "1px solid #cbd5e1" }} /></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
