import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testHarness = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  navigate: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
  rows: [
    {
      name: "PUR-SQTN-2026-00348",
      supplier: "SUP-001",
      supplier_name: "Acme Industrial",
      transaction_date: "2026-10-15",
      status: "Submitted",
    },
  ],
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const slot = testHarness.cursor++;
    if (!(slot in testHarness.slots)) {
      testHarness.slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    }
    return [
      testHarness.slots[slot],
      (next: unknown) => {
        testHarness.slots[slot] = typeof next === "function" ? (next as (prev: unknown) => unknown)(testHarness.slots[slot]) : next;
      },
    ];
  },
  useMemo: (compute: () => unknown) => compute(),
  useEffect: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => testHarness.navigate,
  useSearchParams: () => [new URLSearchParams()],
  Link: () => null,
}));

vi.mock("react-hot-toast", () => ({
  default: testHarness.toast,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      data: testHarness.rows,
      total_records: 1,
      total_pages: 1,
      current_page: 1,
    },
    isLoading: false,
  }),
}));

vi.mock("../../hooks/usePagination", () => ({
  usePagination: () => ({
    page: 1,
    pageSize: 20,
    setPage: vi.fn(),
    setPageSize: vi.fn(),
  }),
}));

vi.mock("../../hooks/useDebounce", () => ({
  useDebounce: (v: unknown) => v,
}));

vi.mock("../../components/sourcing/ViewQuotationModal", () => ({
  default: function MockViewQuotationModal(props: { sqName: string; onClose: () => void }) {
    return {
      type: "MockViewQuotationModal",
      props,
    };
  },
}));

import SupplierQuotationsListPage from "./SupplierQuotationsListPage";
import { TableRowActions } from "../../components/ui";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const el = node as Element;
  return [el, ...elements(el.props.children)];
}

describe("SupplierQuotationsListPage - Eye icon notification fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testHarness.cursor = 0;
    testHarness.slots = [];
  });

  it("does not show 'Open related RFQ to review' toast when clicking the eye icon", () => {
    testHarness.cursor = 0;
    const tree = SupplierQuotationsListPage();
    const all = elements(tree);

    // Find TableRowActions
    const rowActions = all.find((el) => el.type === TableRowActions);
    expect(rowActions).toBeDefined();

    const props = rowActions!.props as {
      onView?: () => void;
      items: { id: string; label: string; onClick: () => void }[];
    };

    // Invoke onView (eye icon handler)
    expect(props.onView).toBeDefined();
    props.onView!();

    // Verify toast was NOT called with any related RFQ message
    expect(testHarness.toast).not.toHaveBeenCalled();

    // Re-render to check if ViewQuotationModal opened
    testHarness.cursor = 0;
    const reRendered = SupplierQuotationsListPage();
    const reAll = elements(reRendered);
    const modal = reAll.find(
      (el) =>
        typeof el.type === "function" &&
        (el.type.name === "MockViewQuotationModal" || el.type.name === "default"),
    );
    expect(modal).toBeDefined();
    expect((modal!.props as { sqName: string }).sqName).toBe("PUR-SQTN-2026-00348");

    // Close the modal
    (modal!.props as { onClose: () => void }).onClose();

    // Re-render and verify modal is closed
    testHarness.cursor = 0;
    const closedTree = SupplierQuotationsListPage();
    const closedAll = elements(closedTree);
    const closedModal = closedAll.find(
      (el) =>
        typeof el.type === "function" &&
        (el.type.name === "MockViewQuotationModal" || el.type.name === "default"),
    );
    expect(closedModal).toBeUndefined();

    // Verify toast was never called during the entire open-and-close cycle
    expect(testHarness.toast).not.toHaveBeenCalled();
  });

  it("does not show toast when selecting View from the actions dropdown", () => {
    testHarness.cursor = 0;
    const tree = SupplierQuotationsListPage();
    const all = elements(tree);
    const rowActions = all.find((el) => el.type === TableRowActions);
    const props = rowActions!.props as {
      items: { id: string; label: string; onClick: () => void }[];
    };

    const viewItem = props.items.find((it) => it.id === "view");
    expect(viewItem).toBeDefined();
    viewItem!.onClick();

    expect(testHarness.toast).not.toHaveBeenCalled();
  });

  it("navigates to related RFQ without showing a toast notification", () => {
    testHarness.cursor = 0;
    const tree = SupplierQuotationsListPage();
    const all = elements(tree);
    const rowActions = all.find((el) => el.type === TableRowActions);
    const props = rowActions!.props as {
      items: { id: string; label: string; onClick: () => void }[];
    };

    const rfqItem = props.items.find((it) => it.id === "rfq");
    expect(rfqItem).toBeDefined();
    rfqItem!.onClick();

    expect(testHarness.navigate).toHaveBeenCalledWith("/sourcing/rfq?q=PUR-SQTN-2026-00348");
    expect(testHarness.toast).not.toHaveBeenCalled();
  });
});
