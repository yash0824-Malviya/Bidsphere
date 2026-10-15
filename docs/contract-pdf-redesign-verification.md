# Contract PDF redesign verification

## Outcome and live limitation

The actual `pdf-lib` Contract generator has been updated. This is not a preview-only redesign. A four-page unsigned layout proof has been rendered from the saved source data for `CON-2026-00001` and visually reviewed on every page.

**The live Contract has not yet been revised or regenerated.** It remains version **1.0**, with the Legal Manager signature persisted and the supplier signature pending. The accessible browser's account menu still identifies **Legal Manager / legal@netlink.com**, including after reloading the page. That account cannot create the required revised version. No role was impersonated or authorization bypassed.

The delivered layout proof is explicitly labeled `2.0 (layout proof)`. It is not a persisted ERPNext version, approved Contract or signed artifact.

## Implementation

- Existing approved Netlink logo and embedded subset Roboto font; no invented assets.
- A4 pages, navy `#0F1B36`, blue `#146CE8`, approximately 20 mm margins, 10.5 pt body and 10 pt table text.
- Repeating branded header and footer with Contract number, version, issue status and `Page X of Y`.
- RFQ, Award, Supplier and winning Quotation references, source-attributed item scope, saved commercial/technical terms and audit metadata.
- No invented commercial terms or line-level award prices. The saved Award provides the total; the winning Quotation provides the item scope because the Award has no item allocation ledger.
- Pending and persisted signatures are distinct. Signatures from an earlier Contract version cannot appear as signatures of a revised version.
- Layout-only revisions receive a new version, archive the existing evidence and require fresh Legal approval/signatures. Locked or signed PDFs cannot be overwritten through the generation service.
- Current document viewing, downloading and the signing source share the canonical versioned PDF resolver. Version mismatch, conflicting File ID and hash mismatch fail closed.
- Historical PDF access retains existing authorization and does not broaden supplier access.
- Existing RFQ signing rendering is preserved; embedded-font signature rendering is enabled only for Contracts.

## Files changed for this task

### Runtime code and packaging

| File | Change |
| --- | --- |
| `api/clmContractPdf.ts` | Branded, embedded-font, multipage generation and signature/audit layout |
| `api/clmContractPdfData.ts` | Approved source context, provenance and final Award amount/currency validation |
| `api/clmPdfEvidence.ts` | Shared current/historical versioned PDF evidence resolver |
| `api/clmSignature.ts` | Immutable lock checks, captured PDF context and embedded Contract signature font |
| `api/clmCore.ts` | Safe existing revision action for layout-only revisions and shared signature evidence resolution |
| `api/clm.ts` | Authorized current PDF download with version/hash validation and historical evidence access |
| `src/api/clm.ts` | Expected-version request parameter and actionable file errors |
| `src/components/contracts/ClmDocuments.tsx` | Canonical View/Download PDF and historical artifact rows |
| `src/utils/legalPdfSignature.ts` | Optional Contract font provider with name wrapping and bounds checks |
| `package.json`, `package-lock.json` | `@pdf-lib/fontkit` dependency |
| `vercel.json` | Include the approved logo and font in server function deployment |

### Regression tests

- `api/clmContractPdf.test.ts`
- `api/clmContractPdfData.test.ts`
- `api/clmPdfEvidence.test.ts`
- `api/clmPdfFiles.test.ts`
- `api/clmPdfRevision.test.ts`
- `api/clmSignature.test.ts`
- `api/clmSignatureTransaction.test.ts`
- `src/api/clm.test.ts`
- `src/components/contracts/ClmDocuments.test.tsx`
- `src/components/contracts/ClmDocuments.currentPdf.test.tsx`
- `src/utils/legalPdfSignature.test.ts`

Read-only live verification and local proof builders are in `scratch/verify-contract-pdf-redesign.*` and `scratch/render-contract-redesign.*`.

## Test results

| Check | Result |
| --- | --- |
| `npm run build` | PASS; existing large-chunk warning |
| `npm test -- --reporter=dot` | 3,813 passed, 4 failed, 5 skipped |
| PDF/signature/transaction/layout focused suite | 66 passed |
| Resolver/file API/core/API/source-file focused suite | 248 passed |
| Core/revision focused suite | 124 passed, including 22 new revision tests |
| Current-PDF UI/client focused suite | 70 passed |
| Read-only live ERPNext/PDF integrity verification | 1 passed |
| Four-page local layout proof | All pages visually reviewed; no clipping or overlap |

Focused-suite counts overlap and must not be added together. The four full-suite failures are existing assertions in `src/api/approvalWorkflow.test.ts`, also recorded in earlier baseline logs. They concern legacy RFQ Legal/Finance stage derivation and were not changed for this PDF task.

Tests cover A4 multipage layout, actual approved data, logo, repeated footer/page numbering, embedded fonts, long text/signature names, version consistency, signature integrity, immutable previous versions, authorization and downloads.

## Live integrity evidence

GET-only verification on 2026-09-28 fetched ERPNext Contract and private PDF bytes, checked SHA-256 digests and confirmed the Contract `modified` value did not change.

| Evidence | Persisted value |
| --- | --- |
| Contract | `CON-2026-00001` |
| Current version | `1.0` |
| Current status | `Pending Signature` (Legal signed; supplier pending) |
| RFQ | `PUR-RFQ-2026-00104` |
| Award | `LDC2026-00027` |
| Winning Quotation | `PUR-SQTN-2026-00273` |
| Final Award value | USD 4,500 |
| Original locked File | `be1e1f2d01` |
| Original locked SHA-256 | `42f8bd8f489c49a4efd088167e106ae068bf527b2d0f1841593de328d9c75cfe` |
| Legal-signed File | `c53c993072` |
| Legal-signed SHA-256 | `92ed2d5e91f9816866d60dd32635d7733c5043cc93d6ed46eebb7be709f61097` |

Both version 1.0 files were verified unchanged. The redesigned proof does not reuse their signatures.

## Remaining live completion steps

1. Use the existing Procurement account to open this Contract and its Authoring section.
2. Enter a presentation-only revision summary and use **Save new version**. Preserve terms, source references, dates and value. This should create version 2.0 in Draft and archive version 1.0 evidence.
3. Submit the revised version for existing Legal review.
4. Legal must review and approve the revised version. The existing approval/lock operation then generates and stores the redesigned authoritative PDF. Do not manually overwrite a File or status.
5. Re-fetch the Contract and PDF; confirm template `netlink-a4-2`, version 2.0, embedded fonts, source references, page layout and digest. Verify View, Download and E-Sign use that same artifact.
6. Recheck both archived version 1.0 hashes above. Fresh signatures, if requested, belong only to version 2.0 and must be completed through the existing signing workflow.

No RFQ sourcing, CLM initial routing, Finance approval or PO business logic was changed. No migration or bench access is needed for these code changes.
