# Legal Manager Contract E-Signature flow

The later [signature-capture correction](./contract-signature-adoption-2026-09-28.md) separates Full Legal Name from an explicitly captured/adopted signature. Its RFQ Legal payload supersedes the name-only payload described below.

## Scope and observed gaps

The existing CLM service already renders typed signatures into the approved PDF, stores private ERPNext Files, and saves signature receipts and audit history on the standard Contract. This change connects and completes that flow; it does not add another signature system or DocType.

The incomplete areas were:

1. The review screen lacked the saved quotation, explicit signer identity, signature preview, and clear confirmation section.
2. Native iframe loading did not prove the PDF pages were rendered successfully.
3. Legal-first signing left the displayed current responsibility as Legal, although the supplier was now required to act.
4. Contract save trusted the ERP save response without independently verifying that signature evidence survived a new GET before downstream synchronization.
5. Saved signature documents needed explicit status, signer, timestamp and direct viewing controls.

These are code findings. Live signing acceptance remains pending authentication; no production signing failure is claimed to have been reproduced.

## Changes

- `src/components/contracts/RfqContractSigning.tsx`: complete E-Sign Contract review/confirmation screen, persisted references, configured Legal email, typed signature preview, consent, and **Confirm & Sign Contract**. Confirmation requires a verified PDF and completed page rendering. Failed actions retain inputs. Only a successful backend response updates the Contract view. The reviewed revision remains attached to the request.
- `src/components/contracts/ClmPdfPreview.tsx`: uses the project's existing PDF.js dependency/worker to render all Contract pages into canvases. Readiness follows successful rendering of every page. Parsing/render failures and cancelled reviews cannot enable signing.
- `src/components/contracts/ClmDocuments.tsx`: Original Contract, Signed Contract, signature status/by/at/version, protected **View Signed Contract**, **View**, and **Download**. Signed receipt files remain accessible through the existing authorized file API. Standalone company signers retain the Company label.
- `src/utils/rfqClmWorkflow.ts`: derives **Pending Supplier Signature / E-Signature / Supplier** from a valid persisted Legal receipt when the supplier has not signed. Native `Pending Signature` and workflow phase `signature` remain unchanged. Finance is reached only by the existing backend transition after both signatures.
- `api/clmErp.ts`: after an RFQ signature save, independently re-fetches the Contract and verifies the signing fields, receipt/audit data and revision before RFQ/Award synchronization, successful response or notification. If verification fails after the save request, the error accurately says persistence could not be verified and instructs refresh before retrying. It does not claim rollback.

Regression files:

- `src/components/contracts/RfqContractSigning.test.tsx`
- `src/components/contracts/ClmPdfPreview.test.tsx`
- `src/components/contracts/ClmDocuments.test.tsx`
- `src/components/contracts/clmForms.test.tsx`
- `src/utils/rfqClmWorkflow.test.ts`
- `src/utils/rfqClmLifecycle.test.ts`
- `api/clmSignaturePersistence.test.ts`
- `api/clm.test.ts`

No changes were made to RFQ creation, invitations, supplier quotations, scoring, selection, award, Contract Required decisions, Procurement Team creation routing, Finance decisions or PO logic.

## API and persistence

The screen uses the existing protected endpoints:

```text
GET /api/clm?view=detail&doctype=Contract&name=CON-2026-00001
GET /api/clm?view=file&doctype=Contract&name=...&fieldname=locked_file&file_id=...
POST /api/clm
  doctype=Contract, name, action=sign, expected_modified
  payload={ typed_name, consent:true, request_id }, comment
```

The backend enforces Legal role, named signatory, Contract ownership/access, current signature stage, no prior signature for that party, approved version hash, valid private PDF, and explicit typed name/consent. Procurement Manager, Procurement Team, Finance and Department users cannot perform Legal's signature.

Signed bytes are stored as a private ERPNext File and read back for SHA-256 verification. The existing `Contract.custom_clm_data.signatures` receipt stores party, Legal role, by, at, version, File ID/URL/hash and typed name. Existing Contract signer/date fields are updated. Append-only `e_signed` audit evidence is displayed as **Legal Manager E-Signature Completed**. No redundant signature-status columns were introduced.

Legal-first stays in the signature stage, with the supplier responsible. Supplier-first and Legal-first both use the preceding saved PDF when adding the second signature. Finance is available only after both receipts are saved on the approved version.

## Local verification

**671 tests passed, 0 failed, across 28 files. Production build passed.** Vite emitted its bundle-size warning only.

```powershell
npx vitest run src/components/contracts src/pages/contracts src/api/clm.test.ts src/utils/rfqClmWorkflow.test.ts src/utils/rfqClmLifecycle.test.ts api/clmCore.test.ts api/clmSignature.test.ts api/clmSignatureTransaction.test.ts api/clmSignaturePersistence.test.ts api/clmNotifications.test.ts api/clm.test.ts api/clmGatewayGuard.test.ts api/rfqClmRestSync.test.ts api/rfqPurchaseOrderGuard.test.ts --reporter=json --outputFile=scratch/clm-complete-esign-tests.json
npm run build
```

Coverage includes real PDF signature rendering with controlled ERP storage, both signing orders, new read-back verification, missing audit/receipt/signer fields, failed uploads/saves/reads, render failures, consent, unauthorized role actions, supplier-waiting display, and unchanged Finance/PO gates.

Reports: `scratch/clm-complete-esign-tests.json`, `scratch/clm-complete-esign-tests.log`, `scratch/clm-complete-esign-build.log`.

## Actual ERPNext inspection

Read-only inspection at `2026-09-28T07:36:39Z` confirmed:

| Field | Persisted value |
|---|---|
| Contract | CON-2026-00001 |
| Native status / phase | Pending Signature / signature |
| E-sign status | Pending Supplier |
| Legal signatory | legal@netlink.com |
| RFQ | PUR-RFQ-2026-00104 |
| Award | LDC2026-00027 |
| Winning quotation | PUR-SQTN-2026-00273 |
| Value | USD 4,500 |
| Dates | 2026-09-25 to 2026-10-25 |
| Current signature receipts | 0 |
| Locked private PDF | File be1e1f2d01, version 1.0, signature page 2 |

The quotation is read from ERPNext; the extra zero in the pasted example is not copied into the application. No live Contract fields, signature records or workflow stages were changed.

## Live acceptance outstanding

The browser preview remains at login. The authenticated button, actual Legal signing transaction and browser reload persistence are **not verified live**. This task must not be described as fully accepted until those checks pass.

1. Sign in as `legal@netlink.com` and open `CON-2026-00001`.
2. Open E-Sign Contract; verify references and the rendered actual PDF.
3. The authorized signer supplies their signature, reviews consent and confirms signing.
4. Re-fetch the Contract and signed File; verify receipt, PDF hash, signer/time and immutable audit, then refresh/reopen the browser page.
5. If supplier is pending, confirm **Pending Supplier Signature / E-Signature / Supplier**, no Legal re-sign action and no Finance action.
6. Once the actual supplier signs through the existing portal, verify Finance becomes responsible and receives its task.

Deploy the updated BidSphere frontend and backend together using the existing deployment process. No schema migration, VM/Bench access or additional Frappe app is required by this change.
