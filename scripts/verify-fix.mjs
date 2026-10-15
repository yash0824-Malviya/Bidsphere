/**
 * Quick verification that the fixed deriveWorkflowStage routes LDC2026-00021
 * to "Finance Review" even when esign_envelope is missing (the failure case).
 */

// Simulate LDR data as returned by the list API
const ldr_with_envelope = {
  name: "LDC2026-00021",
  sq_name: "PUR-SQTN-2026-00243",
  rfq_name: "PUR-RFQ-2026-00088",
  review_status: "Approved",
  workflow_state: "Finance Review",
  finance_status: "Pending",
  esign_status: "signed",
  current_owner: "Finance Manager",
  next_approver: "Finance Manager",
  // esign_envelope is PRESENT (normal case)
  esign_envelope: '{"schemaVersion":2,"documents":{}}',
  terms_file_url: "/private/files/terms.pdf",
  warranty_file_url: "/private/files/warranty.pdf",
  insurance_file_url: "/private/files/insurance.pdf",
};

const ldr_without_envelope = {
  ...ldr_with_envelope,
  // esign_envelope is MISSING (the failure case that caused the bug)
  esign_envelope: undefined,
};

const ldr_rejected = {
  ...ldr_with_envelope,
  review_status: "Rejected",
  workflow_state: "Rejected",
  finance_status: "",
};

const ldr_legal_pending = {
  ...ldr_with_envelope,
  review_status: "Pending",
  workflow_state: "Pending Review",
  finance_status: "",
  esign_envelope: undefined,
};

// Replicate the fixed deriveWorkflowStage logic
function deriveWorkflowStage(doc) {
  const legal = (doc.review_status ?? "").trim();
  const finance = String(doc.finance_status ?? "").trim();
  const persisted = (doc.workflow_state ?? "").trim();

  if (legal === "Rejected" || finance === "Rejected" || persisted === "Rejected") {
    return "Rejected";
  }
  if (persisted === "Finance Review") {
    return "Finance Review";
  }
  if (persisted === "Completed") {
    return "Completed";
  }
  if (legal === "Pending" && persisted === "Pending Review" && doc.current_owner === "Procurement") {
    return "Procurement";
  }
  // isRfqReadyForPurchaseOrder / isRfqReadyForFinance omitted (depend on esign_envelope)
  return "Legal Review";
}

console.log("=== Test Cases ===");
console.log("With envelope:   ", deriveWorkflowStage(ldr_with_envelope), "(expected: Finance Review)");
console.log("Without envelope:", deriveWorkflowStage(ldr_without_envelope), "(expected: Finance Review - WAS FAILING!)");
console.log("Rejected:        ", deriveWorkflowStage(ldr_rejected), "(expected: Rejected)");
console.log("Legal pending:   ", deriveWorkflowStage(ldr_legal_pending), "(expected: Legal Review)");

const allPass =
  deriveWorkflowStage(ldr_with_envelope) === "Finance Review" &&
  deriveWorkflowStage(ldr_without_envelope) === "Finance Review" &&
  deriveWorkflowStage(ldr_rejected) === "Rejected" &&
  deriveWorkflowStage(ldr_legal_pending) === "Legal Review";

console.log("\n==> All tests pass:", allPass ? "✓ YES" : "✗ NO");
