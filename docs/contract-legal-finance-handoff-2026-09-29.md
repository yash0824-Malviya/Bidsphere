# Legal signature to Finance handoff - verification

## Root cause

The RFQ-linked Contract branch required **both supplier and Legal signatures** before creating the Finance approval. The same supplier prerequisite was repeated in Finance authorization, notification routing and the downstream CLM procurement gate. The lifecycle projection consequently assigned the signature stage to Supplier after Legal signed. The Finance dashboard also lacked a CLM Contract queue.

## Corrected behavior

- A verified current-version Legal Manager signature, following Legal approval, completes RFQ CLM E-Signature and creates one pending Finance approval.
- The signature must belong to the configured Legal signatory and locked version, with valid private-file evidence and chronological approval/signature timestamps.
- Only the assigned Finance role receives Approve, Reject and Send Back actions.
- Supplier signature remains independently visible and optional. A later supplier countersignature preserves the Finance approval, its timestamp, the current stage and existing audit entries.
- Finance approval advances the existing Procurement Team stage. The downstream CLM gate uses Legal and Finance evidence without adding a supplier prerequisite.
- Non-RFQ Contract signing retains its existing requirements. RFQ sourcing, quotation, evaluation, award, Legal review, PDF generation and PO business logic were not changed.

## Backend/API path

Existing `POST /api/clm` actions remain in use:

`action=sign` -> `applyClmAction` -> existing signature service and persistence -> Legal receipt validation -> pending Finance row -> existing ERPNext save/readback -> assignment notification.

`action=approve` by Finance -> existing approval persistence -> `rfq_workflow.phase=procurement` -> Procurement Team notification.

No new public mutation endpoint or browser-only transition was added. Existing signed records can be reconciled with the explicit server-side `repairRfqLegalSignatureHandoff` maintenance function. It checks the revision, actual locked/signed PDF bytes and existing Legal receipt before saving; repeated execution does not duplicate approvals or audit entries. It is never called by a GET.

## Live acceptance: CON-2026-00001

1. Read the actual ERPNext record: version 1.0, Legal signed, Supplier pending, incorrectly held at E-Signature.
2. Verified both stored PDF hashes and the saved Legal receipt.
3. Applied the targeted routing repair through the existing ERP persistence mechanism. It created one Finance task and appended an explicit system reconciliation audit; it did not re-sign or regenerate a document.
4. Independently re-fetched: canonical status `Pending Finance`, phase `finance_review`; UI status **Pending Finance Approval**, owner **Finance Manager**.
5. Confirmed in the authenticated Finance dashboard: **Contracts awaiting Finance Approval = 1**, containing this Contract.
6. Opened the Contract as Finance Manager and confirmed **Approve / Reject / Send Back**, E-Signature completed, Supplier Signature pending and Procurement Finalization next.
7. Per the requested acceptance test, submitted Finance approval through the existing UI as `finance@netlink.com`, with the comment: “Approved for the requested workflow acceptance test after verifying the persisted Legal Manager signature.”
8. Approval persisted at **2026-09-29 11:18:45**. After page refresh the Contract shows **Pending Procurement Finalization**, owner **Procurement Team**, Finance Approval completed.
9. Verified the Procurement Team notification for `procurement.team@netlink.com` (Notification Log `d0uruufkkl`, existing subject label “Finance Approved”). Delivery was retried through the existing idempotent notification service and verified independently.
10. Re-fetched and compared against the pre-repair snapshot: terms, dates, USD 4,500 value, version, references, locked PDF and Legal signature are unchanged. Supplier signature remains pending.

Final persisted state:

| Field | Value |
| --- | --- |
| Contract | CON-2026-00001 |
| RFQ | PUR-RFQ-2026-00104 |
| Award | LDC2026-00027 |
| Winning Quotation | PUR-SQTN-2026-00273 |
| Current version | 1.0 |
| Canonical backend status | Executed |
| Workflow phase | procurement |
| Display status | Pending Procurement Finalization |
| Responsibility | Procurement Team |
| Legal signature | Signed; original receipt preserved |
| Supplier signature | Pending; not a workflow gate |
| Finance approval | Approved by finance@netlink.com |
| Next stage | Completed, after existing Procurement/PO finalization |

The existing REST adapter continues using its native ERP status aliases; the canonical status and stage remain stored in the existing CLM evidence. No schema change was needed.

## Preserved signature integrity

- Original locked File: `be1e1f2d01`
- Original locked SHA-256: `42f8bd8f489c49a4efd088167e106ae068bf527b2d0f1841593de328d9c75cfe`
- Legal-signed File: `c53c993072`
- Legal-signed SHA-256: `92ed2d5e91f9816866d60dd32635d7733c5043cc93d6ed46eebb7be709f61097`

Both were fetched and verified before repair and after the live Finance approval. There is still one signature receipt and one pending-to-approved Finance row; no duplicate Contract or version was created.

## Files changed

Runtime:

- `api/clmCore.ts`
- `api/clmSignature.ts` (optional supplier-stage authorization only; signature rendering/persistence unchanged)
- `api/clmNotifications.ts` (Legal-only routing and User-only recipient lookup with stale User handling)
- `api/rfqClmCore.ts` (conditional CLM gate only)
- `src/utils/rfqClmWorkflow.ts`
- `src/components/contracts/RfqContractSigning.tsx`
- `src/components/dashboard/FinanceDashboard.tsx`
- `src/components/dashboard/FinanceContractQueue.tsx`

Tests:

- `api/clmCore.test.ts`
- `api/clmSignatureTransaction.test.ts`
- `api/clmPdfRevision.test.ts`
- `api/clmLegalFinanceRepair.test.ts`
- `api/clmNotifications.test.ts`
- `api/rfqClmCore.test.ts`
- `api/rfqClmRestSync.test.ts`
- `src/utils/rfqClmWorkflow.test.ts`
- `src/utils/rfqClmLifecycle.test.ts`
- `src/components/contracts/RfqContractSigning.test.tsx`
- `src/components/contracts/clmSupplierHandoff.test.tsx`
- `src/components/dashboard/FinanceContractQueue.test.tsx`
- `src/components/dashboard/FinanceDashboard.clm.test.tsx`

Targeted live repair/verification: `scratch/repair-contract-legal-finance.check.ts` and its `.vitest.mjs` configuration. Read-only is the default; mutation requires the explicit exact-Contract environment flag. The pre-repair snapshot and readback evidence are retained in `scratch/contract-legal-finance-before.json` and `scratch/contract-legal-finance-live-verification.json`.

## Tests

- Final `npm run build`: **PASS**, with the existing large-chunk warning.
- Full suite: **3,852 passed, 4 failed, 5 skipped** across 261 files. The four failures remain in the pre-existing `src/api/approvalWorkflow.test.ts` baseline; that RFQ logic was not modified.
- Core, real-PDF signature transaction and immutable revision tests: **129 passed**.
- Downstream CLM gate tests: **130 passed**.
- Notifications: **47 passed**.
- REST workflow synchronization: **40 passed**.
- Frontend lifecycle, signature card and Finance queue: **113 passed**.
- Maintenance repair and signature readback: **28 passed**.
- Live final persisted-state/hash/notification verification: **1 passed**.

Focused counts overlap and should not be added together. An initial parallel run timed out one existing Sidebar test; its isolated rerun passed 6/6 and the final full suite had no Sidebar failure.

Screenshot: `output/verification/CON-2026-00001-procurement-handoff.png`.
