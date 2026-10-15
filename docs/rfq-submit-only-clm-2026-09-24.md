# RFQ submission-only Contract Request routing

> Superseded on 2026-09-25 by [award-only routing](rfq-award-only-clm-2026-09-25.md). RFQ submission must no longer create a Contract Request.

## Root cause

The shared ERP gateway hook called `ensureInitialRfqContractRequestErp` after every RFQ insert/save. The service checked `contract_required=Yes`, but did not require Frappe's persisted `docstatus=1` or an RFQ submission event. Consequently a Draft save created an active Request.

## Change

- RFQ insertion/Draft saving persists the requirement only.
- The existing `PUT /api/resource/Request for Quotation/:name` submission (`docstatus: 1`) remains the submission API. Both gateway adapters read the prior ERP RFQ before forwarding the write. A successful Draft-to-submitted transition, or explicit submission replay, permits initial Request creation.
- Ordinary updates can synchronize an existing Request's award information, but cannot insert or reactivate one. GET/page loading never writes a Request.
- The persistence service independently requires a submitted RFQ and explicit creation permission. RFQ ID remains the unique idempotency key.
- A failed post-submit handoff remains an error. “Retry RFQ submission” replays the same submit API; the frontend confirms the persisted Request/Team assignment before showing success. Existing RFQ submit permissions remain unchanged.
- The legacy Request retry endpoint only resumes an already-reserved submission operation; it cannot create from a Draft or arbitrary missing Request.
- The Request list/detail API checks the actual source RFQ. Historical Draft-origin Requests are projected as inactive Draft records, excluded from Pending CLM counts.
- Actual Contract creation still requires the existing saved supplier award, complete terms, source validation and Legal-review authoring fields. No changes to downstream Legal/e-signature/Finance/PO logic or existing roles.

## Live ERP correction

RFQ `PUR-RFQ-2026-00099` remains `Draft`, `docstatus=0`.

Existing `CTRQ-2026-0002` was preserved, not deleted:

```json
{
  "request_status": "Draft",
  "rfq_request_workflow": {
    "version": 1,
    "phase": "awaiting_rfq_submission",
    "assigned_role": "procurement_team",
    "status": "Draft-originated",
    "current_stage": "Awaiting RFQ Submission"
  }
}
```

An `invalidate_draft_origin_request` audit entry records the correction. Existing terms, explicit saved draft values and audit entries were compared with their prior values and preserved. The RFQ keeps the same Request pointer in `clm_initial_request.phase=awaiting_submission`. Submitting that RFQ later releases the same Request; unit tests verify reuse without an additional insert.

Only this named erroneous Request was corrected in ERP. The read-only projection also keeps other Draft-origin Requests, including RFQ98's older Request, out of the active Pending queue.

No DocType, schema, role or installed-app changes were made. The existing RFQ `custom_approval_data` field was verified to have `allow_on_submit=1`.

## Verification

| Check | Result |
|---|---|
| Real RFQ101, Yes, create/save Draft | 0 Requests |
| Real RFQ101 submitted | `CTRQ-2026-0003`, Pending / Procurement / procurement_team |
| Explicit RFQ101 submission replay | Same Request ID; exactly 1 Request |
| Real RFQ102, No, Draft then submission | 0 Requests |
| Actual Contracts for test RFQ101/102 | 0 |
| Signed-in Procurement Team dashboard | Pending CLM Requests = 1; RFQ101 / CTRQ3 visible |
| Signed-in Contract Requests page | CTRQ3 Pending; CTRQ2 and CTRQ1 Draft, excluded from Pending count |
| RFQ99 detail | Draft; Awaiting RFQ Submission; saved-requirement notice; no CLM creation/retry action |
| Manager exclusion | Backend role-filter regression tests; no live Manager sign-in was performed |
| Same Request enriched after award; actual Contract/Legal handoff | Automated existing native-REST fixture regressions passed; no live award or Contract was created |
| Relevant regression suite | 1,443 tests passed, 0 failed, 138 suites |
| `npm run build` | Passed (TypeScript and production Vite build) |

Real ERP submission tests used the authenticated configured integration identity and the same shared gateway routing function. Supplier email flags were disabled in both explicitly labelled acceptance RFQs. The test documents remain for traceability. Browser verification used the user's Procurement Team session.

The RFQ99 page also logged a Supplier RFQ Response lookup 404. That endpoint and supplier-response workflow were not modified in this timing-only change. CLM Request queue loading succeeded.

Evidence:

- `scratch/rfq-submit-live-before.json`: before backup
- `scratch/rfq-submit-live-evidence.json`: live correction and Yes/No submission results
- `scratch/rfq-submit-live.check.ts`: executable real-ERP acceptance procedure (mutating; do not run casually)
- `scratch/rfq-submit-final-tests.json`: final regression results
- `scratch/rfq-submit-final-build.log`: final successful build

## Files changed for this timing correction

Backend and shared policy:

- `api/rfqInitialClmRouting.ts`
- `api/rfqInitialClmRequest.ts`
- `api/rfqClmErp.ts`
- `api/proxy.ts`
- `vite.config.ts`
- `api/clm.ts`
- `api/clmCore.ts`
- `api/clmErp.ts`
- `api/clmRequestValidation.ts`
- `api/rfqClmCore.ts`
- `api/rfqRequestDraft.ts`
- `api/rfqRequestSubmissionProjection.ts`
- `src/utils/rfqSubmission.ts`
- `src/types/clm.ts`

Timing-specific frontend changes:

- `src/api/rfqSubmitClm.ts`
- `src/pages/sourcing/NewRFQPage.tsx`
- `src/pages/sourcing/RFQDetailPage.tsx`
- `src/components/sourcing/RfqContractPanel.tsx`
- `src/components/sourcing/RfqContractRequirementField.tsx`
- `src/api/sourcing.ts`, `src/api/createRFQFromMaterialRequest.ts`: comment corrections only

Regression tests:

- `api/rfqInitialClmRouting.test.ts`
- `api/rfqInitialClmRequest.test.ts`
- `api/rfqContractRequirementGuard.test.ts`
- `api/clm.test.ts`
- `api/clmRequestRouting.test.ts`
- `api/clmRequestValidation.test.ts`
- `api/rfqClmCore.test.ts`
- `api/rfqClmRest.test.ts`
- `api/rfqRequestDraft.test.ts`
- `src/api/rfqSubmitClm.test.ts`
- `src/components/sourcing/RfqContractPanel.test.tsx`
- `src/components/sourcing/RfqContractRequirementField.test.tsx`

The workspace already contained changes from earlier tasks; they were not reset or included as new work here.
