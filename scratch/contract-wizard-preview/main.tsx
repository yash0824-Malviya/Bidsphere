import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import ContractCreationWizard from "../../src/components/contracts/ContractCreationWizard";
import { getFixtureLog, subscribeFixtureLog, setFailNextSubmit } from "./apiStub";
import "../../src/index.css";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Fixture() {
  const logs = useSyncExternalStore(subscribeFixtureLog, getFixtureLog);
  const location = useLocation();
  const submitted = location.pathname.startsWith("/contracts/CON-UI-QA-");
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <div className="bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950" role="status">UI test fixture — no ERP writes</div>
    <div className="flex min-w-0"><aside className="hidden min-h-screen w-52 shrink-0 bg-[#0B1630] p-5 text-slate-200 lg:block"><div className="text-lg font-bold text-white">Netlink</div><div className="text-xs text-slate-400">Procurement · UI fixture</div><nav className="mt-8 space-y-4 text-sm"><p>Dashboard</p><p>Procurement</p><p className="rounded-lg bg-blue-700 p-2 font-semibold text-white">Contracts</p></nav></aside>
    <main className="min-w-0 flex-1"><header className="border-b border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 sm:px-6">BidSphere · Procurement Manager · Isolated UI QA</header>
      {submitted ? <section className="m-6 rounded-xl border border-green-200 bg-white p-6"><h1 className="text-xl font-bold text-green-800">Fixture contract submitted</h1><p className="mt-2 break-all">{location.pathname}</p><p className="mt-2">The real wizard completed its save and submit sequence using in-memory test data only.</p><Link className="mt-4 inline-block text-blue-700 underline" to="/contracts/new">Start another fixture contract</Link></section> : <ContractCreationWizard />}
      <section className="mx-4 mb-6 min-w-0 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs sm:mx-6" aria-label="UI fixture controls and action log"><h2 className="font-semibold">Fixture verification controls</h2><label className="mt-2 flex items-center gap-2"><input type="checkbox" onChange={event => setFailNextSubmit(event.target.checked)} />Fail next submission to verify retry uses the saved draft</label><p className="mt-2">Enter REQUEST-UI-QA in Source / procurement reference and choose Load source to fill realistic fixture values. No network requests to ERPNext are made.</p><details className="mt-3"><summary className="cursor-pointer font-semibold">Action log ({logs.length} calls; no ERP writes)</summary><pre data-testid="fixture-action-log" className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(logs, null, 2)}</pre></details></section>
    </main></div><Toaster position="top-right" />
  </div>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><BrowserRouter><Fixture /></BrowserRouter></QueryClientProvider>);
