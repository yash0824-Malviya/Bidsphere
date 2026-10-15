# Supplier involvement without an existing procurement reference

## Corrected behavior

`Supplier Required = Yes` and `Reference Type = None` is valid. Supplier selection, supplier impact, response type, required quantity, UOM and the technical/commercial/delivery/quality requirements remain part of the ECR. Selecting an existing RFQ or Purchase Order still requires its document and item references, supplier association and matching item details.

## Cause confirmed on ECR-2026-100010

The saved Draft had `supplier_response_required = Yes`, a selected supplier, `procurement_reference_type = None`, blank parent document references, `supplier_response_type = Quotation`, quantity 10 and UOM Nos. Its affected-part row had `source_reference_type = RFQ` without a source document or item reference. The child Select's native and Custom Field definitions both started with `RFQ` and lacked a blank choice.

The fields that triggered procurement-source validation were `affected_parts[].source_reference_type`, `source_document_reference` and `source_item_reference`; parent `existing_rfq_reference` and `existing_purchase_order_reference` are checked separately. Supplier fields and requirements were not themselves classified as source references. Requirements remain serialized in `engineering_notes` using the existing labeled sections.

## Implementation

- Frontend and backend use the same validation for Reference Type None.
- With no source selected, a recognized type-only RFQ/Purchase Order marker is treated as an old default only when all document/item references are empty. Unknown markers and actual current or legacy source links still fail validation.
- Create payloads and the edit form explicitly send a blank child source type. Supplier data and requirement sections are preserved.
- Existing ECRs can pass validation with the old type-only marker without a record migration. The validator does not mutate stored documents.
- Existing Purchase Order references are preserved when opening and saving the edit form.
- Workflow transitions, RFQ creation, RFQ workflow and RBAC are unchanged.

## Schema and verification

The optional native source-type definition now starts with a blank choice. The live installation also contains a duplicate Custom Field for the same name. Frappe rejects saving that duplicate with `UniqueFieldnameError`; it is preserved. Explicit blank payloads and compatibility validation handle this installation without deleting schema or rewriting ECR records.

The targeted schema repair defaults to a read-only check and preserves duplicate Custom Fields. Custom Field-only installations can update the optional field normally:

```powershell
node scripts/repair-ecr-source-reference-schema.mjs --check
node scripts/repair-ecr-source-reference-schema.mjs --apply
```

Read-only validation of the actual ECR-2026-100010 passed with Supplier Required Yes and Reference Type None. All 11 ECR records and all three Workflow definitions were verified unchanged after the native schema adjustment. No production ECR was saved or advanced for testing.

Regression coverage includes Supplier Yes/No with None, valid RFQ/PO references, missing document/item metadata, rejection of real links with None, supplier payload/requirement preservation, and submission of legacy and extended records with type-only defaults.

Final validation: **554 focused regression tests passed across 63 files**; TypeScript and the production build passed. The schema verifier reran successfully with zero changes required, preserving the duplicate Custom Field and all existing records and workflows.
