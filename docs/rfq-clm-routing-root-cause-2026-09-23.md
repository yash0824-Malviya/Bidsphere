# RFQ CLM routing: live root-cause trace

## Result: live routing is not verified successful

ERPNext at `http://80.225.204.210:8090` was read directly on 2026-09-23.
The transaction extension is still missing. Its exact response is HTTP 417:

```text
Failed to get method for command bidsphere_workflows.rfq_clm.decide
with App bidsphere_workflows is not installed.
```

The configured server returns Frappe 16.20.0 and ERPNext 16.22.0, with no
`bidsphere_workflows` entry. **No Contract Request exists for RFQ93 or RFQ94.**
This is a failed creation prerequisite, not a successfully saved request that
the Procurement Team queue has hidden.

Evidence: `scratch/rfq-clm-routing-live-trace-2026-09-23.json`.
Reproduction script: `scratch/trace-rfq-clm-routing.mjs` (read-only, no credentials
printed). Its first sandboxed attempt could not reach ERP; the subsequent
authorized network read succeeded. No production mutation was performed.

## Actual persisted state

| Requested field | RFQ93 actual value | RFQ94 actual value |
| --- | --- | --- |
| rfq_id | PUR-RFQ-2026-00093 | PUR-RFQ-2026-00094 |
| award_id | LDC2026-00024 | LDC2026-00025 |
| contract_required on RFQ | Yes | No |
| Saved post-award contract_decision | null | null |
| clm_request_id | null; no Request exists | null; no Request exists |
| assigned_role | absent | absent |
| assigned_user | absent | absent |
| CLM current_stage / status | absent; no CLM record | absent; no CLM record |
| Native RFQ status | Submitted | Submitted |
| Contract count for this RFQ | 0 | 0 |

RFQ93 meets the requested raw Yes case. Its supplier is Apex Fasteners Ltd,
quotation PUR-SQTN-2026-00263, value USD 2,500. RFQ94 currently has FEMSA,
quotation PUR-SQTN-2026-00267, value USD 2,600. The RFQ94 preview correctly shows
**Decision pending**, not a saved Yes transaction.

The awards' existing Legal Document Review `current_owner` and `next_approver`
are Legal Reviewer. Those are **award records**, not CLM Request assignments.
Their `custom_clm_state` is empty. They have not overwritten a saved Team request.

## Exact code and API path

1. `src/components/sourcing/RfqContractPanel.tsx` renders **Yes — Request CLM**
   in the current source (the older “Yes — Create CLM” label is absent).
   Its click handler calls `setEditing({ context: summary, mode: "request" })`.
   This opens the existing required-details form; it performs no database write.
2. Submitting the form executes `RfqContractRequestEditor.save()` and then
   `submitRfqClmRequest()` in `src/api/clm.ts`.
3. The client posts to **`/api/clm?view=rfq_contract`**, with this contract:

   ```json
   {
     "rfq": "PUR-RFQ-2026-00093",
     "expected_modified": "<current ERP RFQ revision>",
     "decision": "Yes",
     "operation": "request",
     "payload": {
       "contract_type": "<explicit selection>",
       "contract_purpose": "<entered or prefilled purpose>",
       "description": "<entered or prefilled description>",
       "department": "<selected required department>",
       "contract_start_date": "<entered date>",
       "contract_end_date": "<entered date>"
     }
   }
   ```

   This is the verified **source contract**, not a captured new browser POST.
   No form terms or payload have been invented and submitted as a user.
4. `api/clm.ts` authenticates and validates the body, then calls
   `decideRfqContractRequirement()` → `recordRfqContractRequest()` →
   `processRfqContractRequest()` in `api/rfqClmCore.ts`.
5. The backend verifies RFQ/award/supplier/quotation, derives source context,
   records the authenticated requester, and `routeRequestToTeam()` creates the
   canonical Team routing/approval/audit. It does not use the actor's role as an
   arbitrary assignee and does not assign the requester as queue owner.
6. `commitRfqClmDecision()` in `api/rfqClmErp.ts` posts once to
   **`/api/method/bidsphere_workflows.rfq_clm.decide`**, with `create_contract:
   false`, validated `request_document`, `actor`, RFQ revision and award revisions.
7. The existing native app's `rfq_clm.py:decide()` should insert **Contract
   Request**, record the RFQ decision and award mirror atomically. In production,
   ERP fails before this function can run because the app is not installed.
8. Node maps only this explicit missing-capability error to HTTP 503 with the
   actionable deployment message. It does not show success or write a fallback
   Request/Contract.

The live GET capability response was inspected directly. A fresh authenticated
Team form POST/response has not been captured: the available preview is signed
in as Procurement Manager. The user was asked to switch to Team, without sharing
credentials. Even a Team session cannot complete persistence until deployment.

## Assignment storage and overwrite audit

The real DocType is **Contract Request**, a custom Procurement DocType already
registered on the active site. It has native `requester`, optional `approver`,
`approval_status` and `request_status`. These are separate from the role queue.

The existing application persists routing in:

```text
Contract Request.custom_clm_data.rfq_request_workflow.assigned_role = procurement_team
Contract Request.custom_clm_data.rfq_request_workflow.phase = procurement_team
Contract Request.custom_clm_data.approvals[0].role = procurement_team
Contract Request.custom_clm_data.approvals[0].status = Pending
Contract Request.custom_clm_data.audit[*].new_status = Pending Procurement Team
```

Native `request_status` remains Draft for compatibility. The API exposes the
verified initial routing as `request.assigned_role = procurement_team` and
`request.current_stage = Pending Procurement Team`. It does not add duplicate
`assigned_role` or `current_stage` columns. Role-level assignment has no named
`assigned_user`; `requester` identifies who submitted the request.

`procurement.team` is an accepted alias for the **existing canonical
`procurement_team`** role, not a second role. Procurement Manager remains
`procurement` and cannot perform the initial action.

Live ERP checks found:

- No Assignment Rule for Contract Request.
- Active Workflow `BidSphere Contract Request` uses `request_status`.
- Its states have no `update_field`/`update_value` owner assignment.
- Existing `System Manager` Workflow edit permission is a native gateway save
  permission, not a Procurement Manager queue assignment.
- The additive RFQ request-conversion Workflow edge is still absent; the
  previously prepared migration is also needed for the later Contract step.

Local searches found no second writer assigning Manager after routing. Native
`_validate_request_routing()` and `guard_request()` reject unauthorized changes.
The later successful Team conversion changes the request phase to
`contract_created`, marks its Team row Approved, and creates Legal's separate
Contract approval. That is an intentional transition, not an initial overwrite.

## Queue filtering and corrections

`GET /api/clm?view=list&doctype=Contract%20Request` reads real ERP records and
applies `canReadClm()` using the authenticated server role. The Team dashboard
calls `getClmList("Contract Request")`; `rfqClmRequestWorkflowView()` requires
the saved RFQ source, Team phase, Team assignment and Pending Team approval.
Manager is excluded from valid initial Team requests by the API, before rendering.

Two real local code defects were identified independently of missing deployment:

1. `resolveServerRole()` did not recognize dotted/underscored ERP Team aliases;
   frontend `normalizeAppRole("procurement.team")` fell back to Procurement
   Manager. Explicit aliases now normalize consistently to `procurement_team`.
   No role priority, new role or production record was changed.
2. The Team dashboard used three raw role comparisons for query enablement,
   refresh and rendering. All three now use the same canonical normalization.
3. Explicit malformed new Request routing could fall through to generic Manager
   read access. Such marked records now fail closed. Existing unmarked legacy
   request read behavior is preserved.

Regression checks use both alias resolution and the production request handler:
Yes → saved Team routing → Team queue inclusion → Manager exclusion. Tests also
exercise the actual secured list endpoint against persisted test-store records.
These are local regression results, not substitutes for a live saved record.

## Changes and validation in this follow-up

Implementation files:

- `api/rbacAuth.ts` — explicit existing Team aliases in server role resolution.
- `src/config/roles.ts` — matching aliases in client role resolution.
- `api/clmCore.ts` — no Manager fallback for malformed explicit RFQ routing.
- `src/components/dashboard/ProcurementTeamDashboard.tsx` — canonical role used
  for CLM query, refresh and rendering; no layout redesign.

Regression tests:

- `api/rbacAuth.procurementTeam.test.ts`
- `src/config/roles.procurementTeam.test.ts`
- `api/clmRequestRouting.test.ts`
- `api/rfqClmCore.test.ts`
- `src/components/dashboard/ProcurementTeamDashboard.test.tsx`

Diagnostics/delivery:

- `scratch/trace-rfq-clm-routing.mjs`
- `scratch/rfq-clm-routing-live-trace-2026-09-23.json`
- This root-cause report.

**665 focused tests passed, 0 failed or skipped, across 23 files.** The run covers
backend/client role resolution, persisted request routing, real list-handler
authorization with fixture ERP data, dashboard visibility, duplicate prevention,
failure handling and existing RFQ/PO/CLM gates. ECR role/navigation regressions
also passed; no ECR or Business Case workflow implementation changed.
`npm run build` passed with the existing large-chunk warning.

Evidence: `scratch/rfq-routing-debug-final-tests.json`,
`scratch/rfq-routing-debug-final-tests.log`, `scratch/rfq-routing-debug-build.log`.
This is not a full-repository-suite claim.

| Acceptance item | Live result | Local regression |
| --- | --- | --- |
| Saved Request / Team assignment | FAIL: no Request exists; extension missing | PASS |
| Procurement Team queue | FAIL: cannot contain the absent Request | PASS |
| Procurement Manager exclusion | Not verified with a real saved Request | PASS |
| Existing RFQ regression | No live business mutation performed | PASS |

The live missing-record state is not evidence that Manager's role filter is
correct; exclusion must be rechecked against the actual newly saved Request
after deployment. No production PASS is inferred from an empty database.

## Required production resolution

Use the existing prepared app, not a replacement or REST-only workaround.
Install/update `bidsphere_workflows` in the Bench/site serving port 8090, apply
the reviewed additive schema/Workflow prerequisites, migrate, clear cache and
restart web/workers. Deploy the matching Node/API/frontend release containing
the role fixes. A fresh login is needed if a previous token resolved the wrong
role; do not alter or manufacture a signed session token.

The exact Bench/site commands and verification procedure are in
[the deployment guide](rfq-clm-procurement-team-routing-2026-09-23.md).
Per the user's standing instruction, no SSH/password/private key is requested.

Do not mark this issue resolved until a real transaction returns a Request ID,
ERP re-fetch confirms the assignment/stage, and authenticated Team and Manager
queue reads confirm inclusion and exclusion respectively.
