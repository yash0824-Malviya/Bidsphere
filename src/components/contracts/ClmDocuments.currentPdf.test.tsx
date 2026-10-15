import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ index: 0, slots: [] as unknown[], read: vi.fn(), error: vi.fn(), createUrl: vi.fn(() => "blob:current-contract"), revokeUrl: vi.fn() }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => { const index = state.index++; if (!(index in state.slots)) state.slots[index] = initial; return [state.slots[index], (value: unknown) => { state.slots[index] = value; }]; },
  useEffect: () => undefined,
}));
vi.mock("../../api/clm", () => ({ getClmDocumentBlob: state.read, clmError: (error: Error) => error.message }));
vi.mock("react-hot-toast", () => ({ default: { error: state.error } }));
vi.mock("./ClmFields", () => ({ CLM_BUTTON: "button", fieldLabel: (field: { label: string }) => field.label }));
vi.mock("./ContractPdfPreviewModal", () => ({ default: () => null }));
import ClmDocuments from "./ClmDocuments";
import ContractPdfPreviewModal from "./ContractPdfPreviewModal";

type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!isValidElement(root)) return []; const element = root as Node; return [element, ...nodes(element.props.children as ReactNode)]; }
const label = (node: ReactNode): string => typeof node === "string" ? node : Array.isArray(node) ? node.map(label).join("") : isValidElement(node) ? label((node.props as { children?: ReactNode }).children) : "";
const record = { name: "CON-1", custom_current_version: "2.0", custom_final_version_locked: 1 };
const render = () => { state.index = 0; return nodes(ClmDocuments({ doctype: "Contract", record, fields: [] })); };
const button = (tree: Node[], name: string) => tree.find(node => node.type === "button" && label(node.props.children as ReactNode) === name)!;
const invoke = (node: Node) => (node.props.onClick as () => void)();
beforeEach(() => { state.index = 0; state.slots = []; vi.clearAllMocks(); state.read.mockResolvedValue(new Blob(["%PDF-1.7\nImmutable bytes"], { type: "application/pdf" })); vi.spyOn(URL, "createObjectURL").mockImplementation(state.createUrl); vi.spyOn(URL, "revokeObjectURL").mockImplementation(state.revokeUrl); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Contract Documents authoritative PDF controls", () => {
  it("routes View Contract PDF to current_pdf and passes its exact downloaded bytes to the shared viewer", async () => {
    invoke(button(render(), "View Contract PDF"));
    await vi.waitFor(() => expect(state.slots[1]).toBe(""));
    expect(state.read).toHaveBeenCalledWith("Contract", "CON-1", "current_pdf", undefined, "2.0");
    const modal = render().find(node => node.type === ContractPdfPreviewModal)!;
    expect(modal.props.contractId).toBe("CON-1");
    const preview = modal.props.preview as { name: string; bytes: Uint8Array; url: string };
    expect(preview.name).toBe("CON-1-v2.0.pdf"); expect(preview.url).toBe("blob:current-contract");
    expect(new TextDecoder().decode(preview.bytes)).toBe("%PDF-1.7\nImmutable bytes");
    (modal.props.onClose as () => void)();
    expect(render().find(node => node.type === ContractPdfPreviewModal)).toBeUndefined();
    invoke(button(render(), "View Contract PDF"));
    await vi.waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
    expect(state.read.mock.calls[1][2]).toBe("current_pdf");
  });
  it("downloads the same current_pdf endpoint using a version-specific filename", async () => {
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });
    invoke(button(render(), "Download"));
    await vi.waitFor(() => expect(anchor.click).toHaveBeenCalledTimes(1));
    expect(state.read).toHaveBeenCalledWith("Contract", "CON-1", "current_pdf", undefined, "2.0");
    expect(anchor.download).toBe("CON-1-v2.0.pdf"); expect(anchor.href).toBe("blob:current-contract");
  });
  it("preserves a separate original preview and does not display a modal on integrity failure", async () => {
    invoke(button(render(), "Preview"));
    await vi.waitFor(() => expect(state.slots[1]).toBe(""));
    expect(state.read).toHaveBeenCalledWith("Contract", "CON-1", "locked_file", undefined, undefined);
    state.slots[0] = null; state.read.mockRejectedValueOnce(new Error("Contract PDF integrity check failed"));
    invoke(button(render(), "View Contract PDF"));
    await vi.waitFor(() => expect(state.error).toHaveBeenCalledWith("Contract PDF integrity check failed"));
    expect(render().find(node => node.type === ContractPdfPreviewModal)).toBeUndefined();
  });
});
