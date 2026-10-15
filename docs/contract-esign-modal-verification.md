# Contract E-Signature modal correction

## Root cause

The form was rendered after the Contract summary, terms, 420px PDF preview and supporting documents inside a constrained scrolling modal. The PDF had its own scroll region, so the signer form was easy to miss. A separate Type Signature / Adopt dialog was also required before consent became available; the disabled final button did not explain this extra step.

## Changes

- `src/components/contracts/RfqContractSigning.tsx`: document/form columns on larger screens; signer form first on mobile; compact expandable summary; visible Legal identity, required Full Legal Name, consent, optional comments and readiness explanation; fixed bottom actions. Assigned Legal users can see blocked readiness reasons without losing the form. The final explicit confirmation creates the existing adopted typed-signature payload; entering a name alone performs no action.
- The same component displays persisted signer name, email, timestamp, version and comments in signature history.
- `api/clmCore.ts` and `src/types/clm.ts`: optional `signature_comment` is preserved in the verified signature receipt as well as the existing audit history.
- `api/clmSignature.ts`: the existing PDF signature mechanism labels the RFQ Legal mark with `Legal Manager | SIGNED | v<current version>`; actual name and timestamp still come from the signing operation.

## Actual API and persistence path

`SigningWorkspace` → workspace `runAction` → `applyClmAction` → `POST /api/clm` with action `sign` → server authorization and version checks → `signClmContract` → signed private PDF upload and hash readback → ERPNext Contract save → independent GET verification → linked RFQ synchronization → notification of the next responsible party.

The UI submits `full_legal_name`, `signature: { method: "typed", value: <entered name>, adopted: true }`, `consent: true`, the existing retry/request ID, comments and expected document modification. It never sends a replacement workflow status or signer identity.

Backend checks still enforce the exact assigned Legal user, current E-Signature stage, approved locked version, name, consent, adopted signature, no duplicate party receipt and unchanged reviewed revision. Unauthorized roles do not gain an action. Failures leave the entered form values available and do not show successful completion.

## Preserved workflow constraints

This Contract requires both supplier and Legal Manager signatures. Legal-first signing stores Legal's signature and waits for the supplier. Finance Approval and its queue entry are created only after both signatures are persisted. Neither the modal nor this fix bypasses that existing condition.

The preview opens the exact approved private PDF selected by the backend. The new professional template applies to newly generated approved documents. The local presentation export from the earlier task is not substituted for an already locked approval artifact; replacing it silently would make the reviewed and signed bytes disagree.

## Verification

- `npx vitest run clm Clm RfqContractSigning RfqContractWorkflow LegalESignModal.contract`: **52 files, 1,417 tests passed**.
- `npm run build`: passed, with the existing large-bundle warning.
- Live CON-2026-00001 modal: Legal identity, Full Legal Name and consent are visible beside the approved PDF; initially disabled confirmation.
- Isolated real-component browser fixture: name alone stays disabled; name plus explicit consent enables confirmation after PDF rendering. Laptop 1024×640 and mobile 375×700 layouts inspected. Mobile has no horizontal overflow and places the signer form before the document.
- Tests cover role/stage/version/duplicate checks, failed uploads and saves, independent ERP readback loss of receipt/comment, current-version signature history, real PDF signature marks, preserved source pages and both orders of supplier/Legal signing.

Live persistence verification is recorded separately after the user's final signature confirmation. A closed modal or user acknowledgement alone is not treated as proof of a saved signature.
