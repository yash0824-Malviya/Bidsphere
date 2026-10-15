# Existing Contract signing: separate identity and captured signature

## Correction

Previously, the Full Legal Name input also supplied the text burned into the signature PDF. The latest rule requires a separately captured signature. Entering a legal name is now insufficient, both in the UI and on the server.

The Legal Manager reviews the actual Contract PDF, enters Full Legal Name, clicks **Type Signature**, and explicitly adopts a mark using the existing `LegalESignModal`. Contract mode starts blank, uses the same serif/italic appearance as the existing PDF stamp, and returns an adopted signature only after explicit confirmation. The final consent checkbox and **Confirm & Sign Contract** remain separate. Editing identity/signature or reloading the reviewed document revokes adoption and consent.

## Existing Contract and API

```json
{
  "doctype": "Contract",
  "name": "CON-2026-00001",
  "action": "sign",
  "expected_modified": "<reviewed ERPNext revision>",
  "payload": {
    "full_legal_name": "<signer's full legal name>",
    "signature": {
      "method": "typed",
      "value": "<separately captured signature>",
      "adopted": true
    },
    "consent": true,
    "request_id": "<attempt ID>"
  }
}
```

This is submitted to the existing `POST /api/clm` endpoint. The frontend rejects signing without an existing Contract ID and rejects a response for a different record. Backend authorization still requires the designated Legal Manager and the existing Contract's E-Signature stage.

For a new RFQ Legal signature, the shared backend validator requires the full legal name, nonempty separately captured typed mark, explicit adoption and consent. Name-only, empty, unsupported-method and unadopted requests fail before PDF processing. The existing PDF renderer receives the captured mark, not the identity field.

The original locked PDF remains intact. A new private signed PDF is stored through the existing ERPNext File mechanism and attached to the same Contract. The receipt retains its File ID, URL, SHA-256 hash, authenticated signer, timestamp and version, and additionally stores `full_legal_name`, `signature_method: "typed"` and `signature_adopted: true`. No new Contract, disconnected signature record, signing service or DocType is created.

The existing independent Contract GET verification remains in place before successful response, RFQ synchronization and notifications. Documents shows **Original Contract / Status: Original** and **Signed Contract / Status: Signed**, with the full legal identity, authenticated email, time and protected document controls. Existing receipts without the new optional metadata remain readable.

Legal-first signing retains **Pending Supplier Signature / E-Signature / Supplier** until the supplier countersigns. Both signatures are required before the existing Finance stage. No RFQ sourcing, award, creation routing, Finance decision or PO logic changed. Supplier and standalone Contract signing keep their existing payload rules; RFQ document and Business Case signature modal modes retain their prior behavior.

## Files changed

Production:

- `api/clmCore.ts`
- `api/clmSignature.ts`
- `src/types/clm.ts`
- `src/api/clm.ts`
- `src/components/contracts/RfqContractSigning.tsx`
- `src/components/contracts/ClmDocuments.tsx`
- `src/components/legal/LegalESignModal.tsx`

Tests:

- `api/clm.test.ts`
- `api/clmCore.test.ts`
- `api/clmSignature.test.ts`
- `api/clmSignatureTransaction.test.ts`
- `api/clmSignaturePersistence.test.ts`
- `api/rfqClmCore.test.ts`
- `src/api/clm.test.ts`
- `src/components/contracts/ClmRecordWorkspace.request.test.tsx`
- `src/components/contracts/RfqContractSigning.test.tsx`
- `src/components/contracts/ClmDocuments.test.tsx`
- `src/components/legal/LegalESignModal.contract.test.tsx`

## Verification

**849 tests passed, 0 failed, across 33 files. Production build passed.** Vite emitted its bundle-size warning only.

The combined run covers capture/adoption and cancellation, name-only rejection, role security, signed bytes, original PDF preservation, same-Contract private attachment, no Contract creation, independent persistence read-back, protected receipt retrieval, both signing orders, and RFQ/Finance/PO regression checks. The real PDF renderer runs against controlled ERP fixtures in transaction tests; those tests do not sign production records.

```powershell
npx vitest run src/components/contracts src/pages/contracts src/api/clm.test.ts src/utils/rfqClmWorkflow.test.ts src/utils/rfqClmLifecycle.test.ts src/components/legal/LegalESignModal.contract.test.tsx src/api/legalReviewRender.test.tsx src/api/legalSignatureReadiness.test.tsx src/api/legalEsign.workflow.test.ts api/clmCore.test.ts api/clmSignature.test.ts api/clmSignatureTransaction.test.ts api/clmSignaturePersistence.test.ts api/clmNotifications.test.ts api/clm.test.ts api/clmGatewayGuard.test.ts api/rfqClmCore.test.ts api/rfqClmRestSync.test.ts api/rfqPurchaseOrderGuard.test.ts --reporter=json --outputFile=scratch/clm-adopted-signature-final-tests.json
npm run build
```

Test report: `scratch/clm-adopted-signature-final-tests.json`. Build log: `scratch/clm-adopted-signature-build.log`.

## Live acceptance remains pending

Read-only ERPNext inspection at **2026-09-28T07:54:05Z** found the existing `CON-2026-00001` unchanged, with zero signature receipts, native `Pending Signature`, phase `signature`, and Legal signatory `legal@netlink.com`. Its original locked private PDF remains File `be1e1f2d01`. The Contract references RFQ `PUR-RFQ-2026-00104`, Award `LDC2026-00027`, quotation `PUR-SQTN-2026-00273`, and USD 4,500.

The browser preview remains signed out. No live Legal signature or signed-document ID is claimed. Live read-only evidence: `scratch/contract-signature-adoption-live-readonly.json`. Live acceptance requires the designated Legal user to sign in, review the PDF, provide/adopt their signature and confirm signing. Then re-fetch the Contract and signed File, refresh/reopen the page, and verify receipt, full name, signer/time, audit and supplier-dependent stage.

Deploy the frontend and `/api/clm` changes together. No new ERPNext schema migration or Frappe app installation is required.
