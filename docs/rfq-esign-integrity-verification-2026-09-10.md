# RFQ electronic signature and document integrity fix

## Scope and outcome

The latest RFQ specification supersedes the earlier Finance-before-signature design. The implemented RFQ sequence is:

Required supplier documents verified → actual PDF SHA-256 validation → electronic signatures → Finance Review → Finance approval → Procurement Team → PO.

Neither Finance approval, final Legal approval, nor a separate checklist-completion gate is a prerequisite for RFQ signing. Opening a PDF is not verification or approval. Each required instrument must be verified and signed; only the last completed required signature advances the review to Finance.

Business Case workflow behavior was not changed in this fix. The shared signature modal has an optional RFQ-only variant; its existing Business Case default behavior is preserved. Other pre-existing workspace changes were left intact.

## Root cause and existing implementation

- The Finance-before-signature predicate and message were in uncommitted working-tree changes. Git history searches did not identify a commit introducing the exact message or predicate; HEAD did not require Finance for signing.
- Existing UI: `LegalReviewDetailPage`, `LegalPdfViewer`, and `LegalESignModal`.
- Existing backend: `api/legal-review.ts` and `api/legalReviewCore.ts`; existing typed-signature PDF operation: `burnTypedSignatureIntoPdf`.
- No signing provider, private-key signature, or certificate-backed PDF signature implementation was found. The existing operation places the signer's typed electronic signature into a PDF. SHA-256 is used for integrity, not as a substitute digital signature or a claim of legal enforceability.
- Existing ERP fields are reused: `esign_status`, `esign_document_hash`, `esign_signed_by`, `esign_signed_on`, `esign_signed_file_url`, and the per-document `esign_envelope`. The envelope stores source and signed-file hashes, File IDs, signer, timestamps, request reference, audit evidence, and `signatureMethod: typed_pdf`. No duplicate database fields were added by this fix.
- Existing ERP values are retained: `unsigned`/`signed` for the aggregate signature field, and `Pending Review` → `Finance Review` → `Completed` for workflow state. `Completed` after Finance is presented as the Procurement stage, not as PO creation.

## Server authority and integrity controls

- Required document keys are returned by the server from persisted review attachment slots. Live schema inspection found no defined mandatory-document list or mandatory attachment fields. The unused `custom_legal_documents` Long Text field is null and has no implemented schema/parser; local browser metadata is not used as authority.
- The count is not hardcoded: two populated review slots require two documents; three require three; zero never permits signing. An explicit returned-review resubmission refreshes the slots from the current ERP quotation and invalidates prior verification.
- Signing re-fetches LDR, SQ, RFQ, File metadata, and actual private PDF bytes. It checks Legal authorization, allowed workflow state, quotation-to-RFQ item links, supplier/company consistency, conflicting persisted supplier selection, terminal RFQ/SQ states, all required verification receipts, source File ID, and source SHA-256.
- Signature requests are signer- and source-version-bound. Stale requests, wrong-signer retries, source changes, and fabricated client approval/signature fields are rejected. Verification provenance cannot be rewritten once a signature request starts.
- Existing private upload/retry handling persists the generated signed PDF; the final signature verifies every current source and signed artifact before advancing to Finance. A fresh ERP read verifies persisted fields after mutations.
- Reopening a signed instrument recomputes SHA-256 over both current source and stored signed-PDF bytes. Mismatch is shown as Failed; missing/unavailable proof cannot satisfy downstream gates. Changed signed evidence is preserved, not silently replaced.
- Finance decisions require completed signatures and successful live integrity checks. Finance approval routes to Procurement Team. The production and Vite proxy PO guards re-fetch relevant ERP state and reject premature RFQ-linked create/update/submit requests, including RPC/query variants.
- Standalone non-RFQ POs retain their existing workflow. An initial PO request that omits every RFQ/SQ reference cannot be identified as RFQ-derived; this guard does not infer origin from unrelated data.
- No private files were made public, no authorization was removed, and no ERP roles or permissions were changed. Existing automatic PO Server Script disabling was removed so ERP validations remain active.

## Read-only live ERP findings

The identifier supplied as RFQ, `PUR-SQTN-2026-00243`, is a Supplier Quotation. Its review is `LDC2026-00021`, linked to RFQ `PUR-RFQ-2026-00088`.

| Instrument | Persisted verification | Private File ID | Stable SHA-256 |
| --- | --- | --- | --- |
| Master Terms & Conditions | Verified | `8af637e767` | `ea07c37a06a4d419fc70c1cd353cd8c9b273c47a621ec28e3a04b859b5577c37` |
| Quality & Compliance Warranty | Pending | `6da6b703e5` | `c94d8948f3de83c22c481c426b902579d4230db8e0065469c2aef2b45c04943b` |
| Insurance | Pending | `abbce13da4` | `a23b201a585f2de480593f20fbc7653b3bb7955cbc4be22c2fe887bf9ca9bf10` |

Current state is **1/3 verified**, Pending Review, Legal Reviewer owner, no completed signature, and blank Finance status. Signing must remain disabled until the remaining required documents are genuinely verified.

All three files are private. Read-only service-side retrieval fetched each actual PDF twice: six successful PDF responses and stable hashes matching the current envelope. This verifies byte retrieval and stability, not an authenticated browser signing acceptance test.

The RFQ's persisted `custom_selected_supplier` is currently null. The existing selected quotation/supplier binding is the LDR. A future nonempty conflicting RFQ selection is rejected; a missing RFQ selection is not fabricated or written as part of this fix.

## Validation

| Acceptance cases | Evidence |
| --- | --- |
| A–E: zero/incomplete sets disabled; 3/3 and 2/2 eligible with Finance pending | Shared gate and backend fixture tests; no fixed count or Finance prerequisite |
| F–I: sign, persist status/hash/actor/reference, stable unchanged bytes | Mock ERP integration tests using actual generated PDF bytes and the existing signing operation |
| J: changed source or signed artifact | Signing/Finance/PO integrity rejection tests; prior signed evidence retained |
| K–M: Finance before signing blocked; afterward allowed; Procurement follows | Backend workflow tests and downstream gate tests |
| N: PO creation | Proxy tests prove blocked writes are not forwarded and eligible requests are forwarded only after server validation; no real PO was purchased/created |
| O: unauthorized signing | Authentication, role, parent scope, fabricated-field, and wrong-signer replay tests |
| P–Q: persistence across refresh/login | Fresh ERP readback and gate/render tests cover persisted state; live browser refresh/logout/login after signing remains unperformed |
| Runtime initialization regression | Server-render regression test covers the Legal page without the prior derived-value initialization error |
| Business Case separation | Shared modal default regression coverage; no Business Case workflow changes in this fix |

Commands completed:

- `npx tsc --noEmit`: passed.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- Standalone backend TypeScript check for `api/legal-review.ts`: passed.
- `npm run build`: passed, with existing chunk-size warnings and demo-MFA configuration warning.
- Latest full `npx vitest run --maxWorkers=1`: **1,029 passed, 1 failed**, 121 test files. The failure is the existing ECR sidebar-order assertion at `src/config/roles.ecr.test.ts:67` (Business Intake versus Engineering Changes), unrelated to RFQ signing.
- Final focused run after the last PO URL-normalization fix: **102/102 passed** across six core signing, UI, integrity, and PO gateway suites, including four additional URL regression cases.
- Focused changed-core lint has no errors. Expanded page lint still reports pre-existing React hook errors in Legal/Finance pages; these were not silently suppressed.
- Scoped `git diff --check`: passed.

## Remaining live acceptance and deployment cautions

The available in-app browser redirects to login. The user was asked to sign in for a visual check. No real document verification, signature, Finance decision, PO creation, logout/login cycle, or ERP record mutation was performed for testing. The current 1/3 verification state was not fabricated into readiness.

The current production build configuration reports demo MFA enabled. That unrelated security configuration was not changed; review it before production deployment.
