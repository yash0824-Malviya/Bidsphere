# Contract E-Sign action and live verification

> Historical report, superseded by [Legal-first Contract signing](./contract-legal-first-signing-2026-09-28.md). The subsequent business rule explicitly allows Legal to sign an RFQ Contract before the supplier. The supplier-first statements and readiness result below describe the earlier implementation, not the current behavior.

## Root cause verified against CON-2026-00001

Read-only ERPNext inspection found:

- Native status: `Pending Signature`.
- E-sign status: `Pending Supplier`.
- Persisted RFQ workflow phase: `signature`.
- Configured company signatory: `legal@netlink.com`, enabled with Legal Manager role.
- Supplier signature: **Pending**. Legal Manager signature: **Pending**. Saved signature rows: **0**.
- Legal review was approved on 25 September 2026.
- A private locked PDF exists, has two pages, and its bytes match the stored SHA-256 hash. The approved Contract snapshot hash also matches.

The existing workflow requires the supplier to sign first. Consequently the backend correctly returned no Legal `sign` grant. The detail page showed the broad E-Signature phase without explaining the missing supplier prerequisite or displaying either pending signature state.

No missing external Adobe service or missing Frappe extension was found in this path. The existing backend signs the locked PDF using the established PDF renderer, verifies private File storage, persists signature evidence, and advances to Finance only after both required signatures.

## Changes

- `api/clmCore.ts`: additive `signature_workflow` readiness in Contract Detail, scoped to RFQ signatures; named Legal signatory and persisted-phase checks; append-only signature audit evidence.
- `api/clmSignature.ts`: validates persisted signature phase before PDF signing while preserving supported legacy records.
- `src/types/clm.ts`, `src/api/clm.ts`: readiness/receipt transport types.
- `src/components/contracts/RfqContractSigning.tsx`: Supplier/Legal Pending/Signed summary, Review Contract and backend-authorized E-Sign Contract, approved document review and signature confirmation workspace.
- `src/components/contracts/ClmRecordWorkspace.tsx`: integrates the signing panel, avoids duplicate generic sign buttons, displays E-Signature Completed audit receipts.
- `src/components/contracts/ClmDocuments.tsx`: opens/downloads the saved Supplier and Legal signed PDF receipts through the existing protected file API.
- Tests: backend Core, Signature and Contract API tests; new signing component tests and updated Contract form/handoff tests.

The sign action is enabled only when the backend grants it and reports readiness. While the required supplier signature is pending, the designated Legal Manager sees the disabled E-Sign action and an explicit waiting reason. Other roles receive no Legal E-Sign action. The status summary remains available after the Finance transition.

The review workspace shows Contract, Supplier, RFQ, Award, value/currency, terms, dates, version and supporting documents. It loads the most recent persisted signed PDF, or the approved locked PDF before signatures. A failed document load prevents confirmation. A changed record revision resets the reviewed workspace/consent. A failed save retains entered signature information and the request ID for a safe retry.

## Existing API and persistence path

```text
GET /api/clm?view=detail&doctype=Contract&name=CON-2026-00001
  -> persisted record + allowed actions + signature_workflow

GET /api/clm?view=file&doctype=Contract&name=...&fieldname=locked_file&file_id=...
  -> authorized private PDF

POST /api/clm
  { doctype: "Contract", name, action: "sign", expected_modified,
    payload: { typed_name, consent: true, request_id }, comment }
  -> authorize role/identity/stage and supplier prerequisite
  -> verify approved snapshot and locked PDF
  -> render and privately store signature PDF; verify uploaded bytes
  -> save Contract signature receipt and audit with optimistic concurrency
  -> after both signatures, persist Pending Finance / finance_review
  -> send the existing Finance notification after successful persistence
```

The `e_signed` audit event retains its action identifier and now includes Contract ID, Signed status, party, signature File ID and hash. Historical entries are not rewritten. The UI labels it E-Signature Completed.

Initial Request ownership, RFQ sourcing, supplier-first ordering, Finance approvals and Procurement/PO gates remain unchanged. No live signature, workflow transition or notification was manufactured.

## Verification

- **595 tests passed, 0 failed**, across 24 files. Includes Contract pages/components, protected API actions, real PDF rendering/private-storage fixtures, signature receipts, immutable history preservation, failure handling, Finance notifications, RFQ synchronization and PO guards. Report: `scratch/contract-signature-final-tests.json`.
- `npx tsc -b` passed; `npx vite build` passed (exit 0). Vite emitted a bundle-size warning, with no compilation failures. Logs: `scratch/clm-sign-ui-typecheck.log`, `scratch/contract-signature-build.log`.
- Live read-only check passed: actual Legal user role, authorized record access, approved snapshot hash, locked PDF bytes/pages/hash, and unchanged ERPNext record before/after. Report: `scratch/contract-signature-readonly-evidence.json`.
- For the real record, readiness is `can_review=true`, `can_sign=false`, with reason: “Awaiting the required supplier signature. The Legal Manager can e-sign after the supplier signs.”

## Live acceptance still pending

This is **not a claim of completed live signing**. CON-2026-00001 still has zero signature rows and remains Pending Supplier. The preview is at login; no authenticated Legal action was performed.

1. The actual supplier signs through the existing Supplier Contracts flow.
2. The designated Legal Manager opens CON-2026-00001, reviews the Contract/PDF and supporting documents, and personally confirms E-Signature.
3. Re-fetch Contract and private signed PDF; verify both receipts, document hash and E-Signature Completed audit.
4. Verify `Pending Finance` / `finance_review`, UI Pending Finance Approval, and the Finance Manager notification/task.

No database migration, VM/Bench access or new signing system is required for this change.
