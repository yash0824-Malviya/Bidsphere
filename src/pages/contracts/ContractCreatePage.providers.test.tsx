import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmMetadata } from "../../api/clm";

const api = vi.hoisted(() => ({ action: vi.fn(), metadata: vi.fn(), lookup: vi.fn(async () => []), prefill: vi.fn(), role: "procurement" }));
vi.mock("../../api/clm", () => ({
  applyClmAction: api.action,
  getClmMetadata: api.metadata,
  lookupClm: api.lookup,
  prefillClm: api.prefill,
  clmViewerKey: () => "provider-regression",
  clmRecordRoute: (doctype: string, name: string) => `${doctype === "Contract Request" ? "/contract-requests" : "/contracts"}/${name}`,
  clmError: (error: Error) => error.message,
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: (select: (state: { user: { name: string; email: string; role: string } }) => unknown) => select({ user: { name: "buyer@example.test", email: "buyer@example.test", role: api.role } }),
}));

// React, React DOM, Router and Query all remain real. Unlike event-handler
// harnesses, these renders exercise the hooks through their actual providers.
import ContractCreatePage from "./ContractCreatePage";
import ClmSourcePicker, { type ContractSourceSelection } from "../../components/contracts/ClmSourcePicker";

const metadata: ClmMetadata = {
  fields: {
    Contract: [
      { fieldname: "party_type", label: "Party Type", fieldtype: "Select", options: "Supplier\nCustomer", reqd: 1 },
      { fieldname: "party_name", label: "Party Name", fieldtype: "Dynamic Link", options: "party_type", reqd: 1 },
      { fieldname: "custom_contract_title", label: "Contract Title", fieldtype: "Data", reqd: 1 },
    ],
    "Contract Request": [
      { fieldname: "contract_purpose", label: "Contract Purpose", fieldtype: "Data", reqd: 1 },
      { fieldname: "supplier", label: "Supplier", fieldtype: "Link", options: "Supplier", reqd: 1 },
      { fieldname: "description", label: "Description", fieldtype: "Small Text", reqd: 1 },
    ],
  },
  editableFields: { Contract: ["party_type", "party_name", "custom_contract_title"], "Contract Request": ["contract_purpose", "supplier", "description"] },
  allowedCreate: ["Contract", "Contract Request"],
};
let clients: QueryClient[] = [];
function renderPage(doctype: "Contract" | "Contract Request", schema = metadata, query = ""): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(["clm", "metadata", "provider-regression"], schema);
  const path = doctype === "Contract" ? "/contracts/new" : "/contract-requests/new";
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`${path}${query}`]}>
        <Routes><Route path={path} element={<ContractCreatePage doctype={doctype} />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function renderSource(doctype: string, source: ContractSourceSelection): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter><ClmSourcePicker doctype={doctype} selection={source} onApply={vi.fn()} /></MemoryRouter></QueryClientProvider>);
}

describe("Contract create routes with real React providers", () => {
  beforeEach(() => { vi.clearAllMocks(); api.role = "procurement"; });
  afterEach(() => { clients.forEach(client => client.clear()); clients = []; });

  it("renders the new Contract route through real Router and Query hooks", () => {
    const html = renderPage("Contract");
    expect(html).toContain("New contract");
    // The wizard initializes editable values in a client effect, so its server
    // render is the intentional initial loading state after all hooks execute.
    expect(html).toContain("Loading contract fields");
    expect(html).not.toContain("Unable to load this document");
    expect(api.action).not.toHaveBeenCalled();
    expect(api.metadata).not.toHaveBeenCalled();
  });

  it("continues rendering the existing Contract Request form with the same providers", () => {
    const html = renderPage("Contract Request");
    expect(html).toContain("New contract request");
    expect(html).toContain("Source / procurement reference");
    expect(html).toContain("Contract Purpose *");
    expect(html).toContain("Supplier *");
    expect(html).toContain("Save draft");
    expect(html).not.toContain("Build your contract in five focused stages");
    expect(api.action).not.toHaveBeenCalled();
  });

  it("renders the server permission denial rather than an invalid-hook fallback", () => {
    const html = renderPage("Contract", { fields: {}, editableFields: {}, allowedCreate: [] });
    expect(html).toContain("Your role cannot create this record.");
    expect(html).not.toContain("Loading contract fields");
    expect(html).not.toContain("<form");
  });

  it.each(["Contract", "Contract Request"] as const)("hands an RFQ-sourced %s URL to its existing RFQ action without exposing generic save", doctype => {
    api.role = "procurement_team";
    const query = `?${new URLSearchParams({ source_doctype: "Request for Quotation", source_name: "RFQ/1" })}`;
    const html = renderPage(doctype, metadata, query);
    expect(html).toContain('href="/sourcing/rfq/RFQ%2F1"');
    expect(html).toContain("Create Contract from RFQ Award");
    expect(html).not.toContain("Load source");
    expect(html).not.toContain("Save draft");
    expect(html).not.toContain("<form");
    expect(api.prefill).not.toHaveBeenCalled();
    expect(api.action).not.toHaveBeenCalled();
  });

  it.each(["Contract", "Contract Request"])("gives Procurement Team %s a working RFQ creation handoff", doctype => {
    api.role = "procurement_team";
    const html = renderSource(doctype, { doctype: "Request for Quotation", name: "RFQ-1" });
    expect(html).toContain("Create Contract from RFQ Award");
    expect(html).toContain('href="/sourcing/rfq/RFQ-1"');
    expect(html).not.toContain("Load source");
  });

  it.each(["Supplier Quotation", "Purchase Order"])("preserves generic %s Request source loading and authoring", source => {
    const query = `?${new URLSearchParams({ source_doctype: source, source_name: "SOURCE-1" })}`;
    const html = renderPage("Contract Request", metadata, query);
    expect(html).toContain("Load source");
    expect(html).toContain("Save draft");
    expect(html).toContain("<form");
    expect(html).not.toContain("Open RFQ");
  });

  it("routes direct Contract RFQ selections through the awarded RFQ", () => {
    api.role = "procurement_team";
    const html = renderSource("Contract", { doctype: "Request for Quotation", name: "RFQ-1" });
    expect(html).not.toContain("Load source");
    expect(html).toContain('href="/sourcing/rfq/RFQ-1"');
    expect(html).toContain("Create Contract from RFQ Award");
    expect(api.prefill).not.toHaveBeenCalled();
  });

  it.each(["procurement", "admin", "legal"])("offers %s only a read link instead of RFQ CLM creation", role => {
    api.role = role;
    const html = renderSource("Contract", { doctype: "Request for Quotation", name: "RFQ-1" });
    expect(html).toContain("Open RFQ");
    expect(html).toContain("initiated by Procurement Team");
    expect(html).not.toContain("Create Contract from RFQ Award");
    expect(api.action).not.toHaveBeenCalled(); expect(api.prefill).not.toHaveBeenCalled();
  });

  it.each(["Supplier Quotation", "Purchase Order", "RFP", "RFP Response"])("retains direct Contract %s source loading", source => {
    const html = renderSource("Contract", { doctype: source, name: "SOURCE-1" });
    expect(html).toContain("Load source");
    expect(html).not.toContain("Create Contract from RFQ Award");
  });
});
