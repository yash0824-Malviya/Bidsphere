# Corporate Contract PDF presentation

## Scope

The existing `pdf-lib` Contract lock/generation path now uses a corporate A4 template. This changes document presentation and read-only source enrichment. It does not change RFQ/CLM routing, approval requirements, signature authorization, signature persistence, Finance or PO transitions.

The actual Netlink logo is included in the server function bundle. Generated pages have contract identification, numbered sections, structured procurement/commercial tables, configured terms, linked supporting documents and dynamic page totals. Tables repeat their headings when they paginate. Long identifiers and signatory identities wrap without losing data.

Terms are taken from stored fields; absent legal clauses are omitted. Award value is read from the persisted final award, never substituted from a quotation total. Supporting documents are limited to saved, verified links. Current signature reports use persisted, current-version signature receipts; unsigned documents do not contain fabricated signatures.

## Production files changed

- `api/clmContractPdf.ts`: pure PDF layout/template, dates, signature-status presentation and execution-sheet styling.
- `api/clmContractPdfData.ts`: read-only lookup of exact linked RFQ, award, quotation, supplier, request and supporting-document records.
- `api/clmSignature.ts`: existing lock generator calls the template. Uploaded approved PDF pages retain their original content; only their appended execution sheet is styled. Existing readback/hash/storage/signing implementation is retained.
- `vercel.json`: includes `public/netlink-logo-transparent.png` in the server function assets.

Tests: `api/clmContractPdf.test.ts`, `api/clmContractPdfData.test.ts`, `api/clmSignature.test.ts`, `api/clmSignatureTransaction.test.ts`.

## CON-2026-00001 acceptance export

ERPNext records were fetched using GET only at `2026-09-28T10:58:12.094Z`. The Contract was last modified at `2026-09-25 13:22:23.139023`.

- RFQ: PUR-RFQ-2026-00104
- Award: LDC2026-00027
- Winning quotation: PUR-SQTN-2026-00273
- Supplier: Atlantic Precision Manufacturing.
- Value: USD 4,500
- Term: 25 September–25 October 2026; 30 elapsed days
- Awarded items: Cold Rolled Steel 6, 100 Kg; Galvanized Steel 10, 80 Kg
- Persisted signatures: none; both parties display Pending
- Linked supporting documents: none; no unrelated documents were inserted

The local acceptance PDF is `output/pdf/CON-2026-00001-procurement-contract.pdf`, three A4 pages. All three pages were rasterized with Poppler and visually inspected for branding, legibility, alignment, table layout, page breaks and clipping.

**This export does not overwrite the existing locked ERPNext document.** That approved file/hash is signing evidence. The new template is used when the existing workflow generates a new approved document; previously locked or signed versions remain unchanged. No live Contract, approval or signature state was written during this task.

## Verification

- `npx vitest run clm Clm`: 49 test files, 1,373 tests passed, including authorization, immutable source/hash checks, real PDF signature operations, signature persistence, transaction failures, routing and RFQ/CLM regression coverage.
- After the final signed-report spacing adjustment, renderer/signature/transaction tests passed again: 52/52. The synthetic fully signed report was rendered and all three pages visually inspected; both receipt certificates and signed-party blocks fit without an extra blank page.
- `npx vitest run --config scratch/render-contract-pdf.vitest.mjs`: read-only ERP snapshot export passed; source record remains unchanged.
- `npm run build`: passed; Vite reports its existing large-bundle warning.
- Additional strict standalone API type check: no errors in the PDF files; existing errors remain in `api/clmRequestValidation.ts`, `api/rfqClmCore.ts` and `api/rfqClmRestStatus.ts`. These unrelated files were not changed.

The template also has fixtures for long terms, repeated table headers, 1,000-character signatory identities, leap-date durations, missing/foreign document links, stale signature evidence and unsigned/partially/fully signed presentation. Synthetic signature QA artifacts are kept in `tmp/pdfs` and are not the delivered Contract.

## Reproduce the acceptance export

With the project's existing ERPNext connection configuration available:

```powershell
node scratch/read-contract-pdf-sources.mjs
npx vitest run --config scratch/render-contract-pdf.vitest.mjs
pdftoppm -r 100 -png output/pdf/CON-2026-00001-procurement-contract.pdf tmp/pdfs/contract-redesign/page
```

The capture script issues only GET requests and the renderer writes only local artifacts. A fresh capture is required to include subsequent ERPNext changes.
