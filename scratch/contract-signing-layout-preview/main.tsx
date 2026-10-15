import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { SigningWorkspace } from "../../src/components/contracts/RfqContractSigning";
import type { ClmDetail } from "../../src/api/clm";
import { SIGNING_DISABLED } from "./apiStub";
import "../../src/index.css";

const sample: ClmDetail = {
  doctype: "Contract", record: { name: "CON-LAYOUT-SAMPLE", modified: "fixture-revision-1", custom_rfq: "RFQ-LAYOUT-SAMPLE", custom_supplier: "Atlantic Precision Manufacturing", custom_supplier_quotation: "QUOTE-LAYOUT-SAMPLE", custom_contract_type: "Supply / Procurement Contract", custom_contract_title: "ISOLATED LAYOUT SAMPLE - No ERP writes", custom_contract_status: "Pending Signature", custom_inteva_signatory: "legal-layout@example.test", custom_contract_value: 4500, custom_currency: "USD", start_date: "2026-09-25", end_date: "2026-10-25", custom_current_version: "1.0", custom_final_version_locked: 1, contract_terms: "Sample terms for layout review only. Supply materials according to the agreed delivery schedule. Include inspection evidence with every delivery. Payment is due after an accepted invoice. This sample cannot create a Contract, signature or approval.", custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase: "signature" }, rfq_context: { award_id: "AWARD-LAYOUT-SAMPLE" } }) },
  actions: [{ action: "sign", label: "E-Sign Contract" }], signatures: [], supplier_documents: [{ file_id: "SAMPLE-SUPPORT-PDF", file_name: "Supporting document - layout sample.pdf", file_url: "/sample/supporting.pdf", by: "UI layout fixture", at: "2026-09-28 12:00:00", version: "1.0" }],
  signature_workflow: { supplier_status: "Pending", legal_status: "Pending", is_legal_signatory: true, can_review: true, can_sign: true, can_request_signatures: false, document_file_id: "SAMPLE-LOCKED-PDF" },
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function EmbeddedFixture() {
  const [open, setOpen] = useState(true), [attempts, setAttempts] = useState(0);
  return <QueryClientProvider client={client}><div className="app-shell min-w-0 bg-slate-100">
    <aside className="app-sidebar app-sidebar-fixed w-60 bg-slate-950 p-5 text-white"><h2 className="font-bold">BidSphere</h2><p className="mt-1 text-xs text-slate-300">Isolated layout sample</p><nav className="mt-8 space-y-4 text-sm"><p>Dashboard</p><p>Contracts</p><p>Legal Review</p></nav><p className="mt-auto text-xs">Real sidebar z-index: 100</p></aside>
    <main className="app-shell-main ml-60"><header className="border-b bg-white p-4 text-sm">Legal Manager · No ERP connection</header><div className="app-shell-scroll p-4"><h1 className="text-xl font-bold">CON-LAYOUT-SAMPLE</h1><p className="mt-2 font-medium text-amber-800">Sample data only. No signature or workflow action can be submitted.</p><button className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-white" onClick={() => setOpen(true)}>Open sample E-Sign Contract</button><p className="mt-4 text-sm">Confirmation attempts rejected locally: {attempts}</p>
    {open && <SigningWorkspace detail={sample} fields={[]} busy={false} canSign onClose={() => setOpen(false)} onAction={async () => { setAttempts(count => count + 1); throw new Error(SIGNING_DISABLED); }} />}
    </div></main><Toaster position="top-right" /></div></QueryClientProvider>;
}
function PreviewControls() {
  const [size, setSize] = useState({ width: 1280, height: 800 }), [version, setVersion] = useState(0);
  return <main className="min-h-screen bg-slate-100 p-3 text-slate-900"><header className="mb-3 space-y-2"><h1 className="text-lg font-bold">Contract signing layout - isolated fixture</h1><p className="text-sm text-amber-900">Sample CON-LAYOUT-SAMPLE only. The real modal, PDF renderer and signer form are mounted; ERP APIs and uploads are stubbed. Confirm always fails safely.</p><div className="flex flex-wrap gap-2">{[["Desktop", 1280, 800], ["Laptop", 1024, 640], ["Mobile", 375, 700], ["Landscape", 667, 375]].map(([name, width, height]) => <button key={name} className="rounded border bg-white px-3 py-1 text-sm" onClick={() => setSize({ width: Number(width), height: Number(height) })}>{name} {width} × {height}</button>)}<button className="rounded border bg-white px-3 py-1 text-sm" onClick={() => setVersion(value => value + 1)}>Reset fixture</button></div></header><iframe key={version} title="Isolated Contract signing layout" src="/?embedded=1" style={{ width: size.width, height: size.height, maxWidth: "100%" }} className="mx-auto block border border-slate-400 bg-white" /></main>;
}
createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).has("embedded") ? <EmbeddedFixture /> : <PreviewControls />);
