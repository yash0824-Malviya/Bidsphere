import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClmPurchaseOrderContext } from "../../api/clm";

const h = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void>, query: "contract=CON-1", context: undefined as ClmPurchaseOrderContext | undefined, contextError: null as Error | null, contextLoading: false,
  legacy: false,
  legacyQuotes: undefined as Array<Record<string, unknown>> | undefined, legacyQuotesLoading: false, legacyQuotesError: null as Error | null,
  queries: [] as Array<Record<string, unknown>>, pending: [] as Promise<unknown>[], mutationIndex: 0, mutations: [] as Array<{ isError: boolean; error?: Error }>,
  get: vi.fn(), save: vi.fn(), create: vi.fn(), submit: vi.fn(), noPO: vi.fn(), navigate: vi.fn(), error: vi.fn(), success: vi.fn(), invalidate: vi.fn(), refetch: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = h.cursor++; if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? initial() : initial; return [h.slots[index], (next: unknown) => { h.slots[index] = typeof next === "function" ? next(h.slots[index]) : next; }]; },
  useEffect: (effect: () => void) => h.effects.push(effect),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => h.navigate, useSearchParams: () => [new URLSearchParams(h.query)], Link: () => null }));
vi.mock("react-hot-toast", () => ({ default: { error: h.error, success: h.success } }));
vi.mock("../../api/erpnext", () => ({ ENV_DEFAULTS: { company: "Netlink" } }));
vi.mock("../../api/purchasing", () => ({ assertNoPOForRFQ: h.noPO, createPurchaseOrder: h.create, submitPurchaseOrder: h.submit }));
vi.mock("../../api/clm", () => ({ clmError: (error: Error) => error?.message || "Failed", clmViewerKey: () => "session", getClmPurchaseOrderContext: h.get, saveClmPurchaseOrder: h.save }));
vi.mock("../../api/sourcing", () => ({ getRFQ: vi.fn(), getSupplierQuotations: vi.fn() }));
vi.mock("../../api/supplier", () => ({ getSuppliers: vi.fn() }));
vi.mock("../../api/legalDocs", () => ({ getLegalDocsByRfq: vi.fn() }));
vi.mock("../../components/ItemPicker", () => ({ default: () => null }));
vi.mock("../../components/ui", () => ({ ErpNextDatePicker: () => null, ErpNextDateDisplay: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => { h.queries.push(options); return options.queryKey[1] === "purchase-order"
    ? { data: h.context, isLoading: h.contextLoading, isError: !!h.contextError, error: h.contextError, refetch: h.refetch }
    : options.queryKey[0] === "supplier-options" ? { data: [], isLoading: false }
    : h.legacy && options.queryKey[0] === "legal-document-review" ? { data: { name: "LDC-27", rfq_name: "RFQ-104", sq_name: "SQ-273", review_status: "Approved", finance_status: "Approved", supplier: "SUP-1", grand_total: 4500 }, isLoading: false }
    : h.legacy && options.queryKey[0] === "rfq-for-po" ? { data: { name: "RFQ-104", items: [] }, isLoading: false }
    : h.legacy && options.queryKey[0] === "sq-for-po" ? { data: h.legacyQuotes, isLoading: h.legacyQuotesLoading, isError: !!h.legacyQuotesError, error: h.legacyQuotesError, isSuccess: !h.legacyQuotesLoading && !h.legacyQuotesError && !!h.legacyQuotes, refetch: h.refetch }
    : { data: undefined, isLoading: false }; },
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess: (result: unknown) => unknown; onError?: (error: Error) => void }) => {
    const index = h.mutationIndex++; h.mutations[index] ||= { isError: false };
    return { ...h.mutations[index], isPending: false, mutate: (input: unknown) => {
      h.pending.push(Promise.resolve().then(() => options.mutationFn(input)).then(options.onSuccess).catch((error: Error) => { h.mutations[index] = { isError: true, error }; options.onError?.(error); }));
    } };
  },
}));
import NewPurchaseOrderPage from "./NewPurchaseOrderPage";
import { ErpNextDatePicker } from "../../components/ui";
type Element = ReactElement<Record<string, unknown> & { children?: ReactNode; onClick?: () => unknown; onChange?: (event: unknown) => unknown }>;
function nodes(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement(node)) return []; const el = node as Element; return [el, ...nodes(el.props.children)]; }
function text(node: ReactNode): string { return typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : isValidElement(node) ? text((node as Element).props.children) : ""; }
function render() { h.cursor = 0; h.mutationIndex = 0; h.effects = []; return NewPurchaseOrderPage(); }
function load() { render(); const effects = h.effects; effects.forEach(effect => effect()); return render(); }
function input(label: string) { return nodes(render()).find(node => node.props["aria-label"] === label)!; }
function requiredBy() { return nodes(render()).find(node => node.type === ErpNextDatePicker)!; }
function expectCommercialFieldsLocked(tree: ReactNode, itemCodes: string[]) {
  const supplier = nodes(tree).find(node => node.props["aria-label"] === "Supplier")!;
  expect(supplier.props.disabled).toBe(true);
  expect(supplier.props.onChange).toBeUndefined();
  for (const code of itemCodes) {
    for (const label of ["Item code", "Item name", "Quantity", "UOM", "Rate"]) {
      const field = nodes(tree).find(node => node.props["aria-label"] === `${label} for ${code}`)!;
      expect(field, `${label} for ${code}`).toBeDefined();
      expect(field.props.readOnly).toBe(true);
      expect(field.props["aria-readonly"]).toBe(true);
      expect(field.props.onChange).toBeUndefined();
    }
  }
  expect(text(tree)).not.toContain("Add Row");
  const itemTable = nodes(tree).find(node => node.type === "table")!;
  expect(nodes(itemTable).filter(node => node.type === "button")).toHaveLength(0);
}
async function click(label: string) { const node = nodes(render()).find(node => node.type === "button" && text(node).trim() === label); expect(node, label).toBeDefined(); node!.props.onClick!(); await Promise.all(h.pending); }
beforeEach(() => {
  vi.clearAllMocks(); h.cursor = 0; h.slots = []; h.effects = []; h.queries = []; h.pending = []; h.mutationIndex = 0; h.mutations = []; h.query = "contract=CON-1"; h.contextError = null; h.contextLoading = false; h.legacy = false;
  h.legacyQuotesLoading = false; h.legacyQuotesError = null;
  h.legacyQuotes = [{ name: "SQ-273", supplier: "SUP-1", supplier_name: "Atlantic", grand_total: 4500, items: [{ item_code: "STEEL-6", item_name: "Cold Rolled Steel 6", qty: 100, uom: "Kg", rate: 25 }, { item_code: "STEEL-10", qty: 80, uom: "Kg", rate: 25 }] }];
  h.context = { contract: "CON-1", expected_modified: "reviewed-revision", rfq: "RFQ-104", award: "LDC-27", quotation: "SQ-273", supplier: "SUP-1", award_value: 4500, currency: "USD", completed: false, payload: {
    supplier: "SUP-1", supplier_name: "Atlantic", company: "Netlink", currency: "USD", transaction_date: "2026-09-29", schedule_date: "2026-10-10", terms: "Net 30. Deliver to approved site.",
    items: [{ name: "ROW-1", item_code: "STEEL-6", item_name: "Cold Rolled Steel 6", qty: 100, uom: "Kg", rate: 25, supplier_quotation: "SQ-273", supplier_quotation_item: "SQ-ROW-1", schedule_date: "2026-10-10" }, { name: "ROW-2", item_code: "STEEL-10", qty: 80, uom: "Kg", rate: 25, supplier_quotation: "SQ-273", supplier_quotation_item: "SQ-ROW-2", schedule_date: "2026-10-10" }],
  } };
  h.save.mockResolvedValue({ contract: "CON-1", purchase_order: { name: "PO-1", docstatus: 1 }, completed: true, reused: false }); h.refetch.mockResolvedValue({}); h.invalidate.mockResolvedValue(undefined);
});

describe("existing New Purchase Order form with a Contract source", () => {
  it("prefills exact persisted Contract/Award values and preserves source bindings", async () => {
    Object.assign(h.context!.payload, { doctype: "Purchase Order", custom_clm_contract: "CON-1", custom_clm_creation_key: "server-only", docstatus: 0 });
    const tree = load();
    expect(text(tree)).toContain("RFQ-104"); expect(text(tree)).toContain("LDC-27"); expect(text(tree)).toContain("SQ-273"); expect(text(tree)).toContain("Net 30. Deliver to approved site.");
    expectCommercialFieldsLocked(tree, ["STEEL-6", "STEEL-10"]);
    expect(input("Quantity for STEEL-6").props.value).toBe(100); expect(input("Rate for STEEL-6").props.value).toBe(25); expect(input("UOM for STEEL-10").props.value).toBe("Kg");
    expect(nodes(tree).find(node => node.type === "select")!.props.disabled).toBe(true);
    expect(h.queries.filter(query => (query.queryKey as string[])[1] !== "purchase-order").every(query => query.enabled === false)).toBe(true);
    await click("Create & Submit Purchase Order");
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ name: "CON-1", expected_modified: "reviewed-revision", operation: "submit", payload: expect.objectContaining({ supplier: "SUP-1", company: "Netlink", currency: "USD", terms: "Net 30. Deliver to approved site.", items: [expect.objectContaining({ qty: 100, rate: 25, supplier_quotation: "SQ-273", supplier_quotation_item: "SQ-ROW-1" }), expect.objectContaining({ qty: 80, rate: 25, supplier_quotation: "SQ-273", supplier_quotation_item: "SQ-ROW-2" })] }) }));
    expect(h.create).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled(); expect(h.noPO).not.toHaveBeenCalled();
    for (const field of ["doctype", "custom_clm_contract", "custom_clm_creation_key", "docstatus"]) expect(h.save.mock.calls[0][0].payload).not.toHaveProperty(field);
    expect(h.navigate).toHaveBeenCalledWith("/contracts/CON-1"); expect(h.success).toHaveBeenCalledWith(expect.stringContaining("Contract finalized"));
  });
  it("saves a draft through the same idempotent transaction without finalizing", async () => {
    h.save.mockResolvedValue({ contract: "CON-1", purchase_order: { name: "PO-DRAFT", docstatus: 0 }, completed: false, reused: false });
    load(); await click("Save Draft");
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ operation: "save_draft" }));
    expect(h.refetch).toHaveBeenCalledOnce(); expect(h.navigate).not.toHaveBeenCalled(); expect(h.success).toHaveBeenCalledWith(expect.stringContaining("Submit the PO to complete"));
  });
  it("keeps the required-by date editable while preserving awarded lines and totals in the submitted payload", async () => {
    const tree = load();
    const footer = nodes(tree).find(node => node.type === "tfoot")!;
    expect(text(footer)).toContain("4,500");
    const amountCells = nodes(tree).filter(node => node.type === "td").map(text);
    expect(amountCells.some(value => value.includes("2,500"))).toBe(true);
    expect(amountCells.some(value => value.includes("2,000"))).toBe(true);
    expect(requiredBy().props.disabled).not.toBe(true);
    requiredBy().props.onChange!("2026-10-21");
    await click("Create & Submit Purchase Order");
    const payload = h.save.mock.calls[0][0].payload;
    expect(payload.schedule_date).toBe("2026-10-21");
    expect(payload.items).toEqual([
      expect.objectContaining({ item_code: "STEEL-6", item_name: "Cold Rolled Steel 6", qty: 100, uom: "Kg", rate: 25, amount: 2500, schedule_date: "2026-10-21" }),
      expect.objectContaining({ item_code: "STEEL-10", qty: 80, uom: "Kg", rate: 25, amount: 2000, schedule_date: "2026-10-21" }),
    ]);
  });
  it("retains the required-by date and locked award values after a backend failure", async () => {
    load(); requiredBy().props.onChange!("2026-10-21");
    h.save.mockRejectedValue(new Error("PO amount does not match the approved award.")); await click("Create & Submit Purchase Order");
    expect(h.save.mock.calls[0][0].payload.items[0].qty).toBe(100);
    expect(input("Quantity for STEEL-6").props.value).toBe(100); expect(input("Rate for STEEL-6").props.value).toBe(25);
    expect(requiredBy().props.value).toBe("2026-10-21");
    expectCommercialFieldsLocked(render(), ["STEEL-6", "STEEL-10"]);
    expect(text(render())).toContain("PO amount does not match the approved award.");
    expect(h.success).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled();
  });
  it("does not show a form after backend permission or Finance validation failure", () => {
    h.context = undefined; h.contextError = new Error("Only Procurement Team can create this Contract Purchase Order.");
    const tree = render(); expect(text(tree)).toContain("Only Procurement Team"); expect(text(tree)).not.toContain("Create & Submit Purchase Order"); expect(h.save).not.toHaveBeenCalled();
  });
  it("shows the saved PO after a retry instead of offering duplicate creation", () => {
    h.context!.completed = true; h.context!.purchase_order = { name: "PO-1", supplier: "SUP-1", company: "Netlink", transaction_date: "2026-09-29", items: [], docstatus: 1 };
    const tree = load(); expect(text(tree)).toContain("PO Created Successfully"); expect(text(tree)).toContain("PO-1"); expect(text(tree)).not.toContain("Create & Submit Purchase Order");
    expect(nodes(tree).some(node => node.props.to === "/p2p/purchase-orders/PO-1")).toBe(true); expect(h.save).not.toHaveBeenCalled();
  });
  it("keeps the existing non-CLM RFQ PO creation and submission functions", async () => {
    h.query = "rfq=RFQ-104"; h.context = undefined; h.legacy = true;
    h.create.mockResolvedValue({ name: "LEGACY-PO" }); h.submit.mockResolvedValue({ name: "LEGACY-PO", docstatus: 1 }); h.noPO.mockResolvedValue(undefined);
    expectCommercialFieldsLocked(load(), ["STEEL-6", "STEEL-10"]); await click("Submit PO");
    expect(h.noPO).toHaveBeenCalledWith("RFQ-104"); expect(h.create).toHaveBeenCalledOnce(); expect(h.submit).toHaveBeenCalledWith("LEGACY-PO"); expect(h.save).not.toHaveBeenCalled();
    expect(h.create.mock.calls[0][0].items).toEqual([
      expect.objectContaining({ item_code: "STEEL-6", qty: 100, uom: "Kg", rate: 25, amount: 2500 }),
      expect.objectContaining({ item_code: "STEEL-10", qty: 80, uom: "Kg", rate: 25, amount: 2000 }),
    ]);
    expect(h.navigate).toHaveBeenCalledWith("/p2p/purchase-orders/LEGACY-PO");
    expect(h.queries.filter(query => (query.queryKey as string[])[1] === "purchase-order").every(query => query.enabled === false)).toBe(true);
  });
  it("displays the persisted supplier when the supplier options query is empty", () => {
    h.query = "rfq=RFQ-104"; h.context = undefined; h.legacy = true;
    const tree = load();
    const supplier = nodes(tree).find(node => node.props["aria-label"] === "Supplier")!;
    expect(supplier.props.disabled).toBe(true);
    expect(supplier.props.value).toBe("SUP-1");
    const selectedOption = nodes(supplier).find(node => node.type === "option" && node.props.value === "SUP-1");
    expect(selectedOption).toBeDefined();
    expect(text(selectedOption)).toBe("Atlantic");
  });
  it("locks the exact approved quotation when the same supplier has another quotation first", () => {
    h.query = "rfq=RFQ-104"; h.context = undefined; h.legacy = true;
    h.legacyQuotes!.unshift({ name: "SQ-OLD", supplier: "SUP-1", supplier_name: "Atlantic", grand_total: 1, items: [{ item_code: "OTHER", qty: 1, uom: "Nos", rate: 1 }] });
    const tree = load();
    expectCommercialFieldsLocked(tree, ["STEEL-6", "STEEL-10"]);
    expect(input("Item code for OTHER")).toBeUndefined();
    expect(input("Quantity for STEEL-6").props.value).toBe(100);
    expect(input("Rate for STEEL-6").props.value).toBe(25);
  });
  it("does not replace a missing approved quotation with another quote from the same supplier", () => {
    h.query = "rfq=RFQ-104"; h.context = undefined; h.legacy = true;
    h.legacyQuotes = [{ name: "SQ-OLD", supplier: "SUP-1", supplier_name: "Atlantic", grand_total: 1, items: [{ item_code: "OTHER", qty: 1, uom: "Nos", rate: 1 }] }];
    const tree = load();
    expect(text(tree)).toContain("Awarded quotation unavailable");
    expect(text(tree)).not.toContain("Submit PO");
    expect(text(tree)).not.toContain("Save Draft");
    expect(input("Item code for OTHER")).toBeUndefined();
    expect(h.create).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });
  it("waits for the winning quotation before locking any RFQ item values", () => {
    h.query = "rfq=RFQ-104"; h.context = undefined; h.legacy = true;
    const quotations = h.legacyQuotes;
    h.legacyQuotes = undefined; h.legacyQuotesLoading = true;
    expect(text(load())).not.toContain("Submit PO");
    h.legacyQuotes = quotations; h.legacyQuotesLoading = false;
    expectCommercialFieldsLocked(load(), ["STEEL-6", "STEEL-10"]);
    expect(input("Rate for STEEL-6").props.value).toBe(25);
  });
  it("does not offer creation when winning quotation loading fails", () => {
    h.query = "rfq=RFQ-104"; h.context = undefined; h.legacy = true;
    h.legacyQuotes = undefined; h.legacyQuotesError = new Error("Quotation unavailable");
    const tree = load();
    expect(text(tree)).not.toContain("Submit PO");
    expect(h.create).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
  });
});
