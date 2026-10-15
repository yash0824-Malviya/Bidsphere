# CLM implementation and verification — 2026-09-09

Status: implementation and isolated integration verification completed; **production/browser acceptance remains unverified**. No live Legal approval, rejection, changes request, signature, role change, or record modification was performed by this task. Browser verification is still required before calling the issue fixed.

## A. PDF root cause

The existing URL-only File resolver rejects any URL returning multiple File rows. Both real URLs are duplicated across current and historical quotation parents. The failure is a backend 403 (“The requested file path is ambiguous.”), before PDF bytes reach PDF.js—not a canvas/CSS problem, and not proof that the uploader exclusively owns access.

The source regression was identified in commit 52a24f94be9a9a56c547c2efa6313da9b4b8bcf0 (2026-08-26), in the generic exact-File lookup. The scoped resolver keeps that generic ambiguity protection and resolves only within the persisted Legal Document Review / Supplier Quotation relationship.

Actual records:

| Document | File ID | Private | Actual attachment parent | Selected field |
| --- | --- | --- | --- | --- |
| Inteva BidSphere Documentation.pdf | 8af637e767 | 1 | Supplier Quotation / PUR-SQTN-2026-00243 | custom_terms__condition |
| Robotic_Welding_Cell_Preliminary_Technical_Specification.pdf | abbce13da4 | 1 | Supplier Quotation / PUR-SQTN-2026-00243 | custom_insurance_certificate |

Review: LDC2026-00021. RFQ: PUR-RFQ-2026-00088. Assigned procurement manager: procurement@netlink.com. File metadata reports Administrator as owner; the application’s uploader display is not the File ownership record.

There were seven matching Inteva File rows and nine Robotic File rows, including unrelated historical quotation parents. No File or parent records were relinked or deleted.

## B. Workflow root causes

- Approval required a prior signature (or even just an approved checkbox), reversing the required order.
- Clicking View immediately saved viewed=1 before fetching or rendering.
- Request Revision only displayed a success toast and changed React state.
- Client signature persistence merged localStorage over ERP and fabricated a successful result when backend writes failed.
- Local Vite Legal routes bypassed production authentication/role checks.
- Whole signature envelopes, signer identity, timestamps, and viewed flags were accepted from the client.
- Source hashes were not compared on later review/sign operations. “Approved” was displayed as “Signed” / “Active” in signature and contract views.
- The browser ERP client referenced privileged service credentials.

## C. Files changed

Paths are relative to C:/Users/VICTUS/Desktop/Netlink 6.0/Bidsphere. The worktree contains substantial unrelated user changes, which were preserved; the entire repository diff is not attributable to this task.

Backend and adapters:

- api/legal-review.ts
- api/legalReviewCore.ts
- api/legalAttachmentAccess.ts
- api/file-proxy.ts
- api/fileProxyCore.ts
- api/fileResourceGuard.ts
- api/proxyRequestGuard.ts
- api/secureUploadGuard.ts (typed-array request-body compatibility)
- vite.config.ts

Frontend:

- src/api/erpnext.ts
- src/api/legalAttachment.ts
- src/api/legalDocs.ts
- src/api/legalDocsStorage.ts
- src/api/legalEsign.ts
- src/api/approvalWorkflow.ts
- src/types/legalEsign.ts
- src/utils/legalPdfSignature.ts
- src/vite-env.d.ts
- src/components/legal/LegalPdfViewer.tsx
- src/components/supplier/SupplierLegalDocuments.tsx
- src/pages/legal/LegalReviewDetailPage.tsx
- src/pages/legal/LegalEsignaturesPage.tsx
- src/pages/legal/LegalContractRegisterPage.tsx
- src/components/dashboard/LegalDashboard.tsx
- src/pages/sourcing/RFQDetailPage.tsx

Tests, diagnostics, documentation:

- api/legalReviewCore.test.ts
- api/legalAttachmentAccess.test.ts
- api/file-proxy.legal.test.ts
- api/fileProxyCore.test.ts
- src/api/legalAttachment.test.ts
- src/api/legalEsign.workflow.test.ts
- scripts/inspect-legal-attachment.mjs
- scripts/verify-legal-attachment.mjs
- scripts/test-legal-file-dev.mjs
- docs/legal-pdf-access-verification-2026-09-09.md (earlier PDF-only evidence)
- docs/clm-workflow-verification-2026-09-09.md

## D. Backend fix

PDF route: GET /api/file-proxy?path=<encoded-private-path>&legal_review=LDC2026-00021&document_key=terms|insurance. The application's existing access token travels in X-Bidsphere-Access-Token, not the URL.

The server verifies authentication, current review, linked quotation, role/ownership/assignment, selected path, and File parent before using server-only ERP credentials. The generic File-ID path also receives CLM authorization. Successful private responses are no-store and PDF bytes are validated.

POST /api/legal-review actions share the exact production handler in Vite. Decisions use authenticated identity and server time. New actions in the existing gateway: document-viewed, save-checklist, request-changes, begin-signature, complete-signature. Existing approve/reject/resubmit/finance actions were corrected rather than duplicated.

Generic ERP gateway mutations targeting Legal Document Review are rejected, including nested Frappe save/set_value payloads. update-flags accepts only review notes and reviewed-document checkboxes; it cannot forge viewed, workflow, or signature evidence.

Every important workflow mutation is followed by a fresh GET and comparison of all expected fields. Frappe modified timestamps are echoed unchanged for optimistic concurrency.

## E. Frontend fix

The existing viewer, toolbar, layout and typed-signature interaction remain. A viewed receipt is sent only after all PDF.js page render promises succeed. Load/render/receipt failures cannot fabricate approval or signature success.

ERP is authoritative for signature and checklist state. Local checklist typing is only an unsaved draft. Saving returns persisted backend state; errors remain errors. Request Changes now persists the returned workflow owner and comments.

The signature burn-in routine was extracted to a shared utility and reused server-side. The browser submits signature intent and placement, not a replacement PDF to trust blindly.

## F. Permission model

Canonical app roles are reused—no hardcoded legal-user authorization. Suppliers are denied internal CLM attachments. Unassigned internal users are denied. Assigned Procurement retains read access. Legal has read access during its review stage; persisted ownership/assignment and approved-by identities preserve relevant later access. Finance has access in its existing review stage. Existing admin authorization remains unchanged.

No permissions, roles, ERP records, or file privacy flags were changed live.

## G. Actual workflow model

The available ERP workflow is Legal Document Review—not separate Contract Review, Contract Version, or Contract Signature DocTypes (those lookups returned 404).

1. Pending / Pending Review / Legal Reviewer: render and inspect current PDFs; save checklist and reviewed-document flags.
2. Legal Approve: capture exact final File IDs and hashes; Approved / Finance Review / Finance Pending. This does not sign anything.
3. Finance Approve: existing Completed internal-approval stage. Signing now becomes eligible.
4. Begin signature: persist a request for the exact approved File/hash and authenticated signer.
5. Complete signature: re-verify approvals/source; burn approved bytes; save a private artifact; retrieve and hash it; persist request completion and locked signature.

Reject uses existing Rejected values. Request Changes uses Pending / Pending Review with owner and next approver Procurement, preserving comments and envelope audit. The existing resubmit action returns it to Legal and resets review evidence. Procurement's existing resubmit controls now recognize this returned state.

Signature/register displays no longer equate Legal approval with execution. The register uses Executed only for completed artifact evidence. No fictional standalone contract/version records or activation transitions were created.

## H. Version and signature integrity

Review evidence contains source File ID, URL, SHA-256, viewer identity and time. Global approval stores the approved hash/File ID. Signature request IDs, signer, source hash/File ID, initiation and completion times remain in the existing envelope.

Before approval, Finance decision, initiation and completion, the backend resolves and parses actual current bytes. Changed source bytes, File identity, or current quotation attachment require re-review; old view/approval/signature eligibility is invalidated and audit retained.

The backend—not a client-supplied signed PDF—burns the approved bytes with the existing signature routine. The saved private artifact is read and hash-checked before completion is reported. All attached PDFs require completed requests before overall e-sign status is locked.

Retries reuse a persisted request and deterministic artifact filename. A persisted save reservation plus modified checks prevents concurrent writers from starting a second artifact. Unconfirmed upstream upload outcomes remain blocked for reconciliation instead of risking duplicates. No automated administrator reconciliation UI was added.

## I. Security findings

- Existing files stayed private. No global permission bypass or role grant was added.
- Service-key imports were removed from the browser ERP client. Legacy VITE_API_KEY / VITE_API_SECRET values are excluded from the client environment.
- Built-asset scan: 365 JS/MJS/HTML/map files; two configured credential values checked; zero matching files. Values were not printed.
- **Rotate any service credentials previously distributed in older browser bundles.** This task did not rotate deployment credentials.
- **The current production build environment has demo MFA enabled.** Do not deploy this configuration as production authentication. Environment/security-setting changes were not made silently.
- **The configured upstream ERP connection uses HTTP.** Production transport should use HTTPS; TLS deployment was not changed here.
- Unknown signed-upload outcomes require reconciliation before retry; this is intentionally fail-closed.

## J. Test results

Latest targeted run: **123 passed / 123**, eight files. Includes role/anonymous restrictions, real-PDF fixture parsing, viewed versus approved, persisted Approve/Reject/Request Changes, all-document review requirement, actor spoof rejection, Finance prerequisite, changed-byte/path rejection, exact signed-artifact hashes, known upload failure/retry, uncertain-upload duplicate prevention, and generic-gateway bypass rejection.

Real Vite + isolated loopback ERP adapter check passed:

| Case | Result |
| --- | --- |
| Legal fixture PDF access | 200 PDF |
| Assigned Procurement fixture PDF access | 200 PDF |
| Unassigned Department fixture | 403, no byte fetch |
| Supplier fixture | 403, no byte fetch |
| Anonymous fixture | 401, no byte fetch |
| Anonymous local workflow request | 401 |
| Department local approval request | 403 |
| Legal forged signature flags | 400 |
| Legal approval without reviewed version | 422 |

Read-only checks against actual ERP attachments (service credentials plus constructed policy principals, **not signed-in user-session tests**):

| Actual PDF | Status/type | Bytes | Parsed pages | Privacy |
| --- | --- | --- | --- | --- |
| Robotic Welding | 200 / application/pdf | 25,919 | 2 | private=1 |
| Inteva | 200 / application/pdf | 45,438 | 9 | private=1 |

Both resolved to their correct current quotation File IDs. Legal and assigned Procurement policy checks allowed them; unassigned Department policy check returned 403. No production user tokens were minted and no PDF QA copies were saved by these latest runs.

Latest full-suite run before the final two additional targeted tests: **950 passed, 1 failed** (951 tests). Failure: src/config/roles.ecr.test.ts:67 expects Engineering Changes second; existing navigation puts Business Intake second. The earlier Sidebar import timeout passed on isolated and one-worker full-suite reruns.

## K. Build and quality checks

- npx tsc --noEmit: passed.
- npm run build: passed (existing large-chunk warning; demo-MFA configuration warning above).
- Explicit TypeScript check of api/legal-review.ts and its backend dependency graph: passed.
- Scoped git diff --check: passed.
- npm run lint: failed, **553 errors / 1,029 warnings** at the full lint run. This is repository-wide, including many unrelated files. No lint rule was disabled and no broad automatic fix was applied.
- Focused lint inspection found no CLM backend errors. Existing Legal page/dashboard React/compiler/unused-variable lint findings remain; this is not a clean repository-wide lint result.

## L. Remaining acceptance and rollout requirements

The actual legal@netlink.com browser session still needs to demonstrate both PDFs visibly rendering, refresh and close/reopen, actual Procurement access, and denied unauthorized access. Do not substitute the service-side and fixture results above for this acceptance.

Approve/Reject/Request Changes, refresh persistence, version replacement, and signature execution were verified in isolated backend fixtures, **not by changing the live contract**. Live legal/financial/signature decisions need user-confirmed action-time authorization.

No deployed backend rollout, ERP migration, role grant, credential rotation, TLS change, or production signature was performed. Existing legacy “approved” records without verified version evidence fail closed and need reconciliation/re-review; they are not retroactively certified.

Actual user-session browser acceptance, environment hardening, and the unrelated failing lint/test checks must be addressed before production sign-off.
