# RFQ95 CLM deployment readiness

> **Superseded implementation path — 2026-09-23:** The current BidSphere
> integration uses existing ERPNext REST APIs and preserves the installed native
> Workflows. Installing `bidsphere_workflows` is no longer a prerequisite for this
> path. Use [RFQ CLM REST integration](rfq-clm-rest-integration-2026-09-23.md) for
> the two existing-field prerequisites, recovery behavior and current acceptance
> status. This document and its deployment commands remain a historical record
> of the earlier app-based approach; they are not the current deployment plan.

## Verified live state

The read-only ERP check at **2026-09-23 10:32:31 UTC**, reconfirmed at
**2026-09-23 10:46:06 UTC**, found:

| Item | Result |
| --- | --- |
| ERP target | `http://80.225.204.210:8090` |
| Installed applications reported by ERP | Frappe 16.20.0, ERPNext 16.22.0 |
| Transaction method | HTTP 417: `App bidsphere_workflows is not installed` |
| RFQ | `PUR-RFQ-2026-00095`, submitted |
| Award | `LDC2026-00026` |
| Winning quotation | `PUR-SQTN-2026-00270` |
| Supplier display name | Blue Ridge Manufacturing Inc |
| Exact stored Supplier ID | `"Blue Ridge Manufacturing Inc"` (including the quotation marks) |
| Award value | USD 30 |
| Raw RFQ `contract_required` | `Yes` |
| Saved transactional `contract_decision` | Absent |
| Linked Contract Requests / Contracts | 0 / 0 |
| Total Contracts returned by ERP | 0 |

Evidence: [RFQ95 read-only backend trace](../scratch/rfq95-clm-flow-live-evidence.json).
The raw Yes field does not establish a committed CLM decision or a Request.
The missing app prevents the transaction from creating those records, so the
Contracts list accurately remains empty. Production deployment and RFQ95
acceptance have **not** been completed.

### Latest live acceptance status

| Check | Result |
| --- | --- |
| Saved post-award Yes decision | FAIL — absent |
| Persistent Contract Request | FAIL — no record exists |
| Assigned role / current stage on Request | Absent — no Request exists |
| Procurement Team queue acceptance | FAIL — no request can appear |
| Procurement Manager exclusion after creation | Not verified live; local regression passes |
| Separate Team Contract creation | FAIL — blocked before the Request step |
| Contract visible in Contracts list | FAIL — ERP returns zero Contracts |
| Existing RFQ workflow regression | Local tests pass; no production workflow changes made |

The Legal Reviewer owner on award `LDC2026-00026` belongs to the existing award
document. It is not a CLM Request assignment and does not prove that a Team
assignment was overwritten. No Request record exists to be overwritten.

Production deployment remains the unresolved prerequisite. The latest local
master-prompt audit also corrected transaction response/error handling, as
described below; these code changes cannot install the missing app. The prior
instruction to continue locally without SSH/credential requests is still in
effect; ERP document API access cannot install an app on a Frappe Bench.

The local server summary was also evaluated against the live ERP records, with
all mutation dependencies disabled. It resolves the correct Blue Ridge award:
Procurement Team has `can_request: true`, `can_create: false`; Procurement
Manager has both permissions false. Both see `Contract Decision Required`,
with no Request or Contract. This is a read-only role-policy diagnostic, not
an authenticated Team queue acceptance test. Evidence:
[server summary](../scratch/rfq95-clm-summary-live-evidence.json).

## Actual code path and local corrections

1. `RfqContractPanel` opens the request-details editor on **Yes — Request CLM**.
   The click alone does not persist a decision; submitting the required details
   calls `submitRfqClmRequest`.
2. `POST /api/clm?view=rfq_contract`, `operation: request`, reaches
   `api/clm.ts` and `recordRfqContractRequest` in `api/rfqClmCore.ts`.
3. `commitRfqClmDecision` sends the validated RFQ/award/request to
   `POST /api/method/bidsphere_workflows.rfq_clm.decide`, with
   `create_contract: false`. This is the capability missing in production.
4. The native transaction creates a **Contract Request**, links it to the
   RFQ/award, and persists `custom_clm_data.rfq_request_workflow` with
   `assigned_role: procurement_team`, plus its Pending Team approval and audit.
   The API presents **Pending Procurement Team** from that persisted evidence.
   `procurement.team` is an alias for the existing `procurement_team` role.
5. `GET /api/clm?view=list&doctype=Contract%20Request` applies backend record
   authorization. The Team dashboard filters the saved assignment and Pending
   approval; Procurement Manager is excluded from this initial request queue.
6. Team's **Review & Create Contract** submits `operation: create_contract`
   to the same secured endpoint. The native transaction creates one **Contract**
   with the saved Request/RFQ/award/quotation references and Legal assignment.
   Repeated creation returns the linked Contract.
7. `GET /api/clm?view=list&doctype=Contract` reads those real Contracts for
   `/contracts`; counters and links use that returned list, not Requests.

Two bounded local corrections were made:

- `api/clm.ts`: RFQ-to-Request prefill now checks `can_request`. Its stale
  `can_create` check rejected the initial request stage. This separate prefill
  path was defective but does not explain the missing production app.
- `src/components/dashboard/PendingClmRequestsCard.tsx`: the existing queue
  now also displays Award ID and Award Value from the persisted Request.

Regression coverage was added in `api/clm.test.ts`, `api/rfqClmCore.test.ts`,
`src/components/dashboard/PendingClmRequestsCard.test.tsx`,
`src/components/dashboard/ProcurementTeamDashboard.clm.test.tsx`, and
`src/pages/contracts/ContractsPage.test.tsx`. It covers the exact RFQ95 source,
request-only persistence, Team assignment and Manager exclusion, separate
Contract creation, one shared Contract ID, list/count update, duplicate
prevention and downstream approval gates. These use local persisted test
stores, not newly created production records.

### Completed local validation

The following earlier runs established the two-step implementation. The final
master-prompt run below supersedes their aggregate counts.

```powershell
npx vitest run api/clm.test.ts api/clmRequestRouting.test.ts api/rfqClmCore.test.ts api/rfqClmErp.test.ts
# 222 passed / 5 files (the filter also includes src/api/clm.test.ts)
npx vitest run api/clmCore.test.ts api/clmSignature.test.ts api/clmNotifications.test.ts api/rfqPurchaseOrderGuard.test.ts
# 193 passed / 4 files
npx vitest run src/components/dashboard/ProcurementTeamDashboard.clm.test.tsx src/components/dashboard/PendingClmRequestsCard.test.tsx src/pages/contracts/ContractsPage.test.tsx src/utils/rfqClmWorkflow.test.ts src/config/roles.procurementTeam.test.ts src/components/contracts/clmSupplierHandoff.test.tsx
# 50 passed / 6 files
& 'C:\Users\VICTUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover -s erpnext_apps/bidsphere_workflows/tests -p test_rfq_clm.py
# 89 Python extension tests passed
npm run build
# Passed; existing large-chunk warning remains
```

The additional read-only live-summary diagnostic passed once using
`npx vitest run --config scratch/rfq95-clm-live.vitest.mjs`.
It disables create, save, notify and decision operations. The end-to-end live
test remains **blocked**, because the required ERP transaction cannot run until
the app is installed on the production site.

### Master-prompt error handling audit and final local validation

Two additional defects were corrected without changing the sourcing workflow:

- `api/clmErp.ts`, `api/clmErpErrors.ts`, `api/rfqClmErp.ts`: an ERP error containing
  the missing-app detail only in `exception` previously lost that diagnosis.
  The adapter now narrowly recognizes the missing capability and retains the
  deployment guard. Safe field/workflow validation messages survive, while
  credentials and stack traces are replaced with actionable administrator
  guidance. Connection failures, timeouts and invalid JSON never claim success
  or assume rollback; a timeout directs the user to refresh saved state.
- `src/api/clm.ts`: the shared HTTP interceptor could strip a `success: false`
  envelope containing a plausible `data` snapshot. Only RFQ CLM transaction
  calls now preserve that envelope and check outer/inner failure markers before
  validating persistence evidence. Missing or malformed `created` values are
  also rejected. The shared interceptor and other workflow calls are unchanged.

Added/extended regression files:
`api/clmErpErrors.test.ts`, `api/rfqClmErp.test.ts`, `api/clm.test.ts`,
`src/api/clmRfq.test.ts`, and
`src/components/sourcing/RfqContractPanel.test.tsx`.
The panel tests use real client error formatting and verify that failed actions
retain entered values, do not show success, and do not navigate. Double clicks,
idempotent retries and a lost response after a successful commit are covered.

Final combined Vitest run: **762 passed, 0 failed, 26 files**. The complete
file list and individual results are in
[final local test report](../scratch/rfq95-clm-master-final-tests.json).
Re-run the same file set from this workspace with:

```powershell
$report = Get-Content -Raw scratch/rfq95-clm-master-final-tests.json | ConvertFrom-Json
$testFiles = @($report.testResults | ForEach-Object { $_.name })
npx vitest run @testFiles
```

| Requirement | Local result / evidence |
| --- | --- |
| A: Yes creates Request only | PASS — core transaction and Python transaction tests |
| B: Team assignment | PASS — saved workflow marker and Pending Team approval checked |
| C: Pending Procurement Team stage | PASS — derived from saved assignment and approval |
| D: Manager excluded | PASS — authenticated backend policy and queue tests |
| E: Duplicate Yes | PASS — one Request, retry and concurrent request tests |
| F: Team queue | PASS — backend list authorization and dashboard component tests |
| G: Team creates Contract | PASS — separate authorized transaction and saved linkage |
| H: Contracts list | PASS — same returned Contract ID and backend-derived counters |
| I: Duplicate Contract | PASS — retry/concurrent conversion returns the existing Contract |
| J: No skips CLM | PASS — no Request/Contract and existing procurement checks retained |
| K: RFQ regression | PASS — scoped RFQ/CLM guards, sequence, signatures and PO gate tests |

The packaged Python transaction suite also passes **89 tests** after extraction
into a temporary Bench-style layout. These tests use local fixtures/test stores;
they do not create production Requests or Contracts and are not real Frappe
database integration tests. Package evidence:
[offline verification](../scratch/rfq95-clm-package-offline-verification.json).

The initial attempt to run the five schema suites with `node --test` used the
wrong runner; these suites import Vitest. Running them with Vitest passed all
57 tests, also included in the final 762 count.

`npm run build` passed after the final changes; its existing large-chunk warning
remains. Build log: [final build](../scratch/rfq95-clm-master-build.log).
A repository-wide `git diff --check` reports pre-existing extra EOF blank lines
in `src/api/businessIntake.ts` and `src/api/businessIntakeWorkflow.test.ts`.
Those unrelated files were left unchanged by this audit.

Deployment/readiness deliverables changed in this audit:
`erpnext_apps/bidsphere_workflows/README.md`,
`scripts/package-rfq-clm-deployment.py`, this document, and the new archives and
manifests listed below. No Frappe transaction source or production record was
changed during this audit.

## Prepared package verification

The existing two-step app is implemented. Initial Yes creates only a routed
Contract Request; a separate Procurement Team transaction creates the Contract.
The Python method rejects first-time `create_contract: true` before a persisted
Team Request exists. Routing uses the existing canonical role `procurement_team`.

The following ZIP hashes match their manifests. Every packaged application
source/test/README and schema script matches the current workspace byte for
byte. The archive manifests are additional generated package files.

| Package | SHA-256 |
| --- | --- |
| [Existing app, RFQ95 release](../scratch/bidsphere_workflows-rfq95-2026-09-23.zip) | `55258964e5a8b44dc06f1d524c01bedee2e8ce0f5c6b35e5230224be95a0b6b8` |
| [Additive schema scripts, RFQ95 release](../scratch/bidsphere-rfq-clm-schema-rfq95-2026-09-23.zip) | `c59a125cabc857d4de3d8f02450b39b9f4fc4f9b6a8e58813bc06b24440965b3` |

The app targets Frappe/ERPNext 16 and Python 3.11 or later. It creates no new
DocTypes or roles. Package version `0.1.0` alone is insufficient to identify the
correct release; verify the archive hash. The app and schema archives do not
contain the matching BidSphere Node API/frontend release.

Offline checks verified package metadata, Python syntax, hook targets, the
POST-only whitelist, ZIP file hashes, and safe/idempotent Bench registration.
The local Windows runtime has no Frappe Bench, MariaDB, `flit_core` or Python
`build` package. A real wheel/install/migration test was therefore not run here;
the administrator must perform the site checks below. Source package validation
does not claim a successful production installation.

The new `scripts/package-rfq-clm-deployment.py` builds new release archives with
embedded and external per-file SHA-256 manifests. It refuses to overwrite an
existing release and excludes environment files, audit data, and caches.

## Deployment commands

Use the existing authorized hosting/deployment process on the server serving
port 8090. The production Bench path and site name remain unverified; substitute
their actual values. A local development Bench is a different environment.
Keep existing service credentials in their server configuration.

### Required administrator inputs

| Input | Current status |
| --- | --- |
| SSH host / authenticated hosting console | Must identify the deployment target serving `80.225.204.210:8090` |
| SSH username and port | Unknown; web port 8090 does not identify the SSH port |
| Configured SSH key / connection alias | No authenticated connection available in this workspace |
| Bench path | Unknown; verify on the server |
| Active Frappe site | Unknown; verify that it serves the BidSphere ERP URL |
| Existing gateway service user | Verify the owner of the server-side ERP API credential on that site |

Local SSH is available, but no SSH configuration is present and the SSH agent
is stopped; no authenticated hosting-console tool is available. Obtain these
deployment inputs through the administrator's existing secure access process.
Do not paste a password or private key into chat.

```sh
BENCH=/verified/production/frappe-bench
SITE=verified-production-site
GATEWAY_USER=existing-bidsphere-erp-service-user
ARCHIVE=/uploaded/bidsphere_workflows-rfq95-2026-09-23.zip
cd "$BENCH"
bench version
./env/bin/python --version
node --version
bench --site "$SITE" list-apps
bench --site "$SITE" backup --with-files
sha256sum "$ARCHIVE"
test ! -e "$BENCH/apps/bidsphere_workflows"
```

Stop if any check fails. For a missing app directory, extract only after the
last check succeeds. If the directory or installed app already exists, use the
reviewed update procedure instead of overwriting or reinstalling it blindly.

```sh
python3 -m zipfile -e "$ARCHIVE" "$BENCH/apps"
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

For containers or externally supervised processes, use the deployment's normal
web/worker reload instead of `bench restart`; all processes need the same app
release. The final **site** app list must include `bidsphere_workflows`.

From the matching BidSphere source/schema package, inspect existing schema
prerequisites using the server-only environment configuration:

```sh
node scripts/setup-rfq-clm-branch.mjs --check
node scripts/setup-rfq-award-contract.mjs --check
node scripts/setup-rfq-clm-lifecycle.mjs --check
node scripts/setup-rfq-clm-sequential.mjs --check
node scripts/setup-rfq-clm-workflow.mjs --check
```

Apply only reviewed pending plans, preserving the scripts' before/after backups:

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
```

These scripts preserve existing records and extend existing schema/workflows.
Initial Team routing itself uses existing JSON fields and requires no new
column. A conflicting custom Workflow requires review; do not force the plan.
See the [complete deployment guide](rfq-clm-procurement-team-routing-2026-09-23.md)
and [app README](../erpnext_apps/bidsphere_workflows/README.md) for prerequisites.

## Capability verification before acceptance

In `bench --site "$SITE" console`, check the actual installed site:

```python
import frappe
assert "bidsphere_workflows" in frappe.get_installed_apps()
from bidsphere_workflows.rfq_clm import decide
assert callable(decide)
assert frappe.get_meta("Contract").get_field("custom_clm_data")
assert frappe.get_meta("Contract Request").get_field("custom_clm_data")
assert frappe.get_meta("Contract Request").get_field("custom_rfq").unique
assert frappe.get_meta("Legal Document Review").get_field("custom_clm_state")
assert frappe.get_meta("Request for Quotation").get_field("contract_required").allow_on_submit
print({"site": frappe.local.site, "installed_apps": frappe.get_installed_apps()})
```

Deploy/build the matching BidSphere API and frontend and restart its API process.
The actual transaction is `POST /api/method/bidsphere_workflows.rfq_clm.decide`.
An authenticated installed-app GET and a method-resolution GET are safe
diagnostics, but this method is POST-only: a GET rejection alone does not prove
that the app is absent. The current evidence explicitly says the app is missing.
After installation, retain any real permission or business-validation error;
do not treat every HTTP 417 as a missing-app diagnosis or a successful decision.

## RFQ95 acceptance after deployment

1. Re-fetch RFQ95 and award `LDC2026-00026`; verify quotation `00270`, exact
   supplier identity and USD 30 remain current.
2. Submit Yes through the existing contextual form with valid required terms.
   The backend must return one saved Request and **no Contract**. Re-fetch
   RFQ/award/Request: saved decision Yes, Pending Procurement Team, Team Pending
   approval, requester, source context and audit must persist.
3. Verify Procurement Team's request queue/count and Review & Create Contract
   action. Procurement Manager, Legal and Finance must not receive the initial
   Request task.
4. As Procurement Team, review the saved request, provide required risk and
   Legal signer data, then create the Contract. Re-fetch its real Contract ID,
   completed Request linkage, RFQ/award identity and Pending Legal state.
5. Verify **that same Contract ID** in RFQ View Contract and `/contracts`; the
   backend counter must increase. Retry without producing duplicate records.
6. Complete Legal review, actual e-signatures, Finance approval and existing
   procurement/PO steps with the assigned authorized users. Never fabricate
   approval/signature evidence or advance a stage to satisfy a test.
7. Test No on a separate approved test award: neither CLM record is created,
   and existing procurement checks remain intact.

Retain installed-app output, migration results, successful transaction response,
persisted Request/Contract IDs and role-queue evidence before reporting live
acceptance. No live acceptance is claimed by this readiness document.
