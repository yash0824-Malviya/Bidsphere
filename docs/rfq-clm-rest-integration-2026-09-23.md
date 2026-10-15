# RFQ → CLM integration through existing ERPNext REST APIs

## Current implementation and live status

The current BidSphere backend uses the existing ERPNext document APIs for the
RFQ → Contract Request → Contract handoff. It reuses the installed DocTypes,
fields, and native Workflows. This path requires no Bench access, app
installation, new DocType, or `bidsphere_workflows` endpoint.

This guide supersedes the app-deployment requirement in the
[historical RFQ95 deployment guide](rfq95-clm-deployment-readiness-2026-09-23.md).
The older Python app and deployment archives remain historical artifacts; they
are not a prerequisite for the standard REST path documented here.

**Live acceptance is pending.** The two prerequisite metadata changes below
have passed a read-only check but have not been applied. Automatic approval
review rejected the attempted production `--apply` because it interpreted the
available authorization as local-only. Explicit approval for those two changes
is pending. Authenticated Procurement Team and downstream reviewer acceptance
also remain pending. No successful production Request, Contract, approval, or
signature is claimed by this guide.

### Latest verified production records

Read-only checks on 2026-09-23 confirmed:

| Item | Verified value |
| --- | --- |
| ERP target | `http://80.225.204.210:8090` |
| Versions | Frappe 16.20.0; ERPNext 16.22.0 |
| RFQ | `PUR-RFQ-2026-00095`, submitted |
| Award | `LDC2026-00026` |
| Winning quotation | `PUR-SQTN-2026-00270` |
| Winning supplier | Blue Ridge Manufacturing Inc |
| Exact Supplier DocName | `"Blue Ridge Manufacturing Inc"`, including the quotation marks |
| Award value | USD 30 |
| Raw RFQ requirement | `contract_required = Yes` |
| Saved post-award `contract_decision` | Absent |
| RFQ-linked Requests / Contracts | 0 / 0 |
| Existing Contracts scanned for the unique index | 0 |

The raw Yes field alone does not establish a completed CLM decision. The
existing award owner is not evidence of a CLM Request assignment.

Evidence:
[ERP schema and records](../scratch/existing-clm-rest-capabilities.json),
[permission and submitted-field metadata](../scratch/existing-clm-write-metadata.json).
GET-only permission checks return read/write/create/submit permission for the
configured gateway on the four relevant DocTypes. Actual document writes and
native Workflow transitions still require live verification.

## Backend path and persistent records

The authenticated BidSphere endpoint remains:

```text
POST /api/clm?view=rfq_contract
```

`api/clm.ts` resolves the authenticated principal; `api/rfqClmCore.ts` validates
the RFQ, current award, submitted winning quotation, supplier, source documents,
required terms, and role. `api/rfqClmErp.ts` delegates to
`api/rfqClmRest.ts`, which uses `api/clmErp.ts` for:

```text
GET  /api/resource/<DocType>/<name>
GET  /api/resource/<DocType>?filters=...
POST /api/resource/Contract%20Request
POST /api/resource/Contract
POST /api/method/frappe.client.save
```

Frappe's normal document validation, permissions, Workflow checks, and modified
timestamp checks remain active. Saves preserve unrelated existing fields.

### First action: Yes creates a Contract Request

Procurement Team submits the required RFQ-contextualized request details with:

```json
{
  "rfq": "PUR-RFQ-2026-00095",
  "expected_modified": "<current RFQ modified timestamp>",
  "decision": "Yes",
  "operation": "request",
  "payload": {
    "contract_type": "<explicit selected type>",
    "contract_purpose": "<required purpose>",
    "description": "<editable description>",
    "contract_start_date": "<valid start date>",
    "contract_end_date": "<valid end date>"
  }
}
```

Additional required request fields come from the existing schema and validated
RFQ/Award prefill. The example is the operation shape, not a complete standalone
ERP document. Dates, amount, company, department, supplier, quotation and source
attachments retain their existing validation.

The backend persists one **Contract Request** with `custom_rfq`,
`custom_supplier_quotation`, the submitted terms, source documents, and audit.
Its existing `custom_clm_data` holds:

```json
{
  "rfq_request_workflow": {
    "version": 1,
    "phase": "procurement_team",
    "assigned_role": "procurement_team"
  }
}
```

The same runtime contains a Pending Procurement Team approval and verified
`rfq_source` provenance. The API and Team queue derive **Pending Procurement
Team** from that saved evidence. Procurement Manager, Legal and Finance do not
receive this initial task. Existing aliases of the Procurement Team role resolve
to the canonical `procurement_team` role.

Expected successful API envelope:

```text
data.created: true on first creation; false on a completed repeat
data.request.doctype: Contract Request
data.request.record.name: the real ERP Request ID
data.summary.request.name: the same Request ID
data.summary.request.assigned_role: procurement_team
data.summary.request.current_stage: Pending Procurement Team
data.summary.decision: Yes
data.summary.blocks_procurement: true
data.contract: absent
```

Creating a Request alone leaves the Contracts count unchanged. The separate
Procurement Team action below creates the record listed under Contracts.

### Second action: Procurement Team creates the Contract

Team opens the saved request and uses **Review & Create Contract**. The same
endpoint receives `decision: Yes`, `operation: create_contract`, the current RFQ
revision, and the existing required review fields, including risk and the Legal
signatory. The backend requires the already-persisted Team Request.

It creates one standard **Contract**, permanently links it to that Request and
the RFQ/Award/supplier/quotation, then uses the existing CLM validation,
versioning, and Legal-review initialization. The Contract's `custom_clm_data`
stores `persistence: erpnext_rest_v1`, `rfq_source`, `rfq_context`,
`rfq_workflow`, source documents, approvals, versions, and audit history.
`rfq_context` includes the RFQ, award, supplier, quotation, contract type,
canonical contract status and `contract_required: Yes`.

Only after the saved Legal handoff is verified does the Request become
Completed with `rfq_request_workflow.phase: contract_created`; its Team approval
becomes Approved. The response includes:

```text
data.request.record.name: the original ERP Request ID
data.contract.record.name: the real ERP Contract ID
data.contract.record.custom_contract_request: the original Request ID
data.contract.record.custom_contract_status: Pending Legal (API view)
data.contract.approvals: a Pending Legal approval
data.summary.contract.name: the same Contract ID
data.summary.blocks_procurement: true
```

`GET /api/clm?view=list&doctype=Contract` supplies Contract Lifecycle's list and
counters. RFQ View Contract and the Contracts list must open that exact Contract
ID. Repeating a completed creation returns the existing Contract with
`created: false`.

### No decision

`decision: No` records the validated decision and its award reference without
creating either a Request or Contract. Existing CLM records prevent changing
that award to No. A completed No response contains no Request/Contract and has
`created: false`; the CLM-specific block is removed while all existing sourcing,
Legal/Finance, eligibility and PO checks continue to apply.

## Existing native Workflow states are preserved

The installed ERP Workflows do not contain `Pending Legal` or `Pending Finance`.
The adapter preserves those native definitions and translates only Contracts
marked `persistence: erpnext_rest_v1` with matching saved RFQ lifecycle evidence.
It rejects conflicting source, phase, and status combinations. Standalone and
older unmarked Contracts retain their existing behavior.

| Stage | Existing ERP field value | Persisted RFQ phase / API meaning |
| --- | --- | --- |
| New Request | `request_status: Draft`, then `Pending Review` | `procurement_team` / Pending Procurement Team |
| Team converts Request | `Pending Review → Approved → Completed` | `contract_created` after the Contract's Legal handoff |
| Contract prepared | `custom_contract_status: Draft` | `draft` |
| Legal review | `Under Review` | `legal_review` / Pending Legal |
| Legal approved | `Approved` | `signature` |
| E-signatures requested | `Pending Signature` | `signature` |
| Signed; waiting for Finance | `Pending Signature` | `finance_review` / Pending Finance |
| Finance approved | `Executed` | `procurement` / procurement continuation available |
| Existing PO finalized | Existing Contract status retained | `completed`, with verified PO evidence |
| Rejected | `Draft` | `rejected` / Rejected |

The business phase and approvals remain explicit in saved runtime data; the
native status is not used alone to infer eligibility or assignment. Legal
approval and real signatures precede Finance. Finance approval precedes final
Procurement Team action. Individual approval values remain Pending, Approved,
Rejected, or Sent Back.

`api/rfqClmRestSync.ts` derives the RFQ and Award CLM mirrors from a re-fetched,
validated Contract. It updates only their CLM reference/state data; it does not
approve an award or change the RFQ/award workflow owner or workflow state.
The procurement gate verifies actual Legal, signature, and Finance evidence.

## Two existing-field prerequisites

Use the existing server-side ERP configuration; credentials remain outside the
command line and output. Run from this repository:

```sh
node scripts/setup-rfq-clm-rest.mjs --check
```

The checked production plan is exactly:

| Existing field | Current value | Required value | Purpose |
| --- | --- | --- | --- |
| `Contract.custom_contract_request.unique` | 0 | 1 | Database-backed one-Contract-per-Request guarantee |
| `Request for Quotation.contract_required.allow_on_submit` | 0 | 1 | Persist the validated post-award Yes/No decision on a submitted RFQ |

`Contract Request.custom_rfq` is already unique and optional; the script verifies
it and leaves it unchanged. It does not create fields, change status choices,
activate Workflows, alter roles, or rewrite business records.

After explicit production approval for those two changes:

```sh
node scripts/setup-rfq-clm-rest.mjs --apply
node scripts/setup-rfq-clm-rest.mjs --check
```

The script backs up the complete affected schema and business documents,
workflows, roles and permissions to a timestamped
`scratch/rfq-clm-rest-schema-*/before.json` before any write. It re-reads the
snapshot and stops if it changed, then saves only the two existing Custom Fields
using `frappe.client.save`. Frappe's standard Custom Field save updates its
schema and clears the relevant cache. The script captures `after.json`, checks
that unrelated metadata and records are unchanged, and writes `result.json`.
A repeated completed run has zero operations.

The unique-index preflight scans every Contract and refuses duplicate Request
links, case-normalized collisions, non-null blank links, or a required/non-null
source field. It does not repair or delete conflicting rows. Multiple NULL
Request links remain valid for standalone Contracts; the source field stays
optional and has no default. Normal Frappe saves normalize blank unique values
to NULL. The reviewed production inventory currently contains zero Contracts.

These two schema writes are separate HTTP operations. If one fails, inspect the
backup and re-run `--check`; the script does not claim that an earlier successful
metadata save was rolled back. Deploy the matching BidSphere API/frontend
through the existing application process, then refresh the gateway's schema
cache before acceptance testing.

## Idempotency, retries, and failure handling

Standard document REST saves are **not one atomic transaction across multiple
ERP records**. The integration records a recoverable operation under
`RFQ.custom_approval_data.clm_rest_operation`, scoped to the exact decision and
award. Its `saving` phase remains until all required writes and readbacks finish.

Before an insert, the operation temporarily retains the exact intended document
under `pending_insert`. The backend compares the saved fields with that intent,
including after a lost response or retry. Successful verification atomically
replaces the intent with a `verified_inserts` record ID. A delayed double-click
therefore cannot reserve an already-verified insert again. Incorrect saved terms
remain an error and keep procurement blocked; they cannot become an idempotent
success on retry.

- The existing unique Request RFQ link prevents duplicate Requests.
- The prerequisite unique Contract Request link prevents duplicate Contracts.
- Insert conflicts and lost responses trigger a re-read by that unique source.
  The saved source and returned IDs must match; mismatched records are rejected.
- Document updates use current `modified` values and bounded re-read/retry.
  Concurrent source changes are not overwritten silently.
- Incomplete writes may leave a real Request or Draft Contract. The response
  reports the failure and the summary exposes `recovery_required`; it does not
  report a completed handoff or unlock procurement.
- Team's **Resume Contract creation** resumes the same saved records and
  completes the missing links/Legal assignment. It does not reset or duplicate
  the RFQ, Request, or Contract.
- Lifecycle synchronization may fail after a Contract save. Its error explicitly
  states that the Contract was saved and its RFQ/Award synchronization could not
  be confirmed. Refresh and retry against the current saved evidence.
- Form values survive errors. The client validates the complete response
  envelope and matching persistence evidence before showing success.

The code returns meaningful permission, schema, persistence and Workflow errors.
A missing unique prerequisite blocks insertion. The obsolete custom-app method
is no longer a capability check for this path; its historical missing-app HTTP
417 is not converted into a success response.

## Implementation and regression file map

### Files changed for this REST replacement

Implementation:

- `api/rfqClmErp.ts`
- `api/rfqClmRest.ts` (new)
- `api/rfqClmRestStatus.ts` (new)
- `api/rfqClmRestSync.ts` (new)
- `api/rfqClmCore.ts`
- `api/clmErp.ts`
- `api/clmErpErrors.ts`
- `api/rfqInitialClmHold.ts`
- `src/api/clm.ts`
- `src/types/clm.ts`
- `src/utils/rfqClmWorkflow.ts`
- `src/components/sourcing/RfqContractPanel.tsx`

Tests:

- `api/rfqClmErp.test.ts`
- `api/rfqClmRest.test.ts` (new)
- `api/rfqClmRestStatus.test.ts` (new)
- `api/rfqClmRestSync.test.ts` (new)
- `api/rfqClmCore.test.ts`
- `api/clmErpErrors.test.ts`
- `api/rfqInitialClmHold.test.ts`
- `api/rfqClmDocuments.test.ts`
- `api/clmRfqSourceFiles.test.ts`
- `src/api/clmRfq.test.ts`
- `src/utils/rfqClmWorkflow.test.ts`
- `src/components/sourcing/RfqContractPanel.test.tsx`

Schema tooling and documentation:

- `scripts/rfq-clm-rest-schema.mjs` (new)
- `scripts/setup-rfq-clm-rest.mjs` (new)
- `scripts/rfq-clm-rest-schema.test.mjs` (new)
- `docs/rfq-clm-rest-integration-2026-09-23.md` (this guide)
- `docs/rfq95-clm-deployment-readiness-2026-09-23.md` (superseded notice)

### Related paths covered by regression tests

This map covers the current handoff and its retained surrounding guards; the
workspace also contains unrelated work from earlier tasks.

| Responsibility | Source | Regression coverage |
| --- | --- | --- |
| Authenticated operation routing and persistence confirmation | `api/clm.ts`, `api/rfqClmCore.ts`, `src/types/clm.ts` | `api/clm.test.ts`, `api/rfqClmCore.test.ts` |
| Standard REST create/update, unique insertion and recovery | `api/rfqClmErp.ts`, `api/rfqClmRest.ts` | `api/rfqClmErp.test.ts`, `api/rfqClmRest.test.ts` |
| Native status mapping | `api/rfqClmRestStatus.ts`, `api/clmErp.ts` | `api/rfqClmRestStatus.test.ts`, `api/rfqClmErp.test.ts` |
| Validated RFQ/Award lifecycle mirrors | `api/rfqClmRestSync.ts`, `api/clmErp.ts` | `api/rfqClmRestSync.test.ts` |
| CLM actions, approval sequence, signatures and record policy | `api/clmCore.ts`, `api/clmSignature.ts`, `api/clmNotifications.ts` | `api/clmCore.test.ts`, `api/clmRequestRouting.test.ts`, `api/clmSignature.test.ts`, `api/clmNotifications.test.ts` |
| Actionable errors and failed HTTP envelopes | `api/clmErpErrors.ts`, `src/api/clm.ts` | `api/clmErpErrors.test.ts`, `src/api/clm.test.ts`, `src/api/clmRfq.test.ts` |
| RFQ decision/request UI and retry action | `src/components/sourcing/RfqContractPanel.tsx` | `src/components/sourcing/RfqContractPanel.test.tsx` |
| Saved Team assignment, role aliases, queue | `src/utils/rfqClmWorkflow.ts`, `api/rbacAuth.ts`, `src/config/roles.ts`, `src/components/dashboard/ProcurementTeamDashboard.tsx`, `PendingClmRequestsCard.tsx` | `src/utils/rfqClmWorkflow.test.ts`, `api/rbacAuth.procurementTeam.test.ts`, `src/config/roles.procurementTeam.test.ts`, dashboard CLM/card tests |
| Existing award Legal/Finance initial hold | `api/rfqInitialClmHold.ts`, `api/legalReviewCore.ts`, `api/legal-review.ts` | `api/rfqInitialClmHold.test.ts`, `api/legalReviewCore.test.ts` |
| Conditional branch and PO enforcement | `api/rfqClmBranchGuard.ts`, `api/rfqPurchaseOrderGuard.ts`, `api/rfqContractRequirementGuard.ts`, `api/erpProxySecurityGuard.ts` | Matching `*.test.ts`, `api/proxy.rfq-po.test.ts` |
| Real Contract list and counters | `src/pages/contracts/ContractsPage.tsx`, existing `src/api/clm.ts` list endpoint | `src/pages/contracts/ContractsPage.test.tsx` |
| Two-field prerequisite and full backup/verification | `scripts/rfq-clm-rest-schema.mjs`, `scripts/setup-rfq-clm-rest.mjs` | `scripts/rfq-clm-rest-schema.test.mjs` |

Final focused regression run: **847 passed, 0 failed** on 2026-09-23, including
the 27 schema prerequisite tests and 23 REST persistence/recovery tests.
Coverage includes initial Request routing, Manager exclusion, real-document
API contracts, source linkage, foreign documents, duplicate submissions, lost
responses, incorrectly persisted terms, and delayed concurrent insertions.
Existing Legal/signature/Finance and procurement gate tests also passed.
Machine-readable result: [test report](../scratch/rfq-clm-rest-final-tests.json).

Final `npm run build` passed, including TypeScript compilation and the Vite
production bundle. Vite reported its existing large-chunk advisory.
Build log: [build output](../scratch/rfq-clm-rest-build.log).

The read-only production check passed with exactly the two operations above
and no duplicate Contract links. These tests use local fixtures; the production
Request/Contract API result and live queue acceptance remain unverified.

## Required live acceptance evidence

1. Re-fetch RFQ95 and confirm its current award, supplier, quotation and value.
2. As Procurement Team, submit Yes and valid request details. Re-fetch the real
   Request, saved Yes decision, source context, Team assignment and audit.
3. Verify that Request in Team's queue and verify Manager/Legal/Finance exclusion
   from the initial task. Retry Yes and retain the same Request ID.
4. As Team, create the Contract. Re-fetch the real Contract, original Request,
   source references and Legal approval. Verify the completed Request handoff.
5. Open the exact same Contract from RFQ View Contract and Contract Lifecycle.
   Verify real list/counter changes, then repeat creation without a duplicate.
6. Complete actual authorized Legal review and e-signatures. Verify Finance is
   assigned only afterward; complete Finance and verify final Team assignment.
7. Use the existing procurement/PO flow and verify finalization against its real
   submitted PO. Confirm no premature procurement unlock at earlier stages.
8. Use a separate authorized test award for No. Verify there is no CLM Request
   or Contract and that the existing procurement checks remain effective.

Store API responses, re-fetched IDs, queue/list evidence and approval/signature
audit evidence. Update this guide's live status from those results; passing local
fixtures does not establish production completion.
