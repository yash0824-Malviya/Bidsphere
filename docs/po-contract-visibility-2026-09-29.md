# Purchase Order ↔ Contract visibility — 2026-09-29

## Root cause

PO `PUR-ORD-2026-00028` already stores the correct existing Contract link. The PO detail pages did not resolve or display it. Live Supplier Portal testing also exposed a CLM client token-format mismatch: the client decoded a three-part JWT payload, while the existing server issues a two-part signed access token. This falsely treated a valid supplier session as expired.

## Implementation

- Read-only API: `GET /api/clm?view=purchase_order_contract&name=<PO>`.
- Uses the existing `Purchase Order.custom_clm_contract`, `custom_clm_rfq`, `custom_clm_award` and quotation item links. No duplicate `contract_id` field or Contract is created.
- Checks supplier ownership before loading Contract information, then existing Contract read permissions, RFQ decision, Award, winning quotation, company, item source and reverse PO references.
- Returns current Contract status, amount, currency, dates, signature receipts and authorized existing actions. It excludes internal approvals and audit details.
- A successful missing link returns `contract: null` and displays **No Contract linked**. Invalid or unauthorized links return an actionable error rather than misleading empty data.
- Both supplier and internal PO detail pages render **Contract Information** with **View Contract** and **View Contract PDF**. Supplier readers also receive **Review Contract**, with signing/acceptance links only when the existing backend action policy grants them.
- PDF preview uses the existing authorized `current_pdf` endpoint, bound to the saved file ID and version. The endpoint verifies the artifact hash. No PDF generation or signed-artifact modification occurs.
- CLM supplier token parsing follows the existing server format while rejecting staff tokens in Supplier Portal. Server signature verification and ownership enforcement remain authoritative.
- Existing PO creation already persists the link and validates the Contract/Award context. It is reused unchanged. PO acceptance, RFQ sourcing, Legal, signature, Finance and CLM transitions are unchanged.
- The mobile PO Summary now scrolls in the page rather than sticking over the Contract card and its actions. Desktop summary behavior and all summary content are preserved.

## Exact live relationship

| Record | Persisted value |
|---|---|
| Purchase Order | PUR-ORD-2026-00028, submitted (`docstatus=1`) |
| Contract | CON-2026-00001 |
| RFQ | PUR-RFQ-2026-00104 |
| Award | LDC2026-00027 |
| Winning quotation | PUR-SQTN-2026-00273 |
| Supplier | Atlantic Precision Manufacturing. |
| Contract amount | USD 4,500 |
| Contract dates | 2026-09-25 through 2026-10-25 |
| Contract status | Active |
| CLM workflow phase | completed |
| Current version | 1.0 |
| Legal signature | Signed |
| Supplier signature | Pending |

The persisted Contract status and completed CLM phase are separate values. Supplier signing is not granted for this completed Contract under the existing workflow. The visibility change does not invent a new signing action or mark the supplier signature complete.

## Files

- `api/clmPurchaseOrderLink.ts` and `.test.ts`
- `api/clm.ts` and `.test.ts`
- `src/api/clm.ts`, `src/api/clm.test.ts`, `src/api/clmPurchaseOrderContract.test.ts`
- `src/components/p2p/PurchaseOrderContractInformation.tsx` and `.test.tsx`
- `src/pages/p2p/PurchaseOrderDetailPage.tsx`
- `src/pages/supplier-portal/SupplierPOPage.tsx`
- This report and the updated live-verification section in `docs/clm-procurement-finalization-2026-09-29.md`

## Verification

- Staff PO28 page: linked Contract, real status/value/dates and two-page authoritative PDF verified in the browser.
- Read-only live completed check: **1 passed**. Exactly one submitted PO, all five audit events, RFQ/Award mirrors and unchanged source/approval/signature evidence verified. Log: `tmp/clm-po-live-completed.log`.
- Supplier Portal as Atlantic: PO28 displays CON1, Active, USD 4,500, saved dates and signature states. **View Contract** opens `/supplier/contracts/CON-2026-00001`; **View Contract PDF** renders the actual two-page version 1.0. **Review Contract** targets the same workspace.
- PO27 (same supplier, no Contract link) displays **No Contract linked**. Its existing PO acceptance controls remain available.
- Supplier PO28 layout at the preview's 779px viewport: document width 779px, no horizontal overflow. Browser console error check returned no errors after the fix.
- Visual proof: `tmp/po28-contract-supplier.png`, `tmp/po28-contract-pdf-supplier.png`. The Supplier Portal is left open on PO28's Contract section.
- `npm run build`: **PASS** (`tmp/po-contract-visibility-build.log`). Existing bundle-size warning remains.
- Final focused regression suite: **532 passed across 19 files** (`tmp/po-contract-visibility-tests.log`). Covers actual two-part token format, staff-token rejection, supplier isolation, forged link rejection, missing links, persisted source references, current PDF version/hash/download endpoint, existing CLM/PO lifecycle, duplicate prevention and supplier PO read behavior.
- Browser download-event capture for the modal's blob link timed out in this automation environment; a local downloaded file was not independently verified. The authenticated PDF response, rendered pages and download control were verified, and endpoint download bytes/MIME/hash tests pass.

## Deployment

Deploy the normal BidSphere frontend/backend build together. This visibility change requires no ERPNext migration, new DocType, Bench access or `bidsphere_workflows` installation. PO28's existing saved links were verified and require no repair.
