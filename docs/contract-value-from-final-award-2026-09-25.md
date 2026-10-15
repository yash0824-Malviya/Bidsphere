# Contract Value from the final supplier award

## Root cause

The Procurement Request workspace initialized every commercial field from its editable draft and exposed Contract Value and Currency as editable controls. Historical `rfq_request_draft.values` could also override the native Request's award amount/currency in the detail response. Separately, the CLM award resolver could fall back to a quotation total when a persisted award lacked its final amount.

## Correction

- On Request load, the existing RFQ CLM summary API resolves the linked RFQ and saved supplier award. The form uses the verified `source.amount` and `source.currency`, with read-only controls.
- Save Draft and Create Contract refresh the same summary before constructing their payload. Entered purpose, description, dates and other editable terms remain intact.
- An approved estimate populates Estimated Contract Value separately. It is never used as Contract Value. Unapproved editable estimates retain their existing behavior.
- The persisted award record in this application is the existing Legal Document Review. Its `grand_total` is the final amount. Its winning submitted quotation supplies the established currency; if the award also stores a currency, it must agree. Quotation totals, target prices and estimates cannot replace a missing final award amount.
- Draft metadata no longer overrides amount/currency. Draft saves, Contract creation and native Contract updates continue validating the persisted final award. Mismatched requests fail before writes.
- RFQ-linked Contract authoring also keeps these two fields read-only. Standalone Contract editing is unchanged.

No schema migration, new DocType, role change, live data rewrite or workflow transition was introduced.

## Main implementation files

- `src/components/contracts/ProcurementRequestWorkspace.tsx`
- `src/components/contracts/ClmFields.tsx`
- `src/components/contracts/ClmRecordWorkspace.tsx`
- `src/types/clm.ts`
- `api/rfqAwardValue.ts`
- `api/rfqRequestDraft.ts`
- `api/rfqClmCore.ts`
- `api/rfqClmRest.ts`

## Verification

The combined regression suite passed **1,617 tests**, with zero failures (`scratch/clm-award-value-regression-tests.json`). It covers:

- Final award USD 4,500, original quotation USD 6,000, approved estimate USD 50,000.
- Automatic read-only value/currency, delayed award loading and preservation of entered terms.
- Contract creation without manually entering the award amount.
- Rejection of 4,499 and 4,501, currency conflicts and missing final award amounts.
- Stale draft overrides, duplicate prevention, source linkage and existing lifecycle gates.
- Standalone Contracts retain editable commercial fields.

`npm run build` passed (TypeScript and Vite; `scratch/clm-award-value-build.log`). Vite reported the existing non-failing large-chunk warning.

These are automated local tests using fixture ERP persistence. No live award, Contract, legal approval or signature was created for this test.
