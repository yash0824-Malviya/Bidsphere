# PO / Contract / supplier acceptance link repair

## Exact cause

The RFQ, Award, Contract, PO and Contract acceptance/signature links were already correct. The broken record was **PO Shipment `gaqipgvp1u`**, the existing supplier PO acceptance record for **PUR-ORD-2026-00028**. Its `supplier` Link was null.

The actual ERP Supplier ID contains literal surrounding quote characters: `"Atlantic Precision Manufacturing."`. `api/poShipmentCore.ts` stripped those characters from `Purchase Order.supplier`, submitted an ID that did not exist, and then retried by omitting the supplier Link. The gateway verified status/timestamp but did not verify the supplier Link. The Contract Information read correctly refused to treat that incomplete shipment as supplier acceptance, but incorrectly hid the otherwise valid Contract card.

## Live repair performed

- Loaded and validated the exact Supplier master, RFQ, Award, winning quotation, Contract and PO.
- Updated **only the missing supplier Link** on existing shipment `gaqipgvp1u` using the exact PO supplier ID and standard Frappe document save with its current modified timestamp.
- Re-fetched independently. The replay run made **no further write**.
- Verified the entire existing Contract workflow JSON is unchanged, including Contract acceptance, both signatures, audit history and approvals.
- Verified the Legal and supplier signed PDF hashes against the actual private files.
- Preserved PO acceptance time, delivery date, vehicle/tracking information and shipment state.

No Contract, PO, acceptance or signature was created by this repair.

## Verified records and state

| Relationship | Persisted reference |
|---|---|
| RFQ | PUR-RFQ-2026-00104 |
| Award | LDC2026-00027 |
| Winning quotation | PUR-SQTN-2026-00273 |
| Contract | CON-2026-00001 |
| Purchase Order | PUR-ORD-2026-00028 |
| PO acceptance/shipment | gaqipgvp1u |
| Supplier display name | Atlantic Precision Manufacturing. |
| Contract acceptance | Accepted, 2026-09-29 13:15:24 |
| Supplier signature | Signed, 2026-09-29 13:16:06 |
| Legal Manager signature | Signed, original receipt unchanged |
| PO acceptance | Accepted, 2026-09-29 13:16:52 |
| Current supplier stage | Existing PO Processing |

The existing supplier signature is bound to the Contract acceptance by `acceptance_id`; that receipt contains the exact Contract, PO and supplier IDs. Historical signed evidence was not rewritten. New supplier signatures also record explicit `contract_id`, `purchase_order_id` and `supplier_id`, and validate them against the authoritative chain.

Duplicate check: exactly **one Contract**, **one linked PO**, and **one shipment/PO acceptance record** for this transaction.

## Code changes

- `api/poShipmentCore.ts`: preserve exact ERP Supplier ID, verify the Supplier master, remove supplier-dropping retry, and reject ambiguous duplicate shipment rows.
- `api/poShipmentAccess.ts`: verify the saved supplier Link before returning success.
- `api/clmSupplierPoWorkflow.ts`: select by exact PO and canonical supplier ID; unrelated/missing shipment receipts cannot grant PO acceptance or hide a valid linked Contract. A missing Contract acceptance displays **Supplier Contract Acceptance Required**. Duplicate matching receipts remain a conflict.
- `api/clmPurchaseOrderLink.ts`: expose supplier ID/display name from the verified transaction.
- `api/clmCore.ts`, `src/types/clm.ts`: explicit references on future supplier signature receipts; preserve historical receipts and their acceptance relationship.
- `src/api/clm.ts`, `src/components/p2p/PurchaseOrderContractInformation.tsx`, `src/pages/supplier-portal/SupplierPOPage.tsx`: show verified supplier information; rename the read-only control **Refresh Contract**. It performs GET/refetch only.
- Regression tests in the corresponding core, access, workflow, linkage, client and Contract Information suites.
- `scratch/clm-link-relationship-live.check.ts` and `scratch/clm-link-repair-live.check.ts`: guarded live inspection/repair and independent verification. The repair script requires an explicit write flag, verifies the complete chain and modified timestamp, and becomes a no-op once the link matches.

## Verification evidence

- Live repair and no-op replay: **passed**, `tmp/clm-link-repair-live-verified.log`.
- Saved repair result: `scratch/clm-link-repair-verified.json`.
- Supplier Portal displays the linked Contract and both Signed states; the relationship error is gone.
- Final regression suite: **473 tests passed across 23 files** (`tmp/clm-link-repair-regression.log`).
- Production build: **passed** (`tmp/clm-link-repair-build.log`); the existing large-chunk advisory remains.
- The actual Supplier Portal PO link opens **CON-2026-00001**, showing Accepted Contract, both signatures Signed, Fully Signed Contract and Existing PO Processing.
- View Signed Contract loads the existing two-page supplier-signed PDF. Browser console error list is empty; document width matches viewport width (779px), with no horizontal overflow.
- Screenshot: `tmp/po28-contract-link-repaired.png`.

RFQ sourcing, Contract terms, Legal/Finance approvals and downstream PO business transitions were not changed. Local BidSphere API/frontend fixes should be included together in the normal application release; no bench app or database migration is required for this repair.
