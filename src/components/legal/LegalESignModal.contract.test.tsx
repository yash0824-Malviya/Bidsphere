import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[] }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial; return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }]; },
  useMemo: (factory: () => unknown) => factory(),
}));
import LegalESignModal from "./LegalESignModal";

type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!isValidElement(root)) return []; const element = root as Node; return [element, ...nodes(element.props.children as ReactNode)]; }
const label = (node: ReactNode): string => typeof node === "string" ? node : Array.isArray(node) ? node.map(label).join("") : isValidElement(node) ? label((node.props as { children?: ReactNode }).children) : "";
const button = (tree: Node[], name: string) => tree.find(node => node.type === "button" && label(node.props.children as ReactNode) === name)!;
const change = (node: Node, target: unknown) => (node.props.onChange as (event: unknown) => void)({ target });

function modal(workflow: "contract" | "rfq" | "business_case" = "contract", defaultFullName = "") {
  const onContinue = vi.fn(), onClose = vi.fn();
  const render = () => {
    hooks.index = 0;
    const body = LegalESignModal({ open: true, defaultFullName, workflow, caseId: "CON-1", onClose, onContinue })! as Node;
    return nodes((body.type as (props: Record<string, unknown>) => ReactNode)(body.props));
  };
  return { render, onContinue, onClose };
}

beforeEach(() => { hooks.index = 0; hooks.slots = []; vi.clearAllMocks(); });

describe("Existing signature modal isolates Contract capture and adoption", () => {
  it("starts blank, references the actual Contract and uses the existing PDF stamp style", () => {
    const tree = modal().render(), contents = tree.map(node => label(node.props.children as ReactNode)).join(" ");
    expect(tree.find(node => node.props["aria-label"] === "Signature text")?.props.value).toBe("");
    expect(contents).toContain("ADOPT CONTRACT SIGNATURE"); expect(contents).toContain("Contract:"); expect(contents).toContain("CON-1");
    expect(contents).not.toContain("Business Case:"); expect(contents).not.toContain("Select Signature Style");
    expect(tree.some(node => (node.props.style as Record<string, string> | undefined)?.fontFamily === '"Times New Roman", Times, serif' && (node.props.style as Record<string, string>).fontStyle === "italic")).toBe(true);
    expect(button(tree, "Adopt Signature").props.disabled).toBe(true);
  });
  it("requires separate signature text and explicit adoption before returning a signature", () => {
    const test = modal(); let tree = test.render();
    (button(tree, "Adopt Signature").props.onClick as () => void)(); expect(test.onContinue).not.toHaveBeenCalled();
    change(tree.find(node => node.props["aria-label"] === "Signature text")!, { value: " L. Reviewer " });
    tree = test.render(); expect(button(tree, "Adopt Signature").props.disabled).toBe(true);
    change(tree.find(node => node.props.type === "checkbox")!, { checked: true }); tree = test.render();
    expect(button(tree, "Adopt Signature").props.disabled).toBe(false);
    (button(tree, "Adopt Signature").props.onClick as () => void)();
    expect(test.onContinue).toHaveBeenCalledExactlyOnceWith({ typedName: "L. Reviewer", fontId: "great-vibes" });
  });
  it("requires re-adoption when editing a preserved captured signature and resets adoption after text changes", () => {
    const test = modal("contract", "L. Reviewer"); let tree = test.render();
    expect(tree.find(node => node.props["aria-label"] === "Signature text")?.props.value).toBe("L. Reviewer");
    expect(button(tree, "Adopt Signature").props.disabled).toBe(true);
    change(tree.find(node => node.props.type === "checkbox")!, { checked: true });
    change(tree.find(node => node.props["aria-label"] === "Signature text")!, { value: "Changed Signature" });
    tree = test.render(); expect(tree.find(node => node.props.type === "checkbox")?.props.checked).toBe(false); expect(button(tree, "Adopt Signature").props.disabled).toBe(true);
    (button(tree, "Cancel").props.onClick as () => void)(); expect(test.onClose).toHaveBeenCalledOnce(); expect(test.onContinue).not.toHaveBeenCalled();
  });
  it("does not use a supplied default as a fallback after Contract signature text is cleared", () => {
    const test = modal("contract", "Old Signature"); let tree = test.render();
    change(tree.find(node => node.props["aria-label"] === "Signature text")!, { value: " " });
    change(tree.find(node => node.props.type === "checkbox")!, { checked: true }); tree = test.render();
    expect(button(tree, "Adopt Signature").props.disabled).toBe(true); (button(tree, "Adopt Signature").props.onClick as () => void)(); expect(test.onContinue).not.toHaveBeenCalled();
  });
  it.each(["rfq", "business_case"] as const)("preserves the existing %s signature controls and consent defaults", workflow => {
    const tree = modal(workflow, "Legal Counsel").render(), contents = tree.map(node => label(node.props.children as ReactNode)).join(" ");
    expect(contents).toContain("Select Signature Style"); expect(contents).not.toContain("Adopt Signature");
    expect(tree.some(node => node.type === "input" && node.props.value === "Legal Counsel")).toBe(true);
    expect(tree.find(node => node.props.type === "checkbox")?.props.checked).toBe(workflow === "business_case");
    expect(button(tree, workflow === "rfq" ? "Continue to Signature Placement" : "Sign & Approve").props.disabled).toBe(workflow === "rfq");
  });
});
