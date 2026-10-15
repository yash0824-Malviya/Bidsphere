# RFQ → CLM workflow finalization

## Implemented behavior

The existing **Create Contract from RFQ Award** modal is unchanged.

- **Yes:** the existing secured RFQ action creates its provenance Contract Request and a real **Contract Draft** in one ERP transaction. It records the RFQ decision and linked award state in that transaction. The Request is marked converted/Completed with approval Pending; no human approval is invented. The UI opens the Contract directly.
- **Contract review:** the existing Contract authoring, Legal Manager review, approval, version-locking and supplier/company e-signature actions continue to apply.
- **Execution:** Contract lifecycle hooks save the current status and execution evidence on the linked RFQ and award. Valid execution releases the CLM hold. Cancellation, expiry or reopening restores the hold.
- **No:** no CLM record is created. The saved decision allows the original procurement continuation, subject to its existing checks.
- **Backend gate:** both the Node endpoints and native ERP document hooks enforce the conditional hold. The PO gate revalidates the actual Contract and does not trust a browser flag or cached lifecycle mirror. Existing RFQ Legal/Finance and PO readiness checks remain independently required.

## Permanent links and status

The existing Contract `custom_clm_data.rfq_context` stores all seven requested values:

`rfq_id`, `award_id`, `supplier_id`, `quotation_id`, `contract_type`, `contract_status`, `contract_required`.

Existing native Contract source fields remain authoritative. Identity values cannot be detached or substituted. Type/status stay synchronized on subsequent saves. The linked status is persisted in:

- `Request for Quotation.custom_approval_data.contract_decision.clm`
- `Legal Document Review.custom_clm_state`

The optional award field was added and checked against all 23 existing award records. Those records, roles, permissions and existing workflow definitions were preserved. The second schema check has no pending operations.

## Integrity and compatibility

Execution requires the current approved content/version, Legal approval, both signature receipts and the final company-signed PDF. ERP validates private File ownership, URLs and actual PDF-byte SHA-256 hashes. Direct native changes to protected RFQ Contract approval/signature/lifecycle evidence require the configured gateway identity; the secured Node API still authenticates the individual actor and action.

Creation is idempotent. A failure in Contract creation, RFQ persistence or award-state persistence rolls back the transaction. Existing request-only CLM records retain their earlier conversion path. Later lifecycle bookkeeping can update an already-closed RFQ's mirror without advancing or changing its procurement workflow.

No supplier invitation, quotation submission, evaluation, negotiation, award-selection, existing PO business logic, roles or standalone CLM flow was redesigned.

## Validation

- Production build passed (`scratch/rfq-finalization-build.log`).
- Full Vitest run: **2,312 passed, 3 skipped, 4 pre-existing failures**, all in `src/api/approvalWorkflow.test.ts`. These are the same earlier Finance/Legal handoff baseline failures. No new failing files were introduced (`scratch/rfq-finalization-full-tests.json`).
- ERP packaging/schema tests: **4 passed**.
- Additive award lifecycle-schema tests: **13 passed**.
- Python transaction/lifecycle tests: **60 passed**; dedicated schema and shared Node/Python hash checks: **11 passed**. The package manifest records these results and source hashes.

Portable tests exercise rollback, retries, source immutability, Yes/No branches, review/signature holds, execution/unlock, re-blocking and tampered evidence. They do not replace live ERP acceptance or prove deployed MariaDB locking.

## Live deployment remains required

The configured ERPNext site reports **App bidsphere_workflows is not installed**. Its REST credentials cannot install a Python app on the Bench host. No usable Bench/SSH connection is configured in this workspace. The separate submitted-RFQ decision patch (`contract_required.allow_on_submit`) has intentionally not been applied ahead of the extension.

No live Contract, approval, signature, RFQ decision or PO was created to simulate success. Live Yes/No and signed-contract acceptance must run after host installation.

Use the finalized package `scratch/bidsphere_workflows-rfq-finalization-2026-09-21.zip` and follow `erpnext_apps/bidsphere_workflows/README.md`. Install/configure the extension on Bench, apply the documented narrow schema patches, deploy the matching Node/frontend build, then complete the authenticated acceptance steps in that README.
