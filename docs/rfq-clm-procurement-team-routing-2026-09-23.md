# RFQ → Procurement Team Request → Contract routing

## Delivery status

This is a **local implementation and deployment package**. No production
installation, record creation, approval, signature or PO was performed in this
follow-up. No SSH access or credentials are requested.

This guide supersedes the one-step creation instructions in
`rfq94-clm-handoff-2026-09-23.md`. Deploy the matching Python app **and** BidSphere
Node API/frontend. An old Python app and new frontend are not a supported pair.

## Corrected persisted flow

1. On an awarded RFQ, Submit CLM Request records Yes and creates exactly one
   **Contract Request**, with RFQ, award, winning supplier/quotation/value,
   required contract terms, requester, source documents and audit.
2. Its existing `custom_clm_data` stores `rfq_request_workflow` version 1,
   phase `procurement_team`, assigned role `procurement_team`, one stage-0
   Pending Team approval and a `procurement_team_assigned` audit event.
   Its native request status stays Draft; its persisted routing displays
   **Pending Procurement Team**. No new role, status column or user assignment
   is invented.
3. The secured Contract Requests list and Team dashboard expose this saved
   request to Procurement Team only. Manager, Legal and Finance do not receive
   this initial task. Initial Legal/Finance RFQ actions are also held while this
   saved Team request awaits processing; procurement's award read context stays
   available, and native award statuses are not rewritten.
4. Team opens **Review & Create Contract**, reviews the saved terms and provides
   the existing required risk assessment and designated Legal signer. A second
   atomic transaction creates the real **Contract**, completes Team processing
   and assigns Legal Review. Manager cannot call this action on the backend.
5. The same Contract appears in Contract Lifecycle → Contracts and RFQ → View
   Contract. Legal approval → e-signatures → Finance approval → Team procurement
   handoff remains sequential. Existing RFQ/PO checks still apply; CLM finalization
   records an existing submitted PO rather than creating or editing one.
6. No records are created for No, and the existing RFQ branch continues normally.

The initial form retains the required native Request fields: type, purpose,
description, department and dates. Risk/signatory inputs are collected in the
later Team action. Required terms are not replaced with guessed defaults.

### Transaction and failure guarantees

- Node request operation is `operation: "request"`; Python receives
  `create_contract: false`. A Request-only response is valid only here, after
  re-fetching and verifying persisted Team assignment and RFQ links.
- Node conversion is `operation: "create_contract"`; Python receives
  `create_contract: true`. It requires the saved Team request and returns a real,
  linked Contract. A Request-only response cannot report Contract creation.
- Both operations use the existing
  `POST /api/method/bidsphere_workflows.rfq_clm.decide` endpoint. Native RFQ row
  locks and the existing unique Request source constraint prevent duplicates.
- Retrying the request returns the same Request. Retrying creation returns the
  same Contract. First-time one-step creation without a Team request is rejected.
- Initial failure rolls back Request/decision/mirrors together. A later failed
  conversion leaves the already committed Team request intact and creates no
  partial Contract. The real error is returned and entered form values remain.
- Compatible old Draft/Approved request-only records require an explicit audited
  Team-routing action, preserving terms and audit. Prior nonempty review evidence
  requires resolution; it is not overwritten. No bulk business-record migration.

## Local verification

All identities below are **local test fixtures**, not newly created ERP records.
Tests call the production handlers against a stateful ERP test store; native
Python transaction tests model rollback and serialization. They do not establish
live MariaDB locking, production permissions or real signatures.

| Check | Verified locally |
| --- | --- |
| RFQ93 / award LDC2026-00024 / Apex / quotation 00263 | Yes creates a saved Team Request; no Contract before Team action |
| RFQ94 / award LDC2026-00025 / FEMSA / quotation 00267 | Same separate Request and Contract behavior |
| Contract Required | Yes in saved RFQ and source context |
| CLM Request ID | ID returned by test store and independently re-fetched; no live ID claimed |
| Assigned role / stage | `procurement_team` / Pending Procurement Team |
| Team queue | Visible; count derives from persisted Requests |
| Manager queue | Not visible; creation endpoint returns 403 |
| Legal/Finance initial queue/actions | Held until Team Contract creation |
| Contract | Created only after Team action; same Request/RFQ/award links |
| Lifecycle | Legal → signatures → Finance → Team → existing submitted PO → Completed |
| Retry | One Request and one Contract for the award |
| No / unrelated RFQ | Existing branch preserved |

Validation completed locally:

- **1,049 application/schema regression tests passed**, 0 failed or skipped,
  across 46 files. Includes request persistence/queues, exact RFQ93/RFQ94 identity
  fixtures, authorization, duplicate prevention, rollback, Legal/Finance holds,
  full sequential Contract lifecycle, No branch and existing procurement gates.
- **89 Python transaction/native-guard tests passed.**
- `npm run build` passed; Vite reports the existing large-chunk warning.
- These are focused checks, not a claim that the full repository suite passes.
  The prior full-suite baseline recorded four separate LDR stage-projection
  failures in `src/api/approvalWorkflow.test.ts`; that file was not changed by
  this routing delivery.

Evidence: `scratch/rfq-team-routing-tests.json` and `.log`,
`scratch/rfq-team-routing-python.log`, `scratch/rfq-team-routing-build.log`.

## Production prerequisites and evidence

The last prior read-only verification was **2026-09-23 06:50 UTC**, against
`http://80.225.204.210:8090`: Frappe 16.20.0 and ERPNext 16.22.0 were installed;
`bidsphere_workflows` was missing and its method returned HTTP 417. RFQ94 had no
saved CLM decision or linked Request/Contract. Its award was LDC2026-00025 for
FEMSA, quotation PUR-SQTN-2026-00267, USD 2,600. Those are historical observations,
not a fresh production read in this follow-up. Evidence is retained in
`scratch/rfq94-clm-handoff-check-2026-09-23.json`.

The active production Bench path and site name are unknown. The operator must
resolve them on the host serving port 8090. A separate local WSL Bench is not this
production target. Keep the missing-extension error until actual deployment.

## Exact manual deployment procedure

### 1. Identify the active Bench/site

Use the existing authenticated hosting console/deployment connection as the
Bench service owner. For containers, enter the backend container and update the
shared app image/volume used by web and workers. Identify the Bench serving port
8090 from the host's proxy/container configuration, then run:

```sh
cd /absolute/path/to/the/production/frappe-bench
pwd
bench version
./env/bin/python --version
node --version
find sites -maxdepth 2 -name site_config.json -print
```

Match the site to the ERP URL used by BidSphere. Do not print site configuration
contents. Set these non-secret values to the verified deployment values:

```sh
BENCH=/absolute/path/to/the/production/frappe-bench
SITE=actual-production-site-name
GATEWAY_USER=existing-bidsphere-erp-service-user
cd "$BENCH"
bench --site "$SITE" list-apps
bench --site "$SITE" backup --with-files
```

The gateway user is the owner of BidSphere's existing server-side ERP API
credential. Keep that credential in its current secure configuration; this
deployment does not create accounts or grant roles.

### 2. Install or update the existing app

Upload `bidsphere_workflows-rfq-team-routing-2026-09-23.zip` and its manifest using
the normal secure deployment channel. Verify its SHA-256. For a missing app:

```sh
ARCHIVE=/absolute/path/to/bidsphere_workflows-rfq-team-routing-2026-09-23.zip
sha256sum "$ARCHIVE"
test ! -e "$BENCH/apps/bidsphere_workflows"
```

Continue with extraction **only if the directory check succeeds**. If the app
already exists, use the normal reviewed update/release process to replace its
source; do not extract over an unknown app or reinstall an installed site app.

```sh
python3 -m zipfile -e "$ARCHIVE" "$BENCH/apps"
cd "$BENCH"
bench pip install -e apps/bidsphere_workflows
./env/bin/python apps/bidsphere_workflows/register_on_bench.py
./env/bin/python apps/bidsphere_workflows/register_on_bench.py --apply
bench --site "$SITE" install-app bidsphere_workflows
bench --site "$SITE" set-config bidsphere_gateway_user "$GATEWAY_USER"
bench --site "$SITE" migrate
bench --site "$SITE" clear-cache
bench restart
bench --site "$SITE" list-apps
```

For an already installed app, after updating source run editable installation,
migrate, clear-cache and restart; omit `install-app`. For externally supervised
containers/services, use their normal web/worker reload instead of `bench
restart`. All processes must use the same app release. The final site app list
must contain `bidsphere_workflows`; filesystem presence alone is insufficient.

### 3. Apply the existing additive schema prerequisites

The new initial Team routing uses existing JSON fields and requires **no new
column or business-record rewrite**. Existing CLM schema, permissions and the
unique `Contract Request.custom_rfq` field must be present. From the matching
BidSphere source or schema package, use the existing server-only environment
configuration and Node with built-in fetch. Do not put secrets in command lines.

```sh
node scripts/setup-rfq-clm-branch.mjs --check
node scripts/setup-rfq-award-contract.mjs --check
node scripts/setup-rfq-clm-lifecycle.mjs --check
node scripts/setup-rfq-clm-sequential.mjs --check
node scripts/setup-rfq-clm-workflow.mjs --check
```

Review each plan. The prior preflight still required RFQ `contract_required`
allow-on-submit, Contract status options Pending Legal/Pending Finance/Rejected,
and additive RFQ-qualified transitions in the existing CLM Workflows. Award
`custom_clm_state` and type choices were already present. Recheck current state;
do not force a plan that reports a conflicting custom Workflow.

```sh
node scripts/setup-rfq-clm-branch.mjs --apply
node scripts/setup-rfq-award-contract.mjs --apply
node scripts/setup-rfq-clm-lifecycle.mjs --apply
node scripts/setup-rfq-clm-sequential.mjs --apply
node scripts/setup-rfq-clm-workflow.mjs --apply
cd "$BENCH"
bench --site "$SITE" migrate
bench --site "$SITE" clear-cache
bench restart
bench --site "$SITE" list-apps
```

Stop at any failed command; retain schema before/after backups and verification
output. No RFQ sourcing, ECR or Business Case Workflow is replaced.

### 4. Verify the actual capability and deploy the matching application

```sh
bench --site "$SITE" console
```

In that site console:

```python
import frappe
assert "bidsphere_workflows" in frappe.get_installed_apps()
from bidsphere_workflows.rfq_clm import decide
assert callable(decide)
assert frappe.get_meta("Contract").get_field("custom_clm_data")
assert frappe.get_meta("Contract").get_field("custom_rfq")
assert frappe.get_meta("Contract Request").get_field("custom_clm_data")
assert frappe.get_meta("Contract Request").get_field("custom_rfq").unique
assert frappe.get_meta("Legal Document Review").get_field("custom_clm_state")
assert frappe.get_meta("Request for Quotation").get_field("contract_required").allow_on_submit
print({"site": frappe.local.site, "installed_apps": frappe.get_installed_apps(), "rfq_clm_method": decide.__module__ + "." + decide.__name__})
```

Exit the console. Deploy the matching BidSphere release with `npm ci` and
`npm run build`, including **both** API and frontend, then restart the API process.
The app ZIP contains Python only; the schema ZIP contains patch scripts only.
Neither archive replaces the matching Node/frontend release.

The service identity needs existing document permissions on RFQ, awards,
Requests, Contracts and source File evidence. The authenticated Node principal
must map to existing `procurement_team`; no Manager or new role grant is needed.
Verify the POST endpoint using the secured application transaction. A GET error
on this POST-only method is not proof of missing installation. A real validation
failure must remain visible; installation is not business-transaction success.

### 5. Manual acceptance after deployment

1. Re-fetch RFQ93/RFQ94 and its current award/quotation/supplier. Use an approved
   test award and current valid dates; do not assume historical context is current.
2. As Team, select Yes and **Submit CLM Request**. Record the returned Request ID.
   Independently re-fetch Request, RFQ and award. Verify source identity, requester,
   Team Pending approval, role, audit and Pending Procurement Team mirrors.
3. Verify one Request, **zero Contracts** for that award, Team queue visible/count
   increased, Manager/Legal/Finance initial queue absent. Direct unauthorized
   processing and premature Legal/Finance calls must fail without writes.
4. As Team open **Review & Create Contract**, supply required review data and
   create. Re-fetch the real Contract and links. Confirm the same Contract ID in
   RFQ View Contract and Contracts list, Pending Legal Review/Legal Manager owner,
   Request Team approval Approved and Request phase contract_created.
5. Repeat both operations as appropriate: no extra Request or Contract. After a
   Contract exists, show Contract already exists / View Contract.
6. As assigned authorized test users complete Legal, actual e-signatures and
   Finance in order. Finance must have no approval action before signed Legal
   approval; Team must have no finalization action before Finance approval.
7. Complete the existing procurement/PO workflow and finalize with its submitted
   PO. Confirm the same Contract's Completed handoff and immutable audit receipt.
8. On a **separate** approved test award choose No. Verify no CLM records and the
   unchanged RFQ Legal/Finance/procurement continuation. Do not reverse RFQ94's
   saved Yes merely to test No.
9. Retain installed-app list, migration output, endpoint responses, persisted IDs,
   role-queue evidence and audit. Only this establishes live acceptance.

Actual production signatures and POs remain actions for authorized users. Do not
fabricate approval/signature evidence to complete the checklist.

## Changed files

- Transaction: `api/rfqClmCore.ts`, `api/clm.ts`, `src/types/clm.ts`,
  `erpnext_apps/bidsphere_workflows/bidsphere_workflows/rfq_clm.py`.
- Queue/authorization/notification: `api/clmCore.ts`, `api/clmNotifications.ts`,
  `api/rfqInitialClmHold.ts`, `api/legalReviewCore.ts`, `api/legal-review.ts`.
- Client/UI: `src/api/clm.ts`, `src/utils/rfqClmWorkflow.ts`,
  `src/components/sourcing/RfqContractPanel.tsx`,
  `src/components/contracts/ClmRecordWorkspace.tsx`,
  `src/pages/contracts/ContractsPage.tsx`,
  `src/components/dashboard/ProcurementTeamDashboard.tsx`,
  `src/components/dashboard/PendingClmRequestsCard.tsx`.
- Regression tests alongside these components/handlers, including new
  `api/clmRequestRouting.test.ts`, initial-hold tests and native Python tests.
- Existing app README, this guide and `scratch/package_rfq_team_routing.py`.

The workspace contains earlier unrelated changes. They were preserved.
