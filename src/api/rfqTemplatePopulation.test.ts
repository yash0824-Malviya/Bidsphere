import { describe, it, expect, beforeEach } from "vitest";

// In-memory localStorage mock for node test runner
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, String(value)),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

import {
  STANDARD_RFQ_TEMPLATES,
  ensureStandardTemplatesPopulated,
  getCategoryAvailability,
  INITIAL_TEMPLATES_STORAGE_KEY,
} from "./rfqTemplatePopulation";
import {
  getRFQTemplates,
  getRFQTemplate,
  createRFQTemplate,
  updateRFQTemplate,
  activateRFQTemplate,
  deactivateRFQTemplate,
  archiveRFQTemplate,
} from "./rfqTemplates";

describe("RFQ Template Library — Population from Existing Data", () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it("populates the 5 standard reusable templates from verified ERP data", () => {
    const templates = ensureStandardTemplatesPopulated();

    expect(templates).toHaveLength(5);

    const categories = templates.map((t) => t.category);
    expect(categories).toContain("Raw Materials Procurement");
    expect(categories).toContain("Spare Parts & Maintenance");
    expect(categories).toContain("Office Supplies");
    expect(categories).toContain("Electrical & Industrial Components");
    expect(categories).toContain("General Procurement");
  });

  it("populates Raw Materials Procurement strictly with verified Item Master and active Supplier records", () => {
    const templates = ensureStandardTemplatesPopulated();
    const rawMaterials = templates.find(
      (t) => t.category === "Raw Materials Procurement"
    );

    expect(rawMaterials).toBeDefined();
    expect(rawMaterials?.procurement_type).toBe("Direct");
    expect(rawMaterials?.cost_breakdown_required).toBe(true);
    expect(rawMaterials?.contract_required).toBe(true);

    const itemCodes = rawMaterials?.items.map((i) => i.item_code);
    expect(itemCodes).toEqual(["DIR-ALU-001", "DIR-ALU-002", "201"]);

    const uoms = rawMaterials?.items.map((i) => i.uom);
    expect(uoms).toEqual(["Sheet", "Sheet", "Nos"]);

    const suppliers = rawMaterials?.suppliers.map((s) => s.supplier);
    expect(suppliers).toEqual([
      "Atlantic Precision Manufacturing.",
      "Blue Ridge Manufacturing Inc",
      "Apex Fasteners Ltd",
    ]);
  });

  it("populates Spare Parts & Maintenance strictly with verified Item Master and active Supplier records", () => {
    const templates = ensureStandardTemplatesPopulated();
    const spareParts = templates.find(
      (t) => t.category === "Spare Parts & Maintenance"
    );

    expect(spareParts).toBeDefined();
    expect(spareParts?.procurement_type).toBe("Direct");
    expect(spareParts?.cost_breakdown_required).toBe(true);
    expect(spareParts?.contract_required).toBe(false);

    const itemCodes = spareParts?.items.map((i) => i.item_code);
    expect(itemCodes).toEqual([
      "AP001",
      "AP002",
      "BRK001",
      "DIR-BEA-001",
      "DIR-FAS-001",
    ]);

    const suppliers = spareParts?.suppliers.map((s) => s.supplier);
    expect(suppliers).toEqual([
      "Autodyne Manufacturing Co Inc",
      "Bosch México",
      "Liberty Components Corporation",
      "Frontier Industrial Solutions Inc.",
    ]);
  });

  it("handles Office Supplies safely with 0 matching ERP records and clear manual configuration indication", () => {
    const templates = ensureStandardTemplatesPopulated();
    const office = templates.find((t) => t.category === "Office Supplies");

    expect(office).toBeDefined();
    expect(office?.procurement_type).toBe("Indirect");
    expect(office?.items).toHaveLength(0); // 0 matching records in Item Master

    const availability = getCategoryAvailability(office!);
    expect(availability.hasData).toBe(false);
    expect(availability.message).toBe(
      "No matching Item Master records found in ERP. Configure items manually."
    );

    const suppliers = office?.suppliers.map((s) => s.supplier);
    expect(suppliers).toEqual([
      "Northstar Procurement Services",
      "Pioneer Equipment Solutions",
    ]);
  });

  it("populates Electrical & Industrial Components strictly with verified Item Master records", () => {
    const templates = ensureStandardTemplatesPopulated();
    const electrical = templates.find(
      (t) => t.category === "Electrical & Industrial Components"
    );

    expect(electrical).toBeDefined();
    expect(electrical?.procurement_type).toBe("Direct");
    expect(electrical?.cost_breakdown_required).toBe(true);
    expect(electrical?.contract_required).toBe(true);

    const itemCodes = electrical?.items.map((i) => i.item_code);
    expect(itemCodes).toEqual(["AC001", "APSU001", "AP006"]);

    const suppliers = electrical?.suppliers.map((s) => s.supplier);
    expect(suppliers).toEqual([
      "Aptiv",
      "Titan Industrial Products LLC",
      "Bosch México",
    ]);
  });

  it("populates General Procurement strictly with verified Item Master records", () => {
    const templates = ensureStandardTemplatesPopulated();
    const general = templates.find(
      (t) => t.category === "General Procurement"
    );

    expect(general).toBeDefined();
    expect(general?.procurement_type).toBe("Indirect");
    expect(general?.cost_breakdown_required).toBe(false);

    const itemCodes = general?.items.map((i) => i.item_code);
    expect(itemCodes).toEqual(["DIR-COR-001", "CF001", "CL001", "AB001"]);
  });

  it("does not automatically create duplicate templates on repeated actions", () => {
    const firstCall = ensureStandardTemplatesPopulated();
    expect(firstCall).toHaveLength(5);

    const secondCall = ensureStandardTemplatesPopulated();
    expect(secondCall).toHaveLength(5);

    const storageRaw = mockLocalStorage.getItem("bidsphere-rfq-templates");
    const stored = JSON.parse(storageRaw || "[]");
    expect(stored).toHaveLength(5);
  });

  it("supports activating and deactivating templates", async () => {
    ensureStandardTemplatesPopulated();

    // Deactivate
    const deactivated = await deactivateRFQTemplate("TPL-RAW-MATERIALS-PROCUREMENT");
    expect(deactivated.status).toBe("Inactive");

    const fetchedDeactivated = await getRFQTemplate("TPL-RAW-MATERIALS-PROCUREMENT");
    expect(fetchedDeactivated.status).toBe("Inactive");

    // Activate
    const activated = await activateRFQTemplate("TPL-RAW-MATERIALS-PROCUREMENT");
    expect(activated.status).toBe("Active");

    const fetchedActivated = await getRFQTemplate("TPL-RAW-MATERIALS-PROCUREMENT");
    expect(fetchedActivated.status).toBe("Active");
  });

  it("supports creating a custom template from scratch or saving an RFQ configuration", async () => {
    ensureStandardTemplatesPopulated();

    const created = await createRFQTemplate({
      template_name: "Machinery Spare Parts Custom",
      category: "Spare Parts & Maintenance",
      procurement_type: "Direct",
      rfq_type: "Standard RFQ",
      description: "Custom template for emergency maintenance repairs",
      status: "Active",
      cost_breakdown_required: true,
      contract_required: false,
      supplier_terms: "Immediate shipment within 24 hours.",
      items: [
        {
          item_code: "AP001",
          item_name: "Brake Disc",
          qty: 10,
          uom: "Nos",
        },
      ],
      suppliers: [
        {
          supplier: "Autodyne Manufacturing Co Inc",
          supplier_name: "Autodyne Manufacturing Co Inc",
        },
      ],
    });

    expect(created.name).toBeDefined();
    expect(created.template_name).toBe("Machinery Spare Parts Custom");
    expect(created.procurement_type).toBe("Direct");
    expect(created.cost_breakdown_required).toBe(true);
    expect(created.supplier_terms).toBe("Immediate shipment within 24 hours.");

    const all = await getRFQTemplates();
    expect(all).toHaveLength(6);
    expect(all.some((t) => t.name === created.name)).toBe(true);
  });
});
