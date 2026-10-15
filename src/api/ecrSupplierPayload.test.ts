import { beforeEach, describe, expect, it, vi } from "vitest";
import { createECR, updateECR, type CreateECRPayload } from "./ecr";
import { parseECREngineeringNotes, serializeECREngineeringNotes } from "../utils/ecrEngineeringNotes";

const mocks = vi.hoisted(() => ({ apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock("./erpnext", () => ({
  apiGet: vi.fn(),
  apiPost: mocks.apiPost,
  apiPut: mocks.apiPut,
  buildResourceUrl: (doctype: string, name?: string) => `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name || "")}`,
  extractErpNextErrorMessage: (_error: unknown, fallback: string) => fallback,
  withSilent: () => ({}),
  withoutNetworkRetry: () => ({ _disableNetworkRetry: true }),
}));

describe("ECR supplier payload independent from procurement references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiPost.mockResolvedValue({ data: { name: "ECR-2026-100010" } });
    mocks.apiPut.mockResolvedValue({ data: { name: "ECR-2026-100010" } });
  });

  const sections = {
    engineeringNotes: "Existing engineering note",
    supplierImpact: "Supplier participation needed",
    technicalRequirements: "Material grade\nTensile strength",
    commercialRequirements: "Net 30",
    deliveryRequirements: "Samples within 2 weeks",
    qualityRequirements: "PPAP level 3",
  };
  const supplierPayload: CreateECRPayload = {
    ecr_title: "Supplier material change",
    ecr_type: "Material Change",
    priority: "Medium",
    requesting_department: "Engineering",
    plant: "Plant 1",
    target_implementation_date: "2026-10-01",
    chnage_description: "Change material grade",
    reason_for_change: "Improve durability",
    supplier_response_required: "Yes",
    suggested_supplier: "SUP-001",
    supplier_impact: 1,
    supplier_response_type: "Quotation",
    required_quantity: 10,
    quantity_uom: "Nos",
    procurement_reference_type: "None",
    existing_rfq_reference: "",
    existing_purchase_order_reference: "",
    engineering_notes: serializeECREngineeringNotes(sections),
    affected_parts: [{ partitem: "LAT-4401", quantity: 10, uom: "Nos", current_supplier: "SUP-001", source_reference_type: "" }],
  };

  it("creates Supplier Required Yes + Reference Type None without stripping supplier requirements", async () => {
    await createECR(supplierPayload, { idempotencyKey: "supplier-none" });
    expect(mocks.apiPost.mock.calls[0]?.[1]).toEqual({ ...supplierPayload, idempotency_key: "supplier-none" });
    expect(parseECREngineeringNotes(mocks.apiPost.mock.calls[0]?.[1].engineering_notes)).toMatchObject(sections);
  });

  it("resaves legacy labeled requirements and supplier details without introducing source references", async () => {
    const existingNotes = Object.entries({
      "Technical Requirements": sections.technicalRequirements,
      "Commercial Requirements": sections.commercialRequirements,
      "Delivery Requirements": sections.deliveryRequirements,
      "Quality Requirements": sections.qualityRequirements,
      "Supplier Impact": sections.supplierImpact,
    }).map(([label, value]) => `${label}: ${value}`).join("\n");
    const payload = { ...supplierPayload, engineering_notes: serializeECREngineeringNotes(parseECREngineeringNotes(existingNotes)) };
    await updateECR("ECR-2026-100010", payload);
    expect(mocks.apiPut.mock.calls[0]?.[1]).toEqual(payload);
    expect(parseECREngineeringNotes(payload.engineering_notes)).toMatchObject({ ...sections, engineeringNotes: "" });
    expect(payload.affected_parts?.[0].source_reference_type).toBe("");
  });
});
