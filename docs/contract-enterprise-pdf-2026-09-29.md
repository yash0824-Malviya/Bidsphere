# Contract PDF presentation and Supplier Portal preview

## Scope and result

The existing pdf-lib renderer now produces the `netlink-a4-3` presentation: official Netlink logo, embedded Roboto, A4 pages, navy/blue hierarchy, structured summary and award details, item table, separated saved commercial/technical/legal terms, attachment metadata, audit information, and repeating confidentiality/page-count footers. Missing optional terms are omitted. Existing legal wording and explicit ordered-list numbering are retained.

The shared preview adds Fit page / Fit width controls, page count, centered paper boundaries, loading/error states and responsive scrolling. Download continues to use the same authorized document URL; the viewer renders the bytes returned with that document. No API, permission, contract-status, RFQ, CLM routing, signature-operation, Finance or PO logic changed.

Signature presentation uses the saved signing method: adopted typed names and persisted receipts. It does not fabricate signature images or claim cryptographic verification. Complete receipt reports keep each signer, date, version, file reference and hash together where they fit. Documents issued for signing retain the existing reserved signature areas and signing coordinates.

## Files changed in this task

| File | Change |
| --- | --- |
| `api/clmContractPdf.ts` | Corporate PDF typography, tables, signature presentation and pagination. |
| `api/clmContractPdf.test.ts` | Actual values, fonts/logo, table alignment, long text, clause preservation, page boundaries, signature evidence and version tests. |
| `api/clmContractPdfData.ts` | Optional RFQ scope and supporting-file type/date from sources already read; no additional persistence or source-selection changes. |
| `api/clmContractPdfData.test.ts` | Optional metadata, missing fields, source integrity and unchanged read count. |
| `src/components/contracts/ClmPdfPreview.tsx` | Optional viewing controls, page count and page styling. Existing signing callers keep their defaults. |
| `src/components/contracts/ClmPdfPreview.test.tsx` | Scaling controls, page count, renderer/loading/error behavior. |
| `src/components/contracts/ContractPdfPreviewModal.tsx` | Enables viewer controls for the existing modal. |
| `src/components/contracts/ContractPdfPreviewModal.test.tsx` | Controls and unchanged preview/download document source. |
| `scratch/render-contract-enterprise.check.ts` | Local unsigned layout proof from a read-only source snapshot; asserts original records stay unchanged. |
| `scratch/render-contract-enterprise.vitest.mjs` | Isolated proof-generation configuration. |
| This report | Verification and immutable-version limitation. |

These source files were already untracked in the working tree before this task; unrelated existing work was retained.

## Local verification

Final focused run: **13 test files, 228 tests passed**.

Production build: **passed**; Vite retains the existing large-bundle advisory.

```powershell
npm test -- api/clmContractPdf.test.ts api/clmContractPdfData.test.ts api/clmPdfEvidence.test.ts api/clmPdfFiles.test.ts api/clmPdfRevision.test.ts api/clmSignatureTransaction.test.ts api/clmSupplierPoWorkflow.test.ts api/clmSignaturePersistence.test.ts src/components/contracts/ClmPdfPreview.test.tsx src/components/contracts/ContractPdfPreviewModal.test.tsx src/components/contracts/ClmDocuments.currentPdf.test.tsx src/components/contracts/RfqContractSigning.test.tsx src/utils/legalPdfSignature.test.ts
npm run build
```

The current-flow signing tests include genuine PDF signature operations, persisted evidence, supplier acceptance prerequisites and prevention of replacing signed versions. The final layout-only follow-up also passed 52 tests across rendering, signing transactions and version revision suites.

The three-page unsigned proof and three-page synthetic receipt fixture were generated and all pages visually checked with Poppler. No clipping, orphan scope/legal headings, isolated hash pages or duplicate blank signature cards remained in these fixtures. Long-content tests cover multipage rows, headers/footers, long identities and clause preservation. Two local proof-generation tests and one GET-only live integrity test passed.

An earlier broader run including `api/clmSignature.test.ts` produced 213 passes and **two failures** in unchanged tests:

- `stores real RFQ supplier and designated Legal signatures on the same PDF`
- `stores Legal-first RFQ signing and countersigns its private PDF with the supplier signature`

Both legacy fixtures skip the existing PO-linked supplier Contract acceptance prerequisite and are rejected by `api/clmSignature.ts:76` before signing. Neither the guard nor those unrelated fixtures was changed. The passing current-flow suites exercise acceptance before supplier signing. The complete repository test suite was not run.

## Live read-only checks: CON-2026-00001

- Persisted version: **1.0**; backend status: **Active**; Supplier Portal: **Fully Signed**.
- Current authoritative PDF: File **b4d5a45c42**, two pages.
- SHA-256: `fa2b6ce033485346930e3396b5ad9baae2157e087f1320b738d9fdc8fbffdb6e`.
- Current signed PDF, original locked document and Legal-signed document hashes remained unchanged.
- Contract `modified` remained `2026-09-29 13:16:09.395607` during the GET-only check.
- The real Supplier Portal Download produced the identical SHA-256 as the authoritative signed document.
- Desktop and 375px-wide mobile previews rendered both pages, with Fit page / Fit width, Download and Close. No horizontal clipping at the checked sizes and no browser console errors. Temporary viewport override was reset.

## Existing signed PDF and the new template

The existing signed v1.0 is deliberately **not regenerated or overwritten**. Changing its bytes would invalidate its stored signature hash. The new template applies when the existing workflow generates a new document/version. Applying the new layout to this already-signed contract requires its ordinary revision and fresh approval/signature process; that would change business state and is outside this presentation-only request.

The delivered three-page PDF is clearly marked **unsigned layout proof**. It uses the saved commercial/source values, but a local draft copy with no signatures or approvals. It was never uploaded, linked, substituted into preview/download or persisted as a Contract version.

No production database writes or deployment were performed in this task.

## Follow-up for the repeated brief

The second attachment was identical to the first. A new source-to-PDF audit found and corrected additional presentation gaps:

- The preview now defaults to **Fit width**, avoiding unreadably small whole-page previews in short windows. Fit page remains available; inline signing defaults are unchanged.
- Scope includes the existing saved contract description, including standalone contracts. Optional sections now number consecutively; legal clause numbering and nested indentation remain intact.
- Item descriptions are parsed once, preserving escaped comparison operators and literal placeholders.
- The summary identifies its persisted workflow status as **Contract status at issue**, so it cannot be mistaken for a later status after signing.
- Compact audit metadata retains dates/authors while keeping the actual-data unsigned proof to three pages.
- The existing real supplier signature operation now prints **SUPPLIER SIGNED | v[actual version]** in its stamp. This is a presentation string in `api/clmSignature.ts`, not a new signing flow or status mutation. The adopted name, timestamp, coordinates, font size, authorization, private upload, hash, receipt and persistence behavior remain unchanged. The existing Legal stamp remains unchanged.

Additional modified files: `api/clmSignature.ts`, `api/clmSignatureTransaction.test.ts`, and the local-only `scratch/contract-pdf-signed-qa.check.ts`. Follow-up edits also touch the renderer and modal files/tests listed above.

Follow-up verification:

- **234 tests passed across the same 13 focused suites.**
- **Production build passed**, with the same existing bundle-size advisory.
- **31 renderer tests passed again** after the final audit-spacing adjustment.
- Three local generation checks passed: actual-data unsigned proof, synthetic receipt layout, and the actual signature overlay applied to the generated template with clearly labeled QA-only signers. Earlier immutable source bytes are asserted unchanged.
- Actual production-call wiring was checked: `/api/clm` -> `applyClmAction` -> `createClmDependencies.lock` -> `lockClmContract` -> `generateClmContractPdf`. No alternative plain-text CLM generator was found.
- The real Supplier Portal opened the original signed document with **Fit width selected**, both pages ready, and no horizontal page overflow. The unchanged signed v1.0 remains authoritative.

The two earlier legacy signing-fixture failures remain documented above; that legacy suite was not changed or included in the passing follow-up run.
