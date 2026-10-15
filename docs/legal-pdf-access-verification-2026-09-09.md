# Legal PDF access regression — 2026-09-09

Status: implementation and automated/service-side verification completed; authenticated browser acceptance is still blocked by denied Chrome computer-use access. This report does **not** certify that the actual Legal Manager session has opened the PDF.

## Root cause and actual records

The viewer called `/api/file-proxy` with only the file URL. `resolveExactErpFileRecord` in `api/fileProxyCore.ts` queries File metadata by URL and rejects anything other than one matching record. Seven private File records have the URL `/private/files/Inteva BidSphere Documentation.pdf`. The result was HTTP 403 with the internal reason `The requested file path is ambiguous.` before parent authorization or PDF retrieval. The client displayed the generic permission message.

Git commit `52a24f94be9a9a56c547c2efa6313da9b4b8bcf0`, dated 2026-08-26 (`Fix all TypeScript errors and stabilize application`), introduced the multi-result ambiguity rejection. That protection remains in place for unscoped requests; choosing an arbitrary duplicate would be unsafe.

The read-only ERP inspection established:

| Record | Actual value |
| --- | --- |
| Supplier Quotation | `PUR-SQTN-2026-00243` |
| Quotation owner / status | `Administrator` / Submitted, docstatus 1 |
| Legal Document Review | `LDC2026-00021` |
| Linked RFQ | `PUR-RFQ-2026-00088` |
| Procurement manager | `procurement@netlink.com` |
| Review status / workflow state | Pending / Pending Review |
| Current owner / next approver | Legal Reviewer / Legal Reviewer |
| Persisted e-sign status | Empty; no new status was invented |
| Selected File ID | `8af637e767` |
| File name | `Inteva BidSphere Documentation.pdf` |
| File URL | `/private/files/Inteva BidSphere Documentation.pdf` |
| Private | `is_private = 1` |
| Attachment parent | Supplier Quotation / `PUR-SQTN-2026-00243` |
| Attachment field | `custom_terms__condition` |
| File owner | `Administrator` (service-created metadata, not proof that the business uploader was Administrator) |
| Creation / modification | `2026-09-09 12:07:38.470058` |

`e8df811856` is another File row for the same URL and same quotation without an attachment field. The other five rows point at older quotations/temporary targets. None were deleted, relinked, or duplicated by this task.

ERP role metadata was inspected for both named users and the File, Supplier Quotation, Legal Document Review, and Contract DocTypes. Contract Review returned 404. The app uses its existing signed BidSphere session and canonical `legal` role (including Legal Manager/Legal Reviewer aliases), not the browser's Frappe Desk session. No ERP roles or DocType permissions were changed.

## Implementation

1. `api/legalAttachmentAccess.ts` adds shared, read-only CLM authorization and resolution. The endpoint loads the persisted review and quotation, checks the caller, verifies that the requested URL is in the selected review attachment field, and resolves File metadata only within that review or its exact quotation. Duplicate rows within the same authorized parent/path are equivalent; unrelated parents are not candidates.
2. `api/file-proxy.ts` and the Vite middleware accept `legal_review` and `document_key`. They use the same access helper before streaming bytes and preserve real HTTP 401/403/404 errors. Responses use private/no-store caching and nosniff.
3. `api/fileResourceGuard.ts` applies CLM checks to generic File-ID reads too. Historical quotation File rows pointing to a currently protected CLM URL cannot provide an alternate access path.
4. `api/fileProxyCore.ts` verifies that an explicit File ID matches the requested canonical path before any byte request. An invalid ID no longer falls back silently to a different URL lookup.
5. `LegalPdfViewer.tsx` builds a parent-scoped URL, clears stale load/error state when switching documents, and preserves its existing PDF.js canvas renderer and signature controls.
6. `legalEsign.ts` attaches the current app session in a header for same-origin file-proxy requests, strips legacy query tokens before fetching, rejects non-PDF responses, and avoids logging session-bearing URLs or response bodies.
7. Procurement's shared `SupplierLegalDocuments.tsx` preview/download uses the same scoped route for reviewed core documents. `openErpFileInBrowser` supplies authentication and retains its existing Blob cleanup. Upload confirmation retains the returned File ID, avoiding ambiguous URL-only lookups.

No signature cryptography, approval decisions, workflow transitions, UI styling, supplier selection, or RFQ data were changed.

## Permission model

- Existing canonical admin access is preserved.
- Internal parent owners, explicitly assigned internal reviewers, and individually identified current/prior approvers can read the related review attachment.
- Assigned Procurement/Procurement Team users can read their review's attachments and verify replacement uploads.
- Canonical Legal users can read pending reviews in the relevant legal stage, without email-specific authorization.
- Finance Managers can read pending Finance Review attachments; explicit individual authorization also applies.
- Unassigned Department, Warehouse, unrelated Procurement, and other unrelated roles are denied.
- Supplier ownership of a quotation alone does not grant access to internal CLM documents.
- Before a review URL references a new/replacement upload, a classified internal contract attachment still requires parent ownership/assignment or the review's assigned buyer; an unrelated Procurement role alone does not grant access.

The original PDF remains private. No permanent public URL, global permission bypass, new File record, new user role, or production session was created.

## Verification and limits

- Targeted regression suite: 91 passing tests across the file proxy, generic File guard, CLM ACL, client fetch/preview, and signature compatibility.
- `node scripts/test-legal-file-dev.mjs`: actual local Vite HTTP adapter exercised with isolated loopback ERP fixtures and test-only sessions. Legal and assigned Procurement returned 200 PDF, Department and Supplier returned 403 without binary reads, anonymous returned 401. These are **not** real user sessions.
- `node scripts/verify-legal-attachment.mjs`: read-only live ERP check reproduced the original unscoped 403, selected File `8af637e767` through the new parent scope, confirmed Legal/assigned Procurement policy eligibility and Department denial using constructed policy inputs, and retrieved the actual PDF through the existing server credential path: HTTP 200, `application/pdf`, 45,438 bytes.
- PDF skill/Poppler validation: all nine pages of those actual bytes rendered successfully and were visually inspected. This was a local renderer, **not** the application's signed-in Legal viewer. Temporary PDF and PNG copies were removed; ERP source records were untouched. The reusable live diagnostic writes future QA copies outside the application's static-file root.
- Signature compatibility: fetched bytes pass through the unchanged signature burn/hash functions; the generated in-memory signed PDF loads successfully and the original source hash remains unchanged. No real document was signed or approved.
- `npx tsc --noEmit` and `npm run build`: passed. The existing bundle-size warning remains.
- Full suite (`npx vitest run --maxWorkers=2`): 920 passed, one existing unrelated sidebar-order failure in `src/config/roles.ecr.test.ts:67`: it expects Engineering Changes second, but the sidebar now has Business Intake second. A Sidebar import timeout during an earlier build-concurrent run did not recur in this rerun. No sidebar changes were made for this task.

## Required browser acceptance still outstanding

Computer-use access to Google Chrome was denied. No attempt was made to bypass that permission gate, extract browser credentials by another route, or manufacture a token for a real user session.

Once access is enabled, use the actual signed-in `legal@netlink.com` session at `/legal/review/PUR-SQTN-2026-00243` and verify the actual `/api/file-proxy` response is 200 PDF and the PDF.js pages render. Then check refresh, close/reopen, navigate away/back, and existing annotation/e-signature controls. Repeat viewing as the actual Procurement user and confirm an actual unauthorized-role session receives 403. Approval/signature end-to-end acceptance is not certified until these checks are completed.
