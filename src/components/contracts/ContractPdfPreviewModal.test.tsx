import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  portal: vi.fn((element: unknown, _container: unknown) => element),
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => unknown) => state.effects.push(effect),
  useRef: (value: unknown) => ({ current: value }),
  useId: () => "contract-pdf-preview",
}));
vi.mock("react-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-dom")>(), createPortal: state.portal }));
vi.mock("./ClmPdfPreview", () => ({ default: () => null }));
import ContractPdfPreviewModal from "./ContractPdfPreviewModal";
import ClmPdfPreview from "./ClmPdfPreview";

type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement(root)) return [];
  const node = root as Node;
  return [node, ...nodes(node.props.children as ReactNode)];
}
const label = (value: ReactNode): string => typeof value === "string" ? value : Array.isArray(value) ? value.map(label).join("") : isValidElement(value) ? label((value.props as { children?: ReactNode }).children) : "";
const preview = { url: "blob:protected-contract", type: "application/pdf", name: "CON-2026-00001-approved.pdf", bytes: new Uint8Array([1, 2, 3]) };

beforeEach(() => { state.effects = []; vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("shared Contract PDF preview dialog", () => {
  it("portals above the complete application instead of remaining under the sidebar", () => {
    const body = { style: {} };
    vi.stubGlobal("document", { body });
    const result = ContractPdfPreviewModal({ contractId: "CON-2026-00001", preview, onClose: vi.fn() });
    expect(state.portal).toHaveBeenCalledOnce();
    expect(state.portal.mock.calls[0][1]).toBe(body);
    const tree = nodes(result);
    const dialog = tree.find(node => node.props.role === "dialog")!;
    expect(String(dialog.props["aria-modal"])).toBe("true");
    expect(String(dialog.props.className)).toContain("fixed");
    expect(String(dialog.props.className)).toMatch(/z-\[(?:1[3-9]\d{2}|[2-9]\d{3})\]/);
    expect(tree.some(node => String(node.props.className).includes("max-w-[1200px]"))).toBe(true);
  });

  it("keeps Contract identification, Close and Download outside the PDF renderer", () => {
    const onClose = vi.fn();
    const tree = nodes(ContractPdfPreviewModal({ contractId: "CON-2026-00001", preview, onClose }));
    const header = tree.find(node => node.type === "header")!;
    expect(label(header.props.children as ReactNode)).toContain("Contract PDF");
    expect(label(header.props.children as ReactNode)).toContain("CON-2026-00001");
    const headerNodes = nodes(header);
    expect(headerNodes.some(node => node.type === ClmPdfPreview)).toBe(false);
    const download = headerNodes.find(node => node.type === "a" && node.props.download);
    expect(download?.props).toMatchObject({ href: preview.url, download: preview.name });
    const close = headerNodes.find(node => node.type === "button" && /close/i.test(`${node.props["aria-label"] || ""} ${label(node.props.children as ReactNode)}`))!;
    (close.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape, confines keyboard focus, and restores the invoking control on cleanup", () => {
    const previous = { isConnected: true, focus: vi.fn() };
    const doc = { body: { style: { overflow: "auto" } }, documentElement: { style: { overflow: "hidden auto" } }, activeElement: previous, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("document", doc);
    const onClose = vi.fn();
    const tree = nodes(ContractPdfPreviewModal({ contractId: "CON-2026-00001", preview, onClose }));
    const first = { isConnected: true, focus: vi.fn() }, last = { isConnected: true, focus: vi.fn() };
    const close = tree.find(node => node.type === "button" && label(node.props.children as ReactNode) === "Close")!;
    (close.props.ref as { current: unknown }).current = last;
    const panel = tree.find(node => node.type === "div" && node.props.ref)!;
    (panel.props.ref as { current: unknown }).current = { querySelectorAll: () => [first, last] };
    const cleanup = state.effects[0]() as () => void;
    expect(doc.body.style.overflow).toBe("hidden");
    expect(doc.documentElement.style.overflow).toBe("hidden");
    expect(last.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(doc.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    const keydown = doc.addEventListener.mock.calls[0][1] as (event: unknown) => void;
    const forward = { key: "Tab", shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    doc.activeElement = last; keydown(forward);
    expect(forward.preventDefault).toHaveBeenCalledOnce(); expect(first.focus).toHaveBeenCalledOnce();
    const backward = { ...forward, shiftKey: true, preventDefault: vi.fn() };
    doc.activeElement = first; keydown(backward);
    expect(backward.preventDefault).toHaveBeenCalledOnce(); expect(last.focus).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    const escape = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    keydown(escape);
    expect(onClose).toHaveBeenCalledOnce();
    expect(escape.preventDefault).toHaveBeenCalledOnce(); expect(escape.stopPropagation).toHaveBeenCalledOnce();
    cleanup();
    expect(doc.removeEventListener).toHaveBeenCalledWith("keydown", keydown, true);
    expect(doc.body.style.overflow).toBe("auto");
    expect(doc.documentElement.style.overflow).toBe("hidden auto");
    expect(previous.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("opens the same protected PDF bytes at readable width-fit with page-fit controls and no extra fetch", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const savedBytes = preview.bytes.slice();
    const tree = nodes(ContractPdfPreviewModal({ contractId: "CON-2026-00001", preview, onClose: vi.fn() }));
    const renderer = tree.find(node => node.type === ClmPdfPreview)!;
    expect(renderer.props.bytes).toBe(preview.bytes);
    expect(renderer.props.fit).toBe("width");
    expect(renderer.props.fill).toBe(true);
    expect(renderer.props.showControls).toBe(true);
    expect(preview.bytes).toEqual(savedBytes);
    expect(fetch).not.toHaveBeenCalled();
    expect(tree.some(node => ["iframe", "object", "embed"].includes(String(node.type)))).toBe(false);
  });

  it("preserves image attachments without passing their content to the PDF renderer", () => {
    const tree = nodes(ContractPdfPreviewModal({ contractId: "CON-2026-00001", preview: { url: "blob:protected-image", type: "image/png", name: "evidence.png" }, onClose: vi.fn() }));
    expect(tree.find(node => node.type === "img")?.props).toMatchObject({ src: "blob:protected-image", alt: "evidence.png" });
    expect(tree.some(node => node.type === ClmPdfPreview)).toBe(false);
  });

  it("retains a real download for unsupported attachments instead of inventing a PDF preview", () => {
    const tree = nodes(ContractPdfPreviewModal({ contractId: "CON-2026-00001", preview: { url: "blob:protected-sheet", type: "application/vnd.ms-excel", name: "support.xls" }, onClose: vi.fn() }));
    expect(tree.map(node => label(node.props.children as ReactNode)).join(" ")).toMatch(/preview.*unavailable/i);
    expect(tree.some(node => node.type === ClmPdfPreview)).toBe(false);
    expect(tree.find(node => node.type === "a" && node.props.download)?.props).toMatchObject({ href: "blob:protected-sheet", download: "support.xls" });
  });
});
