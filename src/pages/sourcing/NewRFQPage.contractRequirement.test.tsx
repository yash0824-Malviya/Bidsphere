import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], query: "", create: vi.fn(), createMr: vi.fn(), navigate: vi.fn(), error: vi.fn(), success: vi.fn(), pricing: vi.fn(), invalidate: vi.fn() }));
vi.mock("react", async original => ({ ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => { const slot = harness.cursor++; if (!(slot in harness.slots)) harness.slots[slot] = typeof initial === "function" ? initial() : initial; return [harness.slots[slot], (next: unknown) => { harness.slots[slot] = typeof next === "function" ? next(harness.slots[slot]) : next; }]; },
  useRef: (initial: unknown) => { const slot = harness.cursor++; if (!(slot in harness.slots)) harness.slots[slot] = { current: initial }; return harness.slots[slot]; },
  useMemo: (compute: () => unknown) => compute(), useEffect: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => harness.navigate, useSearchParams: () => [new URLSearchParams(harness.query)], Link: () => null }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isLoading: false, isFetching: false }) }));
vi.mock("react-hot-toast", () => ({ default: { error: harness.error, success: harness.success } }));
vi.mock("../../api/erpnext", () => ({ apiGet: vi.fn(), ENV_DEFAULTS: { company: "Netlink" } }));
vi.mock("../../queryClient", () => ({ queryClient: { invalidateQueries: harness.invalidate } }));
vi.mock("../../api/sourcing", () => ({ createRFQ: harness.create, getItemGroups: vi.fn(), updateRFQ: vi.fn() }));
vi.mock("../../api/rfqTargetPricingPersist", () => ({ persistRfqTargetPricing: harness.pricing }));
vi.mock("../../api/createRFQFromMaterialRequest", () => ({ ActiveRfqExistsError: class extends Error {}, createRFQFromMaterialRequest: harness.createMr, buildRFQPrefillFromMaterialRequest: vi.fn() }));
vi.mock("../../api/materialRequestWorkflow", () => ({ ensureItemsExistForNewMode: vi.fn(), fetchMaterialRequestWorkflow: vi.fn() }));
vi.mock("../../api/mrRfqAction", () => ({ findActiveRfqForMaterialRequest: vi.fn() }));
vi.mock("../../api/rfqTemplates", () => ({ getRFQTemplates: vi.fn(), getRFQTemplate: vi.fn() }));
vi.mock("../../api/rfqTemplateStorage", () => ({ incrementLocalTemplateUsage: vi.fn() }));
vi.mock("../../api/rfqCreationMeta", () => ({ buildManualCreationMeta: vi.fn(), buildMetaFromTemplate: vi.fn(), formatRequiredDocumentsList: vi.fn(), stashRFQCreationMeta: vi.fn() }));
vi.mock("../../components/RFQItemLineRow", () => ({ default: () => null }));
vi.mock("../../components/ui", () => ({ ErpNextDatePicker: () => null }));
vi.mock("../../components/contracts/ClmFields", () => ({ ClmLinkInput: () => null }));
vi.mock("../../hooks/useDebounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("../../store/authStore", () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { role: "procurement", email: "manager@example.test" } }) }));
vi.mock("../../api/recommendSuppliers", () => ({ canBypassSupplierCategoryFilter: () => true, fetchRecommendedSuppliers: vi.fn() }));
import NewRFQPage from "./NewRFQPage";
import RfqContractRequirementField from "../../components/sourcing/RfqContractRequirementField";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode; onClick?: () => unknown }>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement(node)) return []; const element = node as Element; return [element, ...elements(element.props.children)]; }
function text(node: ReactNode): string { return typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : isValidElement(node) ? text((node as Element).props.children) : ""; }
function render() { harness.cursor = 0; return NewRFQPage(); }
function component<T>(name: string): T { const node = elements(render()).find(element => typeof element.type === "function" && element.type.name === name); expect(node, name).toBeDefined(); return node!.props as T; }
function choice() { return elements(render()).find(element => element.type === RfqContractRequirementField)!.props as unknown as Parameters<typeof RfqContractRequirementField>[0]; }
function click(label: string) { const button = elements(render()).find(element => element.type === "button" && text(element).trim() === label); expect(button, label).toBeDefined(); return button!.props.onClick!(); }
function fillStep1() {
  if (!harness.query) {
    const scratch = elements(render()).find(element => element.type === "button" && text(element).trim().startsWith("Create from Scratch"));
    expect(scratch).toBeDefined(); scratch!.props.onClick!();
  }
  const fields = component<{ setTitle: (s: string) => void; setValidTill: (s: string) => void; onProcurementCategoryChange: (s: string) => void }>("Step1");
  fields.setTitle("Production steel procurement"); fields.setValidTill("2026-10-30"); fields.onProcurementCategoryChange("Raw Material");
}
function completeRemainingSteps() {
  expect(elements(render()).some(element => element.type === RfqContractRequirementField)).toBe(false);
  click("Next");
  expect(elements(render()).some(element => element.type === RfqContractRequirementField)).toBe(false);
  const items = component<{ items: Array<{ id: string }>; updateItemRow: (id: string, values: Record<string, unknown>) => void }>("Step2");
  items.updateItemRow(items.items[0].id, { item_group: "Steel", item_code: "DIR-STE-020", item_name: "Cold Rolled Steel 10", qty: 20, uom: "Kg" });
  click("Next");
  expect(elements(render()).some(element => element.type === RfqContractRequirementField)).toBe(false);
  const suppliers = component<{ toggleSupplier: (row: { name: string; supplier_name: string }) => void }>("Step3");
  suppliers.toggleSupplier({ name: "SUP-1", supplier_name: "Supplier One" }); suppliers.toggleSupplier({ name: "SUP-2", supplier_name: "Supplier Two" });
  click("Next");
}
beforeEach(() => {
  vi.clearAllMocks(); harness.cursor = 0; harness.slots = []; harness.query = "";
  const create = async (input: Record<string, unknown>) => ({ ...input, name: "RFQ-SAVED", docstatus: 0, status: "Draft" });
  harness.create.mockImplementation(create); harness.createMr.mockImplementation(create); harness.pricing.mockResolvedValue({});
});

describe("New RFQ wizard saves Contract Required as RFQ metadata", () => {
  it("asks only on Review & Submit and requires a choice before creation", async () => {
    fillStep1(); completeRemainingSteps(); expect(choice().value).toBe("");
    expect(harness.error).not.toHaveBeenCalled();
    const nodes = elements(render());
    const review = nodes.findIndex(element => typeof element.type === "function" && element.type.name === "Step4");
    const section = nodes.findIndex(element => element.type === "section" && element.props["aria-labelledby"] === "rfq-contract-management-heading");
    const previous = nodes.findIndex(element => element.type === "button" && text(element).trim() === "Previous");
    expect(review).toBeLessThan(section); expect(section).toBeLessThan(previous);
    expect(text(nodes[section])).toContain("Contract Management");
    await click("Create RFQ");
    expect(harness.error).toHaveBeenCalledWith("Select Yes or No for Contract Required before creating the RFQ.");
    expect(component("Step4")).toBeDefined(); expect(harness.create).not.toHaveBeenCalled(); expect(harness.createMr).not.toHaveBeenCalled();
  });
  it.each(["Yes", "No"] as const)("saves the selected %s on the RFQ draft and reports only RFQ creation", async required => {
    fillStep1(); completeRemainingSteps(); choice().onChange(required);
    expect(component<{ contractRequired: string }>("Step4").contractRequired).toBe(required);
    click("Previous"); click("Next");
    expect(choice().value).toBe(required);
    await click("Create RFQ");
    expect(harness.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ contract_required: required === "Yes", items: [expect.objectContaining({ item_code: "DIR-STE-020", qty: 20, uom: "Kg" })], suppliers: [{ supplier: "SUP-1", supplier_name: "Supplier One" }, { supplier: "SUP-2", supplier_name: "Supplier Two" }] }));
    expect(harness.createMr).not.toHaveBeenCalled(); expect(harness.success).toHaveBeenCalledExactlyOnceWith("RFQ RFQ-SAVED created");
    expect(harness.navigate).toHaveBeenCalledWith("/sourcing/rfq/RFQ-SAVED"); expect(harness.error).not.toHaveBeenCalled();
  });
  it("passes Yes into MR creation and does not require contract-stage terms", async () => {
    harness.query = "mr=MAT-MR-2026-00079"; fillStep1(); completeRemainingSteps(); choice().onChange("Yes"); await click("Create RFQ");
    expect(harness.createMr).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ material_request: "MAT-MR-2026-00079", contract_required: true }));
    expect(harness.create).not.toHaveBeenCalled(); expect(harness.createMr.mock.calls[0][0]).not.toHaveProperty("contract_start_date");
    expect(harness.createMr.mock.calls[0][0]).not.toHaveProperty("contract_type"); expect(harness.success).toHaveBeenCalledWith("RFQ RFQ-SAVED created");
  });
});
