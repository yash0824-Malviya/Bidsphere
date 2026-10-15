import { describe, expect, it } from "vitest";
import {
  cleanBusinessWarehouseRemarks,
  parseStructuredWarehouseProcessing,
  sanitizeHumanRemarks,
} from "./materialIssueRemarksDisplay";
import type { MaterialIssueReceipt } from "../types/materialIssueReceipt";

describe("materialIssueRemarksDisplay & sanitizeHumanRemarks", () => {
  it("sanitizes plain text remarks without alteration", () => {
    const raw = "Materials inspected and ready at loading dock 2.";
    expect(sanitizeHumanRemarks(raw)).toBe(raw);
    expect(cleanBusinessWarehouseRemarks(raw)).toBe(raw);
  });

  it("strips raw JSON object strings completely and extracts human remarks", () => {
    const rawJson = JSON.stringify({
      document_hash: "abcd1234efgh5678",
      document_version: "1.0",
      verification_token: "tok_998877",
      created_at: "2026-08-05T10:00:00Z",
      warehouse_signer: "Warehouse Manager",
      warehouse_sha256: "sha_wh_12345",
      department_signer: "Department User",
      department_sha256: "sha_dept_67890",
      acceptance_checklist: {
        quantity_verified: true,
        material_good_condition: true,
        packaging_verified: true,
        no_visible_damage: true,
      },
      remarks: "Package received in good condition.",
    });

    const sanitized = sanitizeHumanRemarks(rawJson);
    expect(sanitized).toBe("Package received in good condition.");
    expect(sanitized).not.toContain("document_hash");
    expect(sanitized).not.toContain("verification_token");
  });

  it("strips [BidSphere:MIR:...] and [BidSphere:MaterialIssue:...] machine tags", () => {
    const raw =
      "Checked items against purchase order.\n[BidSphere:MIR:{\"issue_number\":\"MIR-20260805-0002\",\"document_hash\":\"hash123\"}]\n[BidSphere:MaterialIssue:{\"audit\":{\"browser\":\"Chrome\"}}]";
    const sanitized = sanitizeHumanRemarks(raw);
    expect(sanitized).toBe("Checked items against purchase order.");
  });

  it("returns empty string when raw remarks contain only machine metadata", () => {
    const raw =
      "[BidSphere:MIR:{\"issue_number\":\"MIR-20260805-0002\",\"document_hash\":\"hash123\"}]";
    const sanitized = sanitizeHumanRemarks(raw);
    expect(sanitized).toBe("");
  });

  it("parses structured warehouse processing data from JSON sidecar", () => {
    const rawJson = JSON.stringify({
      issue_number: "MIR-20260805-0002",
      stock_entry: "MAT-STE-2026-00042",
      warehouse: "Stores - NSGAIL",
      received_by: "Department User",
      issue_type: "Full Issue",
      issue_date: "2026-08-05",
      status: "Confirmed",
      confirmed_at: "2026-08-14T15:27:00Z",
      document_version: "1.0",
      document_hash: "hash_abc_123",
      verification_token: "tok_xyz_789",
      warehouse_signer: "Warehouse Manager",
      department_signer: "Department User",
      acceptance_checklist: {
        quantity_verified: true,
        material_good_condition: true,
        packaging_verified: true,
        no_visible_damage: true,
      },
    });

    const parsed = parseStructuredWarehouseProcessing(rawJson);
    expect(parsed.hasData).toBe(true);
    expect(parsed.issueNumber).toBe("MIR-20260805-0002");
    expect(parsed.stockEntry).toBe("MAT-STE-2026-00042");
    expect(parsed.warehouse).toBe("Stores - NSGAIL");
    expect(parsed.receivedBy).toBe("Department User");
    expect(parsed.issueType).toBe("Full Issue");
    expect(parsed.departmentAcceptance).toBe("Confirmed");
    expect(parsed.acceptanceChecklist?.quantity_verified).toBe(true);
    expect(parsed.acceptanceChecklist?.material_good_condition).toBe(true);
    expect(parsed.acceptanceChecklist?.packaging_verified).toBe(true);
    expect(parsed.acceptanceChecklist?.no_visible_damage).toBe(true);
    expect(parsed.audit.document_version).toBe("1.0");
    expect(parsed.audit.warehouse_signer).toBe("Warehouse Manager");
    expect(parsed.audit.department_signer).toBe("Department User");
  });

  it("merges MaterialIssueReceipt object with structured data", () => {
    const receipt: Partial<MaterialIssueReceipt> = {
      id: "mir-1",
      issue_number: "MIR-20260805-0002",
      stock_entry: "MAT-STE-2026-00042",
      warehouse: "Stores - NSGAIL",
      received_by: "Department User",
      issue_type: "Full Issue",
      issue_date: "2026-08-05",
      status: "Confirmed",
      items: [
        {
          item_code: "RMM001",
          item_name: "Steel Sheet 2mm",
          uom: "Nos",
          requested_qty: 10,
          issued_qty: 10,
          remaining_qty: 0,
        },
      ],
      warehouse_signature: {
        role: "Warehouse Manager",
        signer_name: "Warehouse Manager",
        signed_at: "2026-08-05T12:43:00Z",
        signature_type: "drawn",
        sha256_hash: "sha_wh_sig_123",
        document_hash: "doc_hash_789",
        document_version: "1.0",
        verification_status: "verified",
      },
      department_signature: {
        role: "Department User",
        signer_name: "Department User",
        signed_at: "2026-08-14T15:27:00Z",
        signature_type: "drawn",
        sha256_hash: "sha_dept_sig_456",
        document_hash: "doc_hash_789",
        document_version: "1.0",
        verification_status: "verified",
      },
      document_version: "1.0",
      document_hash: "doc_hash_789",
      verification_token: "ver_tok_999",
      created_at: "2026-08-05T12:43:00Z",
      modified: "2026-08-14T15:27:00Z",
      audit_trail: [],
    };

    const parsed = parseStructuredWarehouseProcessing(undefined, receipt as MaterialIssueReceipt);
    expect(parsed.hasData).toBe(true);
    expect(parsed.issueNumber).toBe("MIR-20260805-0002");
    expect(parsed.stockEntry).toBe("MAT-STE-2026-00042");
    expect(parsed.departmentAcceptance).toBe("Confirmed");
    expect(parsed.audit.warehouse_signer).toBe("Warehouse Manager");
    expect(parsed.audit.department_signer).toBe("Department User");
  });
});
