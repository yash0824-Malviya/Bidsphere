# Material Request submission — implementation and verification

## Outcome and root cause

The stale verification path has been corrected. Browser-level acceptance is still pending Chrome access.

The first live ERP GET already returned MAT-MR-2026-00102 as `custom_bidsphere_status = Under Warehouse Review`, `docstatus = 1`. No reset, new MR, or live stock/RFQ mutation was performed.

`fetchMaterialRequestWorkflow` previously cached documents for 30 seconds in a private module-level cache. Opening the detail page populated it with Draft. `assertMaterialRequestBidsphereStatus` called the same cached function after the write, so it could throw “ERPNext did not save the forward” without making a post-write GET. React Query invalidation did not invalidate that separate cache. A regression test reproduced the exact error before the change and passed afterward.

Other submission defects corrected: fallback mutations after any failure, swallowed field-permission failures, and the create page's incomplete `frappe.client.submit` document plus bare-docstatus fallback.

## Actual ERPNext architecture

- Source of truth: `Material Request.custom_bidsphere_status`, a Select field with `allow_on_submit = 1` and `permlevel = 0`.
- Existing Frappe Workflow: `Material Requisition Approval`, **inactive** (`is_active = 0`). Its unused field is `workflow_state`; its Draft/Submit transition would lead to Warehouse Review at native docstatus 0, allowed for Department User. It was inspected, not enabled or altered.
- The active BidSphere implementation uses its custom field and native submission. Its Warehouse Pending Review query requires `docstatus = 1`.
- No new whitelisted method, permission override, hook deployment, or ERP configuration change was necessary.

## Persistence and API

Both create-page and detail-page submission now use `submitMaterialRequestWorkflow`:

1. GET `/api/resource/Material%20Request/{name}`; validate current state and items.
2. For an ERP draft, POST `/api/method/frappe.client.submit` with `{ doc: <complete fresh ERP document including custom_bidsphere_status> }`. Frappe performs native submission and business-field persistence together. The full document preserves item rows and the modified timestamp. This matches the [Frappe submit(doc) contract](https://github.com/frappe/frappe/blob/version-15/frappe/client.py#L258-L269).
3. For a previously native-submitted/business-Draft document, PUT the same resource with the business field and fresh modified timestamp only; do not resubmit or change items.
4. Perform a fresh GET, bypassing pre-mutation in-flight reads. Require the exact stored business field and native docstatus 1 before success.
5. An already-committed submission is a read-only verified retry. Concurrent submit calls share one promise. Mutations are not automatically replayed.

`getMaterialRequestBusinessStatus` is shared by submit validation and Warehouse Pending Review. Verification explicitly checks the stored field; docstatus fallbacks, comments, and local receipt overlays cannot prove persistence. Existing downstream receipt display behavior remains unchanged.

The private document TTL cache was removed; React Query owns page freshness. The detail page reloads fresh ERP data, uses the verified response on success, invalidates affected lists, and displays “Submitting...” while busy. Existing drafts are not recreated when submission fails, and the create form checks whether an existing document was already submitted before editing it.

## Live results

Read-only application verification executed the real submit retry path, subsequent document reads, and `getPendingMaterialRequests` against ERPNext. The transport blocked every non-GET request. Five document GETs returned HTTP 200.

| Field/check | Actual result |
| --- | --- |
| name | MAT-MR-2026-00102 |
| business status | Under Warehouse Review |
| native status | Pending |
| docstatus | 1 |
| workflow_state | Absent from document; diagnostic output null |
| modified | 2026-09-09 11:39:47.385014 |
| Warehouse Pending Review service | MR returned |
| item | RMM002 — Stainless Steel Plate, 150 Nos |
| item integrity | All original item fields unchanged |
| live mutations | 0 |

The MR was already committed before this work. A fresh live Draft-to-submitted transition was therefore not replayed or fabricated. That transition is covered by mocked API regression tests.

## Validation

- `npx tsc --noEmit`: passed.
- `npm run build` (`tsc -b && vite build`): passed on final code.
- 17 new submission regression tests: passed, including stale Draft cache, concurrent reads/clicks, permission/validation failures, exact-field verification, native-submitted recovery, idempotent retry, item preservation, and pending-queue inclusion.
- Targeted workflow/warehouse tests: 69 passed across 7 files. Includes existing full-stock, zero-stock, partial-stock, issue/forward quantities, review summaries, attachments and signatures.
- Full `npm test`: 870 passed, 1 failed. Unrelated failure in `src/config/roles.ecr.test.ts:67`: navigation expects Engineering Changes second but receives Business Intake. Sidebar and role configuration were not changed in this task.
- Browser refresh, Warehouse-user login, and opening the MR through the Warehouse UI: **not verified**. The computer-use skill reported that Chrome access was not approved. Access was requested; these remain the outstanding acceptance checks.
- Live Warehouse fulfillment, shortage forwarding and RFQ creation were not executed. No operational records were created to exercise those branches.

## Authentication/security observations

The live configured server token authenticated as Administrator. Vite's proxy injects the server token and strips browser cookies; the production proxy also supplies server credentials and suppresses ERP session cookies in responses. The Axios client currently has `withCredentials: true` despite comments saying otherwise. The MR create flow no longer attaches Desk CSRF cookies. The stale-cache failure is reproducible independently of authentication.

**Existing security issue:** `src/api/erpnext.ts` references `VITE_API_KEY` / `VITE_API_SECRET` in frontend code. These must not contain production secrets. This task did not add credentials or change deployment authentication. Diagnostic scripts load credentials server-side and do not print them. The production build also reports existing Demo MFA enabled; do not treat this build as security-hardened for production deployment.

## Exact files changed in this task

All paths are under `C:/Users/VICTUS/Desktop/Netlink 6.0/Bidsphere/`:

- `src/api/materialRequestWorkflow.ts` — fresh reads, source-of-truth helper, guarded submit and strict verification.
- `src/api/purchasing.ts` — full-document native submit helper.
- `src/api/erpnext.ts` — include ERP `exc` / `exc_type` in existing error extraction; remove an unused import.
- `src/pages/material-requests/MaterialRequestCreatePage.tsx` — shared verified submit, draft/retry guards, remove partial-submit and fallback paths, remove unused code/imports from the touched page.
- `src/pages/material-requests/MaterialRequestDetailPage.tsx` — fresh query, verified response handling, pending button label/guard.
- `src/services/warehouseService.ts` — shared business-status resolver for Pending Review.
- `src/api/materialRequestWorkflow.submit.test.ts` — regression coverage.
- `scripts/inspect-material-request.mjs` — read-only document/workflow inspection.
- `scripts/verify-material-request-readback.mjs` — read-only real application retry/readback/queue verification.
- `docs/material-request-submit-verification-2026-09-09.md` — this report.

Existing unrelated workspace changes were preserved. No supplier, quotation, RFQ, inventory or Material Request record was changed during live verification.
