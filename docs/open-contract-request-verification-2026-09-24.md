# Open Contract Request navigation verification

## Root cause

`/contract-requests/:name` already renders `ContractDetailPage` and
`ClmRecordWorkspace`. Its embedded `RfqContractPanel` displayed an ordinary
link back to that same URL. Clicking **Open Contract Request** therefore left
the active section and focus unchanged. This was reproduced on
`/contract-requests/CTRQ-2026-0002` while Documents was selected.

The route, Request ID, API and Procurement Team read permission were correct.

## Change

- The embedded panel now receives an `onOpenRequest` callback. It passes the
  actual saved Request ID to the existing workspace.
- The workspace checks that ID, selects Authoring when the server grants
  editing, otherwise Overview, then scrolls and focuses the selected section.
- The existing Request editor also uses this callback when embedded, closing
  the editor before opening the workspace section. Buttons have `type=button`
  and cannot submit a form or create a record.
- Panels on an RFQ retain their existing canonical route links.
- `can_open_request` and the existing RFQ/Request mismatch guard remain in
  place. No permission, backend or workflow changes were needed.
- Initial Request details include unavailable type/dates/value/currency as
  `—`. Native zero amounts without a currency are not presented as known
  contract values; explicit zero amounts with a currency still display zero.

CTRQ-2026-0002 is a pre-award Request. Its backend correctly grants no generic
editing action yet. Opening it reveals the existing read-only workflow view;
after award, the existing **Complete Contract Request** action handles terms.
This change does not allow premature Contract creation.

## Existing API

```text
GET /api/clm?view=detail&doctype=Contract%20Request&name=CTRQ-2026-0002
```

`getClmDetail` fetches the Request by its own ID and rejects a response for
another record. The backend loads the ERP Contract Request and checks its
existing read policy. The embedded RFQ summary remains supplementary workflow
context, not a replacement for the Request fetch.

## Live acceptance

Verified in the signed-in Procurement Team browser against live ERPNext:

1. Opened CTRQ-2026-0002 from the unchanged Request list.
2. Loaded its actual Request data and linked RFQ PUR-RFQ-2026-00099.
3. Selected Documents, then clicked **Open Contract Request**.
4. Overview became selected and received keyboard focus. Its top was visible
   below the header; URL stayed `/contract-requests/CTRQ-2026-0002`.
5. Department, requester, assignment, Pending status and Procurement stage
   remained visible. Missing award/terms did not prevent opening.
6. Browser warning/error logs were empty. Document width equalled viewport
   width (766 pixels), so no page-level horizontal overflow was introduced.
7. Read-only ERP snapshots before/after navigation matched: the full Request
   and RFQ fingerprints were unchanged, the Request list was unchanged, RFQ99
   still had exactly one Request and zero Contracts.

Persisted state:

```json
{
  "request_id": "CTRQ-2026-0002",
  "rfq_id": "PUR-RFQ-2026-00099",
  "assigned_role": "procurement_team",
  "status": "Pending",
  "current_stage": "Procurement",
  "request_count": 1,
  "contract_count": 0
}
```

## Files

Application changes:

- `src/components/sourcing/RfqContractPanel.tsx`
- `src/components/contracts/ClmRecordWorkspace.tsx`

Regression coverage:

- `src/components/sourcing/RfqContractPanel.test.tsx`
- `src/components/contracts/clmSupplierHandoff.test.tsx`
- `src/pages/contracts/ContractDetailPage.routes.test.tsx`
- `src/api/clm.test.ts`

Verification script/evidence:

- `scratch/verify-open-contract-request.mjs` (GET-only)
- `scratch/open-contract-request-live-before.json`
- `scratch/open-contract-request-live-after.json`
- `scratch/open-contract-request-tests.json`: **260 passed, zero failed**
- `scratch/open-contract-request-build.log`: **TypeScript and production build
  passed** (existing bundle-size warning)

The focused run also covered source documents, the unchanged Request list,
Team authorization/Manager exclusion, and RFQ Contract workflow guards.
No RFQ creation, Request persistence, award, ECR, Business Case, Legal,
signature, Finance or PO implementation was changed in this fix.
