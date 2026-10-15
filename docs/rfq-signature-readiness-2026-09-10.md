# RFQ Sign Document readiness follow-up

## Exact current cause

Supplier Quotation `PUR-SQTN-2026-00243` is linked to RFQ `PUR-RFQ-2026-00088` and Legal Document Review `LDC2026-00021`.

Fresh ERP reads and the authenticated browser confirm **three required review instruments, two verified**:

| Required instrument | Current verification |
| --- | --- |
| Master Terms & Conditions | Verified |
| Quality & Compliance Warranty | Verified |
| Liability Insurance Certificate | **Pending** |

The third instrument is not an invented requirement: its populated review and quotation attachment slots identify private File `abbce13da4`. This schema has no separate implemented required-document configuration; the existing server policy derives the required set from populated ERP review instrument slots. No count is hardcoded to two or three.

Insurance has been viewed but has not been verified (`insurance_approved = 0`). The current shared rule correctly returns false for all signing buttons. Finance is blank/pending and is not part of that rule. The review remains Pending / Pending Review and is owned by Legal Reviewer.

There was also a reproducible UI synchronization defect: the already-open browser tab still showed **1/3**, including an outdated Warranty state, while ERP held **2/3**. The third card appeared below the expanded Warranty PDF, making the unmet requirement easy to miss.

## Exact disabled condition found

In `src/components/legal/LegalPdfViewer.tsx`, both signing controls previously used:

```tsx
disabled={!canSign || !rendered || integrity !== "Verified" || locked || signed || saving || readOnly}
```

The parent passed:

```tsx
canSign={canEsign && canStartLegalSignature(legalDocs, shortField)}
```

For the actual 2/3 record, `canSign` was false because `areRequiredDocumentsVerified` was false. There was no remaining Finance-before-signature predicate. The render/integrity/signed/locked safeguards were not removed.

## Changes in this follow-up

1. `api/legalReviewCore.ts`: added read-only `getLegalSignatureEligibility`. It returns a fresh ERP record, required/verified/pending keys, eligible document keys, checked time, and a failure reason. It reuses the exact `verifiedPdfsForSignature` checks used by signing: current RFQ/SQ links and status, signer authorization, selected-supplier consistency, verification receipts, private File authorization, and actual source PDF SHA-256. Readiness checks never create signature requests, write verification flags, or upload PDFs. In-progress/unconfirmed saves are excluded and also rejected by begin-signature.
2. `api/legal-review.ts`: exposes authenticated `POST /api/legal-review/signature-eligibility` for Legal/admin. Vite already dispatches to this same production handler.
3. `src/api/legalDocs.ts`: adds the typed eligibility client/result contract.
4. `src/pages/legal/LegalReviewDetailPage.tsx`: uses the fresh server eligibility record for both badges/counts and signing. Refetches on focus, reconnect, relevant mutations, and explicit Refresh status. Blocks signing during an eligibility fetch/error. Guards against older in-flight record reads overwriting newer verification. Adds a named pending-document notice above the instrument list.
5. `src/components/legal/LegalPdfViewer.tsx`: displays every required instrument and its status beside the signing controls, with counts and Refresh status. Uses the latest parent envelope instead of stale local signature state. Button, toolbar, tooltip, and readiness label share the actual loading/render/hash/permission/save blockers. Successful tooltip is “Sign the verified supplier document.” Incomplete tooltip is “Verify all required supplier documents before signing.”
6. `api/legalReviewCore.test.ts`: tests current counts, 2/2 and 3/3 eligibility with Finance pending, matching signing/preflight rules, read-only behavior, changed PDF bytes, authorization, and unconfirmed saves.
7. `src/api/legalSignatureReadiness.test.tsx`: eight UI regression cases cover stale 1/3 versus current 2/3, server-approved readiness with Finance pending, stale cached eligibility during fetch/error, out-of-order reads, refresh settings, required-document visibility, and rendering blockers.

Current parent condition:

```tsx
canEsign = eligibilityFresh && !savingChecklist && Boolean(eligibilitySnapshot?.eligible)
```

The individual instrument must additionally appear in `canSignDocumentKeys`. The viewer finally requires the actual PDF to be rendered with verified integrity, no completed signature/lock, no save in progress, and signing permission. It renders `disabled={!signEnabled}`, where `signEnabled` is true only when none of those blockers has a reason. Finance and final Legal approval are not prerequisites.

## Signing API and SHA-256

Begin/complete still re-fetch and validate state at action time; a successful prior readiness check cannot authorize a stale signature. The existing typed-PDF electronic-signature operation is unchanged. Source and signed-artifact hashes are generated from actual PDF bytes and stored in the existing ERP envelope/fields. SHA-256 is integrity evidence, not a certificate-backed digital signature.

The last required completed signature routes the review to Finance. Finance remains blocked before completed signatures and successful integrity verification. Procurement/PO remains after Finance approval. Business Case behavior, private PDF routes, file privacy, ERP permissions, and supplier selection were not changed by this follow-up.

## Live validation

- Authenticated Legal page reloaded successfully and showed **2/3 Verified**.
- Both the page and open Warranty viewer visibly named **Liability Insurance Certificate** as pending.
- Existing private Warranty PDF rendered on its canvas. The displayed SHA-256 was `c94d8948f3de83c22c481c426b902579d4230db8e0065469c2aef2b45c04943b`, with Document Integrity: Verified.
- Sign Document was disabled with the exact incomplete-document tooltip.
- Clicked the read-only Refresh status control; the state remained correctly 2/3 and disabled.
- Final read-only ERP check confirmed `modified` remained `2026-09-10 15:41:35.907158`, verification stayed 1/1/0, and no signature request, signature, or Finance decision was created.

No document was marked verified and no signature, Finance approval, or PO was submitted. Real 3/3 signing through PO remains a user acceptance step after genuine Insurance verification; those paths are exercised by isolated automated tests, not fabricated production records.

## Automated checks

- Backend/PO focused tests: 72 passed.
- UI focused tests: 42 passed, including eight new readiness cases and the previous initialization regression test.
- `npx tsc --noEmit`: passed.
- Standalone backend TypeScript check: passed.
- Focused backend/viewer/new-test lint: no errors. The Legal page retains its two previously reproduced baseline React hook lint errors.
- Scoped `git diff --check`: passed.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- `npm run build`: passed. Existing chunk-size and demo-MFA configuration warnings remain; security configuration was not changed.
- Full `npx vitest run --maxWorkers=1`: **1,045 passed, 1 failed** across 122 files. The only failure remains the pre-existing ECR sidebar-order assertion at `src/config/roles.ecr.test.ts:67`, expecting Engineering Changes instead of Business Intake. No RFQ signing test failed.
