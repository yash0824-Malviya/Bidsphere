# Procurement Contract Request working page

## Scope and result

The existing `/contract-requests/:name` route now includes a **Request details**
working section for RFQ-linked Requests. **Open Contract Request** selects and
focuses that section for the same saved Request. No new route or Request is
created. The original list and unrelated workflows are unchanged.

The page displays Request status/assignment, read-only RFQ/Department/requester,
saved supplier/award context, eight editable contract terms, supporting
documents, **Save Draft**, and explicit **Create Contract**.

## Why editing was previously unavailable

The initial RFQ Request intentionally had no generic authoring permissions:
its existing save and preparation paths required a supplier award and complete
terms. Changing that generic path would weaken existing Contract validation.
The new narrowly scoped draft action allows Procurement Team to save partial
terms on the already-persisted initial Request while retaining those checks.

## Backend contract

Load the actual Request by its own ID:

```text
GET /api/clm?view=detail&doctype=Contract%20Request&name=CTRQ-2026-0002
```

The response includes `rfq_request_draft_editable` only when the server allows
that capability. The frontend also checks the authenticated Team role.

Save partial terms:

```text
POST /api/clm?view=rfq_request_draft
{
  "name": "CTRQ-2026-0002",
  "expected_modified": "<loaded Request revision>",
  "payload": {
    "contract_type": "",
    "contract_purpose": "<draft purpose>",
    "description": "<draft description>",
    "contract_start_date": "",
    "contract_end_date": "",
    "contract_value": "",
    "currency": "",
    "estimated_contract_value": ""
  }
}
```

Returns `{data: ClmDetail}` only after a native ERP save and fresh read-back of
the same Request. It does not insert a Request/Contract, update the RFQ or
advance the workflow. It validates:

- Exact Procurement Team role and the persisted Team assignment.
- The saved active RFQ, Yes decision, company and unique Request linkage.
- No linked Contract or Contract creation already in progress.
- Original Request revision, through native ERP optimistic concurrency.
- An allowlist of the eight contract fields; source/assignment/document fields
  cannot be supplied.
- Valid dates and date order, supported type, nonnegative amounts and an
  enabled ERP Currency whenever those fields are entered.

Draft values are stored in the existing Request's
`custom_clm_data.rfq_request_draft` and mirrored to native fields when possible.
Intentional blank purpose/description remain honest draft values while native
mandatory source text stays intact. GET projects the explicit draft values;
Contract preparation validates them, so retained native defaults cannot bypass
required-term validation. No schema change or installed app is required.

Each successful save records `save_rfq_request_draft` in the existing audit.
Unsaved edits keep their original revision when background queries refresh,
so concurrent edits cannot silently overwrite each other.

## Explicit Contract creation

**Create Contract** re-reads the saved award and checks field-level errors
before writing. It requires the existing supplier/quotation/award, Yes decision,
full terms and existing risk/Legal signatory requirements. Draft values/currency
must agree with the authoritative award. Nothing is silently substituted.

After validation, the page saves the draft and reuses the existing transaction:

1. `POST /api/clm?view=rfq_contract`, `operation=request`, prepares the same
   Request if necessary.
2. The same API with `operation=create_contract` creates/reuses the standard
   ERPNext Contract and performs the existing Legal handoff.

The request displays Contract Created and follows the linked Contract's stage
only after confirmed handoff. Native Request status values are retained.
Existing Contracts show **View Contract**. An incomplete existing creation
offers **Resume Contract creation**, without treating a partial record as a
successful Legal handoff. Errors remain visible and duplicate prevention stays
in the existing backend transaction.

The older RFQ preparation form remains supported. If its omitted locked
monetary fields conflict with a stored draft, the backend returns an actionable
message to open this Request and reconcile the named field with the saved award.
After correction, it prepares the same Request. It never silently discards the
user's draft amount or currency.

## Live acceptance on CTRQ-2026-0002

The browser was authenticated as Procurement Team. Verified:

- Open selected the editable Request details section for CTRQ-2026-0002.
- RFQ: PUR-RFQ-2026-00099; Department: Production - NSGAI; requester:
  Administrator; Contract Required: Yes.
- Pending / Procurement / Procurement Team remained the persisted assignment.
- Supplier displayed Pending Award; award/quotation displayed Pending.
- Edited the description of this existing diagnostic Request and clicked
  Save Draft with incomplete terms. Save succeeded.
- Full reload showed the saved edit; direct ERP read-back confirmed draft
  values and an audit action by `procurement.team@netlink.com`.
- Restored the original diagnostic description through Save Draft.
- Clicked Create Contract with the award/terms missing. Inline validation
  appeared for supplier, award, quotation, type, dates, currency and review
  fields. No Contract was created.
- Before/after ERP checks confirmed unchanged RFQ, protected Request fields,
  assignment and source metadata; still one Request and zero Contracts for
  RFQ99. The two intentional draft saves remain in audit history.

This RFQ has no supplier award, so an actual live Contract/Legal handoff was
not performed. The complete valid creation sequence and failure/idempotency
paths are covered by local regression tests using the existing ERP adapter.
No award, supplier response, signature, Finance action or PO was manufactured
to make the pre-award test pass.

## Files changed

Final verification: **1,390 regression tests passed, zero failed**. TypeScript
and the production build passed; Vite reported only the existing bundle-size
warning. The live page had no browser warning/error logs or horizontal overflow
(document and viewport widths both 766 pixels).

- `api/rfqRequestDraft.ts`, `api/rfqRequestDraft.test.ts`
- `api/clm.ts`, `api/clm.test.ts`
- `api/rfqClmCore.ts`, `api/rfqClmRest.test.ts`
- `src/api/clm.ts`, `src/api/clm.test.ts`, `src/types/clm.ts`
- `src/components/contracts/ClmRecordWorkspace.tsx`
- `src/components/contracts/ClmRecordWorkspace.request.test.tsx`
- `src/components/contracts/ProcurementRequestWorkspace.tsx`
- `src/components/contracts/ProcurementRequestWorkspace.test.tsx`

Evidence:

- `scratch/request-working-page-live-before.json`
- `scratch/request-working-page-live-saved-edit.json`
- `scratch/request-working-page-live-after.json`
- `scratch/verify-request-working-page.mjs` (read-only ERP verification)
- `scratch/request-working-final-tests.json`
- `scratch/request-working-final-build.log`

The local application was verified against live ERPNext. Publishing these
application changes to a separate web host remains a normal application
deployment; no SSH/Bench migration or `bidsphere_workflows` installation is
needed for this implementation.
