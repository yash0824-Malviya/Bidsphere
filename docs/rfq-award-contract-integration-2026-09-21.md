# RFQ Award → CLM contract integration

Follow-up: see [workflow finalization](rfq-clm-finalization-2026-09-21.md) for the real Contract Draft transaction, persisted lifecycle state, final tests and current deployment package. The report below describes the earlier contextualized-modal stage.

## Changes

- The awarded RFQ opens **Create Contract from RFQ Award**, with a context summary of its RFQ, award, winning supplier/quotation, amount/currency, company and verified department.
- Contract Type is explicitly unselected. The five choices are Supply / Procurement Contract, Service Agreement, NDA, Master Service Agreement and Other. Standalone CLM defaults remain unchanged.
- Purpose and description are generated from this award and remain editable. Both are required; start/end dates must be real calendar dates with end on or after start. Validation runs in the form, Node API and ERP transaction.
- Department comes from the RFQ/award or exact linked Material Request and resolves within the company. Missing or ambiguous optional lineage leaves the required department for manual entry.
- Source documents require verified RFQ, winning quotation, award or exact Material Request item provenance. Incorrect RFQ/quotation references, unrelated payment reports, stale uploads and duplicates are omitted. Existing files and stored audit evidence are not deleted or rewritten.
- Generic RFQ source authoring hands off to the RFQ award screen. Backend guards prevent changing/detaching the award, supplier, quotation, value or source links, including during Request → Contract conversion.
- Saved company/department and award evidence survive Request → Contract conversion using existing fields and existing `custom_clm_data`. No duplicate backend fields or roles were added.
- RFQ-derived contracts require Legal Manager review. Existing configured reviewers/order are retained. If no CLM matrix exists, this RFQ-specific policy creates a Pending Legal Manager review. If a configured route omits Legal, Legal is inserted before its existing stages so its final approver remains final. Standalone CLM still requires its existing configured matrix.
- The existing conditional gate remains: Yes requires an executed linked contract, current approved content and both signatures before the existing procurement/PO checks; No retains the RFQ's existing workflow. No supplier invitation, quotation submission, evaluation, negotiation, award or PO creation logic was replaced.

## Live read-only verification

Checked 2026-09-21 against the configured ERPNext site:

| Context | Verified value |
| --- | --- |
| RFQ | PUR-RFQ-2026-00093 |
| Award | LDC2026-00024 |
| Supplier | Apex Fasteners Ltd |
| Winning quotation | PUR-SQTN-2026-00263 |
| Award value | USD 2,500 |
| Company | Netlink |
| Material Request | MAT-MR-2026-00105 |
| Department | Production - NSGAI |

The updated summary API produces these values, generated purpose/scope and a blank type. The winning quotation's six File rows are duplicates of two unsuitable documents: another RFQ's PDF and a payment report. Neither is offered as a supporting document. No authentic RFQ93/quotation PDF was invented.

The additive contract-type schema patch was applied and rechecked; a second run has no pending operations. Existing RFQ, award and quotation records, roles, workflows and permissions were verified unchanged. Backup: `scratch/rfq-award-contract-migration-2026-09-21T06-22-55-569Z/`.

## Validation

- Production build passed.
- Focused API, form, source-document, CLM branch and PO regression tests: 355 passed.
- ERP extension transaction tests: 40 passed (portable Frappe transaction fixture, not a live MariaDB test).
- Additive schema tests: 13 passed.
- Full suite: 2,282 passed, 3 skipped, 4 pre-existing failures in `src/api/approvalWorkflow.test.ts`. The four failures match the earlier baseline involving blank Finance status, Legal/Finance queue selection and signature/Finance handoff checks. Subsequent changes passed the focused suite.
- Live context summary readback passed without writes (`scratch/rfq-award-live-context.json`).

## Remaining deployment / acceptance

ERPNext explicitly reports **App bidsphere_workflows is not installed**. The Node API intentionally requires that app's atomic transaction; it cannot safely emulate it through separate REST writes. The companion `contract_required.allow_on_submit` patch also belongs to that deployment. No live Contract Request, contract, approval, signature, RFQ decision or PO was created during this task.

The reviewed package is `scratch/bidsphere_workflows-rfq-award-2026-09-21.zip`. Follow `erpnext_apps/bidsphere_workflows/README.md` on the ERP Bench host, using its existing gateway service identity, then deploy this matching Node/frontend build. No server access is available through the ERP REST credentials alone.

After deployment, sign in as Procurement Manager and open RFQ00093. Choose Yes, verify the context, select a type and dates, save the editable purpose/description, and create the linked request. Complete existing procurement validation, contract authoring, Legal Manager approval and both signatures with authorized reviewers/signers. Confirm the original procurement/PO path unlocks only after execution. Test No on a separate uncommitted award; do not change the decision on an existing linked contract.
