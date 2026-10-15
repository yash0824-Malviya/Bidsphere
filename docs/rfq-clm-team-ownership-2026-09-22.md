# RFQ CLM ownership and deployment — 22 September 2026

## Outcome

The local integration now assigns RFQ-linked CLM creation and authoring to
**Procurement Team** (`procurement_team`). Procurement Manager and administrator
roles cannot create this CLM or perform its coordinator actions. The existing
`procurement.team@netlink.com` identity maps to the canonical Team role; no role
was added or renamed. Business Case still uses Procurement Manager.

Production deployment is **not complete**. The production check at
`2026-09-22T07:18:59.798Z` returned Frappe 16.20.0 and ERPNext 16.22.0 only.
`bidsphere_workflows.rfq_clm.decide` returned HTTP 417 with
`App bidsphere_workflows is not installed`.

RFQ `PUR-RFQ-2026-00093` remains Submitted with Contract Required = Yes, no saved
CLM decision and no linked Contract Request or Contract. Award `LDC2026-00024`
still points to quotation `PUR-SQTN-2026-00263`. No production business record,
workflow, permission or schema was changed in this update.

## Scoped behavior

| Stage | Responsible actor | Next state |
| --- | --- | --- |
| Awarded RFQ, Contract Required = Yes | Procurement Team | Atomic linked Contract Draft |
| Contract Draft | Procurement Team verifies details and submits | Pending Legal |
| Pending Legal | Legal Manager approves | Approved, signature phase |
| Signatures | Legal requests signatures; existing supplier then designated Legal company signer signs | Pending Finance |
| Pending Finance | Finance Manager approves | Executed |
| Executed | Procurement Team | Existing procurement/PO continuation, subject to existing readiness checks |

Finance has no action before Legal approval and both existing signatures.
Procurement Team waits during Legal, signature and Finance review. Finance Send
Back returns the Contract to Draft, retaining prior approvals, signatures and
locked-document evidence in review history. Reject retains the record and audit
trail and keeps the gate closed. Approval rows remain Pending, Approved,
Rejected or Sent Back.

Backend actor checks enforce the same policy as the UI. Related-record writes
and uploads respect the parent Contract's stage. Supporting documents are
revalidated against this RFQ, winning quotation, award and supplier before
being served to assigned internal reviewers. Relevant documents remain visible
in the Contract workspace.

The existing atomic transaction still serializes creation, returns the same
linked Contract on an identical retry, and rolls back on failure. The No branch
records the decision and skips CLM. Native Contract hooks mirror lifecycle state
to the RFQ and award. Procurement release requires valid current signed evidence
and Finance approval after signing; cached status alone cannot release it.

Standalone CLM approval matrices and the existing Business Case, RFQ sourcing,
quotation, evaluation, negotiation, award and PO readiness logic remain in
place. RFQ-linked Contracts use the scoped sequential policy. No CCB or
Implementation Team role was introduced.

## Additional deployment prerequisite found

The active ERPNext CLM Workflows do not permit the new sequential states or the
atomic Draft Contract Request conversion. Updating Select options alone would
still fail native Frappe Workflow validation.

Prepared migrations:

- `scripts/setup-rfq-clm-sequential.mjs`: append absent Pending Legal, Pending
  Finance and Rejected Contract status options.
- `scripts/setup-rfq-clm-workflow.mjs`: append RFQ-qualified transitions to the
  existing BidSphere Contract Lifecycle and BidSphere Contract Request
  Workflows. Preserve every existing row, role, condition and document. The new
  Draft-to-Completed Request edge is additionally restricted by the native
  transaction guard.

Both scripts passed read-only checks on the production site. The workflow plan
adds two absent state masters, nine action masters and rows on the two existing
CLM Workflows. It creates no replacement Workflow, changes no RFQ or Business
Case Workflow, and refuses blank legacy workflow states that Frappe would
otherwise default during Workflow save. No `--apply` was run.

## Validation

| Check | Result |
| --- | --- |
| `npm run build` | Passed; existing large-bundle warning remains |
| Full application Vitest suite | 2,458 passed, 4 pre-existing failures, 3 skipped |
| Python transaction/native lifecycle tests | 74 passed |
| Sequential-status/native-workflow schema tests | 22 passed, included in the application suite |
| Dedicated schema and cross-runtime hash suite | 11 passed |
| Separate ERP schema suite | 4 passed |
| Production schema preflight | Passed, read-only |
| Production endpoint | HTTP 417, extension missing |
| Live RFQ93 creation and signing acceptance | Blocked pending production deployment |

The four existing failures are all in `src/api/approvalWorkflow.test.ts`: blank
Finance handoff, Legal/Finance queue filtering, legacy approval labels without
signatures, and post-Finance RFQ handoff. They also failed before this ownership
change. The unrelated RFQ implementation was not changed to address them.

Key regression coverage includes Team-only creation, Manager/admin denial,
Legal-before-signature-before-Finance ordering, correction/rejection, private
signed evidence, duplicate requests, rollback, No branch, RFQ/award mirrors,
related-record ownership, source-document access, and existing standalone CLM.
Portable fixtures do not prove real Bench installation, MariaDB concurrency or
live e-signature execution.

## Deployment handoff

Use the updated archive:
`scratch/bidsphere_workflows-rfq-team-2026-09-22.zip`.
It contains the existing app and its reviewed source, tests and instructions;
it contains no credentials or business data. The separate schema archive
`scratch/bidsphere-rfq-clm-schema-2026-09-22.zip` contains the narrow migration
scripts and their shared ERP client. Use the matching BidSphere application
changes with this ERP app.

Follow `erpnext_apps/bidsphere_workflows/README.md` for the existing-app install,
site-specific gateway configuration, migrate, clear-cache and service restart,
then apply the documented narrow schema patches. Verify the actual remote
Bench/site first; the local WSL Frappe 15 Bench is a different environment.

Required access remains an authorized SSH username/port/key or authenticated
hosting-console session for `80.225.204.210`. REST credentials cannot install a
Python app on the Bench. No SSH/hosting access has been supplied.

Deployment is complete only after `bench --site <site> list-apps` includes
`bidsphere_workflows`, migrations and service reloads succeed, and the real
authenticated transaction works. Then run RFQ93 acceptance as Procurement Team,
verify Manager denial, complete actual assigned Legal/signature/Finance actions,
and verify Team continuation. Test No on a separate approved test RFQ so RFQ93's
Yes decision is not overwritten. Do not fabricate approvals, signatures or a PO
to satisfy acceptance.

Evidence files:

- `scratch/rfq-team-deployment-check-2026-09-22.json`
- `scratch/rfq-clm-sequential-check-2026-09-22.json`
- `scratch/rfq-clm-workflow-check-2026-09-22.json`
- `scratch/rfq-team-full-tests-final.json`
- `scratch/rfq-team-build-final.log`
