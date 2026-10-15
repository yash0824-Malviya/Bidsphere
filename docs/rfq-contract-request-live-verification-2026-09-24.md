# RFQ Contract Request: live verification, 24 September 2026

> Historical evidence. The pre-award Requests described here were invalidated by [the award-only correction on 25 September 2026](rfq-award-only-clm-2026-09-25.md).

## Result

The approved ERP schema correction is applied and verified on `80.225.204.210:8090`.
RFQ98 now has a real persisted Contract Request, visible in the authenticated
Procurement Team browser session at `/contract-requests` and its detail route.

| Case | RFQ | Persisted Request | Result |
| --- | --- | --- | --- |
| Recover existing Yes RFQ | PUR-RFQ-2026-00098 | CTRQ-2026-0001 | PASS |
| New draft, Yes | PUR-RFQ-2026-00099 | CTRQ-2026-0002 | PASS |
| New draft, No | PUR-RFQ-2026-00100 | None | PASS |
| Retry Yes routing | RFQ98 and RFQ99 | Same original IDs | PASS; one Request per RFQ |

The Team list shows **Pending CLM Requests: 2**, from actual ERP records.
Both Requests display **Pending / Procurement / Procurement Team**. Neither
has an awarded supplier or actual Contract. RFQ100 created no Request.

## Root cause and correction

The RFQ save flag alone did not create an initial Request, and the former
award-dependent path could not handle pre-award intake. The shared save hook
and native REST Request service address that path. The final live blocker was
the existing Contract Request schema: it required seven award-stage fields
before an initial RFQ Request could be inserted.

With explicit user approval, the existing Request schema now defers only
`supplier`, `contract_type`, `contract_start_date`, `contract_end_date`,
`contract_value`, `currency`, and `estimated_contract_value`.
Department remains mandatory. No DocType, role, workflow, standard Contract
schema or existing business record was replaced.

Frappe Desk applies the conditional mandatory expression; direct ERP REST
callers see these seven Request fields as optional. The user approved that
exact scope. BidSphere still validates full terms for prepared/standalone
Requests and actual Contract creation.

Two local follow-ups ensure normal RFQ creation uses this route reliably:

- A real Department is required for Yes, inherited from a verified Material
  Request or selected from existing Departments for the RFQ company.
- Successful RFQ creation invalidates the Contract Request list/dashboard
  cache, so a previously cached zero count is refreshed.

## Actual backend path and persistence

1. Existing RFQ resource/save endpoint persists the RFQ.
2. Both `api/proxy.ts` and `vite.config.ts` call
   `routeSavedRfqInitialClmRequest` in `api/rfqInitialClmRouting.ts`.
3. `ensureInitialRfqContractRequestErp` in `api/rfqInitialClmRequest.ts`
   re-reads the RFQ and uses native ERP REST to create/reuse the existing
   `Contract Request` DocType, then verifies persistence and the RFQ pointer.
4. `GET /api/clm?view=list&doctype=Contract%20Request` reads ERP records and
   applies the existing assignment/role access policy for the Team queue.

Existing recovery endpoint:

```text
POST /api/clm?view=rfq_initial_request
{"rfq":"PUR-RFQ-2026-00098"}
```

It returns the verified persisted Request aggregate/summary. The live recovery
test invoked that endpoint's service directly through the actual authenticated
ERP integration identity; it did not simulate a successful HTTP response.

RFQ98's read-back result:

```json
{
  "request_id": "CTRQ-2026-0001",
  "rfq_id": "PUR-RFQ-2026-00098",
  "contract_required": "Yes",
  "department": "Production - NSGAI",
  "assigned_role": "procurement_team",
  "assigned_user": "",
  "current_stage": "Procurement",
  "status": "Pending",
  "native_request_status": "Pending Review",
  "request_count": 1,
  "contract_count": 0
}
```

`procurement_team` is the existing canonical role, not a newly introduced role.
The Request's `custom_clm_data.rfq_request_workflow` holds assignment/stage;
`custom_rfq` binds it uniquely to the RFQ. The RFQ retains the Request pointer
under `custom_approval_data.clm_initial_request`.

## Verification scope

- Live recovery and fresh Yes/No saves used the ERP integration account's real
  authenticated identity, `Administrator`, and the same backend save hook used
  by both gateways. No browser session or user identity was forged. Requester
  therefore correctly records Administrator for these diagnostic records.
- Separately, the user signed in as Procurement Team in the browser. The real
  list, pending count of 2, and RFQ98 Request detail were verified there.
- The same persisted RFQ98 Request passes Team access and fails Manager access
  under the queue policy. Manager exclusion is covered by local policy tests;
  no separate live Manager sign-in was performed.
- Duplicate retries returned the same IDs. RFQ98's business item data and
  status were preserved. No target price was guessed or changed.
- Both acceptance RFQs remain Draft. No invitation email, supplier award,
  actual Contract, signature or PO was created by these tests.
- Browser warning/error logs were empty after the final list verification.
- **1,139 regression tests passed, zero failed.** TypeScript and the production
  Vite build passed via `npm run build`.
- This verifies initial Request routing. It does not claim a new live
  Legal/signature/Finance/PO acceptance run.

## Files changed in this final verification pass

- `api/rfqClmDiagnostics.ts` and `.test.ts`: opt-in structured diagnostics.
- `api/rfqInitialClmRouting.ts` and `.test.ts`: routing diagnostics.
- `api/rfqInitialClmRequest.ts` and `.test.ts`: persistence diagnostics.
- `src/api/rfqContractRequirement.ts` and `.test.ts`: validate real Department.
- `src/api/sourcing.ts`, `src/api/createRFQFromMaterialRequest.ts`: carry
  validated Department into the saved RFQ.
- `src/pages/sourcing/NewRFQPage.tsx`: Department input when needed and Request
  cache invalidation after successful creation.
- `src/components/sourcing/RfqContractRequirementField.tsx` and `.test.ts`:
  existing Department lookup for Yes requests without inherited Department.
- `src/api/rfqCreation.contractRequirement.test.ts`: RFQ creation regressions.
- Live scripts/evidence and the three linked implementation/schema guides.

The earlier persistence, queue and gateway files are listed in the
[routing implementation guide](rfq-clm-request-routing-2026-09-24.md).

Set `RFQ_CLM_DEBUG=1` on the backend process for diagnostic events, including
RFQ saved/reloaded, routing attempt, payload field presence, schema failure,
creation response, persisted ID/assignment and routing result. Logging is off
by default and excludes full documents, credentials and free-text terms.

## Evidence and configuration command

Applied once with the configured ERP API connection:

```powershell
node scripts/setup-rfq-clm-initial-request.mjs --apply --gateway-validation-confirmed
node scripts/setup-rfq-clm-initial-request.mjs --check
```

The apply result reports seven fields changed and `verified: true`.
The subsequent check returned no pending operations. No SSH, Bench command
or `bidsphere_workflows` installation was used or required for this route.

- Schema backup/result: `scratch/rfq-clm-initial-request-schema-2026-09-24T07-43-17-902Z/`
- RFQ98 read-back/idempotency: `scratch/rfq98-live-created-request.json`
- New Yes/No read-back: `scratch/rfq-clm-live-yes-no-evidence.json`
- Test results: `scratch/rfq-live-final-tests.json`
- Build result: `scratch/rfq-live-final-build.log`
- Live diagnostic scripts: `scratch/rfq98-create-request.check.ts` and
  `scratch/rfq-clm-live-yes-no.check.ts`

The live ERP configuration and local application verification are complete.
This pass did not publish the local application bundle to a separate production
web host; that host must run the updated gateway/client code to use the same
automatic save hook and cache behavior.
