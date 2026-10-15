import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmMetadata, RfqClmSummary } from "../../api/clm";

const harness = vi.hoisted(() => ({
  capture: false, cursor: 0, changed: false, role: "procurement_team" as string | undefined,
  slots: [] as Array<{ value?: unknown; dependencies?: readonly unknown[] }>, effects: [] as Array<() => unknown>,
  metadata: {} as ClmMetadata, context: {} as RfqClmSummary, metadataError: false, editorMode: "create_contract" as "request" | "create_contract",
  create: vi.fn(), request: vi.fn(), retryInitial: vi.fn(), submitRfq: vi.fn(), decide: vi.fn(), navigate: vi.fn(), summary: vi.fn(), refetch: vi.fn(), saved: vi.fn(), cancel: vi.fn(), success: vi.fn(), notice: vi.fn(),
  qc: { setQueryData: vi.fn(), invalidateQueries: vi.fn() },
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
      const slot = harness.cursor++; const previous = harness.slots[slot];
      if (!previous || !dependencies || dependencies.some((value, index) => !Object.is(value, previous.dependencies?.[index]))) harness.effects.push(effect);
      harness.slots[slot] = { dependencies };
    },
  };
});
vi.mock("react-router-dom", () => ({ useNavigate: () => harness.navigate, Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[1] === "metadata" ? harness.metadata : harness.context, isLoading: false, isError: queryKey[1] === "metadata" && harness.metadataError, error: new Error("Cannot load fields"), refetch: harness.refetch }),
  useQueryClient: () => harness.qc,
}));
vi.mock("react-hot-toast", () => ({ default: Object.assign(harness.notice, { success: harness.success }) }));
vi.mock("../../api/rfqSubmitClm", () => ({ submitRfqWithContractConfirmation: harness.submitRfq }));
vi.mock("../../api/legalDocsStorage", () => ({ uploadFileToERPNextDetailed: vi.fn() }));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: harness.role } }) }));
vi.mock("../../api/clm", async importOriginal => ({
  createRfqContractRequest: harness.create, submitRfqClmRequest: harness.request, retryInitialRfqClmRequest: harness.retryInitial, recordRfqAwardDecision: harness.decide, getRfqClmSummary: harness.summary, getClmMetadata: vi.fn(), lookupClm: vi.fn(),
  clmViewerKey: () => "staff-session", clmError: (await importOriginal<typeof import("../../api/clm")>()).clmError,
  clmRecordRoute: (doctype: string, name: string) => doctype === "Contract Request" ? `/contract-requests/${name}` : `/contracts/${name}`,
}));
import RfqContractPanel, { RfqContractRequestEditor } from "./RfqContractPanel";
import ClmFields from "../contracts/ClmFields";
import RfqContractRequirementField from "./RfqContractRequirementField";
import { RFQ_CONTRACT_TYPES } from "../../utils/rfqContractContext";

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void }>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement(node)) return []; const element = node as Element; return [element, ...elements(element.props.children)]; }
function textOf(node: ReactNode): string { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(textOf).join(""); return isValidElement(node) ? textOf((node as Element).props.children) : ""; }
function renderEditor(props: { onOpenRequest?: (requestName: string) => void } = {}) {
  for (let attempt = 0; attempt < 10; attempt++) {
    harness.cursor = 0; harness.changed = false; harness.effects = []; harness.capture = true;
    let tree: ReactNode;
    try { tree = RfqContractRequestEditor({ context: harness.context, mode: harness.editorMode, onSaved: harness.saved, onCancel: harness.cancel, ...props }); } finally { harness.capture = false; }
    harness.effects.forEach(effect => effect()); if (!harness.changed) return tree;
  }
  throw new Error("Editor did not settle");
}
function renderPanel(props: { rfqName?: string; expectedRequestName?: string; onOpenRequest?: (requestName: string) => void } = {}) {
  for (let attempt = 0; attempt < 10; attempt++) {
    harness.cursor = 0; harness.changed = false; harness.effects = []; harness.capture = true;
    let tree: ReactNode;
    try { tree = RfqContractPanel({ rfqName: "RFQ-1", ...props }); } finally { harness.capture = false; }
    harness.effects.forEach(effect => effect()); if (!harness.changed) return tree;
  }
  throw new Error("Panel did not settle");
}
function clickPanel(label: string, tree = renderPanel()) { elements(tree).find(element => element.type === "button" && textOf(element) === label)!.props.onClick!(); }
function group(tree = renderEditor()) { return elements(tree).find(element => element.type === ClmFields) as unknown as ReactElement<Parameters<typeof ClmFields>[0]>; }
function change(values: Record<string, unknown>) { const fieldGroup = group(); fieldGroup.props.onChange({ ...fieldGroup.props.values, ...values }); }
function submit(tree = renderEditor()) { elements(tree).find(element => element.type === "form")!.props.onSubmit!({ preventDefault: vi.fn() }); }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function validValues() { change({ contract_type: "Supply / Procurement Contract", contract_purpose: "Production tooling", description: "Supply tooling for the awarded project", contract_start_date: "2026-10-01", contract_end_date: "2027-09-30", custom_inteva_signatory: "legal@example.test" }); }

beforeEach(() => {
  vi.clearAllMocks(); harness.retryInitial.mockReset(); harness.submitRfq.mockReset(); harness.slots = []; harness.capture = false; harness.metadataError = false; harness.role = "procurement_team"; harness.editorMode = "create_contract";
  harness.context = { rfq: { name: "RFQ-1", modified: "award-revision" }, contract_required: "Yes", decision: "Pending", can_decide: true, can_request: true, blocks_procurement: true, continuation_ready: false, can_create: true, eligible: true, reason: "", status: "Not Started", can_open_request: false, can_open_contract: false,
    source: { award: "AWARD-1", supplier: "SUP-1", quotation: "SQ-1" }, prefill: { custom_rfq: "RFQ-1", supplier: "SUP-1", custom_supplier_quotation: "SQ-1", company: "Company", department: "Purchasing", contract_value: 0, estimated_contract_value: 0, currency: "USD", contract_purpose: "Award purpose" },
    locked_fields: ["custom_rfq", "supplier", "custom_supplier_quotation", "company", "department", "contract_value", "estimated_contract_value", "currency"], required_fields: ["contract_type", "description", "contract_start_date", "contract_end_date"], source_documents: [], warnings: [],
  };
  const fields = [
    { fieldname: "contract_type", fieldtype: "Select", label: "Contract Type", reqd: 1, options: "Supplier Agreement\nNDA", default: "NDA" },
    { fieldname: "contract_purpose", fieldtype: "Data", label: "Business Purpose", reqd: 1, default: "Default purpose" },
    { fieldname: "description", fieldtype: "Small Text", label: "Description", reqd: 1 },
    { fieldname: "contract_start_date", fieldtype: "Date", label: "Start Date", reqd: 1 },
    { fieldname: "contract_end_date", fieldtype: "Date", label: "End Date", reqd: 1 },
    ...harness.context.locked_fields.map(fieldname => ({ fieldname, fieldtype: "Data", reqd: 1 })),
    { fieldname: "internal_notes", fieldtype: "Small Text", label: "Internal Notes" },
    { fieldname: "supporting_document", fieldtype: "Attach" },
  ];
  harness.metadata = { fields: { "Contract Request": fields, Contract: [{ fieldname: "custom_risk_level", fieldtype: "Select", options: "Low\nMedium\nHigh\nCritical", default: "Low" }, { fieldname: "custom_inteva_signatory", fieldtype: "Link", options: "User" }] }, editableFields: { "Contract Request": fields.map(field => field.fieldname) }, allowedCreate: ["Contract Request"] };
  harness.create.mockReset().mockResolvedValue({ created: true, request: { record: { name: "CR-1" } }, summary: { ...harness.context, can_create: false, request: { name: "CR-1", status: "Draft" } } });
  harness.request.mockReset().mockResolvedValue({ created: true, request: { record: { name: "CR-1" } }, summary: { ...harness.context, can_request: false, can_create: true, request: { name: "CR-1", status: "Draft", assigned_role: "procurement_team", current_stage: "Pending Procurement Team" } } });
});

describe("RFQ CLM action eligibility display", () => {
  it.each([0, 1])("does not create or retry CLM without an award for docstatus %s", docstatus => {
    Object.assign(harness.context, { rfq: { name: "RFQ-1", modified: "v1", docstatus }, source: undefined, can_decide: false, initial_request_required: true });
    const tree = renderPanel();
    expect(textOf(tree)).not.toContain("Retry RFQ submission"); expect(textOf(tree)).not.toContain("will be created when the RFQ is submitted");
    expect(elements(tree).some(element => element.type === RfqContractRequirementField)).toBe(false);
    expect(harness.submitRfq).not.toHaveBeenCalled(); expect(harness.request).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled();
  });
  it.each(["procurement", "Procurement Manager", "procurement_team", "Procurement Team"])("allows saved requirement handoff retry for %s without another choice", role => {
    harness.role = role; const tree=renderPanel();
    expect(elements(tree).some(element => element.type === RfqContractRequirementField)).toBe(false);
    expect((elements(tree).find(element => element.type === "button" && textOf(element) === "Retry Contract Handoff")!.props as any).disabled).toBe(false);
    expect(textOf(tree)).toContain("Contract Required (saved on RFQ)Yes");
  });
  it.each(["admin", "legal", "finance", "department", undefined])("hides award creation actions for %s", role => {
    harness.role=role; expect(elements(renderPanel()).some(element => element.type === RfqContractRequirementField)).toBe(false);
    expect(textOf(renderPanel())).not.toContain("Retry Contract Handoff");
  });
  it.each(["Yes", "No"] as const)("retries saved %s using only persisted award identity without changing the requirement", async decision => {
    harness.context.contract_required = decision;
    const summary = { ...harness.context, decision, contract_required: decision, can_decide: false, ...(decision === "Yes" ? { request: { name: "CR-1", assigned_role: "procurement_team", current_stage: "Procurement" }, can_open_request: true } : {}) };
    harness.decide.mockResolvedValue({ created: decision === "Yes", ...(decision === "Yes" ? { request: { record: { name: "CR-1" } } } : {}), summary });
    const tree=renderPanel(); clickPanel("Retry Contract Handoff",tree); clickPanel("Retry Contract Handoff",tree); await settle();
    expect(harness.decide).toHaveBeenCalledExactlyOnceWith({rfq:"RFQ-1",award_id:"AWARD-1",supplier_id:"SUP-1",quotation_id:"SQ-1"});
    expect(harness.request).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled(); expect(harness.submitRfq).not.toHaveBeenCalled();
    expect(harness.success).toHaveBeenCalled();
  });
  it("keeps the saved requirement visible after a real failed transaction", async () => {
    harness.decide.mockRejectedValue(new Error("ERPNext award Request denied")); clickPanel("Retry Contract Handoff"); await settle();
    expect(textOf(renderPanel())).toContain("ERPNext award Request denied"); expect(harness.success).not.toHaveBeenCalled();
    expect(textOf(renderPanel())).toContain("Contract Required (saved on RFQ)Yes");
    expect(elements(renderPanel()).some(element=>element.type===RfqContractRequirementField)).toBe(false);
  });
  it("retries the persisted award decision after a partial Request save without allowing a new choice", async () => {
    Object.assign(harness.context, { decision:"Yes", recovery_required:true, can_decide:true, can_request:false, can_create:false, request:{name:"CR-PARTIAL",status:"Pending"} });
    harness.decide.mockResolvedValue({created:false,request:{record:{name:"CR-PARTIAL"}},summary:{...harness.context,recovery_required:false,can_decide:false}});
    const tree=renderPanel(); expect(elements(tree).some(element=>element.type===RfqContractRequirementField)).toBe(false);
    clickPanel("Retry Contract Handoff",tree); await settle();
    expect(harness.decide).toHaveBeenCalledExactlyOnceWith({rfq:"RFQ-1",award_id:"AWARD-1",supplier_id:"SUP-1",quotation_id:"SQ-1"});
    expect(harness.create).not.toHaveBeenCalled(); expect(harness.request).not.toHaveBeenCalled(); expect(harness.submitRfq).not.toHaveBeenCalled();
  });
  it("rejects a stale editor submit after losing procurement authorization", async () => {
    validValues(); harness.role="legal"; submit(); await settle(); expect(harness.create).not.toHaveBeenCalled();
  });
  it("opens an existing Request without presenting duplicate creation", () => {
    Object.assign(harness.context, { can_create: false, request: { name: "CR-1", status: "Draft" }, can_open_request: true, status: "Contract Request Created" });
    const html = renderToStaticMarkup(<RfqContractPanel rfqName="RFQ-1" />);
    expect(html).toContain("Open Contract Request"); expect(html).toContain("/contract-requests/CR-1"); expect(html).not.toContain("Yes — Request CLM");
    expect(html).toContain("No Contract is linked yet"); expect(html).not.toContain("Contract already exists.");
  });
  it("lets Procurement Team complete an authorized request-only handoff without repeating the Yes decision", () => {
    Object.assign(harness.context, { can_create: true, can_decide: false, decision: "Yes", request: { name: "CR-1", status: "Approved" }, can_open_request: true });
    const tree = renderPanel();
    expect(textOf(tree)).not.toContain("Yes — Request CLM"); expect(textOf(tree)).not.toContain("No — No Contract");
    clickPanel("Review & Create Contract", tree);
    expect(elements(renderPanel()).some(element => element.type === RfqContractRequestEditor)).toBe(true);
    expect(harness.create).not.toHaveBeenCalled();
    harness.role = "legal";
    expect(textOf(renderPanel())).not.toContain("Review & Create Contract");
  });
  it("opens preparation for the same initial Request after award without creating a Contract", () => {
    Object.assign(harness.context, { can_request: true, can_create: false, can_decide: false, request_needs_details: true, decision: "Yes", request: { name: "CR-INITIAL", status: "Pending", assigned_role: "procurement_team", current_stage: "Procurement" }, can_open_request: true });
    const tree = renderPanel();
    expect(textOf(tree)).toContain("Complete Contract Request"); expect(textOf(tree)).not.toContain("Route CLM Request to Procurement Team");
    expect(textOf(tree)).not.toContain("Review & Create Contract"); expect(textOf(tree)).not.toContain("Yes — Request CLM");
    clickPanel("Complete Contract Request", tree);
    const editor = elements(renderPanel()).find(element => element.type === RfqContractRequestEditor) as unknown as ReactElement<Parameters<typeof RfqContractRequestEditor>[0]>;
    expect(editor.props.mode).toBe("request"); expect(editor.props.context.request?.name).toBe("CR-INITIAL");
    editor.props.onSaved({ created: false, request: { record: { name: "CR-INITIAL" } } as any, summary: { ...harness.context, request_needs_details: false, can_request: false, can_create: true } });
    expect(harness.success).toHaveBeenCalledWith("Contract Request details saved. Procurement Team can now create the Contract.");
    expect(harness.navigate).toHaveBeenCalledWith("/contract-requests/CR-INITIAL"); expect(harness.create).not.toHaveBeenCalled();
  });
  it("shows the initial Pending/Procurement request without exposing preparation until award is ready", () => {
    Object.assign(harness.context, { can_request: false, can_create: false, can_decide: false, decision: "Yes", status: "Pending", source: {}, prefill: { custom_rfq: "RFQ-1" }, request: { name: "CR-INITIAL", status: "Pending", assigned_role: "procurement_team", current_stage: "Procurement" }, can_open_request: true, reason: "Complete supplier award before preparing the Contract." });
    const html = renderToStaticMarkup(<RfqContractPanel rfqName="RFQ-1" expectedRequestName="CR-INITIAL" />);
    expect(html).toContain("Procurement"); expect(html).toContain("Pending"); expect(html).toContain("Open Contract Request");
    expect(html).toContain("Actual Contract creation follows supplier award and completed contract details");
    expect(html).not.toContain("Yes — Request CLM"); expect(html).not.toContain("Review &amp; Create Contract"); expect(html).not.toContain("Complete Contract Request</button>");
    expect(harness.create).not.toHaveBeenCalled(); expect(harness.request).not.toHaveBeenCalled();
  });
  it("shows server-derived lifecycle and respects Request/Contract link permissions", () => {
    Object.assign(harness.context, { can_create: false, request: { name: "CR-1", status: "Approved" }, contract: { name: "CON-1", status: "Active" }, status: "Active", can_open_contract: true });
    const html = renderToStaticMarkup(<RfqContractPanel rfqName="RFQ-1" />);
    expect(html).toContain("Active"); expect(html).toContain("Contract already exists."); expect(html).toContain("View Contract"); expect(html).not.toContain("Open Contract Request");
  });
  it("lets authorized Team resume a partial Contract without presenting completed creation", () => {
    Object.assign(harness.context, { recovery_required: true, can_create: true, can_request: false, can_decide: false,
      decision: "Yes", request: { name: "CR-1", status: "Pending Review" }, contract: { name: "CON-1", status: "Draft" }, can_open_contract: true });
    const tree = renderPanel();
    expect(textOf(tree)).toContain("Resume Contract creation");
    expect(textOf(tree)).toContain("Contract creation is incomplete.");
    expect(textOf(tree)).toContain("View Contract");
    expect(textOf(tree)).not.toContain("Contract already exists.");
    clickPanel("Resume Contract creation", tree);
    const editor = elements(renderPanel()).find(element => element.type === RfqContractRequestEditor) as unknown as ReactElement<Parameters<typeof RfqContractRequestEditor>[0]>;
    expect(editor.props.mode).toBe("create_contract");
    expect(editor.props.context.contract?.name).toBe("CON-1");
    expect(harness.create).not.toHaveBeenCalled(); expect(harness.success).not.toHaveBeenCalled();
    harness.role = "legal";
    expect(textOf(renderPanel())).not.toContain("Resume Contract creation");
    expect(elements(renderPanel()).some(element => element.type === RfqContractRequestEditor)).toBe(false);
    harness.role = "procurement_team"; harness.context.can_create = false;
    expect(textOf(renderPanel())).not.toContain("Resume Contract creation");
  });
  it("shows existing historical PO context without a fake pending decision", () => {
    Object.assign(harness.context, { contract_required: "No", decision: "Pending", can_decide: false, can_create: false, continuation_ready: true, blocks_procurement: false, status: "Existing Purchase Order" });
    const html = renderToStaticMarkup(<RfqContractPanel rfqName="RFQ-1" />);
    expect(html).toContain("No (existing purchase order)"); expect(html).toContain("Existing Purchase Order");
    expect(html).not.toContain("Decision pending"); expect(html).not.toContain("Yes — Request CLM"); expect(html).not.toContain("Save the contract decision");
  });
  it("does not allow a request detail to process a different RFQ request", () => {
    const html = renderToStaticMarkup(<RfqContractPanel rfqName="RFQ-1" expectedRequestName="CR-other" />);
    expect(html).toContain("does not reference this Contract Request"); expect(html).not.toContain("Yes — Request CLM");
  });
  it.each([true, false].flatMap(created => [{ created, warnings: [] as string[] }, { created, warnings: ["Contract created, but Legal notification could not be delivered."] }]))("opens the persisted CLM with created=$created and preserves delivery warnings: $warnings", ({ created, warnings }) => {
    Object.assign(harness.context, {decision:"Yes",request:{name:"CR-1",status:"Pending"},can_create:true});
    clickPanel("Review & Create Contract");
    const editor = elements(renderPanel()).find(element => element.type === RfqContractRequestEditor) as unknown as ReactElement<Parameters<typeof RfqContractRequestEditor>[0]>;
    editor.props.onSaved({ created, request: { record: { name: "CR-1" } } as any, contract: { record: { name: "CON-1" }, warnings } as any, summary: { ...harness.context, decision: "Yes", can_decide: false, can_create: false, request: { name: "CR-1", status: "Completed" }, contract: { name: "CON-1", status: "Pending Legal" }, can_open_request: true, can_open_contract: true } });
    expect(harness.navigate).toHaveBeenCalledWith("/contracts/CON-1");
    expect(harness.success).toHaveBeenCalledWith(created ? "Contract created and sent to Legal Review." : "Contract already exists. Opening the contract.");
    expect(harness.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["rfq", "RFQ-1"] });
    expect(harness.qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["clm", "list", "Contract"] });
    if (warnings.length) expect(harness.notice).toHaveBeenCalledWith(warnings[0], { icon: "ℹ️" });
    else expect(harness.notice).not.toHaveBeenCalled();
    expect(elements(renderPanel()).some(element => element.type === RfqContractRequestEditor)).toBe(false);
  });

});

describe("Opening the existing Contract Request workspace", () => {
  function savedInitialRequest() {
    Object.assign(harness.context, {
      rfq: { name: "PUR-RFQ-2026-00099", modified: "unchanged-rfq-revision" },
      decision: "Yes", can_decide: false, can_request: false, can_create: false, status: "Pending",
      source: {}, prefill: { custom_rfq: "PUR-RFQ-2026-00099" },
      request: { name: "CTRQ-2026-0002", status: "Pending", assigned_role: "procurement_team", current_stage: "Procurement" },
      can_open_request: true,
    });
  }
  function expectNoTransaction() {
    for (const call of [harness.create, harness.request, harness.retryInitial, harness.decide, harness.saved, harness.navigate, harness.success, harness.qc.setQueryData, harness.qc.invalidateQueries]) expect(call).not.toHaveBeenCalled();
  }
  it("opens CTRQ-2026-0002 in the embedded workspace without self-navigation or any transaction", () => {
    savedInitialRequest(); const onOpenRequest = vi.fn(); const persisted = structuredClone(harness.context);
    const tree = renderPanel({ rfqName: "PUR-RFQ-2026-00099", expectedRequestName: "CTRQ-2026-0002", onOpenRequest });
    const open = elements(tree).find(element => element.type === "button" && textOf(element) === "Open Contract Request");
    expect(open).toBeDefined();
    expect(elements(tree).some(element => (element.props as { to?: string }).to === "/contract-requests/CTRQ-2026-0002")).toBe(false);
    open!.props.onClick!();
    expect(onOpenRequest).toHaveBeenCalledExactlyOnceWith("CTRQ-2026-0002");
    expect(harness.context).toEqual(persisted); expectNoTransaction();
  });
  it("keeps the canonical Request link on the source RFQ page", () => {
    savedInitialRequest();
    const html = renderToStaticMarkup(<RfqContractPanel rfqName="PUR-RFQ-2026-00099" />);
    expect(html).toContain('href="/contract-requests/CTRQ-2026-0002"');
    expect(html).toContain("Open Contract Request"); expectNoTransaction();
  });
  it.each(["mismatched-request", "not-authorized"])("does not expose the embedded open action for %s", condition => {
    savedInitialRequest(); const onOpenRequest = vi.fn();
    if (condition === "not-authorized") harness.context.can_open_request = false;
    const tree = renderPanel({ rfqName: "PUR-RFQ-2026-00099", expectedRequestName: condition === "mismatched-request" ? "CTRQ-2026-0001" : "CTRQ-2026-0002", onOpenRequest });
    expect(textOf(tree)).not.toContain("Open Contract Request");
    if (condition === "mismatched-request") expect(textOf(tree)).toContain("does not reference this Contract Request");
    expect(onOpenRequest).not.toHaveBeenCalled(); expectNoTransaction();
  });
  it("passes embedded opening through the existing awarded-request editor", () => {
    savedInitialRequest(); harness.context.can_request = true; harness.context.request_needs_details = true;
    const onOpenRequest = vi.fn(); const props = { expectedRequestName: "CTRQ-2026-0002", onOpenRequest };
    clickPanel("Complete Contract Request", renderPanel(props));
    const editor = elements(renderPanel(props)).find(element => element.type === RfqContractRequestEditor) as unknown as ReactElement<Parameters<typeof RfqContractRequestEditor>[0]>;
    expect(editor.props.context.request?.name).toBe("CTRQ-2026-0002");
    expect(editor.props.onOpenRequest).toBeDefined();
    editor.props.onOpenRequest!("CTRQ-2026-0002");
    expect(onOpenRequest).toHaveBeenCalledExactlyOnceWith("CTRQ-2026-0002"); expectNoTransaction();
  });
  it("opens the exact saved Request from the editor without submitting or creating anything", () => {
    savedInitialRequest(); harness.editorMode = "request"; const onOpenRequest = vi.fn(); const persisted = structuredClone(harness.context);
    const tree = renderEditor({ onOpenRequest });
    const open = elements(tree).find(element => element.type === "button" && textOf(element) === "Open Contract Request");
    expect(open).toBeDefined();
    expect((open!.props as { type?: string }).type).toBe("button");
    open!.props.onClick!();
    expect(onOpenRequest).toHaveBeenCalledExactlyOnceWith("CTRQ-2026-0002");
    expect(harness.context).toEqual(persisted); expectNoTransaction();
  });
  it("keeps the editor Request link when it is opened outside the Request workspace", () => {
    savedInitialRequest(); harness.editorMode = "request";
    const tree = renderEditor();
    expect(elements(tree).some(element => (element.props as { to?: string }).to === "/contract-requests/CTRQ-2026-0002")).toBe(true);
    expect(elements(tree).some(element => element.type === "button" && textOf(element) === "Open Contract Request")).toBe(false);
    expectNoTransaction();
  });
  it("does not let an editor callback bypass the server Request read permission", () => {
    savedInitialRequest(); harness.editorMode = "request"; harness.context.can_open_request = false; const onOpenRequest = vi.fn();
    expect(textOf(renderEditor({ onOpenRequest }))).not.toContain("Open Contract Request");
    expect(onOpenRequest).not.toHaveBeenCalled(); expectNoTransaction();
  });
});

describe("RFQ-sourced Contract Request form", () => {
  it("persists missing terms and optional notes on the same existing initial Request before Contract creation", async () => {
    harness.editorMode = "request";
    Object.assign(harness.context, { can_request: true, can_create: false, can_decide: false, request_needs_details: true, decision: "Yes", request: { name: "CR-INITIAL", status: "Pending", assigned_role: "procurement_team", current_stage: "Procurement" } });
    validValues(); change({ internal_notes: "Team reviewed the initial RFQ request", custom_inteva_signatory: "" });
    const tree = renderEditor(); expect(textOf(tree)).toContain("Complete Contract Request"); expect(textOf(tree)).toContain("Save Contract Request Details"); expect(textOf(tree)).toContain("Additional request details");
    expect(elements(tree).filter(element => element.type === ClmFields).some(element => (element.props as unknown as Parameters<typeof ClmFields>[0]).fields.some(field => field.fieldname === "custom_inteva_signatory"))).toBe(false);
    submit(tree); await settle();
    expect(harness.request).toHaveBeenCalledOnce(); expect(harness.create).not.toHaveBeenCalled();
    expect(harness.request.mock.calls[0][0]).toEqual({ rfq: "RFQ-1", expected_modified: "award-revision", payload: { contract_type: "Supply / Procurement Contract", contract_purpose: "Production tooling", description: "Supply tooling for the awarded project", contract_start_date: "2026-10-01", contract_end_date: "2027-09-30", internal_notes: "Team reviewed the initial RFQ request" } });
    expect(harness.request.mock.calls[0][0]).not.toHaveProperty("contract_fields");
  });
  it("submits the request separately without collecting or creating a Legal review before Team processing", async () => {
    harness.editorMode = "request"; harness.context.can_create = false; harness.metadata.fields.Contract = [];
    validValues(); change({ custom_inteva_signatory: "" });
    const tree = renderEditor(); expect(textOf(tree)).toContain("Submit CLM Request"); expect(textOf(tree)).toContain("Request CLM from RFQ Award");
    expect(elements(tree).filter(element => element.type === ClmFields).some(element => (element.props as unknown as Parameters<typeof ClmFields>[0]).fields.some(field => field.fieldname === "custom_inteva_signatory"))).toBe(false);
    submit(tree); await settle();
    expect(harness.request).toHaveBeenCalledOnce(); expect(harness.create).not.toHaveBeenCalled();
    expect(harness.request.mock.calls[0][0]).toMatchObject({ rfq: "RFQ-1", expected_modified: "award-revision", payload: { contract_type: "Supply / Procurement Contract", contract_purpose: "Production tooling", contract_start_date: "2026-10-01", contract_end_date: "2027-09-30" } });
    expect(harness.request.mock.calls[0][0]).not.toHaveProperty("contract_fields");
  });
  it("keeps required Request validation and preserves the entered form after failed routing", async () => {
    harness.editorMode = "request"; submit(); await settle(); expect(harness.request).not.toHaveBeenCalled();
    validValues(); harness.request.mockRejectedValueOnce(new Error("Deploy bidsphere_workflows to persist the Procurement Team assignment."));
    submit(); await settle();
    expect(textOf(renderEditor())).toContain("Deploy bidsphere_workflows"); expect(group().props.values.contract_purpose).toBe("Production tooling");
    expect(harness.saved).not.toHaveBeenCalled(); expect(harness.create).not.toHaveBeenCalled();
  });
  it.each(["request", "create_contract"] as const)("shows the safe actionable server error and retains all entered values after failed %s", async mode => {
    harness.editorMode = mode;
    const api = mode === "request" ? harness.request : harness.create;
    const message = mode === "request" ? "The RFQ CLM transaction extension is not installed in ERPNext. Deploy bidsphere_workflows before recording this decision; nothing has been advanced." : "The saved RFQ award changed. Refresh the award before creating its Contract.";
    api.mockRejectedValueOnce({ message: "We couldn't complete this action. Please try again.", response: { data: { error: "transaction_failed", message } } });
    validValues(); change({ internal_notes: "Keep this exact request note" }); const entered = structuredClone(group().props.values);
    submit(); await settle();
    expect(textOf(renderEditor())).toContain(message); expect(textOf(renderEditor())).not.toContain("We couldn't complete this action");
    expect(group().props.values).toEqual(entered);
    expect(harness.saved).not.toHaveBeenCalled(); expect(harness.success).not.toHaveBeenCalled(); expect(harness.navigate).not.toHaveBeenCalled(); expect(harness.qc.setQueryData).not.toHaveBeenCalled();
    const originalInput = structuredClone(api.mock.calls[0][0]); submit(); await settle();
    expect(api).toHaveBeenCalledTimes(2); expect(api.mock.calls[1][0]).toEqual(originalInput); expect(harness.saved).toHaveBeenCalledOnce();
  });
  it("deduplicates same-tick request submissions while the ERP transaction is pending", async () => {
    harness.editorMode = "request";
    let finish!: (value: unknown) => void; harness.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    validValues(); const tree = renderEditor(); submit(tree); submit(tree);
    expect(harness.request).toHaveBeenCalledOnce(); expect(harness.create).not.toHaveBeenCalled(); expect(harness.saved).not.toHaveBeenCalled();
    expect(textOf(renderEditor())).toContain("Submitting…"); finish({ created: true, request: { record: { name: "CR-1" } } }); await settle();
    expect(harness.saved).toHaveBeenCalledOnce();
  });
  it("recovers a saved Team Request after a lost response without submitting it again", async () => {
    harness.editorMode = "request"; validValues();
    harness.request.mockRejectedValueOnce(new Error("Network response unavailable. Refresh the RFQ to verify whether the request was saved."));
    const entered = structuredClone(group().props.values); submit(); await settle();
    harness.summary.mockResolvedValue({ ...harness.context, decision: "Yes", can_request: false, can_create: true, can_decide: false, can_open_request: true, request: { name: "CR-existing", status: "Draft", assigned_role: "procurement_team", current_stage: "Pending Procurement Team" }, prefill: { ...harness.context.prefill, ...entered }, locked_fields: [...new Set([...harness.context.locked_fields, "contract_type", "contract_purpose", "description", "contract_start_date", "contract_end_date"])] });
    elements(renderEditor()).find(element => element.type === "button" && textOf(element) === "Refresh award")!.props.onClick!(); await settle();
    const refreshed = renderEditor(); expect(textOf(refreshed)).toContain("CLM Request already exists in Procurement Team's queue.");
    expect(elements(refreshed).some(element => (element.props as { to?: string }).to === "/contract-requests/CR-existing")).toBe(true);
    expect(group(refreshed).props.values).toEqual(entered); submit(refreshed); await settle();
    expect(harness.request).toHaveBeenCalledOnce(); expect(harness.create).not.toHaveBeenCalled(); expect(harness.success).not.toHaveBeenCalled(); expect(harness.saved).not.toHaveBeenCalled();
  });
  it("shows the current award context and never auto-selects the metadata or source NDA default", () => {
    harness.context.prefill = { ...harness.context.prefill, contract_type: "NDA", contract_value: 2500 };
    const tree = renderEditor();
    expect(textOf(tree)).toContain("Create Contract from RFQ Award");
    expect(textOf(tree)).toContain("Contract Context");
    for (const source of ["RFQ-1", "AWARD-1", "SUP-1", "SQ-1", "USD 2,500", "Company", "Purchasing"]) expect(textOf(tree)).toContain(source);
    const select = elements(tree).find(element => element.type === "select") as ReactElement<{ value: string; children: ReactNode }>;
    expect(select.props.value).toBe("");
    expect(elements(select).filter(element => element.type === "option").map(textOf)).toEqual(["Select Contract Type", ...RFQ_CONTRACT_TYPES]);
    expect(group(tree).props.fields.map(field => field.fieldname)).not.toContain("contract_type");
  });
  it("requires the purpose and validates dates even when older metadata marks them optional", async () => {
    harness.metadata.fields["Contract Request"].forEach(field => { if (["contract_purpose", "contract_start_date", "contract_end_date"].includes(field.fieldname)) field.reqd = 0; });
    validValues(); change({ contract_purpose: "   ", contract_start_date: "2026-10-01", contract_end_date: "2026-09-30" });
    submit(); await settle();
    expect(group().props.errors?.contract_purpose).toBeTruthy();
    expect(group().props.errors?.contract_end_date).toBeTruthy();
    expect(harness.create).not.toHaveBeenCalled();
    expect(group().props.values.description).toBe("Supply tooling for the awarded project");
  });
  it("does not submit an invalid date or unsupported contract type", async () => {
    validValues(); change({ contract_type: "Supplier Agreement", contract_start_date: "2026-02-30" });
    submit(); await settle();
    expect(group().props.errors?.contract_type).toBeTruthy();
    expect(group().props.errors?.contract_start_date).toBeTruthy();
    expect(harness.create).not.toHaveBeenCalled();
  });
  it("preserves available purpose/zero award and asks for missing type/dates without inventing values", () => {
    const fields = group().props;
    expect(fields.values).toMatchObject({ contract_purpose: "Award purpose", contract_value: 0, estimated_contract_value: 0 });
    expect(fields.values.contract_type).toBe(""); expect(fields.values.contract_start_date).toBeUndefined();
    expect(fields.values.custom_inteva_signatory).toBe("");
    expect(fields.fields.map(field => field.fieldname)).not.toContain("supplier");
    expect(harness.create).not.toHaveBeenCalled();
  });
  it("preserves the saved Request type and contractual terms when completing its Contract handoff", async () => {
    Object.assign(harness.context, { request: { name: "CR-1", status: "Approved" }, decision: "Yes", can_decide: false });
    const saved = { contract_type: "Service Agreement", contract_purpose: "Saved purpose", description: "Saved description", contract_start_date: "2026-10-01", contract_end_date: "2027-09-30" };
    Object.assign(harness.context.prefill, saved);
    harness.context.locked_fields.push(...Object.keys(saved));
    const tree = renderEditor();
    const select = elements(tree).find(element => element.type === "select") as ReactElement<{ value: string; disabled: boolean }>;
    expect(select.props.value).toBe("Service Agreement"); expect(select.props.disabled).toBe(true);
    const locked = elements(tree).find(element => element.type === "fieldset" && elements(element.props.children).some(child => child.type === "legend" && textOf(child) === "Saved Contract Request details") && (element.props as { disabled?: boolean }).disabled) as ReactElement<{ disabled: boolean }>;
    expect(locked.props.disabled).toBe(true);
    expect(group().props.values).toMatchObject(saved);
    change({ custom_inteva_signatory: "legal@example.test" }); submit(); await settle();
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.create.mock.calls[0][0].payload).toEqual({});
    for (const field of Object.keys(saved)) expect(harness.create.mock.calls[0][0].payload).not.toHaveProperty(field);
  });
  it("validates mandatory metadata before any create call", async () => {
    submit(); await settle();
    expect(group().props.errors).toMatchObject({ contract_type: "Select a contract type.", description: "Contract Description is required.", contract_start_date: "Enter a valid Contract Start Date." });
    expect(harness.create).not.toHaveBeenCalled();
  });
  it("requires the Legal signatory before creating and sends it separately from Request data", async () => {
    validValues(); change({ custom_inteva_signatory: "" }); submit(); await settle();
    expect(group().props.errors).toMatchObject({ custom_inteva_signatory: "Legal Manager Signatory is required." });
    expect(group().props.errors).not.toHaveProperty("custom_risk_level");
    expect(harness.create).not.toHaveBeenCalled();
    change({ custom_inteva_signatory: "legal@example.test" }); submit(); await settle();
    expect(harness.create.mock.calls[0][0]).toMatchObject({ contract_fields: { custom_inteva_signatory: "legal@example.test" } });
    expect(harness.create.mock.calls[0][0].payload).not.toHaveProperty("custom_risk_level");
    expect(harness.create.mock.calls[0][0].payload).not.toHaveProperty("custom_inteva_signatory");
  });
  it("creates only the existing Request with user fields and the exact source revision", async () => {
    validValues(); change({ internal_notes: "Keep these notes", supplier: "tampered", custom_clm_data: "tampered", supporting_document: "/private/files/source.pdf" });
    submit(); await settle();
    expect(harness.create).toHaveBeenCalledOnce();
    const input = harness.create.mock.calls[0][0];
    expect(input).toMatchObject({ rfq: "RFQ-1", expected_modified: "award-revision", payload: { contract_type: "Supply / Procurement Contract", contract_purpose: "Production tooling", internal_notes: "Keep these notes" }, contract_fields: { custom_inteva_signatory: "legal@example.test" } });
    for (const key of ["supplier", "custom_rfq", "contract_value", "custom_clm_data", "supporting_document"]) expect(input.payload).not.toHaveProperty(key);
    expect(harness.saved).toHaveBeenCalledOnce();
  });
  it("deduplicates same-tick clicks while creation is pending", async () => {
    let finish!: (value: unknown) => void; harness.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    validValues(); const tree = renderEditor(); submit(tree); submit(tree);
    expect(harness.create).toHaveBeenCalledOnce();
    expect(textOf(renderEditor())).toContain("Creating…"); finish({ created: true }); await settle();
    expect(harness.saved).toHaveBeenCalledOnce();
  });
  it("keeps entered values after failure and permits safe retry", async () => {
    harness.create.mockRejectedValueOnce(new Error("Network unavailable."));
    validValues(); submit(); await settle();
    expect(textOf(renderEditor())).toContain("Network unavailable."); expect(group().props.values.contract_purpose).toBe("Production tooling");
    expect(harness.saved).not.toHaveBeenCalled();
    submit(); await settle(); expect(harness.create).toHaveBeenCalledTimes(2); expect(harness.saved).toHaveBeenCalledOnce();
  });
  it("explicitly refreshes a stale award, keeps entered details and sends the new revision", async () => {
    harness.create.mockRejectedValueOnce(new Error("The RFQ changed. Refresh its award."));
    validValues(); submit(); await settle();
    harness.summary.mockResolvedValue({ ...harness.context, rfq: { name: "RFQ-1", modified: "award-revision-2" }, prefill: { ...harness.context.prefill, supplier: "SUP-2", custom_supplier_quotation: "SQ-2" } });
    elements(renderEditor()).find(element => element.type === "button" && textOf(element) === "Refresh award")!.props.onClick!(); await settle();
    expect(textOf(renderEditor())).toContain("Award refreshed.");
    expect(group().props.values).toMatchObject({ supplier: "SUP-2", custom_supplier_quotation: "SQ-2", contract_purpose: "Production tooling", contract_type: "Supply / Procurement Contract" });
    submit(); await settle();
    expect(harness.create.mock.calls[1][0]).toMatchObject({ expected_modified: "award-revision-2", payload: { contract_purpose: "Production tooling" } });
  });
  it("refreshes the final award to USD 4,500 without replacing an entered 50,000 estimate", async () => {
    harness.context.locked_fields = harness.context.locked_fields.filter(field => field !== "estimated_contract_value");
    Object.assign(harness.context.prefill, { contract_value: 6000, currency: "EUR", estimated_contract_value: 30000 });
    validValues(); change({ estimated_contract_value: 50000 });
    harness.create.mockRejectedValueOnce(new Error("The RFQ changed. Refresh its award.")); submit(); await settle();
    harness.summary.mockResolvedValue({ ...harness.context, rfq: { name: "RFQ-1", modified: "award-revision-2" }, prefill: { ...harness.context.prefill, contract_value: 4500, currency: "USD" } });
    elements(renderEditor()).find(element => element.type === "button" && textOf(element) === "Refresh award")!.props.onClick!(); await settle();
    const refreshed = renderEditor();
    expect(textOf(refreshed)).toContain("USD 4,500"); expect(textOf(refreshed)).not.toContain("EUR 6,000");
    expect(group(refreshed).props.values).toMatchObject({ contract_value: 4500, currency: "USD", estimated_contract_value: 50000 });
    expect(group(refreshed).props.editableFields).not.toContain("contract_value");
    expect(group(refreshed).props.editableFields).not.toContain("currency");
    submit(refreshed); await settle();
    const payload = harness.create.mock.calls[1][0].payload;
    expect(payload.estimated_contract_value).toBe(50000);
    expect(payload).not.toHaveProperty("contract_value"); expect(payload).not.toHaveProperty("currency");
  });
  it("refreshes generated purpose and description for a changed award while retaining explicit inputs", async () => {
    harness.context.prefill.description = "Original awarded supplier description";
    change({ contract_type: "Service Agreement", contract_start_date: "2026-10-01", contract_end_date: "2027-09-30", internal_notes: "Keep these notes", custom_inteva_signatory: "legal@example.test" });
    harness.create.mockRejectedValueOnce(new Error("The RFQ changed. Refresh its award.")); submit(); await settle();
    harness.summary.mockResolvedValue({ ...harness.context, rfq: { name: "RFQ-1", modified: "award-revision-2" }, source: { award: "AWARD-2" }, prefill: { ...harness.context.prefill, supplier: "SUP-2", custom_supplier_quotation: "SQ-2", contract_purpose: "New award purpose", description: "New awarded supplier description" } });
    elements(renderEditor()).find(element => element.type === "button" && textOf(element) === "Refresh award")!.props.onClick!(); await settle();
    expect(textOf(renderEditor())).toContain("AWARD-2");
    expect(group().props.values).toMatchObject({ supplier: "SUP-2", custom_supplier_quotation: "SQ-2", contract_purpose: "New award purpose", description: "New awarded supplier description", contract_type: "Service Agreement", internal_notes: "Keep these notes" });
  });
  it("offers the existing Request when refresh discovers another user already created it", async () => {
    harness.create.mockRejectedValueOnce(new Error("Response unavailable.")); validValues(); submit(); await settle();
    harness.summary.mockResolvedValue({ ...harness.context, can_create: false, request: { name: "CR-existing", status: "Draft" }, can_open_request: true });
    elements(renderEditor()).find(element => element.type === "button" && textOf(element) === "Refresh award")!.props.onClick!(); await settle();
    expect(textOf(renderEditor())).toContain("Open Contract Request"); submit(); await settle(); expect(harness.create).toHaveBeenCalledOnce();
  });
  it("offers the same persisted Contract when a retry discovers successful creation", async () => {
    harness.create.mockRejectedValueOnce(new Error("The RFQ CLM transaction extension is not installed in ERPNext.")); validValues(); submit(); await settle();
    expect(textOf(renderEditor())).toContain("transaction extension is not installed");
    expect(harness.success).not.toHaveBeenCalled(); expect(harness.saved).not.toHaveBeenCalled();
    harness.summary.mockResolvedValue({ ...harness.context, can_create: false, contract: { name: "CON-existing", status: "Pending Legal" }, can_open_contract: true });
    elements(renderEditor()).find(element => element.type === "button" && textOf(element) === "Refresh award")!.props.onClick!(); await settle();
    expect(textOf(renderEditor())).toContain("Contract already exists."); expect(textOf(renderEditor())).toContain("View Contract");
    expect(group().props.values).toMatchObject({ custom_inteva_signatory: "legal@example.test" });
    submit(); await settle(); expect(harness.create).toHaveBeenCalledOnce();
  });
  it("refreshes a partial Contract and resumes the same creation endpoint with saved Request terms", async () => {
    harness.create.mockRejectedValueOnce(new Error("Contract saved, but its RFQ handoff is incomplete. Refresh and resume creation."));
    validValues(); const entered = structuredClone(group().props.values); submit(); await settle();
    harness.summary.mockResolvedValue({ ...harness.context, recovery_required: true, can_create: true, can_request: false, can_decide: false,
      rfq: { name: "RFQ-1", modified: "recovery-revision" }, decision: "Yes", request: { name: "CR-existing", status: "Pending Review" },
      contract: { name: "CON-existing", status: "Draft" }, can_open_contract: true,
      prefill: { ...harness.context.prefill, ...entered },
      locked_fields: [...new Set([...harness.context.locked_fields, "contract_type", "contract_purpose", "description", "contract_start_date", "contract_end_date"])],
    });
    elements(renderEditor()).find(element => element.type === "button" && textOf(element) === "Refresh award")!.props.onClick!(); await settle();
    const refreshed = renderEditor();
    expect(textOf(refreshed)).toContain("Resume Contract creation");
    expect(textOf(refreshed)).toContain("Contract creation is incomplete.");
    expect(textOf(refreshed)).not.toContain("Contract already exists.");
    expect(elements(refreshed).some(element => (element.props as { to?: string }).to === "/contracts/CON-existing")).toBe(true);
    expect(group(refreshed).props.values).toEqual(entered);
    expect(harness.success).not.toHaveBeenCalled(); expect(harness.saved).not.toHaveBeenCalled(); expect(harness.navigate).not.toHaveBeenCalled();
    submit(refreshed); await settle();
    expect(harness.create).toHaveBeenCalledTimes(2);
    expect(harness.create.mock.calls[1][0]).toEqual({ rfq: "RFQ-1", expected_modified: "recovery-revision", payload: {}, contract_fields: { custom_inteva_signatory: "legal@example.test" } });
    expect(harness.request).not.toHaveBeenCalled();
  });
  it("preserves manual edits when metadata refetches", () => {
    validValues(); harness.metadata = { ...harness.metadata, fields: { ...harness.metadata.fields, "Contract Request": [...harness.metadata.fields["Contract Request"]] } };
    expect(group().props.values.contract_purpose).toBe("Production tooling");
  });
  it("does not create with unavailable required metadata", async () => {
    harness.context.required_fields.push("missing_required_field"); const tree = renderEditor();
    expect(textOf(tree)).toContain("required Contract Request fields are unavailable"); submit(tree); await settle(); expect(harness.create).not.toHaveBeenCalled();
  });
  it("returns an existing Contract and Request without overwriting them", async () => {
    harness.create.mockResolvedValue({ created: false, request: { record: { name: "CR-existing", contract_purpose: "Existing manual content" } }, contract: { record: { name: "CON-existing" } }, summary: { ...harness.context, request: { name: "CR-existing" }, contract: { name: "CON-existing" } } });
    validValues(); submit(); await settle();
    expect(harness.saved.mock.calls[0][0]).toMatchObject({ created: false, request: { record: { name: "CR-existing", contract_purpose: "Existing manual content" } }, contract: { record: { name: "CON-existing" } } });
  });
});
