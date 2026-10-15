import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  index: 0,
  slots: [] as unknown[],
  contract: null as unknown,
  delivery: null as unknown,
  po: null as unknown,
  sqList: [] as unknown[],
  sqDetail: null as unknown,
  directSq: null as unknown,
  verify: vi.fn(),
  accept: vi.fn(),
  error: vi.fn(),
  qc: {
    invalidateQueries: vi.fn(async () => undefined),
    refetchQueries: vi.fn(async () => undefined),
    setQueryData: vi.fn(),
  },
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.slots)) {
      state.slots[index] = initial === null ? state.delivery : initial;
    }
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] =
          typeof next === "function"
            ? (next as (prev: unknown) => unknown)(state.slots[index])
            : next;
      },
    ];
  },
  useEffect: (fn: () => void | (() => void)) => {
    fn();
  },
  useMemo: (fn: () => unknown) => fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useParams: () => ({ poName: "PO-100" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => state.qc,
  useQuery: ({ queryKey }: { queryKey: (string | unknown)[] }) => {
    const key = queryKey[0];
    if (key === "supplier-portal-po") {
      return {
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
        data: state.po,
      };
    }
    if (key === "purchase-order-contract") {
      return {
        isLoading: false,
        isError: false,
        data: { purchase_order: "PO-100", contract: state.contract },
      };
    }
    if (key === "po-shipment") {
      return { isLoading: false, isError: false, data: null };
    }
    if (key === "supplier-portal-po-sqs") {
      return { isLoading: false, isError: false, data: state.sqList };
    }
    if (key === "supplier-portal-po-sq-details") {
      return { isLoading: false, isError: false, data: state.sqDetail ? [state.sqDetail] : [] };
    }
    if (key === "supplier-portal-direct-sq") {
      return { isLoading: false, isError: false, data: state.directSq };
    }
    return { isLoading: false, isError: false, data: [] };
  },
}));

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), {
    error: state.error,
    success: vi.fn(),
  }),
}));

vi.mock("../../api/clm", () => ({
  clmViewerKey: () => "supplier-viewer",
  getPurchaseOrderContract: vi.fn(),
  verifyPurchaseOrderContractAcceptance: state.verify,
}));
vi.mock("../../api/accounts", () => ({ getInvoicesForPO: vi.fn() }));
vi.mock("../../api/supplierPortal", () => ({ getSupplierPaymentSummaries: vi.fn() }));
vi.mock("../../api/purchasing", () => ({ getGRNsForPO: vi.fn(), getPurchaseOrder: vi.fn() }));
vi.mock("../../api/sourcing", () => ({ getSupplierQuotation: vi.fn(), getSupplierQuotationsBySupplier: vi.fn() }));
vi.mock("../../api/poDeliveryWorkflow", () => ({
  acceptPO: state.accept,
  rejectPO: vi.fn(),
  markInTransit: vi.fn(),
  updateDeliveryDetails: vi.fn(),
  hydrateDeliveryStateFromErp: vi.fn(),
  isPoPendingSupplierAcceptance: (status: string) =>
    !status || ["Pending Acceptance", "Pending Supplier Acceptance"].includes(status),
  saveDeliveryState: vi.fn(),
  syncDeliveryStateFromERPNext: vi.fn(),
}));
vi.mock("../../api/poShipment", () => ({
  fetchPoShipment: vi.fn(),
  shipmentRecordToDeliveryState: vi.fn(),
}));
vi.mock("../../hooks/useSupplierSession", () => ({
  useSupplierSession: () => ({
    supplierName: "Supplier Acme",
    erpSupplierName: "SUP-ACME",
    isReady: true,
    isAuthenticated: true,
  }),
}));
vi.mock("../../utils/procurementStatusWorkflow", () => ({
  buildPOWorkflowSteps: () => [],
  derivePOWorkflowSnapshot: () => ({
    displayStatus: "Pending Supplier Acceptance",
    receivedPct: 0,
    billedPct: 0,
    workflowComplete: false,
  }),
  logPoWorkflowSnapshot: vi.fn(),
  toSupplierTimelineSteps: () => [],
}));
vi.mock("../../components/p2p/PurchaseOrderContractInformation", () => ({ default: () => null }));
vi.mock("../../components/ui/CalendarDatePicker", () => ({ default: () => null }));

import SupplierPOPage from "./SupplierPOPage";
import CalendarDatePicker from "../../components/ui/CalendarDatePicker";

type Node = ReactElement<Record<string, unknown>>;
function nodes(root: ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement(root)) return [];
  const element = root as Node;
  return [element, ...nodes(element.props.children as ReactNode)];
}

const label = (node: ReactNode): string =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(label).join("")
      : isValidElement(node)
        ? label((node.props as { children?: ReactNode }).children)
        : "";

const render = () => {
  state.index = 0;
  return nodes(SupplierPOPage());
};

const button = (tree: Node[], name: string) =>
  tree.find((node) => node.type === "button" && label(node.props.children as ReactNode).trim() === name);

const click = (name: string) => {
  const node = button(render(), name);
  expect(node).toBeDefined();
  if (!node) throw new Error(`Button not found: ${name}`);
  (node.props.onClick as () => void)();
};

const getDatePicker = (tree: Node[]) => tree.find((node) => node.type === CalendarDatePicker);

describe("SupplierPOPage Expected Delivery Date prefill from awarded Supplier Quotation", () => {
  beforeEach(() => {
    state.index = 0;
    state.slots = [];
    state.delivery = null;
    state.contract = null;
    state.po = {
      name: "PO-100",
      supplier: "SUP-ACME",
      supplier_name: "Supplier Acme",
      company: "Company",
      docstatus: 1,
      status: "To Receive and Bill",
      currency: "USD",
      grand_total: 10000,
      transaction_date: "2026-10-01",
      rfq_name: "PUR-RFQ-2026-0005",
      items: [
        {
          item_code: "STEEL-01",
          supplier_quotation: "PUR-SQTN-2026-00300",
        },
      ],
    };
    state.sqList = [{ name: "PUR-SQTN-2026-00300", status: "Submitted" }];
    state.directSq = {
      name: "PUR-SQTN-2026-00300",
      supplier: "SUP-ACME",
      supplier_name: "Supplier Acme",
      rfq_no: "PUR-RFQ-2026-0005",
      expected_delivery_date: "2026-11-15",
      items: [
        {
          item_code: "STEEL-01",
          expected_delivery_date: "2026-11-15",
        },
      ],
    };
    state.sqDetail = state.directSq;
    vi.clearAllMocks();
    state.verify.mockResolvedValue({ purchase_order: "PO-100", contract: null });
    state.accept.mockResolvedValue({ po_name: "PO-100", status: "Accepted" });
  });

  it("prefills Expected Delivery Date from the awarded Supplier Quotation when opening the Accept PO modal", () => {
    click("Accept Purchase Order");

    const tree = render();
    const datePicker = getDatePicker(tree);
    expect(datePicker).toBeDefined();
    expect(datePicker?.props.value).toBe("2026-11-15");

    // Displays clear attribution message
    const fullText = tree.map((n) => label(n)).join(" ");
    expect(fullText).toContain("Prefilled from your committed delivery date in Supplier Quotation");
    expect(fullText).toContain("PUR-SQTN-2026-00300");
  });

  it("extracts delivery date from quotation item row if header-level date is not set", () => {
    state.directSq = {
      name: "PUR-SQTN-2026-00300",
      supplier: "SUP-ACME",
      supplier_name: "Supplier Acme",
      rfq_no: "PUR-RFQ-2026-0005",
      items: [
        {
          item_code: "STEEL-01",
          delivery_date: "2026-11-20",
        },
      ],
    };
    state.sqDetail = state.directSq;

    click("Accept Purchase Order");

    const tree = render();
    const datePicker = getDatePicker(tree);
    expect(datePicker?.props.value).toBe("2026-11-20");
  });

  it("cleanses date with timestamp (e.g. 2026-11-20 00:00:00) to calendar YYYY-MM-DD preventing timezone shifts", () => {
    state.directSq = {
      name: "PUR-SQTN-2026-00300",
      supplier: "SUP-ACME",
      supplier_name: "Supplier Acme",
      expected_delivery_date: "2026-12-05 00:00:00",
      items: [],
    };
    state.sqDetail = state.directSq;

    click("Accept Purchase Order");

    const tree = render();
    const datePicker = getDatePicker(tree);
    expect(datePicker?.props.value).toBe("2026-12-05");
  });

  it("shows unavailable notice and requires input when quotation has no delivery date", () => {
    state.directSq = {
      name: "PUR-SQTN-2026-00300",
      supplier: "SUP-ACME",
      supplier_name: "Supplier Acme",
      items: [{ item_code: "STEEL-01" }],
    };
    state.sqDetail = state.directSq;

    click("Accept Purchase Order");

    const tree = render();
    const datePicker = getDatePicker(tree);
    expect(datePicker?.props.value).toBe("");

    // Message explaining committed date is unavailable
    const fullText = tree.map((n) => label(n)).join(" ");
    expect(fullText).toContain("committed delivery date is unavailable from the quotation");

    // Attempting to continue with empty date triggers error
    click("Continue");
    expect(state.error).toHaveBeenCalledWith("Expected Delivery Date is required.");
  });

  it("does NOT prefill date from another supplier's quotation", () => {
    state.directSq = {
      name: "PUR-SQTN-2026-00300",
      supplier: "SUP-OTHER",
      supplier_name: "Other Supplier Corp",
      expected_delivery_date: "2026-11-15",
      items: [],
    };
    state.sqDetail = state.directSq;

    click("Accept Purchase Order");

    const tree = render();
    const datePicker = getDatePicker(tree);
    expect(datePicker?.props.value).toBe("");
  });

  it("allows supplier to edit the prefilled date and submits the edited date", async () => {
    click("Accept Purchase Order");

    // Change prefilled date to custom date
    const picker = getDatePicker(render())!;
    (picker.props.onChange as (d: string) => void)("2026-11-30");

    click("Continue");
    click("Continue");
    click("Confirm Accept Purchase Order");

    await vi.waitFor(() => expect(state.accept).toHaveBeenCalledOnce());
    expect(state.accept).toHaveBeenCalledWith(
      "PO-100",
      expect.objectContaining({ expected_delivery_date: "2026-11-30" }),
      "SUP-ACME"
    );
  });
});
