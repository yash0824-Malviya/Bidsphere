# RFQ Contract: either signing order, Finance after both signatures

The subsequent [complete E-Signature flow report](./contract-complete-esign-2026-09-28.md) adds rendered PDF review, signature confirmation, independent persistence verification, and the waiting-supplier responsibility display.

## Root cause

The persisted Contract was already at the signature stage, but the backend required a supplier signature before granting Legal the `sign` action. The PDF service enforced the same ordering, and completion assumed Legal would always sign second. Showing a button alone would still have failed that backend rule.

The latest requirement explicitly permits Legal to sign first for RFQ-linked Contracts. The existing standalone Contract ordering is preserved.

## Implementation

- The designated Legal Manager can sign a locked, approved RFQ Contract during `Pending Signature` / `signature`, even when its supplier signature is pending. Identity, role, stage, approval, version and consent checks remain server-enforced.
- The detail page displays **E-SIGNATURE REQUIRED**, both party statuses, **Review Documents** and **E-Sign Contract** below the lifecycle. The review workspace shows references, value, dates, terms, approved PDF and supporting documents. Confirmation submits the reviewed record revision, so background refresh cannot silently switch the document being signed.
- Signing uses the existing PDF implementation and private ERPNext File storage. Each party's signature is added in its reserved area. The second signer uses the first signer's persisted PDF, preserving the first signature and approved terms.
- Legal-first persists the receipt, signer, timestamp, private PDF and audit, while keeping `Pending Signature` / `signature` and `Pending Supplier`. No Finance approval row is created yet.
- Either party signing second completes the evidence chain and advances the Contract to native `Pending Finance` / `finance_review`. The existing display maps that to **Pending Finance Approval**, **Finance Approval**, **Finance Manager**.
- Finance timestamp checks now compare against the final signature receipt, regardless of party. The existing procurement gate remains blocked until Finance approval.
- Approvals shows both signatures' status, signed-by and signed-at. Documents exposes receipt PDFs, including the Legal-first PDF in the existing supplier view without exposing internal workflow tabs. The existing append-only `e_signed` audit identifier is retained; Legal entries are displayed as **Legal Manager E-Signature Completed**, with Contract, signer, time, File and successful signature evidence.
- There are no duplicate Legal signature fields: current-version signature receipts in `Contract.custom_clm_data.signatures` are the evidence source. Existing Contract signature fields are updated as before.
- Failed upload/save does not mark the Contract signed or advance it. UI errors remain visible with entered values retained. The existing supplier portal action remains the supplier's authorized signing path.

## Files changed for this correction

Production code:

- `api/clmCore.ts`
- `api/clmSignature.ts`
- `api/clmNotifications.ts`
- `src/components/contracts/RfqContractSigning.tsx`
- `src/components/contracts/ClmRecordWorkspace.tsx`

Regression coverage:

- `api/clmCore.test.ts`
- `api/clmSignature.test.ts`
- `api/clmSignatureTransaction.test.ts`
- `api/clmNotifications.test.ts`
- `api/clm.test.ts`
- `api/rfqClmRestSync.test.ts`
- `src/components/contracts/RfqContractSigning.test.tsx`
- `src/components/contracts/ClmRecordWorkspace.request.test.tsx`
- `src/components/contracts/clmSupplierHandoff.test.tsx`

This change does not modify RFQ sourcing, supplier responses, AI evaluation, award, Procurement Team creation routing, Finance decision logic or PO creation logic. It updates RFQ signature ordering and the evidence checks required to keep those downstream gates valid for either signing order.

## Existing API / persistence path

```text
GET /api/clm?view=detail&doctype=Contract&name=CON-2026-00001
  -> persisted Contract, allowed actions, signature_workflow

GET /api/clm?view=file&doctype=Contract&name=...&fieldname=locked_file&file_id=...
  -> authorized private approved/latest signed PDF

POST /api/clm
  { doctype: "Contract", name, action: "sign", expected_modified,
    payload: { typed_name, consent: true, request_id }, comment }
  -> authenticated role and named signatory checks
  -> approved snapshot / PDF hash / current stage verification
  -> real PDF signature and private File upload/read-back verification
  -> optimistic-concurrency Contract save with receipt and append-only audit
  -> first signature: remain in signature stage
  -> second signature: Finance approval stage and existing notification path
```

No new signing system, DocType, schema migration, Frappe app installation or VM/Bench access is required. Deployment consists of shipping the updated BidSphere frontend and `/api/clm` backend together using the existing application deployment process.

## Verification completed

**615 tests passed, 0 failed, across 25 test files.**

```powershell
npx vitest run src/components/contracts src/pages/contracts src/api/clm.test.ts src/utils/rfqClmLifecycle.test.ts api/clmCore.test.ts api/clmSignature.test.ts api/clmSignatureTransaction.test.ts api/clmNotifications.test.ts api/clm.test.ts api/clmGatewayGuard.test.ts api/rfqClmRestSync.test.ts api/rfqPurchaseOrderGuard.test.ts --reporter=json --outputFile=scratch/clm-legal-first-final-tests.json
npm run build
```

The production build passed. Vite reported only its bundle-size warning.

Transaction tests exercise the real PDF renderer and storage verification against a controlled ERP fixture: both signing orders, persisted receipts and PDFs, audit preservation, Finance notification after both receipts, and upload/save failures. These are local transaction tests, not production signatures.

Reports:

- `scratch/clm-legal-first-final-tests.json`
- `scratch/clm-legal-first-final-tests.log`
- `scratch/clm-legal-first-build.log`
- `scratch/contract-signature-legal-first-readonly-evidence.json`

## Live ERP inspection and remaining acceptance

Read-only inspection at `2026-09-28T07:15:26Z` verified:

- Contract `CON-2026-00001`, RFQ `PUR-RFQ-2026-00104`, Award `LDC2026-00027`.
- Legal user `legal@netlink.com` is enabled and resolves to the Legal role.
- Persisted state remains `Pending Signature`, `Pending Supplier`, phase `signature`, with zero signature receipts.
- The locked private two-page PDF exists and matches the saved SHA-256 hash.
- Applying the updated backend policy to this real record produces `can_sign: true`, `can_review: true`, and a `sign` grant for the designated Legal Manager.
- The live Contract was unchanged by inspection.

This is **not completed live signing acceptance**. The browser preview remains at login, so the visible authenticated action and a persisted production signature have not yet been verified.

Remaining steps:

1. Sign in as the designated Legal Manager and open `CON-2026-00001`.
2. Verify the prominent action and review the Contract/PDF/supporting documents.
3. The authorized signer confirms the electronic signature.
4. Re-fetch ERPNext Contract and receipt File; verify the PDF hash, Legal receipt, signer/time and audit. With supplier still pending, confirm no Finance task and no stage advance.
5. The actual supplier signs through the existing Supplier Contracts flow. Re-fetch the final PDF and both receipts; verify Finance stage, task and permissions.

No live signature, supplier identity, stage change or Finance notification has been manufactured for this report.
