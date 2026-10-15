import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  query: vi.fn(), read: vi.fn(), document: vi.fn(), retry: vi.fn(), viewer: "viewer-1",
  index: 0, slots: [] as unknown[], refs: [] as { current: unknown }[], refIndex: 0,
  createUrl: vi.fn(() => "blob:verified-contract"), revokeUrl: vi.fn(),
}));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => { const index = state.index++; if (!(index in state.slots)) state.slots[index] = initial; return [state.slots[index], (value: unknown) => { state.slots[index] = value; }]; },
  useRef: (initial: unknown) => { const index = state.refIndex++; return state.refs[index] ||= { current: initial }; },
  useEffect: () => undefined,
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: state.query }));
vi.mock("../../api/clm", () => ({
  getPurchaseOrderContract: state.read, getClmDocumentBlob: state.document, clmError: (error: Error) => error.message,
  clmViewerKey: () => state.viewer, clmRecordRoute: (_doctype: string, name: string, supplier: boolean) => `${supplier ? "/supplier" : ""}/contracts/${encodeURIComponent(name)}`,
}));
vi.mock("../contracts/ClmFields", () => ({ CLM_BUTTON: "button", CLM_PRIMARY: "primary" }));
vi.mock("../contracts/ContractPdfPreviewModal", () => ({ default: () => null }));
import PurchaseOrderContractInformation from "./PurchaseOrderContractInformation";
import ContractPdfPreviewModal from "../contracts/ContractPdfPreviewModal";
import SupplierContractLifecycle from "../contracts/SupplierContractLifecycle";
import type { ClmSupplierWorkflow } from "../../types/clm";

type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!isValidElement(root)) return []; const element = root as Node; return [element, ...nodes(element.props.children as ReactNode)]; }
const label = (node: ReactNode): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(label).join("") : isValidElement(node) ? label((node.props as { children?: ReactNode }).children) : "";
const contract = {
  name: "CON-2026-00001", status: "Active", value: 4500, currency: "USD", start_date: "2026-09-25", end_date: "2026-10-25",
  supplier_id: "SUP-ATLANTIC", supplier_name: "Atlantic Precision Manufacturing",
  rfq: "PUR-RFQ-2026-00104", award: "LDC2026-00027", quotation: "PUR-SQTN-2026-00273", current_version: "1.0", pdf_available: true,
  pdf: { file_id: "signed-file-1", version: "1.0", hash: "saved-hash", kind: "signed" },
  signature_workflow: { supplier_status: "Pending", legal_status: "Signed", can_sign: false, can_review: true }, actions: [] as { action: string; label: string }[],
  supplier_workflow: { purchase_order: "PUR-ORD-2026-00028", acceptance_status: "Pending", signature_status: "Pending", status: "Contract Acceptance Required", current_stage: "Contract Acceptance", next_stage: "Supplier E-Signature", responsible_role: "supplier", responsible: "Supplier", can_accept_contract: true, can_sign_contract: false, can_accept_po: false, version: "1.0", document_file_id: "signed-file-1", document_hash: "saved-hash" } as ClmSupplierWorkflow,
};
const saved = { purchase_order: "PUR-ORD-2026-00028", contract };
const render = (supplier = true) => { state.index = 0; state.refIndex = 0; return nodes(PurchaseOrderContractInformation({ purchaseOrder: saved.purchase_order, supplier })); };
const control = (tree: Node[], name: string, type: unknown = "button") => tree.find(node => node.type === type && label(node.props.children as ReactNode) === name);
const invoke = (node: Node | undefined) => { expect(node).toBeDefined(); (node!.props.onClick as () => void)(); };
const text = (tree: Node[]) => label(tree[0]);
const show = (value: Partial<typeof contract> = {}) => state.query.mockReturnValue({ data: { ...saved, contract: { ...contract, ...value } }, isLoading: false, isError: false, refetch: state.retry });
beforeEach(() => {
  vi.clearAllMocks(); state.index = 0; state.refIndex = 0; state.slots = []; state.refs = []; state.viewer = "viewer-1"; show();
  state.document.mockResolvedValue(new Blob(["%PDF-1.7\nActual signed version bytes"], { type: "application/pdf" }));
  vi.spyOn(URL, "createObjectURL").mockImplementation(state.createUrl); vi.spyOn(URL, "revokeObjectURL").mockImplementation(state.revokeUrl);
});
afterEach(() => vi.restoreAllMocks());

describe("Purchase Order linked Contract information", () => {
  it("shows the saved Contract value, dates, actual status, source references and independent signature states", () => {
    const tree = render(); const output = text(tree);
    for (const expected of ["Contract Information", saved.purchase_order, contract.name, "Active", "4,500", "USD", contract.rfq, contract.award, "Supplier: Atlantic Precision Manufacturing", "Supplier Signature: Pending", "Legal Manager Signature: Signed", "Contract Start Date", "Contract End Date"]) expect(output).toContain(expected);
    expect(control(tree, "View Contract", Link)?.props.to).toBe(`/supplier/contracts/${contract.name}`);
    expect(control(tree, "Review Contract", Link)?.props.to).toBe(`/supplier/contracts/${contract.name}`);
    expect(control(tree, "Sign Contract", Link)).toBeUndefined(); expect(control(tree, "Accept Contract", Link)).toBeUndefined();
  });
  it("isolates the query by authenticated viewer and loads only the authorized backend relationship", async () => {
    render();
    const options = state.query.mock.calls[0][0];
    expect(options.queryKey).toEqual(["purchase-order-contract", "viewer-1", saved.purchase_order]);
    await options.queryFn(); expect(state.read).toHaveBeenCalledWith(saved.purchase_order);
    state.viewer = "viewer-2"; render(); expect(state.query.mock.lastCall![0].queryKey).toContain("viewer-2");
  });
  it("links staff readers to the existing internal Contract without supplier signing or acceptance actions", () => {
    show({ signature_workflow: { ...contract.signature_workflow, can_sign: true }, actions: [{ action: "sign", label: "Sign" }, { action: "supplier_accept", label: "Accept" }] });
    const tree = render(false);
    expect(control(tree, "View Contract", Link)?.props.to).toBe(`/contracts/${contract.name}`);
    expect(control(tree, "Review Contract", Link)).toBeUndefined(); expect(control(tree, "Sign Contract", Link)).toBeUndefined(); expect(control(tree, "Accept Contract", Link)).toBeUndefined();
  });
  it("shows Sign Contract only when both server readiness and the supplier sign action are granted", () => {
    show({ supplier_workflow: { ...contract.supplier_workflow, acceptance_status: "Accepted", can_accept_contract: false, can_sign_contract: true }, signature_workflow: { ...contract.signature_workflow, can_sign: true }, actions: [{ action: "sign", label: "E-Sign" }] });
    expect(control(render(), "Sign Contract", Link)?.props.to).toBe(`/supplier/contracts/${contract.name}`);
    show({ signature_workflow: { ...contract.signature_workflow, can_sign: true }, actions: [] });
    expect(control(render(), "Sign Contract", Link)).toBeUndefined();
    show({ actions: [{ action: "sign", label: "Sign" }] });
    expect(control(render(), "Sign Contract", Link)).toBeUndefined();
  });
  it("offers Accept Contract only for the existing supplier_accept action and never executes it on the PO page", () => {
    show({ actions: [{ action: "supplier_accept", label: "Accept terms" }] });
    const tree = render(); expect(control(tree, "Accept Contract", Link)?.props.to).toBe(`/supplier/contracts/${contract.name}`);
    expect(control(tree, "Accept Contract")).toBeUndefined(); expect(state.document).not.toHaveBeenCalled();
  });
  it("renders the persisted supplier lifecycle and blocks a stale sign action before acceptance", () => {
    show({ signature_workflow: { ...contract.signature_workflow, can_sign: true }, actions: [{ action: "sign", label: "Sign" }, { action: "supplier_accept", label: "Accept" }] });
    const tree = render(); expect(control(tree, "Sign Contract", Link)).toBeUndefined();
    expect(control(tree, "Accept Contract", Link)).toBeDefined();
    expect(tree.find(node => node.type === SupplierContractLifecycle)?.props.workflow).toEqual(contract.supplier_workflow);
  });
  it("shows No Contract linked only for an explicit successful null link", () => {
    state.query.mockReturnValue({ data: { ...saved, contract: null }, isLoading: false, isError: false });
    const tree = render(); expect(text(tree)).toContain("No Contract linked"); expect(text(tree)).not.toContain(contract.name);
    expect(control(tree, "View Contract", Link)).toBeUndefined(); expect(control(tree, "View Contract PDF")).toBeUndefined();
  });
  it("shows the real lookup error with a read-only refresh instead of claiming no Contract exists", () => {
    state.query.mockReturnValue({ error: new Error("Linked Contract belongs to a different award."), isLoading: false, isError: true, refetch: state.retry });
    const tree = render(); expect(text(tree)).toContain("different award"); expect(text(tree)).not.toContain("No Contract linked");
    invoke(control(tree, "Refresh Contract")); expect(state.retry).toHaveBeenCalledOnce();
    expect(state.document).not.toHaveBeenCalled();
  });
  it("shows a loading state before a link response is available", () => {
    state.query.mockReturnValue({ isLoading: true, isError: false });
    expect(text(render())).toContain("Loading linked Contract"); expect(text(render())).not.toContain("No Contract linked");
  });
  it("opens the exact authoritative version through the existing authorized PDF service and shared viewer", async () => {
    invoke(control(render(), "View Contract PDF"));
    await vi.waitFor(() => expect(state.slots[1]).toBe(false));
    expect(state.document).toHaveBeenCalledExactlyOnceWith("Contract", contract.name, "current_pdf", "signed-file-1", "1.0");
    const modal = render().find(node => node.type === ContractPdfPreviewModal)!;
    expect(modal.props.contractId).toBe(contract.name);
    const preview = modal.props.preview as { name: string; bytes: Uint8Array; url: string };
    expect(preview.name).toBe(`${contract.name}-v1.0.pdf`); expect(preview.url).toBe("blob:verified-contract");
    expect(new TextDecoder().decode(preview.bytes)).toBe("%PDF-1.7\nActual signed version bytes");
    (modal.props.onClose as () => void)(); expect(render().find(node => node.type === ContractPdfPreviewModal)).toBeUndefined();
  });
  it("does not attempt to generate or invent a PDF when the backend has no authoritative version", () => {
    show({ pdf_available: false }); const tree = render();
    expect(control(tree, "View Contract PDF")?.props.disabled).toBe(true); invoke(control(tree, "View Contract PDF"));
    expect(state.document).not.toHaveBeenCalled(); expect(text(tree)).toContain("approved Contract PDF is not available");
  });
  it.each(["The versioned Contract PDF failed its integrity check.", "You do not have permission to view this document."])("preserves PDF service failure: %s", async message => {
    state.document.mockRejectedValue(new Error(message)); invoke(control(render(), "View Contract PDF"));
    await vi.waitFor(() => expect(text(render())).toContain(message));
    expect(state.createUrl).not.toHaveBeenCalled(); expect(render().find(node => node.type === ContractPdfPreviewModal)).toBeUndefined();
  });
  it("ignores a late PDF response after the authenticated viewer changes", async () => {
    let finish!: (blob: Blob) => void; state.document.mockReturnValue(new Promise<Blob>(resolve => { finish = resolve; }));
    invoke(control(render(), "View Contract PDF")); state.viewer = "viewer-2"; render();
    finish(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    await vi.waitFor(() => expect(state.slots[1]).toBe(false)); expect(state.createUrl).not.toHaveBeenCalled();
  });
  it("ignores a late PDF response when another signature changes the file without changing version", async () => {
    let finish!: (blob: Blob) => void; state.document.mockReturnValue(new Promise<Blob>(resolve => { finish = resolve; }));
    invoke(control(render(), "View Contract PDF"));
    show({ pdf: { ...contract.pdf, file_id: "signed-file-2", hash: "new-saved-hash" } }); render();
    finish(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    await vi.waitFor(() => expect(state.slots[1]).toBe(false)); expect(state.createUrl).not.toHaveBeenCalled();
  });
  it("refuses a non-PDF response instead of showing a misleading preview", async () => {
    state.document.mockResolvedValue(new Blob(["error html"], { type: "text/html" })); invoke(control(render(), "View Contract PDF"));
    await vi.waitFor(() => expect(text(render())).toContain("did not return the authoritative Contract PDF")); expect(state.createUrl).not.toHaveBeenCalled();
  });
});
