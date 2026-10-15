import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmDetail } from "../../api/clm";
const state = vi.hoisted(() => ({ review: null as unknown }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useState: () => [state.review, (next: unknown) => { state.review = next; }] }));
vi.mock("./ClmFields", () => ({ CLM_BUTTON: "button", CLM_PRIMARY: "primary" }));
vi.mock("./RfqContractSigning", () => ({ SigningWorkspace: () => null }));
vi.mock("./ClmDocuments", () => ({ default: () => null }));
import SupplierContractActions from "./SupplierContractActions";
import SupplierContractLifecycle from "./SupplierContractLifecycle";
import { SigningWorkspace } from "./RfqContractSigning";
import ClmDocuments from "./ClmDocuments";
type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!isValidElement(root)) return []; const element = root as Node; return [element, ...nodes(element.props.children as ReactNode)]; }
const label = (node: ReactNode): string => typeof node === "string" ? node : Array.isArray(node) ? node.map(label).join("") : isValidElement(node) ? label((node.props as { children?: ReactNode }).children) : "";
const initial: ClmDetail = { doctype: "Contract", record: { name: "CON-1", modified: "saved-revision", custom_contract_status: "Active" }, actions: [{ action: "supplier_accept", label: "Accept Contract" }],
  signature_workflow: { supplier_status: "Pending", legal_status: "Signed", can_sign: false, can_review: true, is_legal_signatory: false, can_request_signatures: false },
  supplier_workflow: { purchase_order: "PO-1", acceptance_status: "Pending", signature_status: "Pending", status: "Contract Acceptance Required", current_stage: "Contract Acceptance", next_stage: "Supplier E-Signature", responsible_role: "supplier", responsible: "Supplier", can_accept_contract: true, can_sign_contract: false, can_accept_po: false, version: "1.0" },
};
const render = (detail = initial) => nodes(SupplierContractActions({ detail, fields: [], busy: false, onAction: vi.fn() }));
const button = (tree: Node[], name: string) => tree.find(node => node.type === "button" && label(node.props.children as ReactNode) === name);
beforeEach(() => { state.review = null; });
describe("Supplier Contract handoff actions", () => {
  it("starts with separate acceptance and opens the existing PDF workspace for the exact saved snapshot", () => {
    const tree = render(); expect(button(tree, "Accept Contract")).toBeDefined(); expect(button(tree, "Sign Contract")).toBeUndefined();
    (button(tree, "Accept Contract")!.props.onClick as () => void)();
    const refreshed = { ...initial, record: { ...initial.record, modified: "new-revision" } };
    const workspace = render(refreshed).find(node => node.type === SigningWorkspace)!;
    expect(workspace.props).toMatchObject({ supplierSigner: true, purpose: "accept", canSign: true, detail: initial });
  });
  it("offers supplier signature only after the persisted acceptance grant and keeps it separate from PO acceptance", () => {
    const accepted = { ...initial, actions: [{ action: "sign", label: "Sign Contract" }], signature_workflow: { ...initial.signature_workflow!, can_sign: true }, supplier_workflow: { ...initial.supplier_workflow!, acceptance_status: "Accepted" as const, can_accept_contract: false, can_sign_contract: true, status: "Contract Signature Required" } };
    const tree = render(accepted); expect(button(tree, "Accept Contract")).toBeUndefined(); expect(button(tree, "Sign Contract")).toBeDefined();
    (button(tree, "Sign Contract")!.props.onClick as () => void)();
    expect(render(accepted).find(node => node.type === SigningWorkspace)?.props).toMatchObject({ purpose: "sign", supplierSigner: true });
    expect(button(tree, "Accept Purchase Order")).toBeUndefined();
  });
  it("shows the clear sign action after acceptance even when the old supplier projection omits internal Legal readiness", () => {
    const accepted = { ...initial, actions: [{ action: "sign", label: "Sign Contract" }], signature_workflow: undefined, supplier_workflow: { ...initial.supplier_workflow!, acceptance_status: "Accepted" as const, can_accept_contract: false, can_sign_contract: true } };
    const tree = render(accepted);
    expect(label(tree[0])).toContain("Action Required"); expect(label(tree[0])).toContain("Please electronically sign the accepted contract.");
    expect(button(tree, "Sign Contract")).toBeDefined();
    expect(tree.find(node => node.type === "div" && node.props["aria-label"] === "Supplier signature action required")).toBeDefined();
  });
  it("offers the exact persisted fully signed PDF and links to the separate PO acceptance flow", () => {
    const signedReceipt = { party: "supplier" as const, by: "SUP-1", at: "2026-09-29 10:00:00", version: "1.0", file_id: "SIGNED-FILE", file_url: "/private/files/signed.pdf", hash: "signed-hash", typed_name: "Supplier Signer" };
    const signed = { ...initial, actions: [], signatures: [signedReceipt], signature_workflow: { ...initial.signature_workflow!, supplier_status: "Signed" as const }, supplier_workflow: { ...initial.supplier_workflow!, acceptance_status: "Accepted" as const, signature_status: "Signed" as const, can_accept_contract: false, can_accept_po: true, document_file_id: "SIGNED-FILE", document_hash: "signed-hash" } };
    const tree = render(signed);
    expect(button(tree, "Sign Contract")).toBeUndefined(); expect(label(tree[0])).toContain("Supplier Signature: Signed"); expect(label(tree[0])).toContain("Legal Manager Signature: Signed");
    expect(tree.find(node => node.type === ClmDocuments)?.props).toMatchObject({ doctype: "Contract", signedOnly: true, signatures: [signedReceipt] });
    const next = tree.find(node => node.props.to === "/supplier/po/PO-1" && label(node.props.children as ReactNode) === "Accept Purchase Order");
    expect(next).toBeDefined(); expect(label(tree[0])).toContain("Purchase Order Acceptance Required");
  });
  it("does not use a stale action grant to bypass supplier acceptance", () => {
    const tree = render({ ...initial, actions: [{ action: "sign", label: "Sign Contract" }], signature_workflow: { ...initial.signature_workflow!, can_sign: true } });
    expect(button(tree, "Sign Contract")).toBeUndefined(); expect(button(tree, "Accept Contract")).toBeUndefined();
  });
  it("renders current, next and responsibility directly from server evidence", () => {
    const html = renderToStaticMarkup(<SupplierContractLifecycle workflow={initial.supplier_workflow!} />);
    for (const text of ["Contract Acceptance Required", "Current stage", "Contract Acceptance", "Current responsibility", "Supplier", "Next stage", "Supplier E-Signature"]) expect(html).toContain(text);
    expect(html).not.toContain("Fully Signed");
    const signed = renderToStaticMarkup(<SupplierContractLifecycle workflow={{ ...initial.supplier_workflow!, acceptance_status: "Accepted", signature_status: "Signed", can_accept_contract: false, can_accept_po: true, status: "Purchase Order Acceptance Required", current_stage: "Purchase Order Acceptance", next_stage: "Existing PO Processing" }} />);
    expect(signed).toContain("Contract: Fully Signed"); expect(signed).toContain("Purchase Order Acceptance Required");
  });
  it("does not install this workflow on a standalone Contract", () => {
    expect(render({ ...initial, supplier_workflow: undefined })).toHaveLength(0);
  });
});
