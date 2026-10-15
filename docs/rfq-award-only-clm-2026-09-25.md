# Saved RFQ choice and award-only Contract Requests

This supersedes the submission-only trigger documented on 2026-09-24.

## Root cause and correction

Both ERP gateway adapters previously invoked Request routing after RFQ submission. The intake service accepted a submitted RFQ without a saved supplier award. Requests could therefore enter Procurement with no awarded supplier, quotation or award value.

The RFQ creation form now requires an explicit **Contract Required? No / Yes** selection in **Step 4 — Review & Submit**, in the **Contract Management** section after the supplier terms and before the Previous / Create RFQ footer. Neither option is initially selected; Create RFQ validates the choice. Earlier steps do not ask for it. The choice survives Previous / Next navigation.

The helper reads: "If Yes, the CLM workflow will start after the supplier is awarded. No Contract Request is created before supplier award."

The creation UI passes `contract_required: true` for Yes and `false` for No. Both direct and Material Request creation adapters normalize these values to the existing ERPNext Select field: `true → "Yes"`, `false → "No"`. The RFQ persists `Request for Quotation.contract_required` in this established format and verifies it by re-fetching the saved RFQ. Existing string inputs remain supported. No schema migration is needed.

Creation, draft saves, submission and sourcing perform no CLM routing. A saved Yes does not create a Request or Contract and does not assign work to Procurement.

Award confirmation does not ask the question again. The existing sourcing action saves the selected supplier, award and final award amount first. The app then calls:

`POST /api/clm?view=rfq_award_decision`

```json
{
  "rfq": "<saved RFQ>",
  "award_id": "<saved Legal Document Review award reference>",
  "quotation_id": "<winning submitted Supplier Quotation>",
  "supplier_id": "<awarded Supplier>"
}
```

The existing application's persistent award reference is a Legal Document Review (`LDC...`). No new Award or Contract DocType was introduced.

The endpoint re-fetches the RFQ and reads its saved `contract_required`. It independently verifies RFQ submission, the real saved award, winning quotation, supplier, company and final negotiated amount. An optional legacy `decision` input is accepted only if it matches the persisted RFQ value; it cannot change that value. Missing or conflicting decisions fail before Request creation. The endpoint records an immutable award handoff intent, then uses the existing Contract Request persistence API. No `bidsphere_workflows` installation is required.

- **Saved Yes, after award:** create one Request containing the RFQ, actual awarded supplier, saved award, winning quotation, final award value, Department and Requester. It is assigned to the existing `procurement_team` role, displayed as **Pending / Procurement**. Native Request status is **Pending Review**. Procurement Manager can open and complete its CLM terms; existing Procurement Team preparation access remains available.
- **Saved No, after award:** record the handoff, create no Request or Contract, and retain the existing procurement continuation.
- **Actual Contract:** a separate action after required terms, estimate, risk and Legal signatory are completed. It reuses the existing standard ERPNext Contract and Legal → E-signature → Finance → Procurement/PO gates.
- **Amounts:** Contract Value uses the final saved award amount. An approved same-currency Business Case estimate is retained separately. Otherwise Estimated Contract Value remains blank until entered; ERP Currency default zero is not presented as an estimate.

The response contains `created`, the persisted Request aggregate when Yes, and an independently re-fetched `summary`. A partial save returns an actionable error and leaves the gate blocked. Retrying the same award handoff resumes the same saved Request. Retrying after actual Contract creation returns the existing linkage without rewriting or resubmitting Legal review.

## Persistence and safety

- Existing `Contract Request.custom_rfq` uniqueness prevents duplicate Requests.
- Existing `Contract.custom_contract_request` uniqueness prevents duplicate Contracts.
- ERP native revision checks protect concurrent writes.
- The award handoff rechecks the saved RFQ choice during persistence and never replaces it with a frontend decision.
- Request creation and subsequent saves independently verify the authoritative award at the ERP adapter boundary.
- Re-fetch validation checks the native amount/currency as well as source metadata; an ineligible summary cannot produce success.
- Historical pre-award Requests are excluded from active lists and counters. Detail/history remains readable and non-editable.
- Legal, Finance and final Procurement approval authority is unchanged. Manager's added permission applies to Request/Contract preparation.

## Primary changed paths

| Area | Files |
|---|---|
| Award endpoint | `api/clm.ts`, `api/rfqAwardClmDecision.ts`, `api/rfqClmCore.ts`, `api/rfqClmRest.ts` |
| Request persistence / source validation | `api/rfqInitialClmRequest.ts`, `api/clmRequestValidation.ts`, `api/clmErp.ts` |
| Access, draft preparation and queues | `api/clmCore.ts`, `api/rfqRequestDraft.ts`, `api/rfqRequestSubmissionProjection.ts`, `api/rfqInitialClmHold.ts`, `src/utils/rfqClmWorkflow.ts` |
| Remove old trigger | `api/proxy.ts`, `vite.config.ts`, `api/rfqContractRequirementGuard.ts`; retired `api/rfqInitialClmRouting.ts` |
| Normal and reverse awards | `src/pages/sourcing/RFQDetailPage.tsx`, `src/pages/sourcing/ReverseBiddingDetailPage.tsx`, `src/components/AIAnalysisModal.tsx`, `src/api/reverseAuctionContractDecision.ts`, `src/api/clm.ts` |
| Initial RFQ and submission | `src/pages/sourcing/NewRFQPage.tsx`, `src/api/rfqSubmitClm.ts`, `src/api/rfqContractRequirement.ts`, `src/api/sourcing.ts`, `src/api/createRFQFromMaterialRequest.ts` |
| Preparation UI / role checks | `src/components/sourcing/RfqContractPanel.tsx`, `src/components/contracts/ProcurementRequestWorkspace.tsx`, `src/utils/rfqContractPermissions.ts` |

Associated regression files cover both gateway adapters, award decisions, role checks, partial failures, concurrent retries, native persistence, queue/detail projection, negotiated values, estimates and downstream lifecycle gates.

## Prior live ERP verification on 2026-09-25

The following schema and historical-record corrections were verified earlier on this date. The final adjustment moving the decision back to RFQ creation required only local application changes; it did not modify additional live ERP records.

The existing reviewed REST schema utility was applied:

```powershell
node scripts/setup-rfq-clm-rest.mjs --check
node scripts/setup-rfq-clm-rest.mjs --apply
```

Exactly two existing Custom Field properties changed:

1. `Request for Quotation.contract_required.allow_on_submit = 1` — existing schema capability, retained. The current creation flow saves the choice while Draft; award handoff reads it without changing it.
2. `Contract.custom_contract_request.unique = 1` — prevents duplicate actual Contracts.

The utility verified all 102 affected existing records, native workflow definitions and permissions remained unchanged. No new fields, roles or DocTypes were created. Backup and verification: `scratch/rfq-clm-rest-schema-2026-09-25T06-24-46-770Z/`.

The existing Contract Request workflow has no transition into Cancelled. The correction therefore used its permitted Pending Review → Draft transition plus persisted **Invalidated / Awaiting Supplier Award** lifecycle metadata. It did not bypass the workflow or add a new transition.

| Request | RFQ | Verified result |
|---|---|---|
| CTRQ-2026-0001 | PUR-RFQ-2026-00098 | Invalidated; RFQ remains Draft |
| CTRQ-2026-0002 | PUR-RFQ-2026-00099 | Invalidated; RFQ remains Draft |
| CTRQ-2026-0003 | PUR-RFQ-2026-00101 | Invalidated; RFQ remains Submitted |

All three retained their terms and audit history, have no active queue entry and no Contract. No replacement Request was created. The same Request can be reused only after a valid saved award and the RFQ's saved Yes decision. Backup: `scratch/rfq-award-live-cleanup-before.json`. Read-back evidence: `scratch/rfq-award-live-cleanup-evidence.json`.

## Verification and limits

- Step 4 placement and boolean-input follow-up: **313 passed, 0 failed** (`scratch/clm-step4-regression-tests.json`). Includes required-choice validation, placement before the footer, back/forward retention, both creation adapters, persisted value readback, no early routing, saved-choice award routing, duplicate protection and branch guards.
- Step 4 follow-up `npm run build` (TypeScript and Vite): **passed** (`scratch/clm-step4-build.log`), with the existing non-failing large-chunk warning. This follow-up changed only creation UI/adapters, tests and this report; no backend workflow or live ERP records changed.
- Final saved-choice regression run: **1,638 passed, 0 failed** (`scratch/clm-saved-choice-final-tests.json`). It covers explicit creation selection, RFQ persistence, no Request during Draft or sourcing, saved Yes/No award routing, contradictory client-input rejection, queue assignment, duplicate prevention, failure recovery, negotiated award values and downstream lifecycle gates.
- Earlier separate ECR, Business Case/Intake and gateway regression run: **210 passed, 0 failed** (`scratch/clm-award-unrelated-regression.json`). No ECR/Business Case implementation changed in the final saved-choice adjustment.
- Application TypeScript check and `npm run build`: passed (`scratch/saved-rfq-requirement-client-types.log`, `scratch/clm-saved-choice-build.log`). Vite reports a non-failing large-chunk warning.
- Earlier native ERP invalidation/read-back test: passed (`scratch/rfq-award-live-cleanup.log`).
- Automated API tests exercised both Manager and Team queues and Manager preparation → one standard Contract → Legal, with no early Finance/PO access.

The browser was at login. A newly awarded live RFQ through Contract signatures and PO was **not** executed in this turn. The successful lifecycle tests use fixture ERP storage; they do not represent a live supplier award, legal approval or signature. Application code is updated in this workspace; the ERP field prerequisites and named test-record corrections above were applied live. No Bench/SSH deployment is required for this REST implementation.
