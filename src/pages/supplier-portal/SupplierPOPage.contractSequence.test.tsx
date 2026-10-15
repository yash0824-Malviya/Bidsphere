import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  index: 0, slots: [] as unknown[], contract: null as unknown, delivery: null as unknown, verify: vi.fn(), accept: vi.fn(), error: vi.fn(),
  qc: { invalidateQueries: vi.fn(async () => undefined), refetchQueries: vi.fn(async () => undefined), setQueryData: vi.fn() },
}));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => { const index = state.index++; if (!(index in state.slots)) state.slots[index] = initial === null ? state.delivery : initial; return [state.slots[index], (next: unknown) => { state.slots[index] = typeof next === "function" ? next(state.slots[index]) : next; }]; }, useEffect: () => undefined, useMemo: (fn: () => unknown) => fn(),
}));
vi.mock("react-router-dom", async importOriginal => ({ ...await importOriginal<typeof import("react-router-dom")>(), useParams: () => ({ poName: "PO-1" }), useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => state.qc, useQuery: ({ queryKey }: { queryKey: string[] }) => ({
  isLoading: false, isError: false, refetch: vi.fn(),
  data: queryKey[0] === "supplier-portal-po" ? { name: "PO-1", supplier: "SUP-1", supplier_name: "Supplier One", company: "Company", docstatus: 1, status: "To Receive and Bill", currency: "USD", grand_total: 4500, transaction_date: "2026-09-29", items: [] }
    : queryKey[0] === "purchase-order-contract" ? { purchase_order: "PO-1", contract: state.contract } : queryKey[0] === "po-shipment" ? null : [],
}) }));
vi.mock("react-hot-toast", () => ({ default: Object.assign(vi.fn(), { error: state.error, success: vi.fn() }) }));
vi.mock("../../api/clm", () => ({ clmViewerKey: () => "supplier-viewer", getPurchaseOrderContract: vi.fn(), verifyPurchaseOrderContractAcceptance: state.verify }));
vi.mock("../../api/accounts", () => ({ getInvoicesForPO: vi.fn() }));
vi.mock("../../api/supplierPortal", () => ({ getSupplierPaymentSummaries: vi.fn() }));
vi.mock("../../api/purchasing", () => ({ getGRNsForPO: vi.fn(), getPurchaseOrder: vi.fn() }));
vi.mock("../../api/sourcing", () => ({ getSupplierQuotation: vi.fn(), getSupplierQuotationsBySupplier: vi.fn() }));
vi.mock("../../api/poDeliveryWorkflow", () => ({ acceptPO: state.accept, rejectPO: vi.fn(), markInTransit: vi.fn(), updateDeliveryDetails: vi.fn(), hydrateDeliveryStateFromErp: vi.fn(), isPoPendingSupplierAcceptance: (status: string) => !status || ["Pending Acceptance", "Pending Supplier Acceptance"].includes(status), saveDeliveryState: vi.fn(), syncDeliveryStateFromERPNext: vi.fn() }));
vi.mock("../../api/poShipment", () => ({ fetchPoShipment: vi.fn(), shipmentRecordToDeliveryState: vi.fn() }));
vi.mock("../../hooks/useSupplierSession", () => ({ useSupplierSession: () => ({ supplierName: "Supplier One", erpSupplierName: "SUP-1", isReady: true, isAuthenticated: true }) }));
vi.mock("../../utils/procurementStatusWorkflow", () => ({ buildPOWorkflowSteps: () => [], derivePOWorkflowSnapshot: () => ({ displayStatus: "Pending Supplier Acceptance", receivedPct: 0, billedPct: 0, workflowComplete: false }), logPoWorkflowSnapshot: vi.fn(), toSupplierTimelineSteps: () => [] }));
vi.mock("../../components/p2p/PurchaseOrderContractInformation", () => ({ default: () => null }));
vi.mock("../../components/ui/CalendarDatePicker", () => ({ default: () => null }));
import SupplierPOPage from "./SupplierPOPage";
import CalendarDatePicker from "../../components/ui/CalendarDatePicker";
type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!isValidElement(root)) return []; const element = root as Node; return [element, ...nodes(element.props.children as ReactNode)]; }
const label = (node: ReactNode): string => typeof node === "string" ? node : Array.isArray(node) ? node.map(label).join("") : isValidElement(node) ? label((node.props as { children?: ReactNode }).children) : "";
const render = () => { state.index = 0; return nodes(SupplierPOPage()); };
const button = (tree: Node[], name: string) => tree.find(node => node.type === "button" && label(node.props.children as ReactNode).trim() === name)!;
const click = (name: string) => { const node = button(render(), name); expect(node).toBeDefined(); (node.props.onClick as () => void)(); };
const contract = (ready: boolean) => ({ name: "CON-1", supplier_workflow: { can_accept_po: ready, po_acceptance_status: "Pending", blocked_reason: ready ? undefined : "Accept and sign the Contract first." } });
beforeEach(() => { state.index = 0; state.slots = []; state.delivery = null; state.contract = contract(false); vi.clearAllMocks(); state.verify.mockResolvedValue({ purchase_order: "PO-1", contract: contract(true) }); state.accept.mockResolvedValue({ po_name: "PO-1", status: "Accepted" }); });
function completeDeliveryForm() {
  click("Accept Purchase Order");
  const picker = render().find(node => node.type === CalendarDatePicker)!;
  (picker.props.onChange as (date: string) => void)("2026-10-02");
  click("Continue"); click("Continue");
}
describe("Supplier PO acceptance waits for its linked Contract", () => {
  it("disables PO acceptance until Contract acceptance and signature are persisted, while retaining Reject PO", () => {
    const tree = render(); expect(button(tree, "Accept Purchase Order").props.disabled).toBe(true);
    expect(button(tree, "Reject Purchase Order").props.disabled).toBe(false);
    click("Accept Purchase Order"); expect(state.error).toHaveBeenCalledWith("Accept and sign the Contract first."); expect(state.accept).not.toHaveBeenCalled();
  });
  it("preserves the normal no-Contract PO action", () => {
    state.contract = null; expect(button(render(), "Accept Purchase Order").props.disabled).toBe(false);
  });
  it("does not accept the PO automatically just because the Contract is fully signed", () => {
    state.contract = contract(true); expect(button(render(), "Accept Purchase Order").props.disabled).toBe(false);
    expect(state.verify).not.toHaveBeenCalled(); expect(state.accept).not.toHaveBeenCalled();
  });
  it("rechecks Contract readiness immediately before the existing explicit PO acceptance action", async () => {
    state.contract = contract(true); completeDeliveryForm(); click("Confirm Accept Purchase Order");
    await vi.waitFor(() => expect(state.accept).toHaveBeenCalledOnce());
    expect(state.verify).toHaveBeenCalledExactlyOnceWith("PO-1");
    expect(state.verify.mock.invocationCallOrder[0]).toBeLessThan(state.accept.mock.invocationCallOrder[0]);
    expect(state.accept).toHaveBeenCalledWith("PO-1", expect.objectContaining({ expected_delivery_date: "2026-10-02" }), "SUP-1");
  });
  it("blocks a stale open PO confirmation when the fresh Contract check fails", async () => {
    state.contract = contract(true); completeDeliveryForm(); state.verify.mockRejectedValue(new Error("Contract version changed; acceptance is required."));
    click("Confirm Accept Purchase Order");
    await vi.waitFor(() => expect(state.error).toHaveBeenCalledWith("Contract version changed; acceptance is required."));
    expect(state.accept).not.toHaveBeenCalled();
  });
  it("offers explicit reconfirmation when the saved PO acceptance predates the newly signed Contract", async () => {
    state.contract = contract(true); state.delivery = { status: "Accepted", supplier_accepted: true, supplier_acceptance_date: "2026-09-28 10:00:00" };
    completeDeliveryForm(); click("Confirm Accept Purchase Order");
    await vi.waitFor(() => expect(state.accept).toHaveBeenCalledOnce());
    expect(state.verify).toHaveBeenCalledExactlyOnceWith("PO-1");
    expect(state.accept).toHaveBeenCalledWith("PO-1", expect.objectContaining({ expected_delivery_date: "2026-10-02" }), "SUP-1", { reconfirmContractAcceptance: true });
  });
});
