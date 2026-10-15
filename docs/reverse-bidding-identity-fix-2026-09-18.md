# Reverse bidding quotation identity fix — 18 September 2026

## Root cause

The Recommendation Results checkbox already stored the Supplier Quotation document name (`quotation_id`). The callback passed that string array to `RFQDetailPage.handleStartReverseBidding`, which called it `supplierNames` and forwarded it as `approvedSuppliers`. `createReverseBiddingFromRFQ` compared these quotation IDs only with `SupplierQuotation.supplier` and `supplier_name` aliases. No quotation ID could match those supplier aliases, so the service raised “None of the shortlisted suppliers submitted a quotation for this RFQ.” before the ERP save request.

This was an identity-contract mismatch, not a missing quotation, price or AI evaluation. The original filter was replayed against the actual selected document IDs and returned zero matches.

## Verified current RFQ

The pasted request named **PUR-RFQ-2026-00089**. A live ERP read showed that record contains Atlantic, Apex and Eagle quotations at $2,500, with no Titan or FEMSA quotation. The described $50 Titan/FEMSA/Atlantic screen belongs to **PUR-RFQ-2026-00092**. The user explicitly approved testing RFQ 00092.

| Selected supplier | Frontend selected quotation ID | Authoritative ERP supplier ID | Linked RFQ | Submitted amount |
|---|---|---|---|---:|
| Titan Industrial Products LLC | PUR-SQTN-2026-00261 | `"Titan Industrial Products LLC"` | PUR-RFQ-2026-00092 | $50 |
| FEMSA | PUR-SQTN-2026-00258 | `FEMSA` | PUR-RFQ-2026-00092 | $50 |

The quotation marks in Titan's ERP supplier ID are literal document-name characters and are preserved. Both quotations have `docstatus = 1`, status `Submitted`, and two child items linked through `items.request_for_quotation` to RFQ 00092. Each item has quantity 1 and rate $25. FEMSA's separate partial draft `PUR-SQTN-2026-00259` is excluded. Atlantic's submitted quotation is `PUR-SQTN-2026-00260`; it was not selected for the created auction.

## Corrected data flow

1. Checkbox state holds quotation IDs only. Each selected recommendation supplies its existing `quotation_id`, `supplier_id` and `rfq_id`.
2. The RFQ action verifies these identities against the currently loaded ERP documents and passes explicit `selectedQuotations` plus exact `approvedSuppliers` to the existing creation service.
3. The service re-fetches quotations using the current RFQ child-row filter and current round. It checks submitted state, actual RFQ linkage, supplier identity, quotation identity and positive quotation pricing.
4. Duplicate parent records produced by the child-table join are deduplicated by document name. The current submitted revision is resolved consistently with the RFQ page; stale selected revisions are rejected.
5. Only the two resolved quotations provide auction opening totals and item rates. An older or unselected quotation cannot contribute a cheaper rate.
6. The existing `frappe.client.save` endpoint receives the existing Reverse Bidding document structure with the two authoritative Supplier IDs. No schema, roles, invitation policy or auction lifecycle was changed.
7. The existing one-auction-per-RFQ behavior remains: repeated valid requests return the existing auction after validating the selection. They do not replace its suppliers or create another auction.

Missing quotations, foreign RFQs, wrong supplier IDs, stale records, drafts, cancellations and conflicting/duplicate selections still fail validation. A partially valid shortlist no longer silently drops the invalid supplier. Development-only diagnostics show selected and resolved identities; production does not emit these new detailed traces.

## Live result

- **Selected suppliers:** 2.
- **Valid submitted quotations found:** 2.
- **Reverse bidding creation/readback:** SUCCESS via the same selection helpers and creation service used by the button.
- **Created ERP document:** `RB-2026-00023`.
- **RFQ:** `PUR-RFQ-2026-00092`.
- **Auction status:** `Draft`.
- **Invited supplier rows:** exactly FEMSA and Titan, $50 each, invitation status `Pending`.
- **Item rows:** 4, two per supplier, each opening at $25.
- **Negative case:** Apex Fasteners Ltd has no quotation for RFQ 00092; validation rejected it before any save.
- **Repeat/reopen service case:** a fresh valid Titan + Atlantic selection returned the existing auction without another write, preserving existing idempotency.
- **Unchanged source data:** the RFQ, all fetched quotation documents, and the saved AI analysis were re-fetched and compared successfully. AI scores remain Titan 100, FEMSA 100, Atlantic 91.

The manual probe used real ERP queries and the real creation service with a credential-safe transport; no mock data was sent to ERP. It created one draft only. No invitations were sent, no bids were submitted, and no supplier award or PO was created.

**Browser limitation:** the preview remains on the login page. Procurement Manager sign-in was requested, so the actual checkbox/button click and visual refresh/reopen acceptance remain pending. The live ERP creation is verified; browser interaction is not claimed as verified.

## PO identity mapping

**VALID after correction.** Recommendation selection now passes the same authoritative IDs and records the quotation ID in the existing selection audit. PO creation reads the live, approved Legal Document Review's `supplier` and `sq_name`, then resolves that exact quotation within the RFQ query. It no longer chooses a quotation by supplier display name or the AI's first row. Existing Legal/e-signature/Finance approval gates and PO creation rules remain in place. No live PO was created during testing.

## Evidence

Production build passed. Final full regression run: **2,094 passed, 4 failed, 2 intentionally skipped live tests**. The four failures are the same pre-existing Legal/Finance handoff failures in `src/api/approvalWorkflow.test.ts`. Two additional unrelated failures in the first run passed on isolated rerun and on the final complete run. The authorized live reverse-bidding test passed separately.

- `scratch/reverse-bidding-89-source.json`: actual RFQ 00089 records establishing the request's RFQ mismatch.
- `scratch/reverse-bidding-92-source.json`: actual current RFQ, quotations and saved AI snapshot before creation.
- `scratch/reverse-bidding-92-verified.json`: selected tuples, original zero-match result, exact creation payload, created document, readback and unchanged-source checks.
- `scratch/reverse-bidding-live-tests.log`: live integration test passed.
- `scratch/reverse-bidding-final-focused-tests.log`: 68 targeted tests passed, including selection/PO identity checks and isolated reruns of two unrelated intermittent tests.
- `scratch/reverse-bidding-build.log`: production build result.
- `scratch/reverse-bidding-full-tests.json`: complete regression results.

The live integration test is skipped during normal runs and requires explicit `RUN_LIVE_REVERSE_BIDDING_TRACE=1`. It restricts writes to a Reverse Bidding draft for the approved RFQ 00092 and refuses existing-record updates.
