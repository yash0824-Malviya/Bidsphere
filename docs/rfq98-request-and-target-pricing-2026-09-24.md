# RFQ98: initial Contract Request and target pricing

**Current status:** the approved schema correction is applied. RFQ98 now links
to `CTRQ-2026-0001`, verified in ERP and the authenticated Procurement Team
queue/detail. See [final live verification](rfq-contract-request-live-verification-2026-09-24.md)
for the additional Yes/No tests and final regression results. The initial
diagnostics below describe the state before that correction.

## Verified live state before changes

Read-only ERP inspection of `PUR-RFQ-2026-00098` found:

- Draft RFQ, Contract Required Yes, no Contract Request, Contract or award.
- No RFQ Department. The exact linked MR `MAT-MR-2026-00038` supplies the
  department label Production. Its company is Bidsphere; the RFQ company is
  Netlink. An existing active `Production - NSGAI` Department belongs to Netlink.
- Item AP001, quantity 12 Nos, has `custom_target_price = 0` and
  `custom_show_target_price_to_supplier = 0`. The originally entered target
  price cannot be inferred from that saved value.
- The existing Contract Request schema still requires all award-stage fields.

Evidence: `scratch/rfq98-routing-audit.json`. No source MR data was changed.

## Contract Request correction

Department remains required. The backend resolves the real RFQ Department or
the department of its verified linked MR items to one active Department in the
RFQ company. It rejects missing/ambiguous departments and invalid source items;
it does not invent a default or carry a different company's Department Link.

The reviewed ERP configuration defers only these seven fields at initial intake:
supplier, contract_type, contract_start_date, contract_end_date, contract_value,
currency and estimated_contract_value. Purpose and description are generated
from RFQ context, so the user does not have to supply award terms at this stage.
Standard Contract requirements remain unchanged.

The initial Request persists the RFQ link, requester, Department, Yes decision,
Pending status, Procurement stage and Procurement Team role in the existing
Contract Request and its existing workflow metadata. The queue/list/detail show
those fields, with Not yet awarded / Pending for absent supplier/award.

No-award RFQs are no longer sent through the actual Contract award prerequisite
when summarizing initial intake. After an award is saved, the routing hook
updates the same Request's verified award/supplier/value/document context.
Procurement Team still completes the terms before the separate standard
Contract creation action. Repeated routing does not duplicate Requests or audit
entries for an unchanged award.

## Target pricing correction

The actual ERP field is `Request for Quotation Item.custom_target_price`;
visibility uses `custom_show_target_price_to_supplier` on each item.

The old helper assumed a failed RFQ update response meant target prices had not
saved. The post-save CLM hook can instead fail after ERP already saved the RFQ.
Pricing must be checked against a fresh saved document, independently of the
Contract Request result. A real pricing mismatch remains an error, and a CLM
routing failure remains visible even when prices were saved.

MR-derived RFQs now send their prices and per-line visibility in the initial
insert. The verifier avoids a redundant write when those values already match.
Repeated item codes retain distinct row prices and visibility; verification
binds to the saved child-row identities and rejects missing/mismatched rows.

## Changed files

- `api/rfqRequestDepartment.ts` and tests: initial Department provenance/link.
- `api/rfqInitialClmRequest.ts` and tests: required Department, update same Request
  with available award context, no premature Contract.
- `api/rfqClmCore.ts`, `api/rfqClmRest.test.ts`: initial versus actual Contract
  prerequisites and later preparation of the same Request.
- `api/clmRequestValidation.ts` and tests: Department stays mandatory.
- `scripts/rfq-clm-initial-request-schema.mjs`, tests and companion guide:
  seven-field configuration, backups and verification.
- `src/utils/rfqClmWorkflow.ts`, `src/pages/contracts/ContractsPage.tsx`,
  `src/components/dashboard/PendingClmRequestsCard.tsx`,
  `src/components/contracts/ClmRecordWorkspace.tsx`,
  `src/components/sourcing/RfqContractPanel.tsx` and their tests: persisted
  intake fields and accurate no-award labels.
- `src/api/createRFQFromMaterialRequest.ts`, `src/api/rfqTargetPricingPersist.ts`,
  `src/pages/sourcing/NewRFQPage.tsx` and pricing/creation tests: initial target
  fields, independent saved-price verification and truthful failure feedback.

The GET-only server diagnostic also verified the corrected Department resolution
and no-award summary against RFQ98. Evidence is in
`scratch/rfq98-readonly-server-evidence.json`; this is not a live write or an
authenticated Team queue acceptance test.

Local regression results: **1,113 tests passed, zero failed** (863 backend and
schema tests; 250 client, component and pricing tests). The additional GET-only
RFQ98 diagnostic passed. Reports: `scratch/rfq98-backend-tests.json` and
`scratch/rfq98-client-tests.json`. **Production build and TypeScript passed**
after the final pricing changes (existing bundle-size warning only); build
result is recorded in `scratch/rfq98-build.log`.

## Live configuration and acceptance status

The user explicitly approved the exact seven-field production change after
reviewing its direct-REST scope. It was applied and verified, and a repeated
schema check returned no pending operations.

Frappe evaluates `mandatory_depends_on` in Desk, not in REST mandatory checks.
BidSphere enforces complete terms on prepared/standalone Requests and before
standard Contract creation. Direct ERP REST callers would see the seven fields
as optional after configuration. This was disclosed and explicitly approved.

Configuration commands used with the gateway validation in place:

```powershell
node scripts/setup-rfq-clm-initial-request.mjs --check
node scripts/setup-rfq-clm-initial-request.mjs --apply --gateway-validation-confirmed
node scripts/setup-rfq-clm-initial-request.mjs --check
```

RFQ98 recovery through the existing backend service created `CTRQ-2026-0001`.
ERP read-back, duplicate retry identity and the actual Procurement Team browser
queue/detail passed. New Yes RFQ99 created `CTRQ-2026-0002`; new No RFQ100
created no Request. The live list count is 2. No RFQ recreation, Bench command
or new Frappe app was needed. The intended RFQ98 target price remains unknown;
no price has been guessed or overwritten. Final results supersede the earlier
read-only results above: **1,139 tests and the production build passed**.
