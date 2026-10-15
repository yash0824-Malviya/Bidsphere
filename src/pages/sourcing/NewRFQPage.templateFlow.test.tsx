import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const defaultTemplate = {
    name: "TPL-RAW-MATERIALS-PROCUREMENT",
    template_name: "Raw Materials Procurement",
    category: "Raw Materials Procurement",
    procurement_type: "Direct" as const,
    cost_breakdown_required: true,
    contract_required: true,
    supplier_terms: "Custom raw material delivery terms",
    status: "Active" as const,
    items: [
      { item_code: "DIR-ALU-001", item_name: "Aluminum Sheet 6061-T6", qty: 10, uom: "Sheet" },
      { item_code: "DIR-ALU-002", item_name: "Aluminum Sheet 5052-H32", qty: 10, uom: "Sheet" },
      { item_code: "201", item_name: "Bonnet", qty: 5, uom: "Nos" },
    ],
    suppliers: [
      { supplier: "Atlantic Precision Manufacturing.", supplier_name: "Atlantic Precision Manufacturing." },
      { supplier: "Blue Ridge Manufacturing Inc", supplier_name: "Blue Ridge Manufacturing Inc" },
      { supplier: "Apex Fasteners Ltd", supplier_name: "Apex Fasteners Ltd" },
    ],
  };

  return {
    cursor: 0,
    slots: [] as unknown[],
    query: "",
    defaultTemplate,
    mockTemplate: { ...defaultTemplate },
    create: vi.fn().mockResolvedValue({ name: "PUR-RFQ-2026-00999" }),
    createMr: vi.fn(),
    navigate: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    pricing: vi.fn(),
    invalidate: vi.fn(),
  };
});

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const slot = harness.cursor++;
    if (!(slot in harness.slots)) {
      harness.slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    }
    return [
      harness.slots[slot],
      (next: unknown) => {
        harness.slots[slot] = typeof next === "function" ? (next as (prev: unknown) => unknown)(harness.slots[slot]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const slot = harness.cursor++;
    if (!(slot in harness.slots)) {
      harness.slots[slot] = { current: initial };
    }
    return harness.slots[slot];
  },
  useMemo: (compute: () => unknown) => compute(),
  useEffect: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => harness.navigate,
  useSearchParams: () => [new URLSearchParams(harness.query)],
  Link: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [harness.mockTemplate], isLoading: false, isFetching: false }),
}));

vi.mock("react-hot-toast", () => ({
  default: { error: harness.error, success: harness.success },
}));

vi.mock("../../api/erpnext", () => ({
  apiGet: vi.fn().mockImplementation((url: string) => {
    if (url.includes("/Item")) {
      return Promise.resolve([
        { item_code: "DIR-ALU-001", item_name: "Aluminum Sheet 6061-T6", item_group: "Aluminium", stock_uom: "Sheet" },
        { item_code: "DIR-ALU-002", item_name: "Aluminum Sheet 5052-H32", item_group: "Aluminium", stock_uom: "Sheet" },
        { item_code: "201", item_name: "Bonnet", item_group: "Raw Material", stock_uom: "Nos" },
      ]);
    }
    if (url.includes("/Supplier")) {
      return Promise.resolve([
        { name: "Atlantic Precision Manufacturing.", supplier_name: "Atlantic Precision Manufacturing.", disabled: 0 },
        { name: "Blue Ridge Manufacturing Inc", supplier_name: "Blue Ridge Manufacturing Inc", disabled: 0 },
        { name: "Apex Fasteners Ltd", supplier_name: "Apex Fasteners Ltd", disabled: 0 },
      ]);
    }
    return Promise.resolve([]);
  }),
  ENV_DEFAULTS: { company: "Netlink" },
}));

vi.mock("../../queryClient", () => ({
  queryClient: { invalidateQueries: harness.invalidate },
}));

vi.mock("../../api/sourcing", () => ({
  createRFQ: harness.create,
  getItemGroups: vi.fn(),
  updateRFQ: vi.fn(),
}));

vi.mock("../../api/rfqTargetPricingPersist", () => ({
  persistRfqTargetPricing: harness.pricing,
}));

vi.mock("../../api/createRFQFromMaterialRequest", () => ({
  ActiveRfqExistsError: class extends Error {},
  createRFQFromMaterialRequest: harness.createMr,
  buildRFQPrefillFromMaterialRequest: vi.fn(),
}));

vi.mock("../../api/materialRequestWorkflow", () => ({
  ensureItemsExistForNewMode: vi.fn(),
  fetchMaterialRequestWorkflow: vi.fn(),
}));

vi.mock("../../api/mrRfqAction", () => ({
  findActiveRfqForMaterialRequest: vi.fn(),
}));

vi.mock("../../api/rfqTemplates", () => ({
  getRFQTemplates: vi.fn().mockImplementation(() => Promise.resolve([harness.mockTemplate])),
  getRFQTemplate: vi.fn().mockImplementation(() => Promise.resolve(harness.mockTemplate)),
  createRFQTemplate: vi.fn().mockResolvedValue({ name: "TPL-NEW-SAVED" }),
}));

vi.mock("../../api/rfqTemplateStorage", () => ({
  incrementLocalTemplateUsage: vi.fn(),
}));

vi.mock("../../api/rfqCreationMeta", () => ({
  buildManualCreationMeta: vi.fn(),
  buildMetaFromTemplate: vi.fn(),
  formatRequiredDocumentsList: vi.fn(),
  stashRFQCreationMeta: vi.fn(),
}));

vi.mock("../../components/RFQItemLineRow", () => ({ default: () => null }));
vi.mock("../../components/ui", () => ({ ErpNextDatePicker: () => null }));
vi.mock("../../components/contracts/ClmFields", () => ({ ClmLinkInput: () => null }));
vi.mock("../../hooks/useDebounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("../../store/authStore", () => ({
  useAuthStore: (select: (state: unknown) => unknown) =>
    select({ user: { role: "procurement", email: "manager@example.test" } }),
}));
vi.mock("../../api/recommendSuppliers", () => ({
  canBypassSupplierCategoryFilter: () => true,
  fetchRecommendedSuppliers: vi.fn(),
}));

import NewRFQPage from "./NewRFQPage";

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode; onClick?: () => unknown }>;

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

function text(node: ReactNode): string {
  return typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join("")
      : isValidElement(node)
        ? text((node as Element).props.children)
        : "";
}

function render() {
  harness.cursor = 0;
  return NewRFQPage();
}

describe("Create RFQ from Template Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.cursor = 0;
    harness.slots = [];
    harness.query = "";
    harness.mockTemplate = { ...harness.defaultTemplate };
  });

  it("allows selecting a template, sets fresh Valid Till requirement, and saves new RFQ", async () => {
    // Initial render shows template selection mode
    const templateButton = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Use Template")
    );
    expect(templateButton).toBeDefined();
    templateButton!.props.onClick!();

    // Now in template selection view, find the template card and click it
    const useTplButton = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Raw Materials Procurement")
    );
    expect(useTplButton).toBeDefined();
    await useTplButton!.props.onClick!();

    // Wizard opens in Step 1 with template applied
    const step1El = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "Step1"
    );
    expect(step1El).toBeDefined();
    const step1Props = step1El!.props as {
      title: string;
      validTill: string;
      setValidTill: (d: string) => void;
      procurementType: string;
      procurementCategory: string;
      requireCostBreakdown: boolean;
    };

    expect(step1Props.title).toBe("Raw Materials Procurement");
    expect(step1Props.procurementType).toBe("Direct");
    expect(step1Props.procurementCategory).toBe("Raw Materials Procurement");
    expect(step1Props.requireCostBreakdown).toBe(true);

    // Fresh Valid Till date required
    expect(step1Props.validTill).toBe("");

    // Set fresh Valid Till date
    step1Props.setValidTill("2026-11-15");

    // Click Next to step 2 (Items)
    const nextBtn = elements(render()).find(
      (element) => element.type === "button" && text(element).trim() === "Next"
    );
    expect(nextBtn).toBeDefined();
    nextBtn!.props.onClick!();

    // Step 2 shows loaded items
    const step2El = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "Step2"
    );
    expect(step2El).toBeDefined();
    const step2Props = step2El!.props as {
      items: Array<{ item_code: string; uom: string; qty: number }>;
    };
    expect(step2Props.items.length).toBe(3);
    expect(step2Props.items.map((i) => i.item_code)).toEqual(["DIR-ALU-001", "DIR-ALU-002", "201"]);

    // Click Next to step 3 (Suppliers)
    const nextBtn2 = elements(render()).find(
      (element) => element.type === "button" && text(element).trim() === "Next"
    );
    expect(nextBtn2).toBeDefined();
    nextBtn2!.props.onClick!();

    // Click Next to step 4 (Review)
    const nextBtn3 = elements(render()).find(
      (element) => element.type === "button" && text(element).trim() === "Next"
    );
    expect(nextBtn3).toBeDefined();
    nextBtn3!.props.onClick!();

    // In step 4, click Create RFQ
    const createBtn = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Create RFQ")
    );
    expect(createBtn).toBeDefined();
    await createBtn!.props.onClick!();

    // Verify createRFQ payload contains the template's procurement category and type
    expect(harness.create).toHaveBeenCalledTimes(1);
    const payload = harness.create.mock.calls[0][0];
    expect(payload.custom_procurement_type).toBe("Direct");
    expect(payload.custom_procurement_category).toBe("Raw Materials Procurement");
    expect(payload.contract_required).toBe(true);
    expect(payload.items.length).toBe(3);
  });

  it("supports manual RFQ creation from scratch with user selected category", async () => {
    // Initial render: click Create from Scratch
    const scratchBtn = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Create from Scratch")
    );
    expect(scratchBtn).toBeDefined();
    scratchBtn!.props.onClick!();

    // Step 1: fill required fields
    const step1El = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "Step1"
    );
    expect(step1El).toBeDefined();
    const step1Props = step1El!.props as {
      setTitle: (t: string) => void;
      setValidTill: (d: string) => void;
      onProcurementTypeChange: (type: string) => void;
      onProcurementCategoryChange: (cat: string) => void;
    };

    step1Props.setTitle("Manual Direct RFQ");
    step1Props.setValidTill("2026-11-20");
    step1Props.onProcurementTypeChange("Direct");
    step1Props.onProcurementCategoryChange("Raw Material");

    // Next to Step 2
    const nextBtn = elements(render()).find(
      (element) => element.type === "button" && text(element).trim() === "Next"
    );
    expect(nextBtn).toBeDefined();
    nextBtn!.props.onClick!();

    // Step 2: configure item row
    const step2El = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "Step2"
    );
    expect(step2El).toBeDefined();
    const step2Props = step2El!.props as {
      updateItemRow: (id: string, patch: Record<string, unknown>) => void;
      items: Array<{ id: string }>;
    };
    step2Props.updateItemRow(step2Props.items[0].id, {
      item_code: "DIR-ALU-001",
      item_name: "Aluminum Sheet 6061-T6",
      item_group: "Aluminium",
      uom: "Sheet",
      qty: 15,
    });

    // Next to Step 3
    const nextBtn2 = elements(render()).find(
      (element) => element.type === "button" && text(element).trim() === "Next"
    );
    expect(nextBtn2).toBeDefined();
    nextBtn2!.props.onClick!();

    // Step 3: select suppliers
    const step3El = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "Step3"
    );
    expect(step3El).toBeDefined();
    const step3Props = step3El!.props as {
      toggleSupplier: (s: { name: string; supplier_name: string }) => void;
    };
    step3Props.toggleSupplier({ name: "Atlantic Precision Manufacturing.", supplier_name: "Atlantic Precision Manufacturing." });
    step3Props.toggleSupplier({ name: "Blue Ridge Manufacturing Inc", supplier_name: "Blue Ridge Manufacturing Inc" });

    // Next to Step 4
    const nextBtn3 = elements(render()).find(
      (element) => element.type === "button" && text(element).trim() === "Next"
    );
    expect(nextBtn3).toBeDefined();
    nextBtn3!.props.onClick!();

    // Select Contract Required: No
    const contractField = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "RfqContractRequirementField"
    );
    expect(contractField).toBeDefined();
    (contractField!.props as any).onChange("No");

    // Submit on Step 4
    const createBtn = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Create RFQ")
    );
    expect(createBtn).toBeDefined();
    await createBtn!.props.onClick!();

    expect(harness.create).toHaveBeenCalledTimes(1);
    const payload = harness.create.mock.calls[0][0];
    expect(payload.custom_procurement_type).toBe("Direct");
    expect(payload.custom_procurement_category).toBe("Raw Material");
  });

  it("shows validation error when template category is missing or invalid", async () => {
    // Template with missing category
    harness.mockTemplate = {
      ...harness.defaultTemplate,
      category: "" as any,
    };

    const templateButton = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Use Template")
    );
    expect(templateButton).toBeDefined();
    templateButton!.props.onClick!();

    const useTplButton = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Raw Materials Procurement")
    );
    expect(useTplButton).toBeDefined();
    await useTplButton!.props.onClick!();

    expect(harness.error).toHaveBeenCalledWith(
      expect.stringContaining("missing a Procurement Category"),
      expect.anything()
    );
  });

  it("preserves category across step navigation unless explicitly modified", async () => {
    const templateButton = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Use Template")
    );
    templateButton!.props.onClick!();

    const useTplButton = elements(render()).find(
      (element) => element.type === "button" && text(element).includes("Raw Materials Procurement")
    );
    await useTplButton!.props.onClick!();

    let step1El = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "Step1"
    );
    expect((step1El!.props as any).procurementCategory).toBe("Raw Materials Procurement");

    (step1El!.props as any).setValidTill("2026-11-15");

    // Navigate to Step 2
    elements(render()).find(
      (element) => element.type === "button" && text(element).trim() === "Next"
    )!.props.onClick!();

    // Navigate back to Step 1 using Previous button
    elements(render()).find(
      (element) => element.type === "button" && text(element).trim() === "Previous"
    )!.props.onClick!();

    // Verify category remains preserved
    step1El = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "Step1"
    );
    expect((step1El!.props as any).procurementCategory).toBe("Raw Materials Procurement");

    // Explicitly update category
    (step1El!.props as any).onProcurementCategoryChange("Production");
    step1El = elements(render()).find(
      (element) => typeof element.type === "function" && element.type.name === "Step1"
    );
    expect((step1El!.props as any).procurementCategory).toBe("Production");
  });
});
