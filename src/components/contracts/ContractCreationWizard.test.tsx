import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmDetail, ClmField, ClmMetadata } from "../../api/clm";

const harness = vi.hoisted(() => ({
  capture: false, cursor: 0, changed: false,
  slots: [] as Array<{ value?: unknown; dependencies?: readonly unknown[] }>,
  effects: [] as Array<() => unknown>,
  metadata: {} as ClmMetadata,
  params: new URLSearchParams(),
  action: vi.fn(), prefill: vi.fn(), navigate: vi.fn(), success: vi.fn(), error: vi.fn(), notice: vi.fn(),
  qc: { invalidateQueries: vi.fn(async () => undefined) },
}));

// This repository uses Node tests without a DOM renderer. Exercise real wizard
// handlers across persistent hook state, following the ECR action-panel tests.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      if (!harness.capture) return actual.useState(initial);
      const slot = harness.cursor++;
      if (!(slot in harness.slots)) harness.slots[slot] = { value: typeof initial === "function" ? initial() : initial };
      return [harness.slots[slot].value, (next: unknown) => {
        const value = typeof next === "function" ? next(harness.slots[slot].value) : next;
        if (!Object.is(value, harness.slots[slot].value)) harness.changed = true;
        harness.slots[slot].value = value;
      }];
    },
    useRef: (initial: unknown) => {
      if (!harness.capture) return actual.useRef(initial);
      const slot = harness.cursor++;
      if (!(slot in harness.slots)) harness.slots[slot] = { value: { current: initial } };
      return harness.slots[slot].value;
    },
    useEffect: (effect: () => unknown, dependencies?: readonly unknown[]) => {
      if (!harness.capture) return actual.useEffect(effect as () => void, dependencies);
      const slot = harness.cursor++;
      const previous = harness.slots[slot];
      if (!previous || !dependencies || dependencies.some((value, index) => !Object.is(value, previous.dependencies?.[index]))) harness.effects.push(effect);
      harness.slots[slot] = { dependencies };
    },
  };
});
vi.mock("react-router-dom", () => ({
  useNavigate: () => harness.navigate,
  useSearchParams: () => [harness.params],
  Link: ({ children, to, ...props }: { children?: ReactNode; to: string }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryKey[1] === "metadata" ? harness.metadata : [], isLoading: false, isError: false }),
  useQueryClient: () => harness.qc,
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("react-hot-toast", () => ({ default: Object.assign(harness.notice, { success: harness.success, error: harness.error }) }));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (value: { user: { email: string } }) => unknown) => select({ user: { email: "buyer@example.test" } }) }));
vi.mock("../../api/legalDocsStorage", () => ({ uploadFileToERPNextDetailed: vi.fn() }));
vi.mock("../../api/clm", () => ({
  applyClmAction: harness.action, prefillClm: harness.prefill,
  getClmMetadata: vi.fn(), lookupClm: vi.fn(), clmViewerKey: () => "test-session",
  clmError: (error: Error) => error.message,
  clmRecordRoute: (_doctype: string, name: string) => `/contracts/${name}`,
}));

import ContractCreationWizard, { ContractCreationReview, ContractCreationStepper } from "./ContractCreationWizard";
import ClmFields from "./ClmFields";
import ClmSourcePicker from "./ClmSourcePicker";
import { groupContractFields } from "./contractCreationSteps";

const fields: ClmField[] = [
  { fieldname: "party_type", label: "Party Type", fieldtype: "Select", options: "Supplier\nCustomer", reqd: 1 },
  { fieldname: "party_name", label: "Party Name", fieldtype: "Dynamic Link", options: "party_type", reqd: 1 },
  { fieldname: "custom_supplier", label: "Supplier", fieldtype: "Link", options: "Supplier", reqd: 1 },
  { fieldname: "party_user", label: "Party User", fieldtype: "Link", options: "User" },
  { fieldname: "custom_inteva_signatory", label: "Inteva Signatory", fieldtype: "Link", options: "User" },
  { fieldname: "contract_template", label: "Contract Template", fieldtype: "Link", options: "Contract Template" },
  { fieldname: "custom_contract_request", label: "Contract Request", fieldtype: "Link", options: "Contract Request" },
  { fieldname: "custom_contract_title", label: "Contract Title", fieldtype: "Data", reqd: 1 },
  { fieldname: "custom_contract_type", label: "Contract Type", fieldtype: "Select", options: "NDA\nSupplier Agreement" },
  { fieldname: "start_date", label: "Start Date", fieldtype: "Date" },
  { fieldname: "end_date", label: "End Date", fieldtype: "Date" },
  { fieldname: "contract_terms", label: "Contract Terms", fieldtype: "Text Editor", reqd: 1 },
  { fieldname: "custom_auto_renewal", label: "Auto Renewal", fieldtype: "Check" },
  { fieldname: "custom_renewal_notice_days", label: "Renewal Notice (Days)", fieldtype: "Int" },
  { fieldname: "custom_contract_value", label: "Contract Value", fieldtype: "Currency" },
  { fieldname: "custom_currency", label: "Currency", fieldtype: "Link", options: "Currency" },
  { fieldname: "custom_payment_terms_description", label: "Payment Terms Description", fieldtype: "Small Text" },
  { fieldname: "custom_risk_level", label: "Risk Level", fieldtype: "Select", options: "Low\nMedium\nHigh\nCritical", reqd: 1 },
  { fieldname: "custom_sla__kpi_commitments", label: "SLA & KPI Commitments", fieldtype: "Small Text" },
  { fieldname: "custom_quality_requirements", label: "Quality Requirements", fieldtype: "Small Text" },
  { fieldname: "fulfilment_terms", label: "Fulfilment Terms", fieldtype: "Table", options: "Contract Fulfilment Checklist" },
  { fieldname: "custom_contract_document", label: "Supporting Documents", fieldtype: "Attach" },
  { fieldname: "custom_current_version", label: "Version", fieldtype: "Data", read_only: 1, default: "1.0" },
];
const valid: Record<string, unknown> = {
  party_type: "Supplier", party_name: "SUP-1", custom_supplier: "SUP-1", party_user: "supplier@example.test",
  custom_inteva_signatory: "signer@example.test", custom_contract_title: "Tooling supply agreement",
  custom_contract_type: "Supplier Agreement", start_date: "2026-10-01", end_date: "2027-09-30",
  contract_terms: "Agreed contract terms.", custom_currency: "USD", custom_contract_value: 25000,
  custom_risk_level: "Medium", custom_auto_renewal: 1, custom_renewal_notice_days: 60,
  custom_sla__kpi_commitments: "Delivery within the agreed lead time.", custom_quality_requirements: "Approved material specifications.",
};
type Element = ReactElement<{
  children?: ReactNode; type?: string; disabled?: boolean; [key: string]: unknown;
  onClick?: () => unknown; onSubmit?: (event: { preventDefault: () => void }) => unknown;
}>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement(node) ? textOf((node as Element).props.children) : "";
}
function renderWizard(): ReactNode {
  let tree: ReactNode;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    harness.cursor = 0; harness.changed = false; harness.effects = []; harness.capture = true;
    try { tree = ContractCreationWizard(); } finally { harness.capture = false; }
    for (const effect of harness.effects) effect();
    if (!harness.changed) return tree;
  }
  throw new Error("Wizard did not settle after its effects.");
}
function button(tree: ReactNode, label: string): Element {
  const result = elements(tree).find(element => element.type === "button" && textOf(element) === label);
  expect(result, `button ${label}`).toBeDefined(); return result!;
}
function component<T>(tree: ReactNode, type: unknown): ReactElement<T> {
  const result = elements(tree).find(element => element.type === type);
  expect(result, "component is rendered").toBeDefined(); return result as unknown as ReactElement<T>;
}
function fieldGroup(tree = renderWizard()) { return component<Parameters<typeof ClmFields>[0]>(tree, ClmFields); }
function sourcePicker(tree = renderWizard()) { return component<Parameters<typeof ClmSourcePicker>[0]>(tree, ClmSourcePicker); }
function stepper(tree = renderWizard()) { return component<Parameters<typeof ContractCreationStepper>[0]>(tree, ContractCreationStepper); }
function change(patch: Record<string, unknown>) {
  const group = fieldGroup(); group.props.onChange({ ...group.props.values, ...patch });
}
function next() {
  const form = elements(renderWizard()).find(element => element.type === "form")!;
  form.props.onSubmit!({ preventDefault: vi.fn() });
}
function goToFinal() { for (let index = 0; index < 4; index += 1) next(); expect(stepper().props.current).toBe(4); }
async function settle() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
async function saveDraft() { button(renderWizard(), "Save Draft").props.onClick!(); await settle(); }
function saved(revision: string, status = "Draft"): ClmDetail {
  return { doctype: "Contract", record: { name: "CON-SAVED", modified: revision, custom_contract_status: status }, actions: status === "Draft" ? [{ action: "submit_review", label: "Submit for Review" }] : [], approvals: [], audit: [], versions: [] };
}

describe("New Contract wizard interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks(); harness.capture = false; harness.cursor = 0; harness.slots = []; harness.effects = []; harness.params = new URLSearchParams();
    harness.metadata = { fields: { Contract: fields.map(field => ({ ...field })) }, editableFields: { Contract: fields.filter(field => !field.read_only).map(field => field.fieldname) }, allowedCreate: ["Contract"] };
    let revision = 0;
    harness.action.mockReset().mockImplementation(async (input: { action: string }) => saved(`revision-${++revision}`, input.action === "submit_review" ? "Under Review" : "Draft"));
    harness.prefill.mockReset().mockResolvedValue({});
  });

  it("validates only the current stage and keeps future-stage errors absent", () => {
    next();
    expect(stepper().props.current).toBe(0);
    expect(fieldGroup().props.errors).toMatchObject({ party_name: "Party Name is required.", custom_supplier: "Supplier is required.", custom_inteva_signatory: "Inteva Signatory is required." });
    expect(fieldGroup().props.errors).not.toHaveProperty("contract_terms");
    expect(fieldGroup().props.errors).not.toHaveProperty("custom_currency");
    change({ party_name: "SUP-1", custom_supplier: "SUP-1", custom_inteva_signatory: "signer@example.test" });
    next();
    expect(stepper().props.current).toBe(1);
    expect(fieldGroup().props.errors).toEqual({});
    expect(harness.action).not.toHaveBeenCalled();
  });

  it("retains entered fields and the source selection across Next and Back", () => {
    change(valid);
    sourcePicker().props.onSelectionChange!({ doctype: "Purchase Order", name: "PO-42" });
    sourcePicker().props.onApply({ custom_purchase_order: "PO-42" });
    next(); change({ contract_terms: "Updated contract wording." });
    button(renderWizard(), "Back").props.onClick!();
    expect(fieldGroup().props.values).toMatchObject({ party_name: "SUP-1", contract_terms: "Updated contract wording.", custom_purchase_order: "PO-42" });
    expect(sourcePicker().props.selection).toEqual({ doctype: "Purchase Order", name: "PO-42" });
    expect(stepper().props.reached).toBe(1);
  });

  it("allows editing completed stages while retaining later commercial information", () => {
    change(valid); goToFinal();
    const review = component<Parameters<typeof ContractCreationReview>[0]>(renderWizard(), ContractCreationReview);
    review.props.onEdit(0);
    expect(stepper().props.current).toBe(0);
    change({ party_user: "replacement@example.test" });
    stepper().props.onSelect(4);
    expect(stepper().props.current).toBe(4);
    expect(fieldGroup().props.values).toMatchObject({ party_user: "replacement@example.test", custom_contract_value: 25000, custom_currency: "USD" });
  });

  it("validates the whole form on final submission and opens the first invalid stage", () => {
    change(valid); goToFinal();
    // A metadata refresh can make a previously optional field mandatory while
    // the user is reviewing the form; final validation must recheck every stage.
    harness.metadata = { ...harness.metadata, fields: { Contract: harness.metadata.fields.Contract.map(field => field.fieldname === "custom_payment_terms_description" ? { ...field, reqd: 1 } : field) } };
    next();
    expect(stepper().props.current).toBe(2);
    expect(fieldGroup().props.errors).toHaveProperty("custom_payment_terms_description", "Payment Terms Description is required.");
    expect(harness.action).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2, 3, 4])("saves a draft from stage %s without submitting or navigating away", async stage => {
    change({ ...valid, custom_final_version_locked: 1, custom_current_version: "tampered", name: "injected-name" });
    for (let index = 0; index < stage; index += 1) next();
    await saveDraft();
    expect(harness.action).toHaveBeenCalledTimes(1);
    expect(harness.action).toHaveBeenCalledWith({ doctype: "Contract", action: "save", payload: expect.objectContaining(valid) });
    const input = harness.action.mock.calls[0][0];
    expect(input.payload).not.toHaveProperty("custom_final_version_locked"); expect(input.payload).not.toHaveProperty("custom_current_version"); expect(input.payload).not.toHaveProperty("name");
    expect(stepper().props.current).toBe(stage);
    expect(fieldGroup().props.name).toBe("CON-SAVED");
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.success).toHaveBeenCalledWith("Draft saved. You can continue editing.");
  });

  it("updates the same draft using each returned revision on subsequent saves", async () => {
    change(valid); await saveDraft();
    change({ custom_contract_title: "Revised tooling agreement" }); await saveDraft();
    await saveDraft();
    expect(harness.action.mock.calls[0][0]).not.toHaveProperty("name");
    expect(harness.action.mock.calls[1][0]).toMatchObject({ action: "save", name: "CON-SAVED", expected_modified: "revision-1", payload: { custom_contract_title: "Revised tooling agreement" } });
    expect(harness.action.mock.calls[2][0]).toMatchObject({ action: "save", name: "CON-SAVED", expected_modified: "revision-2" });
  });

  it("saves current values then submits the exact freshly saved revision", async () => {
    change(valid); goToFinal(); next(); await settle();
    expect(harness.action.mock.calls.map(call => call[0].action)).toEqual(["save", "submit_review"]);
    expect(harness.action.mock.calls[1][0]).toEqual({ doctype: "Contract", action: "submit_review", name: "CON-SAVED", expected_modified: "revision-1" });
    expect(harness.navigate).toHaveBeenCalledWith("/contracts/CON-SAVED");
    expect(harness.success).toHaveBeenCalledWith("Contract submitted for review.");
  });

  it("retains the saved identity and entries after failed submission, then retries without creating another Contract", async () => {
    harness.action.mockReset().mockResolvedValueOnce(saved("saved-revision")).mockRejectedValueOnce(new Error("Approval matrix is not configured.")).mockResolvedValueOnce(saved("reviewed-revision", "Under Review"));
    change(valid); goToFinal(); next(); await settle();
    expect(fieldGroup().props.name).toBe("CON-SAVED");
    expect(fieldGroup().props.values).toMatchObject(valid);
    expect(textOf(renderWizard())).toContain("Approval matrix is not configured.");
    expect(harness.navigate).not.toHaveBeenCalled();
    next(); await settle();
    expect(harness.action.mock.calls.map(call => call[0].action)).toEqual(["save", "submit_review", "submit_review"]);
    expect(harness.action.mock.calls[2][0]).toMatchObject({ name: "CON-SAVED", expected_modified: "saved-revision" });
  });

  it("saves edits made after a failed submission against the existing draft before retrying review", async () => {
    harness.action.mockReset().mockResolvedValueOnce(saved("one")).mockRejectedValueOnce(new Error("Routing failed.")).mockResolvedValueOnce(saved("two")).mockResolvedValueOnce(saved("three", "Under Review"));
    change(valid); goToFinal(); next(); await settle();
    component<Parameters<typeof ContractCreationReview>[0]>(renderWizard(), ContractCreationReview).props.onEdit(1);
    change({ contract_terms: "Corrected wording after review failure." });
    stepper().props.onSelect(4); next(); await settle();
    expect(harness.action.mock.calls[2][0]).toMatchObject({ action: "save", name: "CON-SAVED", expected_modified: "one", payload: { contract_terms: "Corrected wording after review failure." } });
    expect(harness.action.mock.calls[3][0]).toMatchObject({ action: "submit_review", name: "CON-SAVED", expected_modified: "two" });
    expect(harness.action.mock.calls.filter(call => !call[0].name)).toHaveLength(1);
  });

  it("keeps backend draft validation failures visible without clearing the form or inventing required data", async () => {
    harness.action.mockRejectedValueOnce(new Error("contract terms is required."));
    change({ party_name: "SUP-1", custom_supplier: "SUP-1" }); await saveDraft();
    expect(harness.action.mock.calls[0][0].payload).not.toHaveProperty("contract_terms");
    expect(fieldGroup().props.values).toMatchObject({ party_name: "SUP-1", custom_supplier: "SUP-1" });
    expect(fieldGroup().props.name).toBeUndefined();
    expect(textOf(renderWizard())).toContain("contract terms is required.");
    expect(harness.success).not.toHaveBeenCalled();
  });

  it("preserves template child rows and other entered values through source loading and save", async () => {
    const fulfilment = [{ requirement: "Supplier qualification evidence", fulfilled: 0 }];
    harness.prefill.mockResolvedValue({ contract_template: "TEMPLATE-1", contract_terms: "Template terms.", fulfilment_terms: fulfilment });
    change({ ...valid, contract_template: "TEMPLATE-1" });
    button(renderWizard(), "Load template").props.onClick!(); await settle();
    expect(harness.prefill).toHaveBeenCalledWith("Contract", "Contract Template", "TEMPLATE-1");
    await saveDraft();
    expect(harness.action.mock.calls[0][0].payload).toMatchObject({ fulfilment_terms: fulfilment, contract_terms: "Template terms.", custom_currency: "USD", custom_quality_requirements: valid.custom_quality_requirements });
  });

  it("loads a route-selected source once and preserves its values during stage navigation", async () => {
    harness.params = new URLSearchParams({ source_doctype: "Contract Request", source_name: "REQ-1" });
    harness.prefill.mockResolvedValue({ ...valid, custom_contract_request: "REQ-1" });
    renderWizard(); await settle();
    expect(fieldGroup().props.values).toMatchObject({ ...valid, custom_contract_request: "REQ-1" });
    next(); button(renderWizard(), "Back").props.onClick!();
    expect(sourcePicker().props.selection).toEqual({ doctype: "Contract Request", name: "REQ-1" });
    expect(harness.prefill).toHaveBeenCalledTimes(1);
  });

  it("hands RFQ source URLs to the award workflow without generic prefill or creation", async () => {
    harness.params = new URLSearchParams({ source_doctype: "Request for Quotation", source_name: "RFQ-1" });
    renderWizard(); await settle();
    const tree = renderWizard();
    expect(textOf(tree)).toContain("Create Contract from RFQ Award");
    expect(sourcePicker(tree).props.selection).toEqual({ doctype: "Request for Quotation", name: "RFQ-1" });
    expect(elements(tree).some(element => element.type === "form" || element.type === ClmFields)).toBe(false);
    expect(textOf(tree)).not.toContain("Save Draft");
    expect(harness.prefill).not.toHaveBeenCalled();
    expect(harness.action).not.toHaveBeenCalled();
  });

  it("hands selected RFQs to their award but preserves standalone inputs when the source is cleared", async () => {
    change(valid);
    sourcePicker().props.onSelectionChange!({ doctype: "Request for Quotation", name: "RFQ-2" });
    const handoff = renderWizard();
    expect(elements(handoff).some(element => element.type === "form")).toBe(false);
    expect(textOf(handoff)).not.toContain("Save Draft");
    expect(harness.prefill).not.toHaveBeenCalled();
    sourcePicker(handoff).props.onSelectionChange!({ doctype: "Contract Request", name: "" });
    expect(fieldGroup().props.values).toMatchObject(valid);
    await saveDraft();
    expect(harness.action).toHaveBeenCalledOnce();
  });

  it.each(["Supplier Quotation", "Purchase Order", "RFP", "RFP Response"])("preserves generic %s source loading", async source => {
    harness.params = new URLSearchParams({ source_doctype: source, source_name: "SOURCE-1" });
    harness.prefill.mockResolvedValue({ ...valid });
    renderWizard(); await settle();
    expect(harness.prefill).toHaveBeenCalledWith("Contract", source, "SOURCE-1");
    expect(fieldGroup().props.values).toMatchObject(valid);
    expect(button(renderWizard(), "Save Draft")).toBeDefined();
    expect(sourcePicker().props.selection).toEqual({ doctype: source, name: "SOURCE-1" });
  });

  it("blocks navigation, draft save and submission while a document upload is pending", async () => {
    change(valid); goToFinal(); await saveDraft(); harness.action.mockClear();
    fieldGroup().props.onUploadBusyChange!(true);
    const busy = renderWizard();
    expect(button(busy, "Save Draft").props.disabled).toBe(true);
    expect(button(busy, "Submit for Review").props.disabled).toBe(true);
    expect(button(busy, "Back").props.disabled).toBe(true);
    expect(elements(busy).find(element => element.type === "fieldset")?.props.disabled).toBe(true);
    button(busy, "Save Draft").props.onClick!(); next(); button(busy, "Back").props.onClick!(); await settle();
    expect(harness.action).not.toHaveBeenCalled(); expect(stepper().props.current).toBe(4);
    fieldGroup().props.onUploadBusyChange!(false);
    change({ custom_contract_document: "/private/files/contract.pdf" }); await saveDraft();
    expect(harness.action).toHaveBeenCalledWith(expect.objectContaining({ name: "CON-SAVED", payload: expect.objectContaining({ custom_contract_document: "/private/files/contract.pdf" }) }));
  });

  it("prevents duplicate saves before React renders the pending state", async () => {
    let resolve!: (value: ClmDetail) => void;
    harness.action.mockImplementationOnce(() => new Promise<ClmDetail>(done => { resolve = done; }));
    change(valid);
    const save = button(renderWizard(), "Save Draft"); save.props.onClick!(); save.props.onClick!();
    expect(harness.action).toHaveBeenCalledTimes(1);
    expect(elements(renderWizard()).find(element => element.type === "fieldset")?.props.disabled).toBe(true);
    resolve(saved("one")); await settle();
    expect(button(renderWizard(), "Save Draft").props.disabled).toBe(false);
  });

  it("honors the server's create permission and returned submission actions", async () => {
    harness.metadata.allowedCreate = [];
    expect(textOf(renderWizard())).toContain("Your role cannot create this record.");
    expect(elements(renderWizard()).some(element => element.type === "form")).toBe(false);
    harness.metadata.allowedCreate = ["Contract"];
    harness.action.mockResolvedValueOnce({ ...saved("one"), actions: [] });
    change(valid); goToFinal(); next(); await settle();
    expect(harness.action).toHaveBeenCalledTimes(1);
    expect(textOf(renderWizard())).toContain("This draft cannot be submitted from its current stage.");
    expect(harness.navigate).not.toHaveBeenCalled();
  });

  it("shows the permission message when the server omits Contract fields for a non-creator", () => {
    harness.metadata = { fields: {}, editableFields: {}, allowedCreate: [] };
    const tree = renderWizard();
    expect(textOf(tree)).toContain("Your role cannot create this record.");
    expect(textOf(tree)).not.toContain("Loading contract fields");
    expect(elements(tree).some(element => element.type === "form")).toBe(false);
  });

  it("shows an explicit field-loading error instead of an endless spinner when an authorized creator receives empty metadata", () => {
    harness.metadata = { fields: { Contract: [] }, editableFields: { Contract: [] }, allowedCreate: ["Contract"] };
    const tree = renderWizard();
    const alerts = elements(tree).filter(element => element.props.role === "alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.map(textOf).join(" ")).toMatch(/fields|schema/i);
    expect(textOf(tree)).not.toContain("Loading contract fields");
    expect(elements(tree).some(element => element.type === "form")).toBe(false);
  });
});

describe("Contract creation structure", () => {
  it("renders five responsive stages with completed, current and inactive states", () => {
    const html = renderToStaticMarkup(<ContractCreationStepper current={1} reached={1} completed={[true, false, false, false, false]} busy={false} onSelect={() => undefined} />);
    expect(html).toContain("sm:grid-cols-5"); expect(html).toContain("grid-cols-1");
    expect(html).toContain('aria-label="1. Source &amp; Parties, completed"');
    expect(html).toContain('aria-current="step"');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).not.toContain("min-w-[");
  });

  it("summarizes entered commercial, performance, child-row and document information without unsafe HTML", () => {
    const html = renderToStaticMarkup(<ContractCreationReview groups={groupContractFields(fields.filter(field => !field.read_only))} values={{ ...valid, contract_terms: '<img src=x onerror="attack()">Visible wording', fulfilment_terms: [{ requirement: "Qualification evidence" }], custom_contract_document: "/private/files/terms.pdf" }} busy={false} onEdit={() => undefined} />);
    expect(html).toContain("Source &amp; parties"); expect(html).toContain("Contract dates &amp; details"); expect(html).toContain("Commercial terms"); expect(html).toContain("Performance &amp; quality");
    expect(html).toContain("Qualification evidence"); expect(html).toContain("terms.pdf"); expect(html).toContain("25000"); expect(html).toContain("Visible wording");
    expect(html).not.toContain("<img"); expect(html).not.toContain("attack()");
    expect(html.match(/<details/g)).toHaveLength(5); expect(html).not.toContain("<textarea");
  });
});
