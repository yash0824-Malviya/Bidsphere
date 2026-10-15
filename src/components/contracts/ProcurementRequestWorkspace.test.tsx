import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmDetail, ClmMetadata, RfqClmSummary } from "../../api/clm";

const harness = vi.hoisted(() => ({
  capture: false, cursor: 0, changed: false, role: "procurement_team", slots: [] as Array<{ value?: unknown; dependencies?: readonly unknown[] }>, effects: [] as Array<() => unknown>,
  detail: {} as ClmDetail, summary: {} as RfqClmSummary, metadata: {} as ClmMetadata,
  save: vi.fn(), getSummary: vi.fn(), prepare: vi.fn(), create: vi.fn(), getDetail: vi.fn(), onSaved: vi.fn(), success: vi.fn(), errorToast: vi.fn(), invalidate: vi.fn(), setQuery: vi.fn(),
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      if (!harness.capture) return actual.useState(initial);
      const slot = harness.cursor++;
      if (!(slot in harness.slots)) harness.slots[slot] = { value: typeof initial === "function" ? initial() : initial };
      return [harness.slots[slot].value, (next: unknown) => { const value = typeof next === "function" ? next(harness.slots[slot].value) : next; if (!Object.is(value, harness.slots[slot].value)) harness.changed = true; harness.slots[slot].value = value; }];
    },
    useRef: (initial: unknown) => { if (!harness.capture) return actual.useRef(initial); const slot = harness.cursor++; if (!(slot in harness.slots)) harness.slots[slot] = { value: { current: initial } }; return harness.slots[slot].value; },
    useEffect: (effect: () => unknown, dependencies?: readonly unknown[]) => {
      if (!harness.capture) return actual.useEffect(effect as () => void, dependencies);
      const slot = harness.cursor++, previous = harness.slots[slot];
      if (!previous || !dependencies || dependencies.some((value, index) => !Object.is(value, previous.dependencies?.[index]))) harness.effects.push(effect);
      harness.slots[slot] = { dependencies };
    },
  };
});
vi.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => ({ data: queryKey[0] === "clm-lookup" ? [] : queryKey[1] === "metadata" ? harness.metadata : queryKey[1] === "detail" ? enabled ? { record: { name: "CON-1", custom_rfq: "RFQ-99", custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase: "legal_review" } }) } } : undefined : queryKey[1] === "legal-signatory" ? harness.summary?.designated_legal_signatory : harness.summary, isLoading: false, isError: false, refetch: vi.fn() }),
  useQueryClient: () => ({ setQueryData: harness.setQuery, invalidateQueries: harness.invalidate }),
}));
vi.mock("react-hot-toast", () => ({ default: { success: harness.success, error: harness.errorToast } }));
vi.mock("../../api/legalDocsStorage", () => ({ uploadFileToERPNextDetailed: vi.fn() }));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: harness.role } }) }));
vi.mock("../../api/clm", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api/clm")>()), saveRfqRequestDraft: harness.save, getRfqClmSummary: harness.getSummary, submitRfqClmRequest: harness.prepare, createRfqContractRequest: harness.create, getClmDetail: harness.getDetail, getClmMetadata: vi.fn(), lookupClm: vi.fn(), getDesignatedLegalSignatory: vi.fn(async () => harness.summary?.designated_legal_signatory), clmViewerKey: () => "test-session",
}));
import ProcurementRequestWorkspace, {
  procurementRequestCreateErrors,
  CONTRACT_TYPE_CONFIG,
  getTermFieldsForType,
} from "./ProcurementRequestWorkspace";
import ClmFields from "./ClmFields";
import { RfqSourceDocuments } from "./ClmSourceTraceability";

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement(node)) return []; const element = node as Element; return [element, ...elements(element.props.children)]; }
function textOf(node: ReactNode): string { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(textOf).join(""); return isValidElement(node) ? textOf((node as Element).props.children) : ""; }
function render() {
  for (let attempt = 0; attempt < 10; attempt++) {
    harness.cursor = 0; harness.changed = false; harness.effects = []; harness.capture = true;
    let tree: ReactNode;
    try { tree = ProcurementRequestWorkspace({ detail: harness.detail, onSaved: harness.onSaved }); } finally { harness.capture = false; }
    harness.effects.forEach(effect => effect()); if (!harness.changed) return tree;
  }
  throw new Error("Workspace did not settle");
}
function fields(doctype = "Contract Request", tree = render()) { return elements(tree).find(element => element.type === ClmFields && (element.props as unknown as { doctype: string }).doctype === doctype) as unknown as ReactElement<Parameters<typeof ClmFields>[0]>; }
function change(values: Record<string, unknown>, doctype = "Contract Request") { const group = fields(doctype); if (group) group.props.onChange({ ...group.props.values, ...values }); }
function click(label: string, tree = render()) { const button = elements(tree).find(element => element.type === "button" && textOf(element) === label); expect(button, label).toBeDefined(); button!.props.onClick!(); }
async function settle() { for (let index = 0; index < 35; index++) await Promise.resolve(); }
const completeTerms = { contract_type: "Supply / Procurement Contract", contract_purpose: "Supply production parts", description: "Supply the awarded production tooling and parts", contract_start_date: "2026-10-01", contract_end_date: "2027-09-30", contract_value: 2500, currency: "USD", estimated_contract_value: 2500 };
const review = { custom_inteva_signatory: "legal@example.test" };
function awarded() { Object.assign(harness.summary, { source: { award: "AWARD-99", supplier: "SUP-99", quotation: "QUOTE-99", amount: 2500, currency: "USD" }, prefill: { supplier: "SUP-99", custom_supplier_quotation: "QUOTE-99", contract_value: 2500, estimated_contract_value: 2500, currency: "USD" }, eligible: true, request_needs_details: true, can_request: true }); }
function fill() { change(completeTerms); }

beforeEach(() => {
  vi.clearAllMocks(); harness.slots = []; harness.capture = false; harness.role = "procurement_team";
  harness.detail = { doctype: "Contract Request", actions: [], rfq_request_draft_editable: true, record: { name: "CTRQ-2", modified: "request-v1", custom_rfq: "RFQ-99", request_status: "Pending Review", department: "Production - NSGAI", requester: "Administrator", custom_clm_data: JSON.stringify({ rfq_source: { stage: "rfq_created", rfq: "RFQ-99", contract_required: true }, rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" }, approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }] }) } };
  harness.summary = { rfq: { name: "RFQ-99", modified: "rfq-v1" }, request: { name: "CTRQ-2", status: "Pending", assigned_role: "procurement_team", current_stage: "Procurement" }, contract_required: "Yes", decision: "Yes", can_decide: false, blocks_procurement: true, continuation_ready: false, eligible: false, reason: "", can_create: false, can_request: false, status: "Pending", can_open_request: true, can_open_contract: false, prefill: {}, required_fields: [], locked_fields: [], source_documents: [], warnings: [], designated_legal_signatory: { signatory: { name: "legal@example.test", full_name: "Legal Manager", email: "legal@example.test" }, source: "workflow_matrix", eligible_signatories: [{ name: "legal@example.test", full_name: "Legal Manager", email: "legal@example.test" }] } };
  harness.metadata = { fields: { Contract: [{ fieldname: "custom_risk_level", fieldtype: "Select", options: "Low\nMedium\nHigh\nCritical" }, { fieldname: "custom_inteva_signatory", fieldtype: "Link", options: "User" }] } };
  harness.getSummary.mockReset().mockImplementation(async () => ({ ...harness.summary }));
  harness.save.mockReset().mockImplementation(async (input: { payload: Record<string, unknown> }) => ({ ...harness.detail, record: { ...harness.detail.record, ...input.payload, modified: "request-v2" } }));
  harness.setQuery.mockImplementation((key: string[], value: RfqClmSummary) => { if (key[1] === "rfq-contract") harness.summary = value; });
  harness.onSaved.mockImplementation((detail: ClmDetail) => { harness.detail = detail; });
  harness.prepare.mockReset().mockImplementation(async () => ({ created: false, request: harness.detail, summary: { ...harness.summary, request_needs_details: false, can_request: false, can_create: true, rfq: { ...harness.summary.rfq, modified: "rfq-prepared" } } }));
  harness.create.mockReset().mockImplementation(async () => ({ created: true, request: harness.detail, contract: { record: { name: "CON-1" } }, summary: { ...harness.summary, contract: { name: "CON-1", status: "Pending Legal" }, can_open_contract: true, can_create: false, recovery_required: false } }));
  harness.getDetail.mockReset().mockImplementation(async () => ({ ...harness.detail, rfq_request_draft_editable: false }));
});

describe("Procurement Request working page", () => {
  it("loads the final USD 4500 award and separate approved 50000 estimate as read-only without writes", () => {
    awarded();
    Object.assign(harness.summary.source!, { amount: 4500, currency: "USD", approved_estimated_value: 50000 });
    Object.assign(harness.summary.prefill, { contract_value: 4500, currency: "USD", estimated_contract_value: 50000 });
    harness.summary.locked_fields = ["contract_value", "currency", "estimated_contract_value"];
    Object.assign(harness.detail.record, { contract_value: 4499, currency: "EUR", estimated_contract_value: "" });
    const group = fields();
    expect(group.props.values).toMatchObject({ contract_value: 4500, currency: "USD", estimated_contract_value: 50000 });
    expect(group.props.readOnlyFields).toEqual(["contract_value", "currency", "estimated_contract_value"]);
    const html = renderToStaticMarkup(group);
    expect(html).toMatch(/data-contract-field="contract_value"[\s\S]*?readOnly=""[^>]*value="4500"/);
    expect(html).toMatch(/data-contract-field="currency"[\s\S]*?readOnly=""[^>]*value="USD"/);
    expect(harness.save).not.toHaveBeenCalled(); expect(harness.prepare).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled();
  });
  it("receives the award asynchronously without losing entered terms and preserves a zero award", () => {
    change({ contract_purpose: "Keep these working terms" });
    awarded(); harness.summary.source!.amount = 0; harness.summary.prefill.contract_value = 0;
    expect(fields().props.values).toMatchObject({ contract_purpose: "Keep these working terms", contract_value: 0, currency: "USD" });
  });
  it("creates using the freshly verified 4500 award without manually entering value or currency", async () => {
    harness.role = "procurement"; awarded();
    const { contract_value: _value, currency: _currency, ...enteredTerms } = completeTerms;
    change(enteredTerms); change(review, "Contract");
    const fresh = { ...harness.summary, source: { ...harness.summary.source, amount: 4500, currency: "USD", approved_estimated_value: 50000 }, prefill: { ...harness.summary.prefill, contract_value: 4500, currency: "USD", estimated_contract_value: 50000 }, locked_fields: ["contract_value", "currency", "estimated_contract_value"] };
    harness.getSummary.mockImplementation(async () => fresh);
    click("Create Contract"); await settle();
    const expected = { ...completeTerms, contract_value: 4500, currency: "USD", estimated_contract_value: 50000 };
    expect(harness.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ payload: expected }));
    expect(harness.prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ payload: expected }));
    expect(harness.create).toHaveBeenCalledTimes(1); expect(harness.success).toHaveBeenCalledWith("Contract created and sent to Legal Review.");
  });
  it("does not fall back to draft or quotation prefill amounts when the verified award amount is missing", async () => {
    awarded(); delete harness.summary.source!.amount;
    harness.summary.prefill.contract_value = 50000; harness.detail.record.contract_value = 4501;
    expect(fields().props.values.contract_value).toBe("");
    click("Save Draft"); await settle();
    expect(harness.save).not.toHaveBeenCalled(); expect(textOf(render())).toContain("saved supplier award amount and currency could not be verified");
  });
  it("keeps an unverified Request readable without inventing an editable award amount", () => {
    const html = renderToStaticMarkup(<ProcurementRequestWorkspace detail={harness.detail} onSaved={harness.onSaved} />);
    for (const value of ["CTRQ-2", "RFQ-99", "Production - NSGAI", "Administrator", "Pending Award", "Procurement Team", "Save Draft", "Create Contract"]) expect(html).toContain(value);
    expect(fields().props.fields).toHaveLength(8);
    expect(fields().props.readOnlyFields).toEqual(["contract_value", "currency"]);
    expect(fields().props.values.contract_type).toBe("");
    expect(harness.save).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled(); expect(harness.prepare).not.toHaveBeenCalled();
  });
  it("saves partial terms on the same awarded Request using its automatically populated award values", async () => {
    awarded();
    change({ contract_purpose: "Procurement working draft" }); click("Save Draft"); await settle();
    expect(harness.save).toHaveBeenCalledExactlyOnceWith({ name: "CTRQ-2", expected_modified: "request-v1", payload: expect.objectContaining({ contract_purpose: "Procurement working draft", contract_type: "", contract_value: 2500, currency: "USD" }) });
    expect(Object.keys(harness.save.mock.calls[0][0].payload)).toHaveLength(8);
    expect(harness.prepare).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled(); expect(harness.getSummary).toHaveBeenCalledExactlyOnceWith("RFQ-99");
    expect(textOf(render())).toContain("Draft saved. The Request remains with Procurement Team.");
  });
  it("preserves entered values and real errors when ERP draft persistence fails", async () => {
    awarded();
    harness.save.mockRejectedValueOnce(new Error("ERPNext refused the stale Request revision."));
    change({ contract_purpose: "Keep these terms" }); click("Save Draft"); await settle();
    expect(fields().props.values.contract_purpose).toBe("Keep these terms"); expect(textOf(render())).toContain("ERPNext refused the stale Request revision.");
    expect(harness.onSaved).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled(); expect(harness.success).not.toHaveBeenCalled();
  });
  it("retains the draft's original revision on background refetch instead of hiding a concurrency conflict", async () => {
    awarded();
    change({ contract_purpose: "My edits" });
    harness.detail = { ...harness.detail, record: { ...harness.detail.record, modified: "someone-else-v2", contract_purpose: "Other person's edits" } };
    render(); click("Save Draft"); await settle();
    expect(harness.save.mock.calls[0][0]).toMatchObject({ expected_modified: "request-v1", payload: { contract_purpose: "My edits" } });
  });
  it("does not submit or save a partial Contract when Create is clicked before award and required fields", async () => {
    click("Create Contract"); await settle();
    const errors = fields().props.errors!;
    expect(errors.contract_type).toBeTruthy(); expect(errors.contract_purpose).toBeTruthy(); expect(errors.description).toBeTruthy(); expect(errors.contract_value).toBeTruthy();
    expect(errors.award).toContain("saved supplier award"); expect(errors.supplier).toContain("winning supplier");
    expect(harness.save).not.toHaveBeenCalled(); expect(harness.prepare).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled();
    expect(textOf(render())).toContain("Please complete all required fields before creating the Contract");
    expect(harness.errorToast).toHaveBeenCalledWith(expect.stringContaining("missing or invalid"));
  });
  it("keeps award value and currency immutable while validating other draft terms", async () => {
    awarded(); harness.summary.locked_fields = ["estimated_contract_value"]; fill(); change({ contract_value: 999, estimated_contract_value: 1000, currency: "EUR" }); click("Create Contract"); await settle();
    expect(fields().props.values.contract_value).toBe(2500); expect(fields().props.values.currency).toBe("USD");
    expect(fields().props.errors).toEqual({ estimated_contract_value: expect.stringContaining("2500") });
    expect(harness.create).not.toHaveBeenCalled(); expect(harness.save).not.toHaveBeenCalled();
  });
  it("saves a changed unapproved draft estimate before preparing and creating the same Contract", async () => {
    awarded(); harness.summary.prefill.estimated_contract_value = 300;
    harness.detail.record.estimated_contract_value = 300;
    fill(); change({ estimated_contract_value: 500 }); click("Create Contract"); await settle();
    expect(harness.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ payload: { ...completeTerms, estimated_contract_value: 500 } }));
    expect(harness.prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ payload: { ...completeTerms, estimated_contract_value: 500 } }));
    expect(harness.create).toHaveBeenCalledTimes(1);
  });
  it("saves and prepares the same valid Request before explicit standard Contract creation", async () => {
    awarded(); fill(); click("Create Contract"); await settle();
    expect(harness.create).toHaveBeenCalledExactlyOnceWith({
      rfq: "RFQ-99",
      expected_modified: "rfq-prepared",
      payload: {},
      contract_fields: expect.objectContaining(review),
    });
    expect(harness.save.mock.invocationCallOrder[0]).toBeLessThan(harness.prepare.mock.invocationCallOrder[0]); expect(harness.prepare.mock.invocationCallOrder[0]).toBeLessThan(harness.create.mock.invocationCallOrder[0]);
    expect(textOf(render())).toContain("Contract created and sent to Legal Review."); expect(textOf(render())).toContain("View Contract"); expect(textOf(render())).not.toContain("Save Draft");
  });
  it("keeps a failed Contract handoff at Procurement, preserves terms, and can retry after preparation", async () => {
    awarded(); fill(); harness.create.mockRejectedValueOnce(new Error("ERPNext could not initialize Legal Review.")); click("Create Contract"); await settle();
    expect(textOf(render())).toContain("ERPNext could not initialize Legal Review."); expect(fields().props.values).toEqual(completeTerms); expect(textOf(render())).not.toContain("View Contract"); expect(harness.success).not.toHaveBeenCalled();
    click("Create Contract"); await settle(); expect(harness.prepare).toHaveBeenCalledTimes(1); expect(harness.save).toHaveBeenCalledTimes(1); expect(harness.create).toHaveBeenCalledTimes(2);
  });
  it("returns the already linked Contract on a concurrent creation without extra mutations", async () => {
    awarded(); fill(); harness.getSummary.mockResolvedValueOnce({ ...harness.summary, contract: { name: "CON-EXISTING", status: "Pending Legal" }, can_open_contract: true });
    click("Create Contract"); await settle(); expect(textOf(render())).toContain("Contract already exists."); expect(textOf(render())).toContain("View Contract");
    expect(harness.save).not.toHaveBeenCalled(); expect(harness.prepare).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled();
  });
  it("resumes an incomplete existing Contract handoff rather than hiding creation behind View Contract", async () => {
    awarded(); harness.detail = { ...harness.detail, rfq_request_draft_editable: false, record: { ...harness.detail.record, ...completeTerms } };
    Object.assign(harness.summary, { request_needs_details: false, can_create: true, recovery_required: true, contract: { name: "CON-1", status: "Draft" } });
    change(review, "Contract"); expect(textOf(render())).toContain("Resume Contract creation"); expect(textOf(render())).not.toContain("View Contract");
    click("Resume Contract creation"); await settle(); expect(harness.create).toHaveBeenCalledOnce(); expect(harness.save).not.toHaveBeenCalled(); expect(harness.prepare).not.toHaveBeenCalled();
  });
  it("does not report success from an incomplete Contract handoff response", async () => {
    awarded(); fill(); harness.create.mockResolvedValueOnce({ created: true, request: harness.detail, contract: { record: { name: "CON-1" } }, summary: { ...harness.summary, contract: { name: "CON-1", status: "Draft" }, recovery_required: true } });
    click("Create Contract"); await settle();
    expect(textOf(render())).toContain("ERPNext did not confirm a complete linked Contract handoff."); expect(textOf(render())).not.toContain("View Contract"); expect(harness.success).not.toHaveBeenCalled();
  });
  it("preserves existing prepared Request terms as read-only while offering its existing creation action", () => {
    awarded(); harness.detail = { ...harness.detail, rfq_request_draft_editable: false, record: { ...harness.detail.record, ...completeTerms } };
    Object.assign(harness.summary, { request_needs_details: false, can_request: false, can_create: true });
    const tree = render(); expect(textOf(tree)).not.toContain("Save Draft"); expect(textOf(tree)).toContain("Create Contract");
    expect(elements(tree).find(element => element.type === "fieldset")?.props.disabled).toBe(true);
  });
  it("clears unsaved values when changing to another exact Request ID", () => {
    change({ contract_purpose: "Only for Request 2" });
    harness.detail = { ...harness.detail, record: { ...harness.detail.record, name: "CTRQ-3", custom_rfq: "RFQ-100", modified: "request3-v1" } };
    render(); expect(fields().props.values.contract_purpose).toBe("");
  });
  it.each(["finance", "legal", "admin"])("does not grant creation or draft editing to %s", role => {
    harness.role = role; const tree = render(); expect(textOf(tree)).not.toContain("Save Draft"); expect(textOf(tree)).not.toContain("Create Contract");
    const parent = elements(tree).find(element => element.type === "fieldset"); expect(parent?.props.disabled).toBe(true);
  });
  it.each(["procurement", "Procurement Manager"])("lets %s prepare the same awarded Request without bypassing server capabilities", role => {
    harness.role = role; awarded();
    expect(textOf(render())).toContain("Save Draft"); expect(textOf(render())).toContain("Create Contract");
    harness.detail = { ...harness.detail, rfq_request_draft_editable: false }; harness.summary.can_create = false;
    expect(textOf(render())).not.toContain("Save Draft"); expect(textOf(render())).not.toContain("Create Contract");
  });
  it("keeps persisted matching RFQ documents before award and excludes a document from another RFQ", () => {
    const data = JSON.parse(String(harness.detail.record.custom_clm_data));
    data.source_documents = [{ file_id: "right", file_name: "RFQ99.pdf", source_doctype: "Request for Quotation", source_name: "RFQ-99", source_path: "RFQ-99" }, { file_id: "wrong", file_name: "RFQ91.pdf", source_doctype: "Request for Quotation", source_name: "RFQ-91", source_path: "RFQ-91" }];
    harness.detail.record.custom_clm_data = JSON.stringify(data);
    const docs = elements(render()).find(element => element.type === RfqSourceDocuments) as unknown as ReactElement<Parameters<typeof RfqSourceDocuments>[0]>;
    expect(docs.props.documents.map(document => document.file_id)).toEqual(["right"]);
  });
  it("excludes PO PDFs mistakenly attached to a Supplier Quotation from supporting documents", () => {
    const data = JSON.parse(String(harness.detail.record.custom_clm_data));
    data.source_documents = [
      { file_id: "valid-spec", file_name: "Spec.pdf", source_doctype: "Request for Quotation", source_name: "RFQ-99" },
      { file_id: "fake-po", file_name: "PO_PUR-ORD-2026-00030.pdf", source_doctype: "Supplier Quotation", source_name: "PUR-SQTN-2026-00288" },
    ];
    harness.detail.record.custom_clm_data = JSON.stringify(data);
    const docs = elements(render()).find(element => element.type === RfqSourceDocuments) as unknown as ReactElement<Parameters<typeof RfqSourceDocuments>[0]>;
    expect(docs.props.documents.map(document => document.file_id)).toEqual(["valid-spec"]);
  });
  it("renders 'No supporting documents available for this contract request.' when no documents exist", () => {
    const data = JSON.parse(String(harness.detail.record.custom_clm_data));
    data.source_documents = [];
    harness.detail.record.custom_clm_data = JSON.stringify(data);
    harness.summary.source_documents = [];
    expect(textOf(render())).toContain("No supporting documents available for this contract request.");
  });
  it("prevents duplicate in-flight Save Draft clicks", async () => {
    awarded();
    let finish!: (value: ClmDetail) => void; harness.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const tree = render(); click("Save Draft", tree); click("Save Draft", tree);
    await settle();
    expect(harness.save).toHaveBeenCalledTimes(1); finish(harness.detail); await settle();
  });
});

describe("Contract creation validation", () => {
  it("allows an unapproved saved estimate of 300 to be changed to 500 without changing the final award value", () => {
    awarded(); harness.summary.prefill.estimated_contract_value = 300;
    expect(procurementRequestCreateErrors({ ...completeTerms, ...review, estimated_contract_value: 500 }, harness.summary)).toEqual({});
    expect(procurementRequestCreateErrors({ ...completeTerms, ...review, contract_value: 500, estimated_contract_value: 500 }, harness.summary).contract_value).toContain("saved award amount");
  });
  it("protects a locked approved estimate of 500 from being changed to 300", () => {
    awarded(); harness.summary.prefill.estimated_contract_value = 500;
    harness.summary.locked_fields = ["estimated_contract_value"];
    expect(procurementRequestCreateErrors({ ...completeTerms, ...review, estimated_contract_value: 300 }, harness.summary)).toEqual({ estimated_contract_value: "Estimated Contract Value must match the approved estimate (USD 500)." });
    expect(procurementRequestCreateErrors({ ...completeTerms, ...review, estimated_contract_value: 500 }, harness.summary)).toEqual({});
  });
  it.each(["", undefined, null, -1, "invalid"])("still requires a valid estimate when the saved draft is editable: %s", estimate => {
    awarded(); harness.summary.prefill.estimated_contract_value = 300;
    expect(procurementRequestCreateErrors({ ...completeTerms, ...review, estimated_contract_value: estimate }, harness.summary).estimated_contract_value).toBe("Estimated Contract Value must be a valid non-negative amount.");
  });
  it("permits zero award value and does not invent a mandatory document when the existing policy has none", () => {
    awarded(); harness.summary.prefill.contract_value = 0; harness.summary.prefill.estimated_contract_value = 0;
    expect(procurementRequestCreateErrors({ ...completeTerms, ...review, contract_value: 0, estimated_contract_value: 0 }, harness.summary)).toEqual({});
  });
  it("validates dates, type and review requirements", () => {
    awarded(); const errors = procurementRequestCreateErrors({ ...completeTerms, contract_type: "Unknown", contract_end_date: "2026-09-01" }, harness.summary);
    expect(errors).toMatchObject({ contract_type: expect.any(String), contract_end_date: expect.any(String), custom_inteva_signatory: expect.any(String) });
    expect(errors).not.toHaveProperty("custom_risk_level");
  });
  it("validates that payment terms and delivery terms are required when provided as empty strings", () => {
    awarded();
    const errors = procurementRequestCreateErrors(
      { ...completeTerms, ...review },
      harness.summary,
      { payment_terms: "", delivery_terms: "" }
    );
    expect(errors.payment_terms).toBe("Payment Terms are required.");
    expect(errors.delivery_terms).toBe("Delivery Terms are required.");
  });
  it("renders awarded items section and editable payment and delivery terms inputs", () => {
    awarded();
    (harness.detail.record as Record<string, unknown>).items = [
      { item_code: "TOOL-001", item_name: "Injection Mold Tooling", qty: 2, rate: 1000, amount: 2000, uom: "Nos" },
      { item_code: "PART-002", item_name: "Plastic Bezel Housing", qty: 500, rate: 1, amount: 500, uom: "Nos" },
    ];
    const html = renderToStaticMarkup(<ProcurementRequestWorkspace detail={harness.detail} onSaved={harness.onSaved} />);
    expect(html).toContain("Awarded Item Rows &amp; Commercial Breakdown");
    expect(html).toContain("TOOL-001");
    expect(html).toContain("Injection Mold Tooling");
    expect(html).toContain("PART-002");
    expect(html).toContain("Payment Terms");
    expect(html).toContain("Delivery Terms");
    expect(html).toContain("Net 30");
    expect(html).toContain("DAP - Delivered at Place");
  });

  describe("Dynamic Contract Type Form", () => {
    it("defines configurations for all 5 contract types", () => {
      const types = [
        "Supply / Procurement Contract",
        "Service Agreement",
        "NDA",
        "Master Service Agreement",
        "Other",
      ];
      for (const t of types) {
        expect(CONTRACT_TYPE_CONFIG[t]).toBeDefined();
        expect(CONTRACT_TYPE_CONFIG[t].title).toBeTruthy();
        expect(CONTRACT_TYPE_CONFIG[t].badge).toBeTruthy();
        expect(CONTRACT_TYPE_CONFIG[t].documentTitle).toBeTruthy();
      }
      expect(CONTRACT_TYPE_CONFIG["Supply / Procurement Contract"].showAwardedItems).toBe(true);
      expect(CONTRACT_TYPE_CONFIG["Supply / Procurement Contract"].showCommercialAmounts).toBe(true);
      expect(CONTRACT_TYPE_CONFIG["NDA"].showAwardedItems).toBe(false);
      expect(CONTRACT_TYPE_CONFIG["NDA"].showCommercialAmounts).toBe(false);
      expect(CONTRACT_TYPE_CONFIG["Service Agreement"].showAwardedItems).toBe(false);
      expect(CONTRACT_TYPE_CONFIG["Service Agreement"].showCommercialAmounts).toBe(true);
      expect(CONTRACT_TYPE_CONFIG["Master Service Agreement"].showAwardedItems).toBe(false);
      expect(CONTRACT_TYPE_CONFIG["Master Service Agreement"].showCommercialAmounts).toBe(true);
      expect(CONTRACT_TYPE_CONFIG["Other"].showAwardedItems).toBe(false);
      expect(CONTRACT_TYPE_CONFIG["Other"].showCommercialAmounts).toBe(true);
    });

    it("returns tailored term fields for each contract type", () => {
      const supplyFields = getTermFieldsForType("Supply / Procurement Contract");
      expect(supplyFields).toHaveLength(8);
      expect(supplyFields.map(f => f.fieldname)).toContain("contract_value");

      const serviceFields = getTermFieldsForType("Service Agreement");
      expect(serviceFields).toHaveLength(8);
      expect(serviceFields.find(f => f.fieldname === "contract_purpose")?.label).toBe("Service Scope & Deliverables");
      expect(serviceFields.find(f => f.fieldname === "contract_start_date")?.label).toBe("Service Start Date");

      const ndaFields = getTermFieldsForType("NDA");
      expect(ndaFields).toHaveLength(5);
      expect(ndaFields.map(f => f.fieldname)).not.toContain("contract_value");
      expect(ndaFields.map(f => f.fieldname)).not.toContain("currency");
      expect(ndaFields.find(f => f.fieldname === "contract_purpose")?.label).toBe("Purpose of Disclosure");

      const msaFields = getTermFieldsForType("Master Service Agreement");
      expect(msaFields).toHaveLength(8);
      expect(msaFields.find(f => f.fieldname === "contract_purpose")?.label).toBe("Agreement Scope & Master Objectives");

      const otherFields = getTermFieldsForType("Other");
      expect(otherFields).toHaveLength(8);
      expect(otherFields.find(f => f.fieldname === "contract_purpose")?.label).toBe("Contract Purpose");
    });

    it("dynamically validates fields per contract type", () => {
      awarded();
      // NDA: skips contract_value validation, checks parties and confidential scope
      const ndaErrors = procurementRequestCreateErrors(
        {
          contract_type: "NDA",
          contract_purpose: "Confidentiality",
          contract_start_date: "2026-10-01",
          contract_end_date: "2027-10-01",
          ...review,
        },
        harness.summary,
        {
          extraTerms: {
            confidential_scope: "",
            disclosing_party: "",
            receiving_party: "",
          },
        }
      );
      expect(ndaErrors.contract_value).toBeUndefined();
      expect(ndaErrors.currency).toBeUndefined();
      expect(ndaErrors.confidential_scope).toBe("Confidential Information Scope is required.");
      expect(ndaErrors.disclosing_party).toBe("Disclosing Party is required.");
      expect(ndaErrors.receiving_party).toBe("Receiving Party is required.");

      // Service Agreement: validates payment schedule
      const serviceErrors = procurementRequestCreateErrors(
        { ...completeTerms, contract_type: "Service Agreement", ...review },
        harness.summary,
        { payment_terms: "" }
      );
      expect(serviceErrors.payment_terms).toBe("Payment Schedule / Payment Terms are required.");

      // Master Service Agreement: validates payment framework
      const msaErrors = procurementRequestCreateErrors(
        { ...completeTerms, contract_type: "Master Service Agreement", ...review },
        harness.summary,
        { payment_terms: "" }
      );
      expect(msaErrors.payment_terms).toBe("Payment Framework is required.");

      // Other: validates custom title
      const otherErrors = procurementRequestCreateErrors(
        { ...completeTerms, contract_type: "Other", ...review },
        harness.summary,
        { extraTerms: { custom_title: "" } }
      );
      expect(otherErrors.custom_title).toBe("Contract Title / Type Description is required.");
    });

    it("renders Service Agreement with governance fields and without physical goods table", () => {
      awarded();
      (harness.detail.record as Record<string, unknown>).contract_type = "Service Agreement";
      const html = renderToStaticMarkup(<ProcurementRequestWorkspace detail={harness.detail} onSaved={harness.onSaved} />);
      expect(html).toContain("Service Level Agreement (SLA) &amp; Governance Terms");
      expect(html).toContain("Payment Schedule / Payment Terms");
      expect(html).toContain("Service Level Agreement (SLA)");
      expect(html).toContain("Performance KPIs");
      expect(html).toContain("Renewal Terms");
      expect(html).toContain("Termination Conditions");
      expect(html).toContain("Service Agreement &amp; SOW Document");
      expect(html).not.toContain("Awarded Item Rows &amp; Commercial Breakdown");
    });

    it("renders NDA with confidentiality covenants and hides commercial amounts and goods table", () => {
      awarded();
      (harness.detail.record as Record<string, unknown>).contract_type = "NDA";
      const html = renderToStaticMarkup(<ProcurementRequestWorkspace detail={harness.detail} onSaved={harness.onSaved} />);
      expect(html).toContain("Non-Disclosure Parties &amp; Confidentiality Covenants");
      expect(html).toContain("Disclosing Party");
      expect(html).toContain("Receiving Party");
      expect(html).toContain("Confidential Information Scope");
      expect(html).toContain("Confidentiality Obligations");
      expect(html).toContain("Permitted Disclosures");
      expect(html).toContain("Non-Financial Agreement");
      expect(html).toContain("Non-Disclosure Agreement Document");
      expect(html).not.toContain("Awarded Item Rows &amp; Commercial Breakdown");
    });

    it("renders Master Service Agreement with framework terms", () => {
      awarded();
      (harness.detail.record as Record<string, unknown>).contract_type = "Master Service Agreement";
      const html = renderToStaticMarkup(<ProcurementRequestWorkspace detail={harness.detail} onSaved={harness.onSaved} />);
      expect(html).toContain("Master Service Agreement (MSA) Operational Framework");
      expect(html).toContain("Payment Framework");
      expect(html).toContain("Service Levels &amp; Performance Terms");
      expect(html).toContain("Master Service Agreement (MSA) Document");
    });

    it("renders Other contract type with custom title input", () => {
      awarded();
      (harness.detail.record as Record<string, unknown>).contract_type = "Other";
      const html = renderToStaticMarkup(<ProcurementRequestWorkspace detail={harness.detail} onSaved={harness.onSaved} />);
      expect(html).toContain("Bespoke Agreement Details &amp; Commercial Terms");
      expect(html).toContain("Contract Title / Type Description");
      expect(html).toContain("Contract Document &amp; Attachments");
    });
  });

  describe("Automatic Legal Manager Signatory Assignment in Contract Creation", () => {
    it("automatically resolves and displays the designated Legal Manager summary without manual search", () => {
      awarded();
      harness.summary.can_create = true;
      harness.summary.request_needs_details = false;
      harness.summary.designated_legal_signatory = {
        source: "workflow_matrix",
        signatory: {
          name: "legal.lead@netlink.com",
          email: "legal.lead@netlink.com",
          full_name: "Elena Rostova",
        },
        eligible_signatories: [
          { name: "legal.lead@netlink.com", email: "legal.lead@netlink.com", full_name: "Elena Rostova" },
        ],
      };

      const tree = render();
      const html = renderToStaticMarkup(tree);

      // Verify the assignment summary displays the resolved name and email
      expect(html).toContain("Legal Manager Signatory");
      expect(html).toContain("Elena Rostova");
      expect(html).toContain("legal.lead@netlink.com");
      expect(html).toContain("Assigned automatically from existing workflow configuration");

      // Verify no searchable user dropdown exists in ClmFields for custom_inteva_signatory,
      // and assessed contract risk has been removed from CLM review fields
      const contractFieldsGroup = elements(tree).find(
        element => element.type === ClmFields && (element.props as unknown as { doctype: string }).doctype === "Contract"
      ) as unknown as ReactElement<Parameters<typeof ClmFields>[0]> | undefined;
      expect(contractFieldsGroup).toBeUndefined();

      // Verify Procurement Team does NOT have "Change Assignee" button
      expect(html).not.toContain("Change Assignee");
    });

    it("allows authorized administrators to see Change Assignee", () => {
      awarded();
      harness.role = "Procurement Manager";
      harness.summary.can_create = true;
      harness.summary.request_needs_details = false;
      harness.summary.designated_legal_signatory = {
        source: "workflow_matrix",
        signatory: {
          name: "legal.lead@netlink.com",
          email: "legal.lead@netlink.com",
          full_name: "Elena Rostova",
        },
        eligible_signatories: [
          { name: "legal.lead@netlink.com", email: "legal.lead@netlink.com", full_name: "Elena Rostova" },
          { name: "legal.deputy@netlink.com", email: "legal.deputy@netlink.com", full_name: "David Chen" },
        ],
      };

      const tree = render();
      const html = renderToStaticMarkup(tree);
      expect(html).toContain("Change Assignee");
    });

    it("displays a clear validation notice when no unique Legal Manager can be resolved", () => {
      awarded();
      harness.summary.can_create = true;
      harness.summary.request_needs_details = false;
      harness.summary.designated_legal_signatory = {
        source: "unresolved",
        error: "Multiple eligible Legal Managers are configured, but no designated signatory is specified in the approval workflow. An authorized administrator must configure the assignment.",
        eligible_signatories: [
          { name: "legal1@netlink.com", email: "legal1@netlink.com", full_name: "Legal One" },
          { name: "legal2@netlink.com", email: "legal2@netlink.com", full_name: "Legal Two" },
        ],
      };

      const tree = render();
      const html = renderToStaticMarkup(tree);
      expect(html).toContain("Multiple eligible Legal Managers are configured");
    });

    it("submits the auto-assigned Legal Manager Signatory on contract creation without manual entry", async () => {
      awarded();
      harness.summary.can_create = true;
      harness.summary.request_needs_details = false;
      harness.summary.designated_legal_signatory = {
        source: "workflow_matrix",
        signatory: {
          name: "legal.lead@netlink.com",
          email: "legal.lead@netlink.com",
          full_name: "Elena Rostova",
        },
        eligible_signatories: [
          { name: "legal.lead@netlink.com", email: "legal.lead@netlink.com", full_name: "Elena Rostova" },
        ],
      };

      // Fill only the core terms; custom_inteva_signatory is auto-assigned
      change(completeTerms);
      click("Create Contract");
      await settle();

      expect(harness.create).toHaveBeenCalledOnce();
      expect(harness.create.mock.calls[0][0].contract_fields).toEqual({
        custom_inteva_signatory: "legal.lead@netlink.com",
      });
      expect(harness.create.mock.calls[0][0].contract_fields).not.toHaveProperty("custom_risk_level");
    });
  });
});

