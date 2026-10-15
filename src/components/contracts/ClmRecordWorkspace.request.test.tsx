import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmDetail, ClmField } from "../../api/clm";

type DetailQueryOptions = {
  queryKey: unknown[]; queryFn: () => Promise<unknown>;
  refetchInterval?: (query: { state: { data?: ClmDetail } }) => number | false;
  refetchIntervalInBackground?: boolean;
  refetchOnWindowFocus?: (query: { state: { data?: ClmDetail } }) => boolean | "always";
  refetchOnReconnect?: (query: { state: { data?: ClmDetail } }) => boolean;
};
type WorkspaceAction = { action: string; comment?: string; payload?: Record<string, unknown>; expectedModified?: string };
type WorkspaceMutation = { mutationFn: (input: WorkspaceAction) => Promise<ClmDetail>; onSuccess: (result: ClmDetail, input: WorkspaceAction) => void };
const harness = vi.hoisted(() => ({
  index: 0, slots: [] as unknown[], dependencies: new Map<number, unknown[]>(), effects: [] as Array<() => void>,
  detail: undefined as ClmDetail | undefined, error: undefined as Error | undefined,
  metadata: { fields: {} as Record<string, ClmField[]>, allowedCreate: [] as string[] },
  queries: [] as DetailQueryOptions[],
  mutations: [] as WorkspaceMutation[],
  navigate: vi.fn(), errorToast: vi.fn(), success: vi.fn(), action: vi.fn(), mutate: vi.fn(), refetch: vi.fn(), getDetail: vi.fn(),
  section: { scrollIntoView: vi.fn(), focus: vi.fn() },
  qc: { setQueryData: vi.fn(), invalidateQueries: vi.fn(), removeQueries: vi.fn() },
}));

// Exercise the callbacks and effects without requiring a browser or creating any records.
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[index], (value: unknown) => { harness.slots[index] = typeof value === "function" ? value(harness.slots[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.slots)) harness.slots[index] = { current: initial };
    return harness.slots[index];
  },
  useEffect: (effect: () => void, dependencies: unknown[]) => {
    const index = harness.index++, previous = harness.dependencies.get(index);
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) harness.effects.push(effect);
    harness.dependencies.set(index, dependencies);
  },
}));
vi.mock("react-router-dom", () => ({ Link: () => null, useNavigate: () => harness.navigate }));
vi.mock("react-hot-toast", () => ({ default: { error: harness.errorToast, success: harness.success } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: DetailQueryOptions) => {
    harness.queries.push(options);
    return options.queryKey[1] === "metadata"
      ? { data: harness.metadata, isLoading: false, isError: false }
      : { data: harness.error ? undefined : harness.detail, isLoading: false, isError: !!harness.error, error: harness.error, refetch: harness.refetch };
  },
  useQueryClient: () => harness.qc,
  useMutation: (options: WorkspaceMutation) => { harness.mutations.push(options); return { isPending: false, mutate: harness.mutate, mutateAsync: harness.mutate }; },
}));
vi.mock("../../api/clm", () => ({
  applyClmAction: harness.action, getClmDetail: harness.getDetail, getClmMetadata: vi.fn(), prefillClm: vi.fn(),
  clmError: (error: unknown) => error instanceof Error ? error.message : "Unable to load Contract Request.",
  clmViewerKey: () => "procurement-team-session",
  clmRecordRoute: (doctype: string, name: string) => `${doctype === "Contract Request" ? "/contract-requests" : "/contracts"}/${name}`,
  clmStatus: (record: Record<string, unknown>) => record.request_status || record.custom_contract_status || "Draft",
  clmTitle: (record: Record<string, unknown>) => record.contract_purpose || record.name,
}));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: "procurement_team" } }) }));
vi.mock("./ClmFields", () => ({ default: () => null, CLM_BUTTON: "button", CLM_INPUT: "input", CLM_PRIMARY: "primary", ClmLinkInput: () => null, clmFormPayload: vi.fn(), fieldLabel: vi.fn(), initialClmValues: vi.fn() }));
vi.mock("./ClmActionPanel", () => ({ default: () => null }));
vi.mock("./ClmDocuments", () => ({ default: () => null }));
vi.mock("./ClmMatrixFields", () => ({ default: () => null }));
vi.mock("./ClmAlerts", () => ({ default: () => null }));
vi.mock("./ClmSourceTraceability", () => ({ default: () => null }));
vi.mock("./RfqContractWorkflow", () => ({ default: () => null, rfqContractPhase: vi.fn() }));
vi.mock("../sourcing/RfqContractPanel", () => ({ default: () => null }));
vi.mock("./ProcurementRequestWorkspace", () => ({ default: () => null }));

import ClmRecordWorkspace from "./ClmRecordWorkspace";
import RfqContractPanel from "../sourcing/RfqContractPanel";
import ProcurementRequestWorkspace from "./ProcurementRequestWorkspace";
import ClmFields from "./ClmFields";
import ClmDocuments from "./ClmDocuments";
import RfqContractSigning, { RfqSignatureApprovals } from "./RfqContractSigning";

type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement(root)) return [];
  const element = root as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function label(root: ReactNode): string {
  return typeof root === "string" ? root : Array.isArray(root) ? root.map(label).join("") : isValidElement(root) ? label((root.props as { children?: ReactNode }).children) : "";
}
function request(): ClmDetail {
  return { doctype: "Contract Request", record: {
    name: "CTRQ-2026-0002", modified: "2026-09-24 10:00:00", request_status: "Pending Review", custom_rfq: "PUR-RFQ-2026-00099",
    department: "Production - NSGAI", requester: "Administrator", contract_purpose: "Contract request for RFQ PUR-RFQ-2026-00099",
    custom_clm_data: JSON.stringify({
      rfq_source: { rfq: "PUR-RFQ-2026-00099", stage: "rfq_created", contract_required: true },
      rfq_request_workflow: { version: 1, phase: "procurement_team", assigned_role: "procurement_team", status: "Pending", current_stage: "Procurement" },
      approvals: [{ role: "procurement_team", stage: 0, status: "Pending" }],
    }),
  }, actions: [], approvals: [], versions: [], audit: [] };
}
function render(supplier = false, doctype = "Contract Request", name = "CTRQ-2026-0002"): Node[] {
  harness.index = 0;
  const tree = nodes(ClmRecordWorkspace({ doctype, name, supplier }));
  const section = tree.find(node => node.props.role === "tabpanel");
  if (section?.props.ref) (section.props.ref as { current: unknown }).current = harness.section;
  for (const effect of harness.effects.splice(0)) effect();
  return tree;
}
function open(tree: Node[], name = "CTRQ-2026-0002") {
  const panel = tree.find(node => node.type === RfqContractPanel)!;
  (panel.props.onOpenRequest as (name: string) => void)(name);
}
function tab(tree: Node[], name: string) { return tree.find(node => node.props.role === "tab" && label(node.props.children as ReactNode) === name); }

beforeEach(() => {
  vi.clearAllMocks(); harness.index = 0; harness.slots = []; harness.dependencies.clear(); harness.effects = [];
  harness.detail = request(); harness.error = undefined; harness.queries = []; harness.mutations = [];
  harness.metadata = { fields: {}, allowedCreate: [] };
  harness.getDetail.mockImplementation(async () => harness.detail);
});

describe("RFQ-linked Contract authoring preserves awarded commercial fields", () => {
  it.each([true, false])("keeps award value/currency visible and read-only only for RFQ-linked Contracts: %s", linked => {
    harness.detail = { doctype: "Contract", record: { name: "CON-1", modified: "c1", custom_contract_status: "Draft", custom_contract_value: 4500, custom_currency: "USD", contract_terms: "Editable contract terms", ...(linked ? { custom_rfq: "RFQ-1" } : {}) }, actions: [{ action: "save", label: "Save changes" }], editable_fields: ["custom_contract_value", "custom_currency", "contract_terms"] };
    harness.metadata.fields.Contract = [{ fieldname: "custom_contract_value", fieldtype: "Currency" }, { fieldname: "custom_currency", fieldtype: "Link", options: "Currency" }, { fieldname: "contract_terms", fieldtype: "Text" }];
    const original = structuredClone(harness.detail.record);
    const initial = render(false, "Contract", "CON-1");
    (tab(initial, "Authoring")!.props.onClick as () => void)();
    const tree = render(false, "Contract", "CON-1");
    const authoring = tree.find(node => node.type === ClmFields)!;
    expect(authoring.props.fields).toEqual(harness.metadata.fields.Contract);
    expect(authoring.props.values).toMatchObject({ custom_contract_value: 4500, custom_currency: "USD", contract_terms: "Editable contract terms" });
    expect(authoring.props.readOnlyFields).toEqual(linked ? ["custom_contract_value", "custom_currency"] : undefined);
    expect(authoring.props.editableFields).toEqual(harness.detail.editable_fields);
    expect(harness.detail.record).toEqual(original);
    expect(harness.action).not.toHaveBeenCalled(); expect(harness.mutate).not.toHaveBeenCalled();
  });
});

describe("RFQ Contract lifecycle refresh", () => {
  function contract(phase = "signature", status = "Pending Signature"): ClmDetail {
    return { doctype: "Contract", record: { name: "CON-1", modified: "original editing revision", custom_rfq: "RFQ-1", custom_contract_status: status, contract_terms: "Saved terms", custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase } }) }, actions: [], approvals: [], versions: [], audit: [] };
  }
  const detailQuery = () => harness.queries.filter(query => query.queryKey[1] === "detail").at(-1)!;
  const currentQuery = () => ({ state: { data: harness.detail } });

  it.each([["legal_review", "Pending Legal"], ["signature", "Pending Signature"], ["finance_review", "Pending Finance"], ["procurement", "Executed"]])("refreshes the saved %s phase while the internal detail stays open", (phase, status) => {
    harness.detail = contract(phase, status);
    render(false, "Contract", "CON-1");
    expect(detailQuery().refetchInterval!(currentQuery())).toBe(15_000);
    expect(detailQuery().refetchIntervalInBackground).toBe(false);
    expect(detailQuery().refetchOnWindowFocus!(currentQuery())).toBe("always");
    expect(harness.action).not.toHaveBeenCalled(); expect(harness.mutate).not.toHaveBeenCalled();
  });

  it.each(["draft", "completed", "rejected", "invalid"])("does not poll the inactive %s phase", phase => {
    harness.detail = contract(phase);
    render(false, "Contract", "CON-1");
    expect(detailQuery().refetchInterval!(currentQuery())).toBe(false);
  });

  it.each(["Cancelled", "Terminated", "Expired", "Closed"])("does not poll a native %s Contract", status => {
    harness.detail = contract("procurement", status);
    render(false, "Contract", "CON-1");
    expect(detailQuery().refetchInterval!(currentQuery())).toBe(false);
  });

  it.each(["supplier", "standalone", "request", "termination", "cancelled_docstatus", "malformed"])("does not add lifecycle polling to %s records", kind => {
    harness.detail = contract();
    if (kind === "standalone") delete harness.detail.record.custom_rfq;
    if (kind === "request") harness.detail = request();
    if (kind === "termination") harness.detail.record.custom_clm_data = JSON.stringify({ rfq_workflow: { version: 1, phase: "legal_review" }, termination: { reason: "Review termination" } });
    if (kind === "cancelled_docstatus") harness.detail.record.docstatus = 2;
    if (kind === "malformed") harness.detail.record.custom_clm_data = "{";
    render(kind === "supplier", kind === "request" ? "Contract Request" : "Contract", "CON-1");
    expect(detailQuery().refetchInterval!(currentQuery())).toBe(false);
  });

  it("uses each refreshed record to stop polling once the handoff completes", () => {
    harness.detail = contract("procurement", "Executed");
    render(false, "Contract", "CON-1");
    const options = detailQuery();
    expect(options.refetchInterval!(currentQuery())).toBe(15_000);
    expect(options.refetchInterval!({ state: { data: contract("completed", "Executed") } })).toBe(false);
  });

  it("pauses automatic refresh in Authoring and preserves edits if an earlier read completes", () => {
    harness.detail = { ...contract("procurement", "Executed"), actions: [{ action: "save", label: "Save changes" }] };
    harness.metadata.fields.Contract = [{ fieldname: "contract_terms", fieldtype: "Text" }];
    const initial = render(false, "Contract", "CON-1");
    (tab(initial, "Authoring")!.props.onClick as () => void)();
    const authoring = render(false, "Contract", "CON-1").find(node => node.type === ClmFields)!;
    (authoring.props.onChange as (values: Record<string, unknown>) => void)({ ...harness.detail.record, contract_terms: "Unsaved user edits" });
    render(false, "Contract", "CON-1");
    expect(detailQuery().refetchInterval!(currentQuery())).toBe(false);
    expect(detailQuery().refetchOnWindowFocus!(currentQuery())).toBe(false);
    expect(detailQuery().refetchOnReconnect!(currentQuery())).toBe(false);
    harness.detail = { ...harness.detail, record: { ...harness.detail.record, modified: "new server revision", contract_terms: "Later server terms" } };
    render(false, "Contract", "CON-1");
    const preserved = render(false, "Contract", "CON-1").find(node => node.type === ClmFields)!;
    expect(preserved.props.values).toMatchObject({ contract_terms: "Unsaved user edits" });
    expect(harness.action).not.toHaveBeenCalled(); expect(harness.mutate).not.toHaveBeenCalled();
  });

  it.each(["save", "new_version"])("keeps %s on the original editing revision after an in-flight read, then advances it only after successful save", async action => {
    harness.detail = { ...contract("draft", "Draft"), actions: [{ action: "save", label: "Save changes" }] };
    harness.metadata.fields.Contract = [{ fieldname: "contract_terms", fieldtype: "Text" }];
    const initial = render(false, "Contract", "CON-1");
    (tab(initial, "Authoring")!.props.onClick as () => void)();
    const authoring = render(false, "Contract", "CON-1").find(node => node.type === ClmFields)!;
    (authoring.props.onChange as (values: Record<string, unknown>) => void)({ ...harness.detail.record, contract_terms: "Unsaved user edits" });
    harness.detail = { ...harness.detail, record: { ...harness.detail.record, modified: "concurrent server revision", contract_terms: "Concurrent server terms" } };
    render(false, "Contract", "CON-1");
    const pending = render(false, "Contract", "CON-1").find(node => node.type === ClmFields)!;
    expect(pending.props.values).toMatchObject({ contract_terms: "Unsaved user edits" });
    const input = { action, payload: pending.props.values as Record<string, unknown> };
    const mutation = harness.mutations.at(-1)!;
    harness.action.mockRejectedValueOnce(new Error("The Contract changed. Refresh before saving."));
    await expect(mutation.mutationFn(input)).rejects.toThrow("The Contract changed");
    expect(harness.action).toHaveBeenLastCalledWith(expect.objectContaining({ action, expected_modified: "original editing revision" }));
    // A failed save does not grant the editing snapshot the newer server revision.
    await mutation.mutationFn(input);
    expect(harness.action).toHaveBeenLastCalledWith(expect.objectContaining({ expected_modified: "original editing revision" }));
    const saved = { ...harness.detail, record: { ...harness.detail.record, modified: "successful saved revision", contract_terms: "Saved normalized terms" } };
    mutation.onSuccess(saved, input);
    harness.detail = saved;
    const refreshed = render(false, "Contract", "CON-1").find(node => node.type === ClmFields)!;
    expect(refreshed.props.values).toMatchObject({ contract_terms: "Saved normalized terms" });
    await harness.mutations.at(-1)!.mutationFn({ action, payload: refreshed.props.values as Record<string, unknown> });
    expect(harness.action).toHaveBeenLastCalledWith(expect.objectContaining({ expected_modified: "successful saved revision" }));
  });

  it("preserves standalone authoring refresh and revision behavior", async () => {
    harness.detail = { ...contract("draft", "Draft"), actions: [{ action: "save", label: "Save changes" }] };
    delete harness.detail.record.custom_rfq;
    harness.metadata.fields.Contract = [{ fieldname: "contract_terms", fieldtype: "Text" }];
    const initial = render(false, "Contract", "CON-1");
    (tab(initial, "Authoring")!.props.onClick as () => void)();
    render(false, "Contract", "CON-1");
    expect(detailQuery().refetchOnWindowFocus!(currentQuery())).toBe(true);
    expect(detailQuery().refetchOnReconnect!(currentQuery())).toBe(true);
    harness.detail = { ...harness.detail, record: { ...harness.detail.record, modified: "refreshed standalone revision", contract_terms: "Refreshed standalone terms" } };
    render(false, "Contract", "CON-1");
    const authoring = render(false, "Contract", "CON-1").find(node => node.type === ClmFields)!;
    expect(authoring.props.values).toMatchObject({ contract_terms: "Refreshed standalone terms" });
    await harness.mutations.at(-1)!.mutationFn({ action: "save", payload: authoring.props.values as Record<string, unknown> });
    expect(harness.action).toHaveBeenLastCalledWith(expect.objectContaining({ expected_modified: "refreshed standalone revision" }));
  });
});

describe("RFQ Contract signature workspace and persisted evidence", () => {
  beforeEach(() => {
    harness.detail = { doctype: "Contract", record: { name: "CON-1", modified: "current revision", custom_rfq: "RFQ-1", custom_contract_status: "Pending Signature", custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase: "signature" } }) }, actions: [{ action: "sign", label: "E-Sign Contract" }], audit: [], signatures: [] };
  });
  it("passes the reviewed PDF revision through the real mutation even after the detail refreshes", async () => {
    const tree = render(false, "Contract", "CON-1");
    const panel = tree.find(node => node.type === RfqContractSigning)!;
    const payload = { full_legal_name: "Legal Reviewer", signature: { method: "typed", value: "L. Reviewer", adopted: true }, consent: true, request_id: "attempt-1" };
    await (panel.props.onAction as (action: string, comment: string, payload: Record<string, unknown>, revision: string) => Promise<void>)("sign", "Approved wording", payload, "reviewed revision");
    const input = harness.mutate.mock.calls[0][0];
    expect(input).toEqual({ action: "sign", comment: "Approved wording", payload, expectedModified: "reviewed revision" });
    await harness.mutations.at(-1)!.mutationFn(input);
    expect(harness.action).toHaveBeenCalledExactlyOnceWith({ doctype: "Contract", name: "CON-1", action: "sign", comment: "Approved wording", payload, expected_modified: "reviewed revision" });
  });
  it("includes current signature evidence in Approvals without exposing another signing action", () => {
    const initial = render(false, "Contract", "CON-1");
    (tab(initial, "Approvals")!.props.onClick as () => void)();
    const approvals = render(false, "Contract", "CON-1");
    expect(approvals.find(node => node.type === RfqSignatureApprovals)?.props.detail).toBe(harness.detail);
  });
  it("passes the already-authorized Legal-first receipt to supplier Documents without exposing internal workflow tabs", () => {
    const receipt = { party: "inteva" as const, role: "legal", by: "legal@example.test", typed_name: "Legal Reviewer", at: "2026-09-28 10:00:00", version: "1.0", file_id: "legal-signed-PDF", file_url: "/private/files/legal-signed.pdf", hash: "a".repeat(64) };
    harness.detail!.signatures = [receipt];
    harness.detail!.actions = [];
    const initial = render(true, "Contract", "CON-1");
    (tab(initial, "Documents")!.props.onClick as () => void)();
    const tree = render(true, "Contract", "CON-1");
    const documents = tree.find(node => node.type === ClmDocuments)!;
    expect(documents.props.signatures).toBe(harness.detail!.signatures);
    expect(documents.props.record).toBe(harness.detail!.record);
    expect(documents.props.doctype).toBe("Contract");
    expect(documents.props).not.toHaveProperty("audit"); expect(documents.props).not.toHaveProperty("approvals");
    expect(tab(tree, "Approvals")).toBeUndefined(); expect(tab(tree, "Audit history")).toBeUndefined();
    expect(tree.some(node => node.type === RfqContractSigning)).toBe(false);
    expect(harness.action).not.toHaveBeenCalled(); expect(harness.mutate).not.toHaveBeenCalled();
  });
  it("labels each persisted signature audit by its party and displays receipt metadata", () => {
    harness.detail!.audit = [
      { action: "e_signed", role: "legal", by: "legal@example.test", at: "2026-09-28 10:00", reference_id: "CON-1", signature_status: "Signed", signature_file_id: "legal-PDF" },
      { action: "e_signed", role: "supplier", by: "supplier@example.test", at: "2026-09-28 11:00", reference_id: "CON-1", signature_status: "Signed", signature_file_id: "supplier-PDF" },
    ];
    const initial = render(false, "Contract", "CON-1");
    (tab(initial, "Audit history")!.props.onClick as () => void)();
    const history = label(render(false, "Contract", "CON-1").find(node => node.props.role === "tabpanel")!.props.children as ReactNode);
    for (const value of ["Legal Manager E-Signature Completed", "Supplier E-Signature Completed", "legal@example.test", "2026-09-28 10:00", "Contract: CON-1", "Signature: Signed", "Document: legal-PDF", "Result: Success"]) expect(history).toContain(value);
  });
});

describe("RFQ Contract Request working-page handoff", () => {
  it("opens Request details for the same persisted request, then focuses and scrolls its existing section", () => {
    const original = structuredClone(harness.detail);
    const initial = render();
    expect(tab(initial, "Overview")?.props["aria-selected"]).toBe(true);
    expect(initial.some(node => node.type === ProcurementRequestWorkspace)).toBe(false);
    expect(initial.find(node => node.type === RfqContractPanel)?.props).toMatchObject({ rfqName: "PUR-RFQ-2026-00099", expectedRequestName: "CTRQ-2026-0002", refreshToken: original?.record.modified });
    open(initial);
    const opened = render();
    expect(tab(opened, "Request details")?.props["aria-selected"]).toBe(true);
    expect(opened.find(node => node.props.role === "tabpanel")?.props).toMatchObject({ "aria-label": "Request details", tabIndex: -1 });
    expect(opened.find(node => node.type === ProcurementRequestWorkspace)?.props.detail).toBe(harness.detail);
    expect(harness.section.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    expect(harness.section.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(harness.detail).toEqual(original);
    expect(harness.action).not.toHaveBeenCalled(); expect(harness.mutate).not.toHaveBeenCalled();
    expect(harness.navigate).not.toHaveBeenCalled(); expect(harness.qc.setQueryData).not.toHaveBeenCalled();
    expect(harness.qc.invalidateQueries).not.toHaveBeenCalled(); expect(harness.success).not.toHaveBeenCalled();
  });

  it("reopens the same working section without navigation or mutation", () => {
    open(render()); render(); open(render());
    const tree = render();
    expect(tree.filter(node => node.type === ProcurementRequestWorkspace)).toHaveLength(1);
    expect(harness.section.focus).toHaveBeenCalledTimes(2);
    expect(harness.section.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(harness.navigate).not.toHaveBeenCalled(); expect(harness.mutate).not.toHaveBeenCalled();
  });

  it("rejects another request ID without changing the selected section", () => {
    open(render(), "CTRQ-2026-OTHER");
    const tree = render();
    expect(harness.errorToast).toHaveBeenCalledWith(expect.stringContaining("does not reference this Contract Request"));
    expect(tab(tree, "Overview")?.props["aria-selected"]).toBe(true);
    expect(tree.some(node => node.type === ProcurementRequestWorkspace)).toBe(false);
    expect(harness.section.focus).not.toHaveBeenCalled(); expect(harness.section.scrollIntoView).not.toHaveBeenCalled();
    expect(harness.navigate).not.toHaveBeenCalled(); expect(harness.mutate).not.toHaveBeenCalled();
  });

  it("loads the exact Request ID through the existing detail API rather than the RFQ ID", async () => {
    render();
    const query = harness.queries.find(row => row.queryKey[1] === "detail")!;
    expect(query.queryKey).toEqual(["clm", "detail", "Contract Request", "CTRQ-2026-0002", false, "procurement-team-session"]);
    await query.queryFn();
    expect(harness.getDetail).toHaveBeenCalledExactlyOnceWith("Contract Request", "CTRQ-2026-0002");
    expect(harness.action).not.toHaveBeenCalled();
  });

  it.each(["standalone", "supplier"])("does not add the RFQ working tab to a %s view", kind => {
    if (kind === "standalone") { delete harness.detail!.record.custom_rfq; delete harness.detail!.record.custom_clm_data; }
    const tree = render(kind === "supplier");
    expect(tab(tree, "Request details")).toBeUndefined();
    expect(tree.some(node => node.type === ProcurementRequestWorkspace || node.type === RfqContractPanel)).toBe(false);
  });

  it("preserves the real detail error and offers Retry without exposing an editor", () => {
    harness.error = new Error("ERPNext denied access to CTRQ-2026-0002.");
    const tree = render();
    expect(label(tree.find(node => node.props.role === "alert")?.props.children as ReactNode)).toContain(harness.error.message);
    expect(tree.some(node => node.type === ProcurementRequestWorkspace || node.type === RfqContractPanel)).toBe(false);
    (tree.find(node => node.type === "button" && label(node.props.children as ReactNode) === "Retry")!.props.onClick as () => void)();
    expect(harness.refetch).toHaveBeenCalledOnce();
    expect(harness.action).not.toHaveBeenCalled(); expect(harness.navigate).not.toHaveBeenCalled();
  });

  it("updates the current request cache only after a matching saved Request is returned", () => {
    open(render());
    const editor = render().find(node => node.type === ProcurementRequestWorkspace)!;
    const onSaved = editor.props.onSaved as (result: ClmDetail) => void;
    onSaved({ ...request(), record: { ...request().record, name: "CTRQ-OTHER" } });
    expect(harness.errorToast).toHaveBeenCalledWith(expect.stringContaining("different Contract Request"));
    expect(harness.qc.setQueryData).not.toHaveBeenCalled(); expect(harness.qc.invalidateQueries).not.toHaveBeenCalled();
    const saved = { ...request(), record: { ...request().record, modified: "2026-09-24 11:00:00", description: "Saved draft terms" } };
    onSaved(saved);
    expect(harness.qc.setQueryData).toHaveBeenCalledExactlyOnceWith(["clm", "detail", "Contract Request", "CTRQ-2026-0002", false, "procurement-team-session"], saved);
    expect(harness.qc.invalidateQueries).toHaveBeenCalledExactlyOnceWith({ queryKey: ["clm"] });
    expect(harness.navigate).not.toHaveBeenCalled();
  });
});

describe("Contract record Commitments and allowRelated regression tests", () => {
  function contractDetail(allowedRelated: string[] = ["Contract Risk", "Contract Obligation"]): ClmDetail {
    return {
      doctype: "Contract",
      record: {
        name: "CON-2026-00004",
        modified: "2026-10-13 10:00:00",
        custom_contract_status: "Active",
        custom_rfq: "PUR-RFQ-2026-00112",
        supplier: "Atlantic Precision Manufacturing.",
        contract_purpose: "Procurement Contract for Atlantic Precision Manufacturing.",
        contract_terms: "Standard commercial contract terms",
      },
      actions: [],
      approvals: [],
      versions: [],
      audit: [],
      allowed_related: allowedRelated,
      related: {
        "Contract Risk": [
          { name: "CRISK-0001", contract: "CON-2026-00004", risk_description: "Supply chain delay risk", risk_level: "Medium" },
        ],
        "Contract Obligation": [],
      },
    };
  }

  beforeEach(() => {
    harness.slots = [];
    harness.dependencies.clear();
    harness.error = undefined;
  });

  it("loads /contracts/CON-2026-00004 Commitments tab without ReferenceError: allowRelated is not defined", () => {
    harness.detail = contractDetail();
    harness.index = 0;
    const tree = nodes(ClmRecordWorkspace({ doctype: "Contract", name: "CON-2026-00004", initialTab: "Commitments" }));
    const commitmentsTab = tree.find(node => node.props.role === "tab" && label(node.props.children as ReactNode) === "Commitments");
    expect(commitmentsTab).toBeDefined();

    // Existing related rows are displayed
    expect(tree.some(node => label(node.props.children as ReactNode).includes("CRISK-0001"))).toBe(true);

    // Permitted related doctypes show Add buttons
    expect(tree.some(node => label(node.props.children as ReactNode) === "Add risk")).toBe(true);
    expect(tree.some(node => label(node.props.children as ReactNode) === "Add obligation")).toBe(true);
    // Non-permitted related types do not show Add buttons
    expect(tree.some(node => label(node.props.children as ReactNode) === "Add amendment")).toBe(false);
  });

  it("preserves authorization by hiding Add related buttons when allowed_related is empty", () => {
    harness.detail = contractDetail([]);
    harness.index = 0;
    const tree = nodes(ClmRecordWorkspace({ doctype: "Contract", name: "CON-2026-00004", initialTab: "Commitments" }));

    // Unpermitted Add buttons are hidden
    expect(tree.some(node => label(node.props.children as ReactNode) === "Add risk")).toBe(false);
    expect(tree.some(node => label(node.props.children as ReactNode) === "Add obligation")).toBe(false);
    expect(tree.some(node => label(node.props.children as ReactNode) === "Add milestone")).toBe(false);

    // Existing related rows and empty state notices remain visible
    expect(tree.some(node => label(node.props.children as ReactNode).includes("CRISK-0001"))).toBe(true);
    expect(tree.some(node => label(node.props.children as ReactNode).includes("No obligations have been added yet."))).toBe(true);
  });

  it("switches to Commitments tab interactively without throwing ReferenceError", () => {
    harness.detail = contractDetail();
    harness.index = 0;
    // Initial render in Overview tab
    let tree = nodes(ClmRecordWorkspace({ doctype: "Contract", name: "CON-2026-00004" }));
    const commitmentsTab = tree.find(node => node.props.role === "tab" && label(node.props.children as ReactNode) === "Commitments");
    expect(commitmentsTab).toBeDefined();

    // Click the Commitments tab
    (commitmentsTab!.props.onClick as () => void)();
    for (const effect of harness.effects.splice(0)) effect();

    // Re-render reflecting tab state update
    harness.index = 0;
    tree = nodes(ClmRecordWorkspace({ doctype: "Contract", name: "CON-2026-00004" }));
    expect(tree.some(node => label(node.props.children as ReactNode) === "Add risk")).toBe(true);
    expect(tree.some(node => label(node.props.children as ReactNode).includes("CRISK-0001"))).toBe(true);
  });
});

