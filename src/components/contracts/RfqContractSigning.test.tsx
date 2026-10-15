import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmDetail } from "../../api/clm";
import { PDFDocument } from "pdf-lib";
const state = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], deps: new Map<number, unknown[]>(), effects: [] as (() => unknown)[], read: vi.fn(), createUrl: vi.fn(() => "blob:contract"), revokeUrl: vi.fn() }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => { const index = state.index++; if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial; return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }]; },
  useEffect: (effect: () => unknown, deps: unknown[]) => { const index = state.index++, previous = state.deps.get(index); if (!previous || deps.some((value, i) => value !== previous[i])) state.effects.push(effect); state.deps.set(index, deps); },
}));
vi.mock("../../api/clm", () => ({ getClmDocumentBlob: state.read, clmError: (error: Error) => error.message }));
vi.mock("./ClmFields", () => ({ CLM_BUTTON: "button", CLM_INPUT: "input", CLM_PRIMARY: "primary" }));
vi.mock("./ClmDocuments", () => ({ default: () => null }));
vi.mock("./ClmPdfPreview", () => ({ default: () => null }));
vi.mock("./ContractPdfPreviewModal", () => ({ default: () => null }));
import RfqContractSigning, { RfqSignatureApprovals, SigningWorkspace } from "./RfqContractSigning";
import ClmDocuments from "./ClmDocuments";
import ClmPdfPreview from "./ClmPdfPreview";
import ContractPdfPreviewModal from "./ContractPdfPreviewModal";

type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!isValidElement(root)) return []; const element = root as Node; return [element, ...nodes(element.props.children as ReactNode)]; }
const label = (node: ReactNode): string => typeof node === "string" ? node : Array.isArray(node) ? node.map(label).join("") : isValidElement(node) ? label((node.props as { children?: ReactNode }).children) : "";
const text = (tree: Node[]) => tree.map(node => label(node.props.children as ReactNode)).join(" ");
const signature = (party: "supplier" | "inteva") => ({ party, by: `${party}@example.test`, role: party === "inteva" ? "legal" : undefined, typed_name: `${party} signer`, at: "2026-09-28 10:00:00", version: "1.0", file_id: `${party}-PDF`, file_url: `/private/files/${party}.pdf`, hash: "a".repeat(64) });
function detail(): ClmDetail { return { doctype: "Contract", record: { name: "CON-1", modified: "version-a", custom_rfq: "RFQ-1", custom_supplier: "Awarded supplier", custom_contract_status: "Pending Signature", custom_contract_type: "Supply / Procurement Contract", custom_contract_title: "Award contract", contract_terms: "Approved payment and supply terms", start_date: "2026-09-28", end_date: "2027-09-28", custom_contract_value: 4500, custom_currency: "USD", custom_current_version: "1.0", custom_clm_data: JSON.stringify({ rfq_workflow: { version: 1, phase: "signature" }, rfq_context: { award_id: "AWARD-1" } }) }, actions: [{ action: "sign", label: "E-Sign Contract" }], signatures: [signature("supplier")], signature_workflow: { supplier_status: "Signed", legal_status: "Pending", is_legal_signatory: true, can_review: true, can_sign: true, can_request_signatures: false, document_file_id: "supplier-PDF" } }; }
beforeEach(async () => { state.index = 0; state.slots = []; state.deps.clear(); state.effects = []; vi.clearAllMocks(); const pdf = await PDFDocument.create(); pdf.addPage(); state.read.mockResolvedValue(new Blob([new Uint8Array(await pdf.save()).buffer], { type: "application/pdf" })); vi.spyOn(URL, "createObjectURL").mockImplementation(state.createUrl); vi.spyOn(URL, "revokeObjectURL").mockImplementation(state.revokeUrl); });
afterEach(() => vi.restoreAllMocks());

describe("RFQ Contract sign actions follow persisted server readiness", () => {
  function render(saved: ClmDetail) { state.index = 0; return nodes(RfqContractSigning({ detail: saved, fields: [], busy: false, onAction: vi.fn() })); }
  it("offers the server-authorized Legal action while the independent supplier signature is pending", () => {
    const saved = detail(); saved.signatures = []; saved.signature_workflow = { ...saved.signature_workflow!, supplier_status: "Pending", can_sign: true };
    const tree = render(saved);
    expect(text(tree)).toContain("Supplier Signature: Pending"); expect(text(tree)).toContain("Legal Manager Signature: Pending");
    expect(text(tree)).toContain("E-SIGNATURE REQUIRED");
    expect(tree.find(node => node.type === "button" && label(node.props.children as ReactNode) === "E-Sign Contract")?.props.disabled).toBe(false);
    expect(tree.find(node => node.type === "button" && label(node.props.children as ReactNode) === "Review Documents")?.props.disabled).toBe(false);
  });
  it("requires both the backend sign grant and Legal readiness before enabling signing", () => {
    const saved = detail(); expect(render(saved).find(node => node.type === "button" && label(node.props.children as ReactNode) === "E-Sign Contract")?.props.disabled).toBe(false);
    saved.actions = []; expect(render(saved).find(node => node.type === "button" && label(node.props.children as ReactNode) === "E-Sign Contract")?.props.disabled).toBe(true);
  });
  it("never shows an E-Sign action to another Legal user or another role", () => {
    const saved = detail(); saved.signature_workflow = { ...saved.signature_workflow!, can_review: false, can_sign: false, is_legal_signatory: false };
    expect(render(saved).filter(node => node.type === "button")).toHaveLength(0);
    delete saved.signature_workflow; expect(render(saved).filter(node => node.type === "button")).toHaveLength(0);
  });
  it("keeps both current-version Signed receipts visible after Finance handoff", () => {
    const saved = detail(); delete saved.signature_workflow; saved.actions = []; saved.signatures!.push(signature("inteva")); saved.record.custom_clm_data = JSON.stringify({ rfq_workflow: { version: 1, phase: "finance_review" } });
    const tree = render(saved); expect(text(tree)).toContain("Supplier Signature: Signed"); expect(text(tree)).toContain("Legal Manager Signature: Signed"); expect(tree.filter(node => node.type === "button")).toHaveLength(0);
    saved.signatures![1].version = "0.9"; expect(text(render(saved))).toContain("Legal Manager Signature: Pending");
  });
  it("keeps the supplier pending and removes Legal re-sign after the Legal receipt is persisted", () => {
    const saved = detail(); saved.signatures = [signature("inteva")]; saved.actions = [];
    saved.signature_workflow = { ...saved.signature_workflow!, supplier_status: "Pending", legal_status: "Signed", can_sign: false };
    const tree = render(saved); expect(text(tree)).toContain("Supplier Signature: Pending"); expect(text(tree)).toContain("Legal Manager Signature: Signed");
    expect(tree.some(node => node.type === "button" && label(node.props.children as ReactNode) === "E-Sign Contract")).toBe(false);
    expect(text(tree)).not.toContain("Finance Approval");
    expect(tree.find(node => node.type === ClmDocuments)?.props).toMatchObject({ signedOnly: true, signatures: [signature("inteva")] });
  });
  it("shows Finance handoff with the persisted Legal signature while supplier remains pending", () => {
    const saved = detail(); saved.signatures = [signature("inteva")]; saved.actions = [];
    saved.record.custom_contract_status = "Pending Finance";
    saved.record.custom_clm_data = JSON.stringify({ rfq_workflow: { version: 1, phase: "finance_review" } });
    saved.signature_workflow = { ...saved.signature_workflow!, supplier_status: "Pending", legal_status: "Signed", can_sign: false };
    const tree = render(saved);
    expect(text(tree)).toContain("Supplier Signature: Pending");
    expect(text(tree)).toContain("Legal Manager Signature: Signed");
    expect(text(tree)).toContain("Legal Manager signature completed. Contract is now pending Finance Approval.");
    expect(text(tree)).not.toContain("Await the supplier");
    expect(tree.filter(node => node.type === "button")).toHaveLength(0);
  });
  it("keeps the exact reviewed record snapshot when a background detail refresh arrives", () => {
    const saved = detail(), initial = render(saved);
    (initial.find(node => node.type === "button" && label(node.props.children as ReactNode) === "E-Sign Contract")!.props.onClick as () => void)();
    const refreshed = { ...saved, record: { ...saved.record, modified: "version-b", contract_terms: "Changed terms" } };
    const workspace = render(refreshed).find(node => node.type === SigningWorkspace)!;
    expect((workspace.props.detail as ClmDetail).record.modified).toBe("version-a");
    expect((workspace.props.detail as ClmDetail).record.contract_terms).toBe("Approved payment and supply terms");
  });
  it("renders the persisted current-version signer identity, comments and time in Approvals", () => {
    const saved = detail(); saved.signatures = [{ ...signature("inteva"), full_legal_name: "Morgan Legal Reviewer", signature_comment: "Approved terms reviewed and signed." }];
    saved.signature_workflow = { ...saved.signature_workflow!, supplier_status: "Pending", legal_status: "Signed" };
    const tree = nodes(RfqSignatureApprovals({ detail: saved }));
    for (const value of ["Legal Manager Signature", "Supplier Signature", "Status: Signed", "Status: Pending", "Signer: Morgan Legal Reviewer", "Signed By / Email: inteva@example.test", "Signed At: 2026-09-28 10:00:00", "Version: 1.0", "Comments / Rationale: Approved terms reviewed and signed."]) expect(text(tree)).toContain(value);
    delete saved.signatures[0].full_legal_name;
    expect(text(nodes(RfqSignatureApprovals({ detail: saved })))).toContain("Signer: inteva signer");
    saved.signatures[0].version = "0.9"; delete saved.signature_workflow;
    const superseded = text(nodes(RfqSignatureApprovals({ detail: saved })));
    for (const value of ["inteva@example.test", "Status: Signed", "inteva signer", "Version: 1.0", "Approved terms reviewed and signed."]) expect(superseded).not.toContain(value);
  });
});

describe("RFQ signing workspace reuses private PDF review and the real sign action", () => {
  function workspace(onAction = vi.fn(async () => undefined), supplierSigner = false, purpose: "sign" | "accept" = "sign") {
    const saved = detail(), onClose = vi.fn();
    saved.record.custom_inteva_signatory = "assigned.legal@example.test";
    saved.record.custom_supplier_quotation = "PUR-SQTN-2026-00273";
    if (supplierSigner) {
      saved.record.custom_contract_status = "Active";
      delete saved.record.custom_clm_data; delete saved.record.custom_rfq;
      saved.signatures = [signature("inteva")];
      saved.signature_workflow = { ...saved.signature_workflow!, legal_status: "Signed", supplier_status: "Pending", is_legal_signatory: false, can_sign: purpose === "sign" };
      saved.supplier_workflow = { purchase_order: "PO-1", acceptance_status: purpose === "accept" ? "Pending" : "Accepted", signature_status: "Pending", status: purpose === "accept" ? "Contract Acceptance Required" : "Contract Signature Required", current_stage: purpose === "accept" ? "Contract Acceptance" : "Supplier E-Signature", next_stage: purpose === "accept" ? "Supplier E-Signature" : "Purchase Order Acceptance", responsible_role: "supplier", responsible: "Supplier", can_accept_contract: purpose === "accept", can_sign_contract: purpose === "sign", can_accept_po: false, version: "1.0", document_file_id: "LEGAL-SIGNED-PDF", document_hash: "a".repeat(64) };
      saved.actions = [{ action: purpose === "accept" ? "supplier_accept" : "sign", label: purpose === "accept" ? "Accept Contract" : "Sign Contract" }];
    }
    const render = (canSign = true) => { state.index = 0; return nodes(SigningWorkspace({ detail: saved, fields: [], busy: false, canSign, onAction, onClose, supplierSigner, purpose })); };
    const flush = async () => { for (const effect of state.effects.splice(0)) effect(); await vi.waitFor(() => { expect(render().some(node => node.type === ClmPdfPreview || node.props.role === "alert")).toBe(true); }); };
    return { saved, render, flush, onAction, onClose };
  }
  const change = (tree: Node[], match: (node: Node) => boolean, value: unknown) => (tree.find(match)!.props.onChange as (event: unknown) => void)({ target: value });
  const nameInput = (node: Node) => node.type === "input" && /full legal name/i.test(String(node.props["aria-label"] || ""));
  const confirm = (tree: Node[]) => tree.find(node => node.type === "button" && node.props.type === "submit");
  const submit = async (tree: Node[]) => {
    const form = tree.find(node => node.type === "form");
    if (form) await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault: vi.fn() });
  };
  function readyPdf(harness: ReturnType<typeof workspace>) {
    (harness.render().find(node => node.type === ClmPdfPreview)!.props.onReady as () => void)();
  }
  function enterName(harness: ReturnType<typeof workspace>, value = "Legal Reviewer") { change(harness.render(), nameInput, { value }); }
  function giveConsent(harness: ReturnType<typeof workspace>) { change(harness.render(), node => node.props.type === "checkbox", { checked: true }); }

  it("exposes signer identity, name and consent while the approved PDF is still loading", () => {
    const harness = workspace(), tree = harness.render();
    expect(text(tree)).toContain("Legal Manager E-Signature");
    expect(text(tree)).toContain("assigned.legal@example.test");
    expect(tree.find(nameInput)).toBeDefined();
    expect(tree.find(node => node.props.type === "checkbox")).toBeDefined();
    expect(confirm(tree)?.props.disabled).toBe(true);
    expect(harness.onAction).not.toHaveBeenCalled();
  });

  it("opens the shared PDF modal with the exact reviewed bytes without signing or refetching", async () => {
    const harness = workspace(); harness.render(); await harness.flush();
    const original = harness.render();
    const inline = original.find(node => node.type === ClmPdfPreview)!;
    const open = original.find(node => node.type === "button" && label(node.props.children as ReactNode) === "View Contract PDF");
    expect(open).toBeDefined();
    expect(original.some(node => node.type === "a" && label(node.props.children as ReactNode) === "View Contract PDF")).toBe(false);
    (open!.props.onClick as () => void)();
    const modal = harness.render().find(node => node.type === ContractPdfPreviewModal)!;
    expect(modal.props.contractId).toBe("CON-1");
    expect(modal.props.preview).toMatchObject({ type: "application/pdf", url: "blob:contract", bytes: inline.props.bytes });
    expect((modal.props.preview as { bytes: Uint8Array }).bytes).toBe(inline.props.bytes);
    expect(state.read).toHaveBeenCalledOnce();
    expect(harness.onAction).not.toHaveBeenCalled();
    expect(confirm(harness.render())?.props.disabled).toBe(true);
    (modal.props.onClose as () => void)();
    expect(harness.render().some(node => node.type === ContractPdfPreviewModal)).toBe(false);
    expect(harness.onClose).not.toHaveBeenCalled();
    expect(harness.render().find(node => node.type === ClmPdfPreview)?.props.bytes).toBe(inline.props.bytes);
    (harness.render().find(node => node.type === "button" && label(node.props.children as ReactNode) === "View Contract PDF")!.props.onClick as () => void)();
    expect(harness.render().some(node => node.type === ContractPdfPreviewModal)).toBe(true);
    expect(state.read).toHaveBeenCalledOnce();
  });
  it("keeps an assigned Legal signer's form visible with the server's blocked reason", async () => {
    const harness = workspace();
    harness.saved.signature_workflow!.can_sign = false;
    harness.saved.signature_workflow!.blocked_reason = "The approved contract version is not available.";
    const tree = harness.render(false);
    expect(text(tree)).toContain("Legal Manager E-Signature");
    expect(text(tree)).toContain("The approved contract version is not available.");
    expect(tree.find(nameInput)).toBeDefined();
    expect(confirm(tree)?.props.disabled).toBe(true);
    await submit(tree); expect(harness.onAction).not.toHaveBeenCalled();
  });
  it("requires the reviewed PDF, explicit name and consent before the real sign submission", async () => {
    const harness = workspace(); harness.render(); await harness.flush(); let tree = harness.render();
    expect(state.read).toHaveBeenCalledExactlyOnceWith("Contract", "CON-1", "locked_file", "supplier-PDF");
    for (const value of ["Awarded supplier", "RFQ-1", "AWARD-1", "PUR-SQTN-2026-00273", "USD 4,500", "Approved payment and supply terms", "2026-09-28", "2027-09-28", "Legal Manager E-Signature", "assigned.legal@example.test", "Confirm & Sign Contract"]) expect(text(tree)).toContain(value);
    expect(confirm(tree)?.props.disabled).toBe(true);
    expect(tree.find(node => node.type === ClmPdfPreview)?.props.bytes).toBeInstanceOf(Uint8Array);
    enterName(harness, " Legal Reviewer "); giveConsent(harness);
    expect(confirm(harness.render())?.props.disabled).toBe(true);
    await submit(harness.render()); expect(harness.onAction).not.toHaveBeenCalled();
    readyPdf(harness);
    tree = harness.render(); expect(confirm(tree)?.props.disabled).toBe(false);
    expect(harness.onAction).not.toHaveBeenCalled();
    change(tree, node => node.type === "textarea", { value: "Reviewed the approved terms." });
    await submit(harness.render());
    expect(harness.onAction).toHaveBeenCalledWith("sign", "Reviewed the approved terms.", { full_legal_name: "Legal Reviewer", signature: { method: "typed", value: "Legal Reviewer", adopted: true }, consent: true, request_id: expect.any(String) }, "version-a");
    expect(harness.onClose).toHaveBeenCalledOnce();
    expect(harness.onAction.mock.calls[0]).not.toContainEqual(expect.objectContaining({ status: "Signed" }));
    expect(text(tree)).not.toContain("Type Signature");
  });
  it.each(["name only", "consent only", "whitespace name"])("does not sign with %s", async input => {
    const harness = workspace(); harness.render(); await harness.flush(); readyPdf(harness);
    if (input === "name only") enterName(harness);
    if (input === "whitespace name") enterName(harness, "   ");
    if (input !== "name only") giveConsent(harness);
    expect(confirm(harness.render())?.props.disabled).toBe(true);
    await submit(harness.render()); expect(harness.onAction).not.toHaveBeenCalled();
  });
  it("re-enables confirmation after the user explicitly consents to their edited name", async () => {
    const harness = workspace(); harness.render(); await harness.flush(); readyPdf(harness);
    enterName(harness); giveConsent(harness); expect(confirm(harness.render())?.props.disabled).toBe(false);
    enterName(harness, "Changed Reviewer");
    expect(harness.render().find(node => node.props.type === "checkbox")?.props.checked).toBe(false);
    expect(confirm(harness.render())?.props.disabled).toBe(true);
    await submit(harness.render()); expect(harness.onAction).not.toHaveBeenCalled();
    giveConsent(harness); await submit(harness.render());
    expect(harness.onAction).toHaveBeenCalledWith("sign", "", expect.objectContaining({ full_legal_name: "Changed Reviewer", signature: { method: "typed", value: "Changed Reviewer", adopted: true } }), "version-a");
  });
  it.each(["missing grant", "not assigned", "server blocked", "not signature stage", "missing version", "already signed", "missing readiness"])("rejects %s even when a parent passes canSign=true", async scenario => {
    const harness = workspace(); harness.render(); await harness.flush(); readyPdf(harness);
    enterName(harness); giveConsent(harness);
    expect(confirm(harness.render())?.props.disabled).toBe(false);
    if (scenario === "missing grant") harness.saved.actions = [];
    if (scenario === "not assigned") harness.saved.signature_workflow!.is_legal_signatory = false;
    if (scenario === "server blocked") harness.saved.signature_workflow!.can_sign = false;
    if (scenario === "not signature stage") harness.saved.record.custom_clm_data = JSON.stringify({ rfq_workflow: { version: 1, phase: "finance_review" } });
    if (scenario === "missing version") delete harness.saved.record.custom_current_version;
    if (scenario === "already signed") harness.saved.signatures!.push(signature("inteva"));
    if (scenario === "missing readiness") delete harness.saved.signature_workflow;
    const tree = harness.render(true);
    expect(confirm(tree) === undefined || confirm(tree)?.props.disabled === true).toBe(true);
    await submit(tree); expect(harness.onAction).not.toHaveBeenCalled(); expect(harness.onClose).not.toHaveBeenCalled();
  });
  it("respects the parent revoking permission during document review", async () => {
    const harness = workspace(); harness.render(); await harness.flush(); readyPdf(harness);
    enterName(harness); giveConsent(harness);
    expect(confirm(harness.render())?.props.disabled).toBe(false);
    const tree = harness.render(false);
    expect(confirm(tree) === undefined || confirm(tree)?.props.disabled === true).toBe(true);
    await submit(tree); expect(harness.onAction).not.toHaveBeenCalled();
  });
  it("blocks confirmation when the private contract document cannot be loaded", async () => {
    state.read.mockRejectedValue(new Error("You do not have permission to view this document.")); const harness = workspace(); harness.render(); await harness.flush(); const tree = harness.render();
    expect(text(tree)).toContain("You do not have permission to view this document."); expect(tree.some(node => node.type === ClmPdfPreview)).toBe(false); await submit(tree); expect(harness.onAction).not.toHaveBeenCalled();
  });
  it("retains the reviewed name, consent and idempotency key when persistence fails", async () => {
    const action = vi.fn(async () => { throw new Error("ERPNext save failed"); }); const harness = workspace(action); harness.render(); await harness.flush(); readyPdf(harness);
    enterName(harness); giveConsent(harness);
    await submit(harness.render()); const tree = harness.render(); expect(harness.onClose).not.toHaveBeenCalled(); expect(tree.find(nameInput)?.props.value).toBe("Legal Reviewer"); expect(tree.find(node => node.props.type === "checkbox")?.props.checked).toBe(true);
    expect(text(tree)).toContain("ERPNext save failed"); expect(tree.some(node => node.type === "button" && label(node.props.children as ReactNode) === "Cancel")).toBe(true);
    await submit(tree); expect(action.mock.calls[0]).toEqual(action.mock.calls[1]);
  });
  it("shows the requested unavailable message and disables confirmation for a missing PDF", async () => {
    state.read.mockRejectedValue(new Error("Document not found.")); const harness = workspace(); harness.render(); await harness.flush(); const tree = harness.render();
    expect(text(tree)).toContain("Contract document is not available for signing."); expect(confirm(tree)?.props.disabled).toBe(true); expect(tree.some(node => node.type === ClmPdfPreview)).toBe(false);
  });
  it("rejects corrupt bytes even if the response claims PDF content type", async () => {
    state.read.mockResolvedValue(new Blob(["invalid-contract-pdf"], { type: "application/pdf" })); const harness = workspace(); harness.render(); await harness.flush(); const tree = harness.render();
    expect(text(tree)).toContain("The contract PDF could not be opened."); expect(state.createUrl).not.toHaveBeenCalled(); expect(tree.some(node => node.type === ClmPdfPreview)).toBe(false); await submit(tree); expect(harness.onAction).not.toHaveBeenCalled();
  });
  it("revokes confirmation when a previously opened PDF fails to render", async () => {
    const harness = workspace(); harness.render(); await harness.flush(); readyPdf(harness); enterName(harness); giveConsent(harness);
    let tree = harness.render(); expect(confirm(tree)?.props.disabled).toBe(false);
    (tree.find(node => node.type === ClmPdfPreview)!.props.onError as (error: Error) => void)(new Error("PDF rendering failed"));
    tree = harness.render(); expect(text(tree)).toContain("PDF rendering failed"); expect(confirm(tree)?.props.disabled).toBe(true); expect(tree.find(node => node.props.type === "checkbox")?.props.checked).toBe(false); await submit(tree); expect(harness.onAction).not.toHaveBeenCalled();
  });
  it("accepts the exact reviewed supplier Contract document without signing it or accepting its PO", async () => {
    const harness = workspace(undefined, true, "accept"); harness.render(); await harness.flush();
    expect(state.read).toHaveBeenCalledWith("Contract", "CON-1", "current_pdf", "LEGAL-SIGNED-PDF", "1.0");
    expect(text(harness.render())).toContain("Supplier Contract Acceptance");
    expect(harness.render().find(nameInput)).toBeUndefined();
    giveConsent(harness); expect(confirm(harness.render())?.props.disabled).toBe(true);
    await submit(harness.render()); expect(harness.onAction).not.toHaveBeenCalled();
    readyPdf(harness); giveConsent(harness); await submit(harness.render());
    expect(harness.onAction).toHaveBeenCalledExactlyOnceWith("supplier_accept", "", { consent: true, expected_version: "1.0", document_file_id: "LEGAL-SIGNED-PDF", document_hash: "a".repeat(64), request_id: expect.any(String) }, "version-a");
    expect(harness.onClose).toHaveBeenCalledOnce();
  });
  it("requires supplier name, email, rendered PDF and explicit consent before the existing sign transaction", async () => {
    const harness = workspace(undefined, true); harness.render(); await harness.flush(); readyPdf(harness);
    expect(text(harness.render())).toContain("Supplier E-Signature"); expect(text(harness.render())).not.toContain("sends the contract to Finance");
    enterName(harness, "Supplier Signer"); giveConsent(harness);
    expect(confirm(harness.render())?.props.disabled).toBe(true); await submit(harness.render()); expect(harness.onAction).not.toHaveBeenCalled();
    change(harness.render(), node => node.props["aria-label"] === "Signatory email", { value: "signer@example.test" });
    expect(harness.render().find(node => node.props.type === "checkbox")?.props.checked).toBe(false);
    giveConsent(harness); await submit(harness.render());
    expect(harness.onAction).toHaveBeenCalledExactlyOnceWith("sign", "", { full_legal_name: "Supplier Signer", signer_email: "signer@example.test", signature: { method: "typed", value: "Supplier Signer", adopted: true }, consent: true, request_id: expect.any(String) }, "version-a");
    expect(harness.onClose).toHaveBeenCalledOnce();
  });
  it("uses the supplier grant without requiring the internal Legal readiness field and shows the accepted contract summary and exact consent", async () => {
    const harness = workspace(undefined, true); delete harness.saved.signature_workflow;
    harness.render(); await harness.flush(); readyPdf(harness);
    const initialTree = harness.render();
    expect(initialTree.find(node => node.type === "details")?.props.open).toBe(true);
    expect(text(initialTree)).toContain("Pending Supplier Signature");
    expect(text(initialTree)).not.toContain("Active");
    expect(text(initialTree)).toContain("I have reviewed the accepted contract and consent to sign it electronically as an authorized signatory.");
    expect(initialTree.find(node => node.props["aria-label"] === "Signatory role")?.props.required).not.toBe(true);
    enterName(harness, "Supplier Signer"); change(harness.render(), node => node.props["aria-label"] === "Signatory email", { value: "supplier@example.test" });
    giveConsent(harness); expect(confirm(harness.render())?.props.disabled).toBe(false);
    change(harness.render(), node => node.props["aria-label"] === "Signatory role", { value: "Commercial Director" });
    expect(confirm(harness.render())?.props.disabled).toBe(true); giveConsent(harness); await submit(harness.render());
    expect(harness.onAction).toHaveBeenCalledWith("sign", "", expect.objectContaining({ signatory_role: "Commercial Director", full_legal_name: "Supplier Signer", consent: true }), "version-a");
  });
  it.each(["missing acceptance", "missing action", "missing document binding"])("blocks supplier signature for %s without altering the internal completed route", async scenario => {
    const harness = workspace(undefined, true); harness.render(); await harness.flush(); readyPdf(harness);
    enterName(harness, "Supplier Signer"); change(harness.render(), node => node.props["aria-label"] === "Signatory email", { value: "signer@example.test" }); giveConsent(harness);
    if (scenario === "missing acceptance") harness.saved.supplier_workflow!.can_sign_contract = false;
    if (scenario === "missing action") harness.saved.actions = [];
    if (scenario === "missing document binding") delete harness.saved.supplier_workflow!.document_hash;
    const tree = harness.render(); expect(confirm(tree) === undefined || confirm(tree)?.props.disabled === true).toBe(true);
    await submit(tree); expect(harness.onAction).not.toHaveBeenCalled(); expect(harness.saved.record.custom_contract_status).toBe("Active");
  });
  it("keeps supplier acceptance review open on a backend save failure with its original document receipt", async () => {
    const action = vi.fn(async () => { throw new Error("Contract version changed before acceptance."); });
    const harness = workspace(action, true, "accept"); harness.render(); await harness.flush(); readyPdf(harness); giveConsent(harness);
    await submit(harness.render()); expect(harness.onClose).not.toHaveBeenCalled(); expect(text(harness.render())).toContain("Contract version changed");
    await submit(harness.render()); expect(action.mock.calls[0]).toEqual(action.mock.calls[1]);
  });
});
