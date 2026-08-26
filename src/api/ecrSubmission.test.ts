import { describe, expect, it, vi } from "vitest";
import {
  createECR,
  extractECRErrorMessage,
  getECRPostSaveWorkflowAction,
  isBusinessECRNumber,
  type CreateECRPayload,
} from "./ecr";
import { erpnext } from "./erpnext";
import { formatERPNextDate } from "../utils/erpNextDate";

describe("ECR Submission Payload & Error Handling", () => {
  it("recognizes public business identifiers without treating internal names as ECR numbers", () => {
    expect(isBusinessECRNumber("ECR-2026-85517")).toBe(true);
    expect(isBusinessECRNumber("1j3b9i4moj")).toBe(false);
  });

  it("reuses the caller's idempotency key across manual create retries", async () => {
    const post = vi.spyOn(erpnext, "post").mockResolvedValue({
      data: { name: "ECR-2026-00050", ecr_title: "Retry-safe ECR" },
    });
    const retryPayload = {
      ecr_title: "Retry-safe ECR",
      ecr_type: "Design Change",
      priority: "High",
      requesting_department: "Engineering",
      plant: "Plant 1",
      target_implementation_date: "2026-09-30",
      chnage_description: "Retry-safe change.",
      reason_for_change: "Response may be lost.",
    } satisfies CreateECRPayload;

    try {
      await createECR(retryPayload, { idempotencyKey: "stable-manual-retry-key" });
      await createECR(retryPayload, { idempotencyKey: "stable-manual-retry-key" });
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[0]?.[1]).toMatchObject({
        idempotency_key: "stable-manual-retry-key",
      });
      expect(post.mock.calls[1]?.[1]).toMatchObject({
        idempotency_key: "stable-manual-retry-key",
      });
      expect(post.mock.calls[0]?.[2]).toMatchObject({
        _disableNetworkRetry: true,
      });
    } finally {
      post.mockRestore();
    }
  });

  it("serializes full ECR submission draft with 2 affected-part rows and validation metadata without errors", () => {
    const rawForm = {
      ecr_title: "Door Latch & Fastener Redesign",
      ecr_type: "Design Change",
      priority: "High",
      ecr_owner: "engineer@netlink.com",
      requesting_department: "Chassis Engineering",
      plant: "Plant 1 - Detroit",
      program: "EV-2026",
      project: "PRJ-LAT-042",
      target_implementation_date: "2026-09-30",
      implementation_date: "", // blank implementation date
      chnage_description: "Update latch geometry and fastener pitch",
      reason_for_change: "OEM fatigue resistance standard update",
      business_justification: "$1.50 per unit savings and higher durability",
      current_state: "Standard M6 latch bracket",
      proposed_state: "Reinforced M8 dual-bolt latch bracket",
      supplier_response_required: "Yes" as const,
      supplier_response_type: "Quotation",
      suggested_supplier: "Acme Fasteners Corp",
      procurement_reference_type: "None" as const,
      required_quantity: 5000,
      quantity_uom: "Nos",
      validation_status: "Not Started" as const,
      validation_notes: "Stress testing and cycle durability across 50,000 cycles",
      validation_documents: "/private/files/validation_plan_rev2.pdf",
    };

    const impacts = {
      product_impact: 1 as const,
      material_impact: 1 as const,
      manufacturing_impact: 0 as const,
      tooling_impact: 1 as const,
      quality_impact: 1 as const,
      cost_impact: 0 as const,
      supplier_impact: 1 as const,
      delivery_impact: 0 as const,
      customer_impact: 0 as const,
      contract_impact: 0 as const,
    };

    const parts = [
      {
        partitem: "PART-DL-1001",
        part_description: "Front Door Latch Mechanism",
        current_revision: "A",
        new_revision: "B",
        quantity: 2500,
        uom: "Nos",
        change_required: "Reinforced hinge pin",
        technical_notes: "Heat-treated alloy steel",
      },
      {
        partitem: "FAST-M8-204",
        part_description: "M8 High-Tensile Fastener",
        current_revision: "01",
        new_revision: "02",
        quantity: 5000,
        uom: "Nos",
        change_required: "Coating change to Geomet 500",
        technical_notes: "Corrosion resistance > 1000h salt spray",
      },
    ];

    const cleanTargetDate = rawForm.target_implementation_date?.trim()
      ? formatERPNextDate(rawForm.target_implementation_date.trim()) || rawForm.target_implementation_date.trim()
      : "";

    const cleanImplementationDate = rawForm.implementation_date?.trim()
      ? formatERPNextDate(rawForm.implementation_date.trim()) || undefined
      : undefined;

    const payload: CreateECRPayload = {
      ...rawForm,
      target_implementation_date: cleanTargetDate,
      implementation_date: cleanImplementationDate,
      validation_status: rawForm.validation_status || "Not Started",
      validation_notes: rawForm.validation_notes?.trim() || undefined,
      required_quantity: typeof rawForm.required_quantity === "number" ? rawForm.required_quantity : 1,
      quantity_uom: rawForm.quantity_uom || "Nos",
      engineering_notes: "Technical Notes: Dual-locking pin required.\n\nSupplier Impact: Tooling re-qualification needed.",
      ...impacts,
      affected_parts: parts,
      validation_documents: rawForm.validation_documents || undefined,
    };

    // Verify payload JSON serialization does not throw or mangle fields
    const serialized = JSON.stringify(payload);
    expect(serialized).toBeDefined();

    const deserialized = JSON.parse(serialized) as CreateECRPayload;
    expect(deserialized.target_implementation_date).toBe("2026-09-30");
    expect(deserialized.implementation_date).toBeUndefined();
    expect(deserialized.validation_status).toBe("Not Started");
    expect(deserialized.validation_documents).toBe("/private/files/validation_plan_rev2.pdf");
    expect(deserialized.affected_parts).toHaveLength(2);
    expect(deserialized.affected_parts?.[0].partitem).toBe("PART-DL-1001");
    expect(deserialized.affected_parts?.[0].current_revision).toBe("A");
    expect(deserialized.affected_parts?.[0].new_revision).toBe("B");
    expect(deserialized.affected_parts?.[1].partitem).toBe("FAST-M8-204");
    expect(deserialized.affected_parts?.[1].current_revision).toBe("01");
    expect(deserialized.affected_parts?.[1].new_revision).toBe("02");
    expect(deserialized.supplier_impact).toBe(1);
    expect(deserialized.suggested_supplier).toBe("Acme Fasteners Corp");
  });

  it("extracts specific ERPNext validation error messages instead of generic fallbacks", () => {
    // Frappe _server_messages with JSON string
    const frappeServerMsgError = {
      response: {
        data: {
          _server_messages: JSON.stringify([
            JSON.stringify({ message: "Plant 'Plant 99' does not exist." }),
          ]),
        },
      },
    };
    expect(extractECRErrorMessage(frappeServerMsgError)).toBe("Plant 'Plant 99' does not exist.");

    // Direct message
    const directMessageError = {
      response: {
        data: {
          message: "Target implementation date cannot be in the past.",
        },
      },
    };
    expect(extractECRErrorMessage(directMessageError)).toBe("Target implementation date cannot be in the past.");

    // Field errors object
    const fieldError = {
      fieldErrors: {
        target_implementation_date: "Target implementation date is required.",
      },
    };
    expect(extractECRErrorMessage(fieldError)).toBe("Target implementation date is required.");
  });

  it("treats submit-committed + response-lost as success on manual retry", () => {
    const persistedReplay = {
      create_replayed: true,
      select_pxfp: "Engineering Review",
      docstatus: 0 as const,
      approval_requirements: [{
        name: "approval-1",
        approval_role: "Engineering Manager",
        status: "Pending" as const,
      }],
    };

    expect(getECRPostSaveWorkflowAction(persistedReplay, {
      submitImmediately: true,
      isEditing: false,
    })).toBeNull();
    expect(persistedReplay).toMatchObject({
      select_pxfp: "Engineering Review",
      docstatus: 0,
      approval_requirements: [{ status: "Pending" }],
    });
  });

  it("still submits when a create replay is persisted only as Draft", () => {
    expect(getECRPostSaveWorkflowAction({
      create_replayed: true,
      select_pxfp: "Draft",
      docstatus: 0,
      approval_requirements: [],
    }, {
      submitImmediately: true,
      isEditing: false,
    })).toBe("Submit ECR");
  });

  it("resubmits a returned Draft while preserving completed history", () => {
    expect(getECRPostSaveWorkflowAction({
      select_pxfp: "Draft",
      docstatus: 0,
      approval_requirements: [{
        name: "approval-sent-back",
        approval_role: "Engineering Manager",
        status: "Sent Back",
      }],
    }, {
      submitImmediately: true,
      isEditing: true,
    })).toBe("Submit ECR");
  });

  it("does not reactivate the historical Sent Back state", () => {
    expect(getECRPostSaveWorkflowAction({
      select_pxfp: "Sent Back",
      docstatus: 1,
      approval_requirements: [],
    }, {
      submitImmediately: true,
      isEditing: true,
    })).toBeNull();
  });
});
