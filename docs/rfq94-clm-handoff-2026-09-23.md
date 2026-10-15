# RFQ94 → persistent Contract handoff

> Historical delivery report. The later Procurement Team routing requirement
> supersedes its one-step creation procedure. Use
> [the two-step routing deployment guide](rfq-clm-procurement-team-routing-2026-09-23.md)
> and its new packages for current deployment and acceptance.

## Scope and production status

This delivery fixes the local application and prepares the existing
`bidsphere_workflows` app for manual deployment. Per the user's latest instruction,
no SSH credentials are requested and no production installation or business
record mutation is performed.

Read-only verification at **2026-09-23 06:50 UTC** against
`http://80.225.204.210:8090` found:

- Installed app versions: Frappe **16.20.0**, ERPNext **16.22.0**; no
  `bidsphere_workflows`.
- `bidsphere_workflows.rfq_clm.decide` returns HTTP **417**, explicitly reporting
  that the app is not installed.
- RFQ **PUR-RFQ-2026-00094** is Submitted; the raw `contract_required` field is
  No, with no recorded post-award contract decision. The UI correctly shows
  **Contract Decision Required**, not permission to bypass the decision.
- Award **LDC2026-00025**, supplier **FEMSA**, winning quotation
  **PUR-SQTN-2026-00267**, award value **USD 2,600**.
- No linked Contract Request or Contract; total native Contracts **0**.
- The browser Contracts counter also shows 0. This is real backend state, not
  a frontend filter hiding an existing Contract.

Evidence: `scratch/rfq94-clm-handoff-check-2026-09-23.json`.
The active production Bench path and site name are **not known**. They must be
identified on the server; the separate local WSL v15 Bench is not this target.

## Local correction

The old retry branch could return `created: false` with only a saved Contract
Request. The client treated that response as successful CLM creation even though
the native Contract list had nothing to show.

The corrected path requires a real persisted Contract for success, including
idempotent retries. Procurement Team can finish a compatible request-only
handoff through the existing atomic ERP transaction. Its saved terms are
preserved, a real Contract enters Legal Review, and the backend re-fetches and
checks the permanent RFQ/award/request/Contract links. A partial response or
missing extension cannot produce a success message or advance procurement.

Procurement Manager cannot create the RFQ CLM. Existing Contract retries return
the same record and show **Contract already exists / View Contract**. The RFQ
link and Contracts list use the same `/contracts/<Contract ID>` route. List
failures remain errors instead of misleading empty results/zero counters.

The existing sequence remains Legal Review → E-Signature → Finance Review →
Procurement Team → existing PO process → Completed. The stored initial native
status `Pending Legal` is displayed as **Pending Legal Review**, with Legal
Manager ownership. Completion records the verified existing submitted PO and
the RFQ lifecycle's Completed state; it does not terminate the signed agreement
or replace the existing PO business logic.

## Manual production deployment

Use the normal authenticated server/hosting console as the Bench service owner.
The following placeholders are values the operator must identify locally, not
credentials to send to Codex. Do not run against an arbitrary site.

### 1. Identify the Bench and active site

Find the Bench serving port **8090** from the hosting/container/reverse-proxy
configuration. If containerized, run Bench commands inside the backend container
and ensure the app is present in the common image/volume used by web and workers.

```sh
cd /absolute/path/to/the/production/frappe-bench
pwd
bench version
./env/bin/python --version
node --version
find sites -maxdepth 2 -name site_config.json -print
```

Match the site to the hostname/site mapping that serves BidSphere's configured
ERP URL. Do not print `site_config.json`, which contains secrets. Then set:

```sh
BENCH=/absolute/path/to/the/production/frappe-bench
SITE=actual-production-site-name
GATEWAY_USER=existing-bidsphere-erp-service-user
cd "$BENCH"
bench --site "$SITE" list-apps
```

`GATEWAY_USER` is the ERP User that owns BidSphere's existing **server-side** API
credential. Keep that credential in the current secret configuration. Do not
create a browser credential or grant new roles for this deployment.

### 2. Back up and install the existing app

Schedule the normal deployment window, back up database/files, and retain the
backup location and previous application release:

```sh
bench --site "$SITE" backup --with-files
```

Upload the supplied `bidsphere_workflows-rfq94-handoff-2026-09-23.zip` through the
normal secure deployment channel. Verify its SHA-256 against its manifest.
For the confirmed missing-app case, extract the archive so that the package
root is exactly `$BENCH/apps/bidsphere_workflows`:

```sh
ARCHIVE=/absolute/path/to/bidsphere_workflows-rfq94-handoff-2026-09-23.zip
sha256sum "$ARCHIVE"
test ! -e "$BENCH/apps/bidsphere_workflows"
```

**Continue only if that last check succeeds.** If the app directory already
exists, inspect its version and use the normal reviewed app update process;
do not overwrite it blindly or reinstall an already installed site app.

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

The final list **must include bidsphere_workflows**. This app has no Node assets
to build. For container-managed or otherwise externally supervised deployments,
use the hosting system's normal web/worker reload in place of `bench restart`;
ensure every process runs the same installed app release. A successful local
Python import alone is not evidence of installation on the active site.

### 3. Apply the existing additive schema/CLM Workflow patches

Run these from the updated BidSphere repository (or extracted matching schema
package), using its existing server-only `ERPNEXT_URL`, `ERP_API_KEY` and
`ERP_API_SECRET` configuration. Do not put secrets in shell command arguments.
The schema tool requires a Node runtime with built-in `fetch` (Node 22 or 24 is
appropriate). Stop on any failed preflight or apply.

```sh
node scripts/setup-rfq-clm-branch.mjs --check
node scripts/setup-rfq-award-contract.mjs --check
node scripts/setup-rfq-clm-lifecycle.mjs --check
node scripts/setup-rfq-clm-sequential.mjs --check
node scripts/setup-rfq-clm-workflow.mjs --check
```

The Sept 23 preflight found these changes still pending:

1. `Request for Quotation.contract_required.allow_on_submit = 1`.
2. Append `Pending Legal`, `Pending Finance`, `Rejected` to the existing Contract
   status choices.
3. Append the RFQ-qualified Legal/Finance transitions and request conversion
   edge to the **existing** CLM Workflows, plus their missing state/action masters.

Contract type options and the award's `custom_clm_state` field were already
present. Recheck at deployment time; the scripts are designed to skip existing
changes. Inspect the plans, then apply in this order:

```sh
node scripts/setup-rfq-clm-branch.mjs --apply
node scripts/setup-rfq-award-contract.mjs --apply
node scripts/setup-rfq-clm-lifecycle.mjs --apply
node scripts/setup-rfq-clm-sequential.mjs --apply
node scripts/setup-rfq-clm-workflow.mjs --apply
```

Retain their `scratch` before/after backups and verification results. These
patches do not migrate existing business records, replace RFQ workflows, add
roles, or change ECR/Business Case flows. Install the native app guards before
exposing these transitions. If a preflight rejects a custom active Workflow,
resolve that conflict through the existing schema review process; do not force
the patch.

Back on the Bench, complete the final migration/reload:

```sh
cd "$BENCH"
bench --site "$SITE" migrate
bench --site "$SITE" clear-cache
bench restart
bench --site "$SITE" list-apps
```

### 4. Verify the installed capability before UI acceptance

```sh
bench --site "$SITE" console
```

Run these read-only Python checks in that site console:

```python
import frappe
assert "bidsphere_workflows" in frappe.get_installed_apps()
from bidsphere_workflows.rfq_clm import decide
assert callable(decide)
assert frappe.get_meta("Contract").get_field("custom_clm_data")
assert frappe.get_meta("Contract").get_field("custom_rfq")
assert frappe.get_meta("Contract Request").get_field("custom_rfq").unique
assert frappe.get_meta("Legal Document Review").get_field("custom_clm_state")
assert frappe.get_meta("Request for Quotation").get_field("contract_required").allow_on_submit
print({"site": frappe.local.site, "installed_apps": frappe.get_installed_apps(), "rfq_clm_method": decide.__module__ + "." + decide.__name__})
```

Exit the console. Deploy the matching BidSphere Node/API/frontend release using
the normal application process (`npm ci`, `npm run build`, deploy the produced
frontend **and** matching API). Restart the app's API/dev gateway if applicable;
uploading only static frontend assets is insufficient.

The real transaction endpoint is:

```text
POST /api/method/bidsphere_workflows.rfq_clm.decide
```

The secured BidSphere API supplies the authenticated Team actor and verifies
award revisions; use the application for the valid transaction. A GET against
this POST-only method may return a method-validation error even after successful
installation. Do not call that an installation failure, and do not treat method
availability alone as a successful business transaction.

### 5. Manual acceptance on RFQ94

1. Re-fetch RFQ94 and confirm its current award, supplier and quotation before
   creation (the observed values are listed above).
2. Sign in as Procurement Team. Select Yes, complete the existing contextual
   form, choose Contract type, valid dates, assessed risk and the designated
   enabled Legal Manager. Create Contract from RFQ Award.
3. Confirm a successful response includes a native Contract ID. Re-fetch it,
   the RFQ and award; confirm the same ID in both links and permanent context.
4. Open Contracts: that ID must appear and Total Contracts must increase by
   one. Open RFQ View Contract: it must open that exact ID, displaying Pending
   Legal Review, stage Legal Review, owner Legal Manager.
5. Retry creation for the award: it must return the same ID, show Contract
   already exists, and keep the total native Contract count unchanged.
6. Confirm Procurement Manager cannot create. Confirm Finance has no review
   action before Legal approval and both signatures, and Procurement Team has
   no finalization action before Finance approval.
7. As the actual assigned reviewers/signers, complete Legal, e-signature and
   Finance. Confirm the same Contract enters Procurement handoff and the
   existing RFQ/PO continuation becomes available only after its normal checks.
8. Complete the existing PO process, then Team finalization using that submitted
   PO. Confirm Completed handoff/audit in both views, with only one Contract.
9. Test No on a **separate approved test award**: record No, verify zero CLM
   records for that award and existing workflow continuation. Do not overwrite
   RFQ94's saved Yes decision to test the opposite branch.

Actual approvals, signatures and purchase orders remain the responsibility of
the authorized production users. Local fixture tests do not establish live
MariaDB concurrency, production permission configuration or real signing.

## Validation results

- **825 application tests passed, 0 failed**, across 33 focused test files.
  Coverage includes new creation, request-only recovery, persisted source
  context, same-ID Contracts listing/counters, idempotent retries, missing and
  mismatched links, rollback/failure responses, Team authorization, Manager
  denial, Legal/signature/Finance sequencing, and existing PO gates.
- **83 Python transaction/native-guard tests passed**, including same-award
  retries, request-only conversion, rollback, review-state restrictions and
  persistent Contract link checks. These are fixture tests, not a live Bench.
- **68 schema regression tests passed**, across six files. The initial attempt
  used Node's test runner on Vitest tests; rerunning with their correct Vitest
  runner passed all 68.
- **Production build passed** (`npm run build`); only the existing large-bundle
  warning remains. The final additional native-RFQ-link check also passed the
  final TypeScript build check.
- Existing full-suite baseline has four failures in
  `src/api/approvalWorkflow.test.ts`, reproduced during the audit. They concern
  separate Legal Document Review stage projection and were not changed in this
  CLM-only task. This delivery's focused tests do not claim a green full suite.
- Browser inspection verified that the real empty Contracts list matches ERP,
  Manager has no RFQ CLM creation action, and Contracts has no page-level
  horizontal overflow at the current 647px viewport. No live Contract was
  created, signed or advanced.

Evidence files:

- `scratch/rfq94-clm-tests.json` and `.log`
- `scratch/rfq94-clm-python-tests.log`
- `scratch/rfq94-clm-schema-tests.json` and `.log`
- `scratch/rfq94-clm-build-final.log`
- `scratch/rfq94-clm-typecheck-final.log`

## Files changed in this follow-up

Application/ERP implementation:

- `api/rfqClmCore.ts` — atomic request-only recovery and strict persisted-link
  verification on idempotent success.
- `erpnext_apps/bidsphere_workflows/bidsphere_workflows/rfq_clm.py` — matching
  native retry link validation and request-state protection.
- `src/api/clm.ts` — require actual Contract on every successful Yes response;
  preserve actionable errors; reject malformed lists.
- `src/components/sourcing/RfqContractPanel.tsx` — Team-only recovery using
  saved request terms, explicit existing Contract and View Contract state.
- `src/pages/contracts/ContractsPage.tsx` — unavailable data cannot show false
  zero counters.

Regression tests:

- `api/rfqClmCore.test.ts`
- `erpnext_apps/bidsphere_workflows/tests/test_rfq_clm.py`
- `src/api/clm.test.ts`
- `src/api/clmRfq.test.ts`
- `src/components/sourcing/RfqContractPanel.test.tsx`
- `src/pages/contracts/ContractsPage.test.tsx`

Supporting delivery files:

- This deployment/verification guide.
- `scratch/rfq94-clm-handoff-check.mjs` — read-only production evidence probe.
- `scratch/package_rfq94_handoff.py` — source-only archive builder.
- `scratch/bidsphere_workflows-rfq94-handoff-2026-09-23.zip` — existing Frappe app,
  its native tests and this deployment guide.
- `scratch/bidsphere-rfq94-clm-schema-2026-09-23.zip` — matching additive schema
  scripts and this guide.
- Matching `.manifest.json` files contain per-file and archive SHA-256 hashes.
  Archives exclude credentials, `.env`, production data and Python caches.

No ECR, Business Case, scoring, sourcing, bidding, supplier response, selection,
award or PO implementation files were changed by this follow-up. The app's
existing conditional procurement guards remain enabled.
