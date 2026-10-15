# RFQ → CLM → Contract Lifecycle integration

## Delivery status

Implemented locally against the existing Contract and RFQ architecture. This
report supersedes the earlier ownership report's Draft-first creation behavior.
The new creation transaction commits **Pending Legal** immediately.

**Production deployment and live acceptance are still blocked.** The read-only
check at `2026-09-22T08:04:18.638Z` found only Frappe 16.20.0 and ERPNext 16.22.0
on the configured production ERP site. The transaction method returned HTTP 417:
`App bidsphere_workflows is not installed`.

RFQ `PUR-RFQ-2026-00093` remains Submitted, Contract Required = Yes, with no saved
CLM decision or linked Contract Request/Contract. Award `LDC2026-00024` still
references quotation `PUR-SQTN-2026-00263`. No production business record was
created, signed or advanced during this implementation.

## Implemented flow

1. **Procurement Team creates CLM.** The existing contextualized award form
   retains RFQ, award, supplier, value, purpose, description, type, dates and
   relevant documents. It additionally collects the existing Contract risk
   assessment and designated enabled Legal Manager needed to begin review.
   Manager, Finance, Legal and administrator creation attempts remain denied.
2. **One native Contract enters Legal Review.** The ERP transaction inserts and
   validates the Contract, its content version, source links, Legal approval
   row and audit, then commits Pending Legal. An internal Draft exists only
   inside that transaction to comply with Frappe's native Workflow. Failure
   rolls back the transaction. A successful retry uses the same Contract.
3. **Contract Lifecycle shows that exact record.** Creation invalidates the
   real Contract list cache and opens `/contracts/<persisted Contract ID>`.
   The RFQ's View Contract link uses the same ID. Contract list records come
   from the secured ERP-backed CLM API, with RFQ, award, current stage, owner,
   dates and value. Counts derive from these records and backend alerts.
4. **Legal → signatures → Finance.** Legal approves the current content;
   existing private PDF signing requires the supplier and designated Legal
   company signer. Only then is Finance's approval row added. Finance may read
   during Legal Review but cannot approve early. Team authoring stays disabled
   while either review is active. Send Back and Reject preserve evidence.
5. **Finance → Procurement Team.** Finance approval marks the native Contract
   Executed and releases only the conditional CLM gate. Existing RFQ/PO
   readiness checks still apply. The workspace links to the existing RFQ and
   PO conversion route.
6. **Verified procurement completion.** Team's Finalize procurement action
   requires an existing submitted, non-cancelled PO with the same supplier,
   company, currency, RFQ references and winning quotation on every item.
   Node and ERP both validate it. No PO is created or changed by this action.
   A normally Closed submitted PO remains valid completion evidence.

## Persisted completion and audit

`custom_clm_data.rfq_workflow.phase = "completed"` and an immutable
`procurement_completion` receipt record the PO, actor, role, timestamp, comments
and exact RFQ/award/quotation/supplier. The RFQ and award mirrors receive the
same completion state. RFQ and Contract screens display **Completed**.

The native Contract remains Executed or Active: finishing procurement does not
end the signed agreement, erase obligations, or bypass expiration/termination
and financial closure controls. Its native lifecycle is displayed separately.
No competing status field or replacement Contract object was introduced.

New RFQ lifecycle audit events include creation, Legal Review Started, Legal
Approved, E-Signed, Finance Review Started, Finance Approved, Procurement
Finalized, Completed and decision actions. They record actor, role, timestamp,
previous/new status, comments and reference ID. Native guards reject rewrites
of existing audit entries or the completion receipt.

The Legal notice is dispatched after the persisted creation handoff is verified.
If notification delivery fails, the response retains the successful Contract
and reports a delivery warning; it does not falsely report transaction failure.
The assignment remains visible in the queue and existing monitoring can retry
the notice. Idempotent creation retries do not create another Contract.

## Compatibility

- Contract Required = No records the decision and creates no CLM record.
- Existing Business Case ownership remains Procurement Manager.
- RFQ creation, supplier invitation, quotation, AI analysis, supplier selection,
  negotiation, award and existing PO business logic were not changed.
- Standalone CLM still uses its existing approval matrices and lifecycle.
- Relevant source documents retain verified ownership; unrelated files are not
  linked. Existing private signature evidence and signed hashes remain intact.
- No new role, CCB or Implementation Team was introduced.
- Table overflow is confined to its table region; the sidebar/header layout was
  not redesigned. Live browser acceptance remains outstanding.

## Validation

- Production build passed.
- Full application regression run: **2,509 passed, 4 pre-existing failures,
  3 skipped**. The four failures remain in `src/api/approvalWorkflow.test.ts`
  and predate this integration change. Focused notification tests also verify
  the final creation-notice change made after this full run.
- **80 Python** transaction/native lifecycle tests passed.
- **22** sequential/native Workflow schema tests passed, included in the
  application suite; dedicated schema/hash checks previously passed unchanged.
- End-to-end fixture regression covers immediate Legal handoff, Finance
  read-only access, Legal approval, both signatures, Finance approval, verified
  existing PO, Completed RFQ summary, the same Contract list ID and retry
  idempotency. It verifies that no PO writes occur.
- Negative coverage includes missing/unsubmitted/cancelled/foreign POs,
  mismatched quotation/reference/supplier/company/currency, wrong stage/role,
  stale extension responses, loss of response, notification failure, immutable
  audit and receipt preservation.

These tests use controlled ERP fixtures. They do not establish live deployment,
real MariaDB concurrency, production permissions or real e-signature acceptance.

## Deployment and remaining acceptance

Updated app: `scratch/bidsphere_workflows-rfq-lifecycle-2026-09-22.zip`.
Schema scripts: `scratch/bidsphere-rfq-lifecycle-schema-2026-09-22.zip`.
Each archive has a hash manifest and excludes credentials and site data.

Follow `erpnext_apps/bidsphere_workflows/README.md`: identify the Bench/site
serving `80.225.204.210:8090`, back up, install the existing app, configure the
existing gateway identity, migrate, clear cache and restart required services.
Apply the documented additive schema/CLM Workflow patches after inspecting
their read-only plans. The previously prepared RFQ-qualified Draft-to-Pending
Legal transition supports the new atomic handoff. Completion needs no native
Contract status or Workflow replacement.

Missing access: authorized SSH username/port/key or an authenticated hosting
console. ERP REST credentials cannot install Python apps on a Bench. The
separate local WSL Frappe 15 Bench is not the production target.

After deployment, verify site-specific `bench list-apps`, the real transaction,
permissions and RFQ93 creation. Confirm the same Contract appears in Contracts
and Legal's queue; complete actual Legal, signature and Finance actions, then
the existing PO flow and Team finalization. Verify both screens show the same
Completed handoff and one Contract. Test No on a separate approved test RFQ.
None of these live steps is claimed complete.

Evidence: `scratch/rfq-team-deployment-check-2026-09-22.json`,
`scratch/rfq-lifecycle-full-tests-final.json`,
`scratch/rfq-lifecycle-build-final.log`,
`scratch/rfq-lifecycle-python-tests.log` and the schema preflight files listed
in the earlier ownership report.
