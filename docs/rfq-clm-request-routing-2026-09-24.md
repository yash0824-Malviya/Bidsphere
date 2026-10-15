# RFQ creation → Contract Request → Procurement Team

> Historical report. Its pre-award trigger is superseded by [award-only routing, 25 September 2026](rfq-award-only-clm-2026-09-25.md).

**Current status:** the user-approved ERP schema correction and live initial
Request/Team queue acceptance are complete. RFQ98 → `CTRQ-2026-0001`; new Yes
RFQ99 → `CTRQ-2026-0002`; new No RFQ100 → no Request. See
[final live verification](rfq-contract-request-live-verification-2026-09-24.md)
for evidence and the limits of this acceptance run.

## Root cause

The earlier REST replacement removed the required `bidsphere_workflows` call,
but RFQ creation still saved only the `contract_required` flag. The Request
service required a supplier award before it could run. Production and Vite also
use separate ERP proxy adapters, so wiring only one adapter would leave the
other path unchanged.

The existing ERP Contract Request schema independently requires supplier,
contract type, dates, department and commercial values before insertion. An
RFQ-stage request cannot truthfully supply those values before selection.

## Implemented route

1. Existing authorized RFQ save/insert/update runs unchanged.
2. After ERP confirms the RFQ write, both gateway adapters re-fetch that RFQ.
3. No → no Contract Request and no Contract.
4. Yes → insert one existing **Contract Request** using standard ERP REST.
5. Verify saved fields, source documents, assignment, and RFQ pointer before
   reporting success. Return the current RFQ revision after that pointer save.
6. Procurement Team sees the Request in Contract Requests and its pending count.
7. After an award exists, Team completes the same Request's missing terms. The
   service revalidates RFQ, supplier, submitted quotation, award and documents.
8. A separate Team-only Create Contract action creates the standard Contract
   through the existing Legal/signature/Finance/procurement handoff.

No Contract is created by step 4. An initial request never manufactures a winning
supplier, contract type, contract dates or award value. If a verified award
already exists, its context is retained under `rfq_source.available_award` and
shown on the Request; permanent award binding occurs during Team preparation.

## Persisted records and assignment

- Existing `Contract Request.custom_rfq` provides database uniqueness per RFQ.
- Existing Request `custom_clm_data` stores source provenance, documents, audit
  and `rfq_request_workflow`:

  ```json
  {"version":1,"phase":"procurement_team","assigned_role":"procurement_team","status":"Pending","current_stage":"Procurement"}
  ```

- Native ERP `request_status` remains its supported **Pending Review** value.
  The application displays the persisted **Pending / Procurement** assignment.
- Procurement Manager is excluded from this initial Request queue. An authorized
  RFQ creator may trigger automatic routing; only Team prepares/creates Contract.
- Existing RFQ `custom_approval_data.clm_initial_request` stores the verified
  Request ID and recoverable write progress. It is distinct from the later
  `contract_decision`, which continues to require an actual supplier award.
- Generic RFQ mutations cannot create, remove or rewrite server-owned CLM
  decision/recovery metadata.

## API and failure responses

RFQ creation keeps its existing ERP resource/save endpoints. Both `api/proxy.ts`
and `vite.config.ts` invoke the same post-save routing helper.

If the RFQ saves but Request routing fails, the gateway returns HTTP 502:

```json
{
  "success": false,
  "code": "RFQ_CLM_REQUEST_NOT_ROUTED",
  "error": "RFQ <id> was saved, but its Contract Request could not be routed. <actual reason>",
  "saved_rfq": {"name":"<the real saved RFQ>"}
}
```

The creation services retain that RFQ identity, finish existing MR/invitation
linkage, and display the error without a success toast or repeated RFQ insert.
The Team can retry the Request alone through:

```text
POST /api/clm?view=rfq_initial_request
{"rfq":"<saved RFQ ID>"}
```

This returns the persisted Request aggregate and summary after verification.
The original `POST /api/clm?view=rfq_contract` remains responsible for completing
award details and the later separate Contract creation action.

There is no installed-app probe, missing-app HTTP 417 conversion, fake success,
mock storage, or new DocType in these paths. Standard REST saves are separate
transactions: partial progress is retained and resumed, never claimed rolled
back or complete when read-back fails.

## Files changed for this routing change

Backend:

- `api/rfqInitialClmRequest.ts` (new initial persistence service)
- `api/rfqInitialClmRouting.ts` (new shared gateway hook)
- `api/clmRequestValidation.ts` (new persistence-boundary validation)
- `api/rfqClmErp.ts`, `api/clmErp.ts`
- `api/proxy.ts`, `vite.config.ts`
- `api/clm.ts`, `api/clmCore.ts`
- `api/rfqClmCore.ts`, `api/rfqClmRest.ts`, `api/rfqClmDocuments.ts`
- `api/rfqInitialClmHold.ts`, `api/rfqClmBranchGuard.ts`

Client and existing views:

- `src/api/rfqContractRequirement.ts`, `src/api/sourcing.ts`
- `src/api/createRFQFromMaterialRequest.ts`, `src/api/clm.ts`
- `src/api/rfqApprovalWorkflow.ts` (preserve fresh server-owned CLM recovery state)
- `src/types/clm.ts`, `src/utils/rfqClmWorkflow.ts`
- `src/components/sourcing/RfqContractPanel.tsx`
- `src/pages/contracts/ContractsPage.tsx`
- `src/components/dashboard/PendingClmRequestsCard.tsx`
- `src/components/contracts/ClmSourceTraceability.tsx`

Focused tests cover these paths, queue/detail visibility, initial No/Yes,
required-field errors, wrong-RFQ documents, partial writes, changed persisted
values, retries, duplicate submissions, Team authorization, Manager exclusion,
and the same Request's later Contract creation.

## Production configuration applied

The initial read-only ERP check on 2026-09-24 found seven existing Contract
Request fields that prevented requests before award. The exact correction was
then explicitly approved, applied and verified. Configuration and scripts are documented in
[initial Request schema guide](rfq-clm-initial-request-schema-2026-09-24.md).

Important limitation: Frappe evaluates `mandatory_depends_on` in Desk, not in
its REST mandatory-field validator. The applied configuration makes those
seven Request fields optional to direct ERP REST callers. Department remains required. BidSphere's gateway
continues requiring all original thirteen fields for standalone/prepared
Requests and full terms before actual Contract creation. That distinction was
reviewed and approved before the live change.

For another environment, inspect the configuration before applying any needed
change. These are the REST-only setup commands; no SSH or Bench is required:

```sh
node scripts/setup-rfq-clm-rest.mjs --check
node scripts/setup-rfq-clm-rest.mjs --apply
node scripts/setup-rfq-clm-initial-request.mjs --check
node scripts/setup-rfq-clm-initial-request.mjs --apply --gateway-validation-confirmed
node scripts/setup-rfq-clm-rest.mjs --check
node scripts/setup-rfq-clm-initial-request.mjs --check
```

The first script handles the previously reviewed Contract unique Request link
and submitted RFQ decision field. The second modifies only the seven existing
award-stage Request mandatory settings. Both back up and verify affected definitions and
records. The initial Request script was applied on the active ERP instance;
the follow-up check returned no pending operations. See the live report for
the exact backup path and records created during acceptance.

## Verification status

Final regression results: **1,139 tests passed, 0 failed** across the focused
RFQ routing, Request persistence, queue, authorization, document, standard
Contract, downstream gate, and schema configuration suites. `npm run build`
passed (TypeScript and Vite). Results are recorded in
`scratch/rfq-live-final-tests.json` and `scratch/rfq-live-final-build.log`.
Production schema changes, real Request persistence/idempotency, new Yes/No
draft routing and the authenticated Procurement Team list/detail/count passed.
These tests did not create an actual Contract or execute a new downstream
Legal/signature/Finance/PO acceptance run.

The existing RFQ sourcing, supplier quotation, evaluation, award, ECR and
Business Case business logic is untouched. Standard Contract schema and the
Legal/signature/Finance/PO sequence are retained; early Requests only extend
the conditional CLM hold until Team creates their Contract.
