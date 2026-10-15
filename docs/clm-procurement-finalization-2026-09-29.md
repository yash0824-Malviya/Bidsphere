# CLM Procurement Finalization — 2026-09-29

## Result and current verification boundary

The Contract's finalization UI opens the existing Purchase Order creation form. It no longer asks the user to find an existing PO. The dedicated backend saves/submits a standard ERPNext Purchase Order, verifies its persisted links and submission, then completes the Contract lifecycle. Saving a draft alone leaves Procurement Finalization pending.

Local implementation, build and focused regression checks pass. The four optional PO linkage fields have been applied to the configured ERPNext instance and read back successfully. The user subsequently created/submitted **PUR-ORD-2026-00028** through Procurement Team. A read-only live verification on September 29 confirms exactly one submitted PO for CON-2026-00001, USD 4,500, all Contract/RFQ/Award links, the completed lifecycle, and unchanged signed evidence.

## Root cause

`ClmActionPanel` rendered an Existing Purchase Order link lookup. `finalize_procurement` accepted a supplied PO ID and only verified that it was already submitted. The Contract continuation link opened an RFQ conversion screen without its Contract context. The standard PO schema also lacked Contract/Award links, and the existing generic PO payload did not carry CLM context or currency reliably.

## Implementation

- Contract action: **Create Purchase Order**, granted only by the backend to `procurement_team`. Existing authentication normalizes the Procurement Team role. Procurement Manager, Finance, Legal and Admin cannot perform this CLM action.
- Route: `/p2p/purchase-orders/new?contract=CON-2026-00001`, using the existing form, with its existing editable item and delivery controls.
- Prefill: persisted Contract, saved final award, winning submitted quotation, company/currency, actual item quantities/UOM/rates, delivery dates, warehouse, and available payment/delivery terms.
- No client success until ERPNext readback confirms the saved PO. Submit success additionally requires `docstatus=1` and a persisted Contract completion receipt.
- Contract workflow evidence stores the PO reference and summary in `custom_clm_data.procurement_order` / `procurement_completion`. This preserves the signed content snapshot, including any original `custom_purchase_order` value.
- The new PO retains `custom_clm_contract`, `custom_clm_rfq`, `custom_clm_award`, and `custom_clm_creation_key`, plus standard Supplier Quotation item links.
- The deterministic creation key is unique in the ERP Custom Field definition. Concurrent requests and lost-response retries recover the same PO; an unrelated earlier PO for the quotation is never silently adopted.
- Generic PO writes cannot forge CLM links or bypass the Contract operation to create a duplicate. The existing non-CLM RFQ PO flow retains its existing approval checks.
- The backend verifies Legal/Finance evidence and the actual original/signed PDF byte hashes before PO work. Saved PO value must match the final award before submission.
- Audit events: `purchase_order_creation_initiated`, `purchase_order_created`, `purchase_order_linked`, `procurement_finalized`, `completed`.
- Existing RFQ/Award lifecycle mirrors include the completion/PO reference; sourcing, quotation, selection, award and their approval fields are not transitioned by this service.
- If quote item pricing cannot reconcile to the saved final award, submission is blocked. The service never invents an item allocation.

## API

`GET /api/clm?view=purchase_order&name=<Contract>` returns:

```json
{
  "data": {
    "contract": "CON-2026-00001",
    "expected_modified": "<current ERP revision>",
    "rfq": "PUR-RFQ-2026-00104",
    "award": "LDC2026-00027",
    "quotation": "PUR-SQTN-2026-00273",
    "award_value": 4500,
    "currency": "USD",
    "payload": { "items": "<actual quoted items and approved PO fields>" },
    "completed": false
  }
}
```

`POST /api/clm?view=purchase_order` accepts `name`, `expected_modified`, `operation` (`save_draft` or `submit`), and editable `payload`. The service supplies protected source fields itself. It returns the persisted `purchase_order`, `completed`, `reused`, Contract ID and current revision. A failure returns an actionable error and does not complete the Contract.

## Live preflight evidence

- Contract: CON-2026-00001; current persisted phase: procurement.
- RFQ: PUR-RFQ-2026-00104; Award: LDC2026-00027; SQ: PUR-SQTN-2026-00273.
- Supplier: Atlantic Precision Manufacturing.
- DIR-STE-016: 100 Kg × USD 25 = USD 2,500.
- DIR-STE-040: 80 Kg × USD 25 = USD 2,000.
- Contract/Award total: USD 4,500; existing PO count: 0 at preflight.
- Signature files and version/approval evidence are unchanged and their actual bytes verified.
- Safe evidence: `scratch/clm-po-live-verification.json`; schema backup: `scratch/clm-po-schema-2026-09-29T06-25-56-661Z/`.

## Modified runtime files

- `api/clm.ts`
- `api/clmCore.ts`
- `api/clmPurchaseOrder.ts` (new)
- `api/clmPurchaseOrderErp.ts` (new)
- `api/rfqPurchaseOrderGuard.ts`
- `src/api/clm.ts`
- `src/pages/p2p/NewPurchaseOrderPage.tsx`
- `src/components/contracts/ClmActionPanel.tsx`
- `src/components/contracts/ClmRecordWorkspace.tsx`
- `src/components/contracts/ClmPurchaseOrderSummary.tsx` (new)
- `src/utils/rfqClmWorkflow.ts`
- `scripts/clm-purchase-order-schema.mjs` (new)
- `scripts/setup-clm-purchase-order.mjs` (new)

Corresponding tests cover service/adapter, full Legal→Finance→PO lifecycle, core finalization, generic proxy security, API response validation, existing form integration, lifecycle display, and additive schema setup.

## Tests

- `npm run build`: PASS. Existing bundle size/config warnings remain.
- Final focused run: **302/302 passed, 11 files** (`tmp/clm-po-focused-tests-final.log`).
- Full suite: **3,942 passed, 4 failed, 5 skipped** (`tmp/clm-po-full-tests.log`). All four failures are the pre-existing workflow-stage expectations in `src/api/approvalWorkflow.test.ts`; no changes were made to that unrelated workflow.
- Earlier focused run during parallel build hit a 5-second proxy-test timeout and a subsequent mock failure; the final isolated focused run above passed both.
- Read-only live preflight: **1/1 passed** (`tmp/clm-po-live-preflight.log`).
- Read-only live completed verification: **1/1 passed** (`tmp/clm-po-live-completed.log`); asserts submitted PO28, exactly one PO, all five audit events, RFQ/Award completion mirrors, unchanged sourcing/award fields and signed PDF hashes.
- Tests include failed ERP create, failed submit, lost create/submit responses, duplicate and simultaneous retries, invalid source/role, altered signature bytes, missing schema, cross-RFQ quotation items, wrong award total, and exact preservation of signed evidence.

## Deployment and remaining live acceptance

No Frappe app or Bench installation is required. Deploy the normal BidSphere frontend/backend build together. On another ERP instance, use the configured server environment without exposing credentials:

```powershell
node scripts/setup-clm-purchase-order.mjs --check
node scripts/setup-clm-purchase-order.mjs --apply
node scripts/setup-clm-purchase-order.mjs --check
```

The setup only adds the four optional read-only Custom Fields to standard Purchase Order. It backs up metadata before applying, refuses incompatible fields, and verifies readback. Existing PO records, workflow definitions and permissions are not rewritten. This schema step is already completed on the current configured ERPNext instance.

Live creation/submission and persisted Completed state are now verified. PO28 was created at 2026-09-29 12:09:49 (ERP timestamp), and the completion receipt records Procurement Team at 12:09:50. The read-only checker was run with `CLM_PO_EXPECT=completed` and passed. The separate PO-to-Contract visibility improvement reuses these existing links without modifying business records or signed artifacts.
