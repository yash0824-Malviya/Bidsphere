# Legal PDF role regression — verified diagnosis and partial correction

Status: the client role mismatch is corrected and tested. **The Legal browser PDF acceptance is not complete.** No ERP permission or account changes have been made.

## Root cause

The real `/api/auth/login` password check for `legal@netlink.com` returned HTTP 200 with `role: "finance"` and no Legal Reviewer/Legal Manager ERP role. The frontend's uncommitted mailbox override in `src/api/auth.ts` instead selected `legal` at login and session restoration. Its display-name helper also preferred the email mapping. This displayed a Legal workspace whose signed API token actually represented Finance.

The running Vite server recorded HTTP 403 for the scoped Inteva request with the exact backend reason: `You are not authorized to view this legal review attachment.` The current review is Pending / Pending Review, where an unassigned Finance principal is not authorized. The refusal originates in BidSphere's `assertLegalReviewFileAccess`, not PDF.js or an ERP denial of these bytes.

Earlier work also established a separate URL-only regression introduced by commit `52a24f94be9a9a56c547c2efa6313da9b4b8bcf0`: duplicate File URLs were rejected as ambiguous. Existing parent-scoped File resolution addresses that ambiguity and is preserved. It does not turn a Finance token into a Legal token.

## Actual records and request

| Field | Verified value |
| --- | --- |
| File ID | `8af637e767` |
| File name | `Inteva BidSphere Documentation.pdf` |
| file_url | `/private/files/Inteva BidSphere Documentation.pdf` |
| is_private | `1` |
| attached_to_doctype | `Supplier Quotation` |
| attached_to_name | `PUR-SQTN-2026-00243` |
| attached_to_field | `custom_terms__condition` |
| File.owner | `Administrator` — service-created metadata, not proof of the business uploader |
| Legal Document Review | `LDC2026-00021` |
| Assigned Procurement | `procurement@netlink.com` |
| Review / workflow state | `Pending` / `Pending Review` |
| Authenticated BidSphere role | `finance` |
| Viewer request method (current source) | `GET` |
| Logged response | `403`, `application/json` |

The current viewer generates this authenticated, parent-scoped endpoint (no token in the URL):

```text
/api/file-proxy?path=%2Fprivate%2Ffiles%2FInteva+BidSphere+Documentation.pdf&legal_review=LDC2026-00021&document_key=terms
```

The current app session is supplied in `X-Bidsphere-Access-Token`. Cookies are intentionally omitted by the existing app proxy flow. GET does not require a CSRF mutation token. ERP credentials remain server-side. No iframe, Blob, or CSS workaround was added.

## Actual ERP user-session verification

Using the password supplied by the user, a temporary **real ERP user session** was authenticated, used for the following read-only requests, and logged out. Neither password nor session/token values were saved or printed. This did not use a constructed principal or service credentials for these reads.

| ERP GET as legal@netlink.com | Status | Content type / result |
| --- | --- | --- |
| Supplier Quotation / PUR-SQTN-2026-00243 | 200 | application/json |
| Legal Document Review / LDC2026-00021 | 200 | application/json |
| File / 8af637e767 | 200 | application/json |
| /private/files/Inteva%20BidSphere%20Documentation.pdf | 200 | application/pdf, `%PDF-` bytes, PDF-lib parsed 9 pages |

Thus the current ERP configuration allows this user to read the exact parent and private PDF. This is **not** proof that the PDF renders in the BidSphere Legal browser session. No PDF copy was saved to public or local storage.

Read-only configuration inspection also found no User Permission rows for this account and no relevant document shares (only a share of its own User record). No server-owned role profile or custom role field supplied a Legal role. Actual authenticated ERP reads exercise its effective permission checks; backend custom-hook source is not present in this repository and was not modified.

## Local changes in this pass

- `src/api/auth.ts`: restore the server response's role as authoritative; stop overriding login/restoration roles by mailbox.
- `src/config/roles.ts`: known-mailbox display labels use the authenticated role when present, so a Finance session is not labeled Legal.
- `src/api/authRole.test.ts`: cover the exact Finance-token/Legal-mailbox regression, refresh, and an authorized Legal user with another email.
- `api/rbacAuth.ecr.test.ts`: confirm the backend does not authorize by the Legal mailbox and recognizes actual Legal Reviewer/Legal Manager roles.
- `api/legalAttachmentAccess.test.ts`: explicitly cover a Procurement-owned attachment with no supplier-upload dependency.

No backend ACL was relaxed. No workflow, document version, review checkbox, approval, signature, supplier, quotation, RFQ, or File record was changed. Existing sessions created with incorrect role labels require sign-out/sign-in; the correction does not mint or elevate existing tokens.

## Permission change requiring a decision

The existing enabled `Legal Reviewer` role is not assigned to this account. It also grants these ERP rights:

- Contract Clause: Read and Write.
- Contract Template: Read.
- Contract: Read, Write, Submit.

Assigning it would do more than grant private PDF Read. It has therefore **not** been assigned under the read-only/minimum-permission requirement. Broadening File permissions is neither necessary nor proposed. The account already has many ERP roles, including System Manager; this task did not add them.

An authorized administrator must decide whether this account should receive that existing review-capable role or a separately approved least-privilege Legal role configuration. A subsequent normal login must issue `role: "legal"` before the existing Legal-stage ACL will allow it. Do not implement an email-specific role or file-access bypass.

## Tests and remaining acceptance

- Targeted role/file regression suite: **128 tests passed in 8 files**, including the supplier-upload independence case, role matrix, invalid/expired authentication, missing files and File-parent validation.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; existing large-chunk warning remains.
- Scoped ESLint: no errors; 8 pre-existing unused eslint-disable warnings in auth.ts.
- Private ERP session / parent / File / PDF read: passed as documented above.
- Browser rendering, zoom, navigation, fullscreen, close/reopen and real Procurement/Department/Supplier/Admin session matrix: not certified in this pass. Automated policy tests are not represented as live account tests.
- Legal workflow/approval/signature changes and live decisions: none; outside this root-cause-only pass.

Existing configuration warnings remain: ERP uses HTTP, and the production build configuration reports demo MFA enabled. No new credential exposure or authentication bypass was introduced; production hardening is not claimed.
