# RFQ contract decision transaction

This small Frappe app supplies one transaction endpoint, native document guards
and Contract lifecycle synchronization hooks.
It reuses the existing Request for Quotation, Contract Request, Contract and
Legal Document Review records. It adds no DocTypes, roles or Frappe Workflow records.

## Deployment prerequisite

The inspected ERP site runs Frappe 16.20.0 / ERPNext 16.22.0 and has Server Scripts
disabled. Storing a Server Script will not make this endpoint available. Deploy
this app through the ERP administrator's normal Bench deployment process;
the frontend/serverless repository cannot install a Python module over REST.
Do not enable all Server Scripts as a workaround.

### Required deployment inputs

The verified ERP web address is `http://80.225.204.210:8090`. Port **8090 is
the web port**, not a verified SSH port. The latest read-only RFQ95 check reports
Frappe 16.20.0 / ERPNext 16.22.0, and explicitly reports that this app is not
installed. No production installation is claimed by this package.

| Server input | Verification status |
| --- | --- |
| SSH host / hosting-console target | Unknown; verify the deployment target serving the ERP web address |
| SSH username | Unknown; use the existing authorized Bench service account |
| SSH port | Unknown; do not assume 8090 or 22 |
| SSH key / connection alias | No authenticated connection is available in this workspace |
| Production Bench path | Unknown; required before running the commands below |
| Active Frappe site name | Unknown; must be the site used by the BidSphere ERP URL |
| Gateway service user | Existing ERP API credential owner; verify the account on that site |
| Production Python / Node environment | Verify on the actual Bench; the app requires Python 3.11+ and Frappe/ERPNext 16 |

Resolve these values through the existing secure deployment process. Never put
a private key or password in chat, package files, or command-line arguments.
Installing on a different local Bench does not deploy to this ERP environment.

### Install and verify on the correct site

1. As the Bench service owner, identify and back up the actual site:

   ```sh
   cd <verified-production-bench-path>
   bench version
   ./env/bin/python --version
   node --version
   bench --site <verified-site-name> list-apps
   bench --site <verified-site-name> backup --with-files
   ```

2. Choose either the packaged local source route below or your normal reviewed
   Git app deployment. For the local source route, extract this app directory as
   `<bench>/apps/bidsphere_workflows` (do not overwrite an existing installation),
   then run from the Bench root:

   ```sh
   bench pip install -e apps/bidsphere_workflows
   ./env/bin/python apps/bidsphere_workflows/register_on_bench.py
   ./env/bin/python apps/bidsphere_workflows/register_on_bench.py --apply
   ```

   The registration helper verifies its directory, preserves and backs up
   `sites/apps.txt`, then appends only this app if absent. No site data is touched.
   This source-only app has no assets or Node dependencies to build.

   For the Git route instead, package this directory as its own reviewed Git app
   repository and run `bench get-app <reviewed-bidsphere-workflows-git-url>`.
   A copied folder without Git metadata is not a valid `bench get-app` source.
   Both routes then use the standard site installer:

   ```sh
   bench --site <site> install-app bidsphere_workflows
   bench --site <site> set-config bidsphere_gateway_user <existing-service-user>
   bench --site <site> migrate
   bench --site <site> clear-cache
   bench restart
   bench --site <site> list-apps
   ```

   Verify `bidsphere_workflows` in that site's final app list. If the app is
   already installed, update its reviewed source and run migrate/cache/restart;
   do not reinstall it blindly. Container deployments must update the shared
   app release and reload their normal web/worker services instead of assuming
   `bench restart` controls them.

   `bidsphere_gateway_user` must be the ERP user owning the existing server-side
   BidSphere API credential. Prefer a dedicated service identity. Do not give
   its credential to browser clients. No account or permission changes are
   made by this app. The existing identity needs normal read/write access to
   RFQs and their Legal Document Review awards, create/read/write access to
   Contract Requests and Contracts, and read access to their private File
   evidence and existing source records. Deployment does not add or rename
   roles, grant permissions, or bypass document permissions. Keep the gateway
   credential server-side: Node enforces each authenticated user's existing
   procurement, Legal and signer permissions before invoking ERP operations.

   For an existing reviewed **local Git working tree**, the Git URL can be its
   absolute path. Keep that app root named `bidsphere_workflows`. The package has
   its own `pyproject.toml`, Frappe `hooks.py`, `modules.txt` and `patches.txt`.
   It declares Frappe/ERPNext v16 dependencies and contains no new DocTypes.

   The local route follows Bench's editable package installation and Frappe's
   app registry requirement ([Bench installer source](https://github.com/frappe/bench/blob/develop/bench/app.py),
   [Frappe v16 installer source](https://github.com/frappe/frappe/blob/version-16/frappe/installer.py)).
   It has been checked against those sources; host deployment is still required.

3. From the BidSphere repository, inspect and apply the narrow schema patches:

   ```sh
   node scripts/setup-rfq-clm-branch.mjs --check
   node scripts/setup-rfq-clm-branch.mjs --apply
   node scripts/setup-rfq-award-contract.mjs --check
   node scripts/setup-rfq-award-contract.mjs --apply
   node scripts/setup-rfq-clm-lifecycle.mjs --check
   node scripts/setup-rfq-clm-lifecycle.mjs --apply
   node scripts/setup-rfq-clm-sequential.mjs --check
   node scripts/setup-rfq-clm-sequential.mjs --apply
   node scripts/setup-rfq-clm-workflow.mjs --check
   node scripts/setup-rfq-clm-workflow.mjs --apply
   ```

   The branch patch changes only `contract_required.allow_on_submit` to `1`, allowing an
   authorized decision on a submitted RFQ. It retains Yes/No, required/default
   rules, all existing records, roles and permissions. Existing CLM schema and
   the unique `Contract Request.custom_rfq` constraint must already be present.
   The script saves before/after schema and record evidence under `scratch`.
   The award-form patch appends missing contract type choices to existing CLM
   fields, retaining all legacy choices, defaults, records and permissions.
   New RFQ award requests must explicitly supply their type, purpose,
   description, department, dates and `legal_review_required: 1`. The transaction
   validates these fields and their persisted values before committing.

   The lifecycle patch adds only `Legal Document Review.custom_clm_state`, an
   optional, empty, read-only Long Text field for server-managed contract identity
   and lifecycle evidence. It does not change the award's Legal, Finance,
   evaluation or workflow status. It first checks for equivalent fields to avoid
   duplicates, backs up schema and all existing awards, and verifies records,
   roles, workflows and permissions after applying the change. Existing RFQ
   `custom_approval_data` and Contract `custom_clm_data` remain the authoritative
   lifecycle data containers; no duplicate fields are added to either DocType.
   Apply this patch before using the updated RFQ decision or Contract lifecycle
   hooks. A missing award state field must fail closed, never release a PO hold.

   The sequential-status patch appends only absent `Pending Legal`, `Pending
   Finance` and `Rejected` labels to the existing Contract status Select. It
   preserves every existing option, default, record, permission and workflow.
   It does not alter the existing RFQ, Business Case or standalone CLM workflow.

   The workflow patch appends RFQ-qualified states/transitions to the two
   **existing** managed Contract and Contract Request Workflows. Every existing
   state, transition, condition and role is retained. New edges require
   `doc.custom_rfq and doc.custom_clm_data`; standalone documents continue using
   their existing edges. The request's new Draft-to-Completed edge is further
   guarded by the extension so only its atomic award transaction may convert
   that Draft. The patch neither changes the RFQ/Business Case Workflows nor
   creates/activates a replacement Workflow. Missing Workflow State/Action
   masters are inserted only for the new edges, using existing gateway roles.
   It refuses blank existing CLM workflow states because Frappe's Workflow save
   would otherwise default those documents, and refuses changed/custom active
   Workflows for manual review. Existing records remain untouched.

   Select options alone are insufficient: Frappe validates state transitions
   against its active Workflow on native saves. This was checked against the
   [Frappe v16 workflow validator](https://github.com/frappe/frappe/blob/version-16/frappe/model/workflow.py)
   and [Workflow save behavior](https://github.com/frappe/frappe/blob/version-16/frappe/workflow/doctype/workflow/workflow.py).

4. Deploy the matching BidSphere Node/API/frontend changes and run the acceptance
   steps below before declaring the branch ready.

   Confirm the target Bench/site serves the ERP URL used by BidSphere before
   installing. A different local development site does not deploy the remote
   integration. Check `bench --site <site> list-apps` after installation, then
   verify the authenticated transaction endpoint before testing the UI. Preserve
   a real validation/permission error if the endpoint is present; it must not be
   replaced by an "app not installed" diagnosis.

## Endpoint contract

`POST /api/method/bidsphere_workflows.rfq_clm.decide`

The secured Node endpoint derives `actor` from its authenticated session and
prepares the Contract Request source document using `applyClmAction`. The flow
has two separate user actions and database transactions. First, **Submit CLM
Request** saves Yes and routes a real Request to Procurement Team. Later,
**Review & Create Contract** converts that same Request into the real Contract
and routes it to Legal. The initial request cannot skip Team processing.

The initial request uses `create_contract: false`, a complete `request_document`
with the existing required type/purpose/description/department/dates, and no
`contract_fields`. The later creation uses `create_contract: true`, the current
RFQ/award revisions, and risk/signatory fields; it requires a previously saved
Yes decision and Procurement Team request. This second-action example is:

```json
{
  "rfq": "RFQ-ID",
  "expected_modified": "exact ERP timestamp",
  "decision": "Yes",
  "create_contract": true,
  "actor": {"id": "authenticated-user", "role": "procurement_team"},
  "contract_fields": {"custom_risk_level": "Medium", "custom_inteva_signatory": "designated-legal-user"},
  "award": {
    "quotation": "SQ-ID",
    "quotation_modified": "exact ERP timestamp",
    "legal_review": "REVIEW-ID",
    "legal_review_modified": "exact ERP timestamp",
    "supplier": "exact Supplier DocName",
    "amount": 100,
    "currency": "USD",
    "business_case": "optional verified case reference",
    "ecr": "optional verified ECR reference"
  }
}
```

For the initial request, Node supplies every required existing CLM field,
source evidence, creation audit and the following persisted routing in
`Contract Request.custom_clm_data`:

```json
{"rfq_request_workflow":{"version":1,"phase":"procurement_team","assigned_role":"procurement_team"}}
```

The same document has one Pending approval row for role `procurement_team`,
stage 0, an authenticated `requester`, and `procurement_team_assigned` audit.
Native request status remains Draft; the persisted routing is displayed as
**Pending Procurement Team**. The application uses a role queue, with no new
role or invented user assignment. Only Team sees the initial Request in the
secured queue/dashboard; Manager, Legal and Finance do not receive it.

For No, omit
`request_document` and `contract_fields`, and send no `create_contract: true`; creating a Contract for
a No decision is rejected. Legal review keys are absent only when the existing
persisted selection identifies a single submitted winning quotation without a
review. The response is `{created, decision, rfq, request, contract}`. Initial
Yes returns a Request and null Contract; separate Contract creation returns
both records. No returns neither record. A Request-only response is successful
only for the explicit request operation, never for Contract creation.

The method locks the RFQ first and verifies exact revisions, award identity,
supplier, quotation and amount. Initial Yes inserts one routed Contract Request
and persists Pending Procurement Team in the RFQ/award mirrors. No Contract,
Legal approval or Legal notification is created. Repeating the decision returns
the same Request. The separate Team creation validates the assessed risk level
and designated enabled Legal Manager, then inserts one linked Contract. Frappe
requires an internal Contract Draft insertion, followed by
the existing RFQ-qualified native Workflow transition in the same transaction.
Only `custom_contract_status: "Pending Legal"` is committed and returned, with
one Pending Legal approval at stage 0, Not Started signatures, an initial
content version, permanent RFQ context, source documents and creation/start
audit. No externally visible Draft stop remains. The Request
becomes `request_status: "Completed"` because its provenance has been converted
into a Contract; its legacy overall `approval_status` stays `"Pending"`.
Its Team processing row changes Pending → Approved with the acting Team user
and timestamp; `rfq_request_workflow.phase` becomes `contract_created`. This
records the actual Team action and does not fabricate Legal/Finance approval
or a signature. The UI opens the real Contract in its Legal review
stage, using the same record returned by Contract Lifecycle → Contracts.

Only Procurement Team may create an RFQ Contract or resubmit a returned Draft.
Its committed `custom_clm_data.rfq_workflow` starts as
`{"version":1,"phase":"legal_review"}`. Native status `Pending Legal` enables only Legal review. Legal
approval locks the current version and sets `Approved` with phase `signature`;
Legal starts the supplier/company signature sequence. The company signer must
be the designated enabled Legal Manager user. Completing both signatures sets
`Pending Finance`, with a new Pending Finance approval at stage 1 after the
Approved Legal row at stage 0. Only Finance approval sets `Executed` and phase
`procurement`, releasing the CLM hold. Send Back preserves prior review and
signature evidence in review history before returning to Draft; rejection
retains evidence and leaves the procurement gate closed. No stages run in
parallel, and Procurement Manager has no RFQ CLM creation action.

The initial request transaction saves `contract_required` and
`custom_approval_data.contract_decision` on the RFQ, including both CLM record
links as they become available. Each transaction persists its derived CLM state
on the RFQ and award. It preserves the
existing RFQ workflow step and the award's Legal/Finance/evaluation statuses.
Frappe commits after successful POST completion; a failure in any insertion,
source check or state mirror rolls back the entire operation. There is no
explicit commit or sequence of separate REST writes. RFQ row locking and the
existing unique Request source constraint protect duplicate creation across
workers. An identical retry returns the same records; an opposite choice is
rejected. An idempotent retry of an existing Contract returns that same record
without overwriting its review stage. Legacy request-only records must first
receive an explicit, audited Team routing;
only compatible Draft/Approved requests with no prior review rows are adopted,
without changing their existing terms or audit. No bulk record migration runs.

## Permanent context and execution synchronization

The Contract's existing `custom_clm_data.rfq_context` stores all seven required
values. Existing DocType fields continue to hold their corresponding values;
the integration does not add competing RFQ or supplier fields.

| Context key | Verified source |
| --- | --- |
| `rfq_id` | `custom_rfq` and the saved RFQ decision |
| `award_id` | Legal Document Review award, or established selected-quotation identity when no review exists |
| `supplier_id` | Awarded supplier in `custom_supplier` |
| `quotation_id` | Winning `custom_supplier_quotation` |
| `contract_type` | Explicitly selected `custom_contract_type` |
| `contract_status` | Current `custom_contract_status` |
| `contract_required` | `"Yes"`, verified against the saved RFQ decision |

Contract saves derive the current type/status while protecting the permanent
RFQ, award, supplier, quotation and requirement identity. Source context and
documents remain available after refresh and throughout the existing Legal
review and e-signature lifecycle.

Contract update hooks persist the linked state in
`RFQ.custom_approval_data.contract_decision.clm` and
`Legal Document Review.custom_clm_state` within the same save transaction. The
state records the Contract, type, status, requirement and whether continuation
is blocked. Valid execution adds the execution timestamp and releases only the
CLM hold. Cancellation, reopening or loss of executable status restores that
hold. Ordinary clients cannot directly rewrite either state mirror.

The gate always revalidates the linked Contract; it does not trust a cached
`blocked: false`. Execution requires the approved current content and hash,
Legal approval, both distinct signer receipts on the current version, subsequent
Finance approval, and the
final company-signed PDF. ERP validates that the locked PDF and signature files
exist, are private Files attached to this Contract, contain PDF bytes, and match
their recorded SHA-256 hashes. Missing, substituted or changed evidence blocks
procurement. `Active` is accepted only with the same valid execution evidence.

## Procurement finalization

After Finance approval, Procurement Team completes the existing RFQ/PO process.
The CLM finalization action accepts an existing submitted Purchase Order; it
does not create, edit or submit one. Native validation checks the saved RFQ
decision, winning quotation, supplier, company and currency, and requires every
PO item to retain that winning quotation. Submitted Closed POs remain valid
completion evidence under the existing procurement process.

The same Contract's runtime data then stores `rfq_workflow.phase: "completed"`
and an immutable `procurement_completion` receipt containing `purchase_order`,
`by`, `role: "procurement_team"`, `at`, `comment`, `rfq`, `award`, `quotation`
and `supplier`. Finalization and Completed audit events carry the actor's role,
timestamp and Contract reference. Existing audit events cannot be overwritten.

The native contractual status remains Executed/Active so contract dates,
obligations, expiration and closure continue to work; the RFQ-linked procurement
status is Completed. RFQ/Award lifecycle mirrors persist the phase, receipt and
`procurement_status: "Completed"`. No signed content field such as
`custom_purchase_order` is changed after execution, and no RFQ/PO business stage
is advanced by this action.

## Enforcement and compatibility

- Only the configured ERP gateway identity may invoke the transaction; actor
  role must be `procurement_team`, as already verified by Node. Procurement
  Manager and administrator roles cannot create this RFQ CLM.
- Native RFQ document saves cannot alter/remove a saved decision or change an
  awarded requirement through the ordinary field path.
- Native RFQ-linked Contract mutations of protected lifecycle, approval or
  signature evidence must come through the configured gateway. Its Node API
  retains existing authenticated actor and action checks. Direct Desk/REST
  updates cannot invent execution evidence or detach the permanent award links.
- New RFQ-linked POs require a recorded No decision, or the matching Yes CLM
  with an Executed/Active Contract, approved route, current version and both
  signatures and verified private PDF evidence. Node and ERP both enforce the
  gate before the existing PO readiness checks.
- Existing Legal signature and Finance approval guards still apply separately.
- Existing already-created POs with no recorded decision and a No/blank flag
  retain historical edit behavior. A Yes flag is always enforced.
- Existing audited RFQ Contract Requests with an earlier Yes flag retain their
  branch: the guard reads the original source and creation audit, validates the
  current award and executed Contract, and never rewrites their history. A
  legacy RFQ Contract without post-signature Finance approval stays gated until
  the sequential review is completed; no bulk record rewrite is performed.
- Standalone PO, supplier invitation, quotation, evaluation, negotiation, legacy
  ECR and Business Intake workflows retain their existing implementation.

## Tests and remaining live acceptance

Portable transaction-model tests (no ERP mutation):

```sh
python -m unittest discover -s erpnext_apps/bidsphere_workflows/tests -v
npx vitest run --config erpnext_apps/bidsphere_workflows/vitest.config.mjs
npx vitest run --config erpnext_apps/bidsphere_workflows/tests/vitest.config.ts
```

The Python fake explicitly models a whole POST rollback and row serialization;
it does **not** prove deployment, MariaDB locking or real e-signature execution.
After deployment, use approved test RFQs/awards and real test users:

1. As Procurement Team, on a submitted awarded test RFQ choose Yes. Keep the
   contextualized form, explicitly choose its type and valid dates, and submit
   the CLM Request. Re-fetch RFQ/award/Request and verify the persisted Team
   role, Pending Procurement Team stage, requester and audit. Confirm one
   Request, zero Contracts, Team queue visible and Manager/Legal queue absent.
   Open Review & Create Contract as Team, assess risk, select the Legal signer
   and create it. Re-fetch the RFQ, award, Request and Contract. Confirm one real
   Contract in Pending Legal, seven correct `rfq_context` values, exact source links,
   initial version, Legal Pending approval, creation/start audit and Contract
   Lifecycle queue entry. Confirm the Request is Completed with its Team row
   Approved and legacy overall approval Pending, preserving separate review evidence.
2. Confirm RFQ and award mirrors show Pending Legal and blocked continuation. Refresh
   the Contract and RFQ pages and confirm their links and context persist.
3. Retry the same creation concurrently in two sessions: the same single
   Request and Contract must be returned.
4. On staging, inject a controlled test-only failure after Contract insertion
   or during an award mirror save. Confirm the Contract and conversion roll
   back while the previously committed Request/Yes decision remain pending
   Team. An initial request failure must roll back Request, decision and award
   mirror together. Remove the test hook before other testing.
5. Attempt ordinary decision/mirror changes, unauthorized native Contract
   approval/signature mutations, terminal RFQ advancement and PO creation while
   CLM is Draft or Pending Signature. Each prohibited action must fail without
   advancing any record. UI controls alone are not an acceptance test.
6. Complete existing Contract authoring requirements, Legal Manager review and
   both signatures as the actual assigned test users. Confirm Pending Finance
   remains gated; Finance must not receive an action earlier. Complete Finance
   approval and confirm Executed status, valid private signed PDFs and audit
   history. Re-fetch RFQ and award mirrors:
   both must retain the correct Contract and execution time with CLM unblocked.
   Existing RFQ Legal/Finance and PO readiness remain independently required.
   As Procurement Team complete that existing process, then finalize CLM using
   the real submitted PO. Confirm the same Contract and RFQ show Completed,
   receipt/audit survive re-fetch, native contractual status remains intact,
   and neither the RFQ workflow nor the PO was edited by finalization.
7. On staging, verify missing or changed PDF evidence cannot release the gate;
   cancel or reopen a test Contract and confirm the CLM hold returns. A failed
   mirror save must roll back the Contract state change as well.
8. On a separate awarded RFQ choose No. Confirm neither CLM record is created,
   persisted state is Not Required/unblocked, and the established procurement
   and PO continuation succeeds when its other checks pass.
9. Verify Procurement Manager, administrator, supplier and other unauthorized
   internal roles cannot record either choice,
   and existing standalone contracts and unrelated RFQ workflows are unchanged.

Do not sign a real supplier contract or place a real PO merely to test deployment.
