import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmDetail } from "../../api/clm";
const fixture = vi.hoisted(() => ({
  navigate: vi.fn(), success: vi.fn(),
  qc: { setQueryData: vi.fn(), invalidateQueries: vi.fn(async () => undefined), removeQueries: vi.fn() },
  onSuccess: undefined as undefined | ((result: ClmDetail, input: { action: string }) => void),
  detail: undefined as ClmDetail | undefined,
}));
vi.mock("react-router-dom", async () => ({ ...await vi.importActual("react-router-dom"), useNavigate: () => fixture.navigate }));
vi.mock("react-hot-toast", () => ({ default: { success: fixture.success, error: vi.fn() } }));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: null }) }));
vi.mock("../../api/legalDocsStorage", () => ({ uploadFileToERPNextDetailed: vi.fn() }));
vi.mock("../sourcing/RfqContractPanel", () => ({ default: ({ rfqName, expectedRequestName }: { rfqName: string; expectedRequestName: string }) => <section data-rfq={rfqName} data-request={expectedRequestName}>RFQ Request processing</section> }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[1] === "metadata" ? { fields: { Contract: [{ fieldname: "contract_terms", label: "Contract Terms", fieldtype: "Text Editor" }, { fieldname: "custom_contract_status", label: "Contract Status", fieldtype: "Data" }, { fieldname: "custom_esign_status", label: "eSign Status", fieldtype: "Data" }] }, allowedCreate: [] }
      : fixture.detail || { doctype: "Contract", record: { name: "CON-1", modified: "2026-09-17 10:00:00", custom_contract_status: "Negotiation", contract_terms: "Terms for the supplier." }, actions: [{ action: "supplier_accept", label: "Accept Contract" }], approvals: [], audit: [], versions: [], alerts: [{ id: "internal", message: "Internal alert should stay hidden", contract: "CON-1", kind: "risk", severity: "high", source_doctype: "Contract", source_name: "CON-1" }] },
    isLoading: false, isError: false,
  }),
  useQueryClient: () => fixture.qc,
  useMutation: (options: { onSuccess: typeof fixture.onSuccess }) => { fixture.onSuccess = options.onSuccess; return { isPending: false, mutateAsync: vi.fn() }; },
}));
import ClmRecordWorkspace from "./ClmRecordWorkspace";
function render(supplier = true) { return renderToStaticMarkup(<MemoryRouter><ClmRecordWorkspace doctype="Contract" name="CON-1" supplier={supplier} /></MemoryRouter>); }
function accepted(status: string): ClmDetail { return { doctype: "Contract", record: { name: "CON-1", custom_contract_status: status }, actions: [], approvals: [], versions: [], audit: [] }; }
beforeEach(() => { fixture.detail = undefined; });
describe("Supplier acceptance handoff", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.onSuccess = undefined; });
  it("leaves an accepted Draft without refetching a document the supplier can no longer read", () => {
    render(); fixture.onSuccess!(accepted("Draft"), { action: "supplier_accept" });
    expect(fixture.navigate).toHaveBeenCalledWith("/supplier/contracts", { replace: true });
    expect(fixture.qc.removeQueries).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(["clm", "detail", "Contract", "CON-1", true]), exact: true });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["clm", "list"] });
    expect(fixture.qc.setQueryData).not.toHaveBeenCalled();
    expect(fixture.success).toHaveBeenCalledWith(expect.stringContaining("Contract accepted"));
  });
  it("keeps a signature-ready accepted contract open", () => {
    render(); fixture.onSuccess!(accepted("Pending Signature"), { action: "supplier_accept" });
    expect(fixture.navigate).not.toHaveBeenCalled(); expect(fixture.qc.removeQueries).not.toHaveBeenCalled(); expect(fixture.qc.setQueryData).toHaveBeenCalled();
  });
  it("does not show internal contract alerts or audit controls to suppliers", () => {
    const html = render(); expect(html).not.toContain("Internal alert should stay hidden"); expect(html).not.toContain("Audit history");
    expect(html).toContain("Accept Contract"); expect(html).toContain("Terms for the supplier.");
  });
  it("keeps PO-linked supplier header and overview statuses consistent without changing internal Contract state", () => {
    fixture.detail = { ...accepted("Active"), record: { name: "CON-1", custom_contract_status: "Active", custom_esign_status: "Completed" },
      supplier_workflow: { purchase_order: "PO-1", acceptance_status: "Pending", signature_status: "Pending", status: "Contract Acceptance Required", current_stage: "Contract Acceptance", next_stage: "Supplier E-Signature", responsible_role: "supplier", responsible: "Supplier", can_accept_contract: true, can_sign_contract: false, can_accept_po: false, version: "1.0" },
    };
    const pending = render();
    expect(pending).toMatch(/Contract Signature Status<\/dt><dd[^>]*>Pending Contract Acceptance<\/dd>/);
    expect(pending).toMatch(/Contract Status<\/dt><dd[^>]*>Pending Contract Acceptance<\/dd>/);
    expect(pending).not.toMatch(/eSign Status<\/dt><dd[^>]*>Completed<\/dd>/);
    expect(fixture.detail.record.custom_esign_status).toBe("Completed");
    let header = pending.slice(pending.indexOf("<header"), pending.indexOf("</header>"));
    expect(header).toContain("Pending Contract Acceptance"); expect(header).not.toContain(">Active<");
    fixture.detail.supplier_workflow!.acceptance_status = "Accepted";
    header = render().split("</header>")[0]; expect(header).toContain("Pending Supplier Signature");
    expect(render()).toMatch(/Contract Status<\/dt><dd[^>]*>Pending Supplier Signature<\/dd>/);
    expect(render()).toMatch(/Contract Signature Status<\/dt><dd[^>]*>Pending Supplier Signature<\/dd>/);
    fixture.detail.supplier_workflow!.signature_status = "Signed";
    expect(render()).toMatch(/Contract Signature Status<\/dt><dd[^>]*>Fully Signed<\/dd>/);
    expect(render()).toMatch(/Contract Status<\/dt><dd[^>]*>Fully Signed<\/dd>/);
    expect(fixture.detail.record.custom_contract_status).toBe("Active");
    expect(render(false)).toMatch(/Contract Status<\/dt><dd[^>]*>Active<\/dd>/);
    expect(render(false)).toMatch(/eSign Status<\/dt><dd[^>]*>Completed<\/dd>/);
    fixture.detail.supplier_workflow = undefined;
    expect(render()).toMatch(/eSign Status<\/dt><dd[^>]*>Completed<\/dd>/);
  });
});

describe("RFQ CLM continuation refresh", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.onSuccess = undefined; });
  it("refreshes the linked RFQ and award alongside CLM after execution", () => {
    render(false);
    fixture.onSuccess!({ ...accepted("Executed"), record: { ...accepted("Executed").record, custom_rfq: "PUR-RFQ-2026-00093" } }, { action: "sign" });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["rfq", "PUR-RFQ-2026-00093"] });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["legal-doc-review", "PUR-RFQ-2026-00093"] });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["clm"] });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(fixture.qc.setQueryData).toHaveBeenCalled();
  });
  it("preserves standalone Contract refresh without invalidating unrelated RFQs", () => {
    render(false); fixture.onSuccess!(accepted("Executed"), { action: "sign" });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledExactlyOnceWith({ queryKey: ["clm"] });
  });
  it("refreshes a linked RFQ when supplier acceptance hands the draft back to its buyer", () => {
    render();
    fixture.onSuccess!({ ...accepted("Draft"), record: { ...accepted("Draft").record, custom_rfq: "RFQ-1" } }, { action: "supplier_accept" });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["rfq", "RFQ-1"] });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["legal-doc-review", "RFQ-1"] });
    expect(fixture.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["clm", "list"] });
    expect(fixture.navigate).toHaveBeenCalledWith("/supplier/contracts", { replace: true });
    expect(fixture.qc.setQueryData).not.toHaveBeenCalled();
  });
});

describe("RFQ Contract detail uses persisted stage and server action grants", () => {
  it("opens Team processing for the exact saved RFQ Request rather than a disconnected contract form", () => {
    fixture.detail = { doctype: "Contract Request", record: { name: "CR-94", request_status: "Draft", custom_rfq: "RFQ-94", custom_clm_data: JSON.stringify({ rfq_source: { rfq: "RFQ-94", award: "AWARD-94" }, rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team" }, approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }] }) }, actions: [{ action: "create_contract", label: "Generic Create Contract" }] };
    const html = renderToStaticMarkup(<MemoryRouter><ClmRecordWorkspace doctype="Contract Request" name="CR-94" /></MemoryRouter>);
    expect(html).toContain("Pending Procurement Team"); expect(html).toContain('data-rfq="RFQ-94"'); expect(html).toContain('data-request="CR-94"');
    expect(html).not.toContain("Pending Legal Review"); expect(html).not.toContain("Procurement Finalization");
    expect(html).not.toContain("Generic Create Contract");
  });
  it("opens the exact initial Request with Pending status before an award exists", () => {
    fixture.detail = { doctype: "Contract Request", record: { name: "CR-NEW", request_status: "Pending Review", department: "Production", requester: "buyer@example.test", custom_rfq: "RFQ-NEW", contract_purpose: "New RFQ request", custom_clm_data: JSON.stringify({
      rfq_source: { rfq: "RFQ-NEW", stage: "rfq_created", contract_required: true },
      rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" },
      approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }],
    }) }, actions: [] };
    const html = renderToStaticMarkup(<MemoryRouter><ClmRecordWorkspace doctype="Contract Request" name="CR-NEW" /></MemoryRouter>);
    expect(html).toContain('>Pending</span>'); expect(html).toContain('data-rfq="RFQ-NEW"'); expect(html).toContain('data-request="CR-NEW"');
    expect(html).toContain("New RFQ request"); expect(html).not.toContain("Pending Legal Review"); expect(html).not.toContain("Generic Create Contract");
    for (const value of ["Department", "Production", "Requester", "buyer@example.test", "Contract Required", ">Yes</dd>", "Current Stage", ">Procurement</dd>", "Not yet awarded", "Award", ">Pending</dd>", "Procurement Team"]) expect(html).toContain(value);
    for (const label of ["Contract Type", "Contract Description", "Start Date", "End Date", "Contract Value", "Currency", "Estimated Contract Value"]) {
      expect(html).toContain(`${label}</dt><dd class="whitespace-pre-wrap break-words text-sm text-slate-900">—</dd>`);
    }
    expect(html).not.toContain('aria-label="Authoring"'); expect(html).not.toContain("Save changes");
    fixture.detail.record.currency = "USD"; fixture.detail.record.contract_value = 0;
    const withTerms = renderToStaticMarkup(<MemoryRouter><ClmRecordWorkspace doctype="Contract Request" name="CR-NEW" /></MemoryRouter>);
    expect(withTerms).toContain('Contract Value</dt><dd class="whitespace-pre-wrap break-words text-sm text-slate-900">0</dd>');
  });
  function linked(phase: string, status: string): ClmDetail {
    return { ...accepted(status), record: { name: "CON-1", custom_rfq: "RFQ-93", custom_contract_status: status, custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase }, rfq_source: { legal_review: "AWARD-93" }, procurement_completion: { purchase_order: "PO-93" } }) } };
  }
  it("shows Finance a read-only Legal stage when the backend returns no actions", () => {
    fixture.detail = linked("legal_review", "Pending Legal"); const html = render(false);
    expect(html).toContain("Pending Legal Review"); expect(html).toMatch(/Current stage<\/dt><dd[^>]*>Legal Review<\/dd>/); expect(html).toMatch(/Current responsibility<\/dt><dd[^>]*>Legal Manager<\/dd>/);
    expect(html).not.toContain("Actions available to you"); expect(html).not.toContain("Continue existing PO flow");
  });
  it("uses the RFQ signature workspace only for the backend-designated Legal signatory", () => {
    fixture.detail = { ...linked("signature", "Pending Signature"), signature_workflow: { supplier_status: "Signed", legal_status: "Pending", is_legal_signatory: true, can_review: true, can_sign: true, can_request_signatures: false }, actions: [{ action: "sign", label: "Sign Contract" }] };
    const html = render(false); expect(html).toContain("Review Documents"); expect(html).toContain("E-Sign Contract"); expect(html).toContain("E-SIGNATURE REQUIRED"); expect(html).not.toContain("Actions available to you");
    expect(html.indexOf('aria-label="RFQ contract workflow"')).toBeLessThan(html.indexOf('aria-label="Contract signatures"'));
    expect(html.indexOf('aria-label="Contract signatures"')).toBeLessThan(html.indexOf('role="tablist"'));
    fixture.detail.signature_workflow = { ...fixture.detail.signature_workflow!, is_legal_signatory: false, can_review: false, can_sign: false }; fixture.detail.actions = [];
    const otherViewer = render(false); expect(otherViewer).not.toContain(">E-Sign Contract<"); expect(otherViewer).toContain("Supplier Signature:");
  });
  it("shows Finance actions after Legal-only handoff and keeps supplier signature independently pending", () => {
    fixture.detail = { ...linked("finance_review", "Pending Finance"),
      signature_workflow: { supplier_status: "Pending", legal_status: "Signed", is_legal_signatory: false, can_review: false, can_sign: false, can_request_signatures: false },
      actions: [{ action: "approve", label: "Approve" }, { action: "send_back", label: "Send Back" }, { action: "reject", label: "Reject" }],
    };
    const html = render(false);
    expect(html).toContain('data-phase="signature" data-state="completed"');
    expect(html).toContain('data-phase="finance_review" data-state="current"');
    expect(html).toContain('data-phase="procurement" data-state="next"');
    expect(html).toContain("Supplier Signature: <strong>Pending</strong>");
    expect(html).toContain("Legal Manager Signature: <strong>Signed</strong>");
    expect(html).toContain("Legal Manager signature completed. Contract is now pending Finance Approval.");
    for (const action of ["Approve", "Send Back", "Reject"]) expect(html).toContain(`>${action}</button>`);
    expect(html).not.toContain("Await the supplier"); expect(html).not.toContain("Continue existing PO flow");
    // Legal and other roles receive no Finance action grants from the backend.
    fixture.detail.actions = [];
    const legalView = render(false);
    for (const action of ["Approve", "Send Back", "Reject"]) expect(legalView).not.toContain(`>${action}</button>`);
  });
  it("offers the existing PO creation form only when the backend grants creation", () => {
    fixture.detail = { ...linked("procurement", "Executed"), actions: [{ action: "create_purchase_order", label: "Create Purchase Order" }] };
    const html = render(false); expect(html).toContain("Pending Procurement Finalization"); expect(html).toContain("Procurement Finalization"); expect(html).toContain("Create Purchase Order");
    expect(html).toContain('href="/p2p/purchase-orders/new?contract=CON-1"'); expect(html).toContain('href="/sourcing/rfq/RFQ-93"');
    expect(html).not.toContain("Existing Purchase Order"); expect(html).not.toContain("Search purchase order");
    fixture.detail.actions = [];
    expect(render(false)).not.toContain('href="/p2p/purchase-orders/new?contract=CON-1"');
  });
  it.each([["signature", "Pending Signature", "Pending Signatures"], ["finance_review", "Pending Finance", "Pending Finance Approval"], ["procurement", "Executed", "Pending Procurement Finalization"]])("shows the current %s status in the Contract header", (phase, nativeStatus, displayStatus) => {
    fixture.detail = linked(phase, nativeStatus);
    const html = render(false);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain(`>${displayStatus}</span>`);
    expect(fixture.detail.record.custom_contract_status).toBe(nativeStatus);
  });
  it("displays completed procurement separately from the ongoing native Contract lifecycle", () => {
    fixture.detail = linked("completed", "Active"); const html = render(false);
    expect(html).toContain("Completed"); expect(html).toContain("Contract lifecycle: Active"); expect(html).toContain("PO-93");
    expect(html).not.toContain("Finalize Procurement"); expect(html).not.toContain("Continue existing PO flow");
  });
});
