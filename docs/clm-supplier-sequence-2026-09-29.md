# Supplier Contract acceptance → signature → PO acceptance

## Scope and root cause

The previous supplier PO acceptance action was independent of Contract signing. Supplier Contract signing also did not require a separate, persisted Contract acceptance. The Vite PO Shipment adapter wrote through the shipment core without the authenticated production boundary. A successful shipment response could merge submitted fields with the ERP response without independently verifying persistence.

The existing Contract, RFQ, Award, quotation, PO and supplier relationships remain authoritative. No replacement Contract, new DocType or Frappe app is introduced.

## Backend behavior

1. `POST /api/clm`, action `supplier_accept`, saves a separate `supplier_po_acceptance` receipt in the existing ERPNext Contract's `custom_clm_data`. It binds consent, authenticated supplier actor, timestamp, Contract, PO, version and the exact Legal-signed PDF file/hash. The owning supplier must review that current artifact.
2. `POST /api/clm`, action `sign`, requires the saved acceptance, verified source links and a submitted PO. It uses the existing PDF signature implementation. The receipt records name, email, email provenance, time, version, acceptance ID, source artifact and resulting signed artifact. The original and Legal-signed PDFs remain immutable.
3. `POST /api/po-shipment/upsert` requires both saved receipts and verified PDF bytes before supplier PO acceptance. The server derives the actor and timestamp, validates supplier ownership and re-reads the shipment before returning success. Later shipment processing cannot manufacture the missing supplier acceptance.
4. Contract/PO reads project the supplier lifecycle from saved Contract evidence and the real `PO Shipment` record. A prior PO acceptance dated before the supplier signature requires explicit reconfirmation; it is never silently reused.

Repeated Contract acceptance and signing requests return matching saved evidence rather than create duplicate actions. Failed saves do not produce client success/cache updates. Generic proxy shipment mutation paths are blocked so they cannot bypass the authenticated endpoint. Linked-CLM shipment acceptance requires a numeric accepted flag, an accepted/post-acceptance state and a post-signature timestamp; contradictory or stale requests cannot reset later shipment progress. Non-CLM POs retain their existing flow.

The completed internal Legal/Finance/Procurement phase is preserved. Supplier acceptance is a separate handoff attached to the existing PO. The supplier overview distinguishes its pending signature from the already completed internal e-sign status.

## UI

The PO and supplier Contract pages show all eight requested states, highlight the current stage, and display responsibility and next stage. The Contract page reuses the existing approved-PDF workspace for two distinct actions:

- **Accept Contract**: PDF review and explicit acceptance consent.
- **Sign Contract**: available only after persisted acceptance; captures actual signer details and signing consent.
- **Accept Purchase Order**: available only after the saved, verified supplier signature. The Contract then shows **Fully Signed**.

Subsequent shipment, receipt, invoice and payment processing remains in the existing PO workflow. Completed is displayed only when the real shipment workflow reaches Completed.

## Files changed for this task

Backend/runtime:

- `api/clmSupplierPoWorkflow.ts` (new): receipt projection, source/PO verification and signature gate.
- `api/clmCore.ts`, `api/clmSignature.ts`, `api/clmErp.ts`: acceptance/signature authorization, persistence and readback.
- `api/clmPurchaseOrderLink.ts`, `api/clm.ts`, `src/types/clm.ts`: linked Contract response and supplier workflow types.
- `api/poShipmentAccess.ts` (new), `api/po-shipment.ts`: shared authenticated shipment boundary.
- `api/erpProxySecurityGuard.ts`, `api/proxy.ts`, `vite.config.ts`: prevent generic bypasses; development/production parity.
- `api/clmPurchaseOrder.ts`, `api/procurementReadScope.ts`: type annotations only.

Frontend:

- `src/components/contracts/SupplierContractActions.tsx` (new).
- `src/components/contracts/SupplierContractLifecycle.tsx` (new).
- `src/components/contracts/RfqContractSigning.tsx` and `ClmRecordWorkspace.tsx`.
- `src/components/p2p/PurchaseOrderContractInformation.tsx`.
- `src/pages/supplier-portal/SupplierPOPage.tsx`.
- `src/api/clm.ts`, `src/api/poShipment.ts`, `src/api/poDeliveryWorkflow.ts`.

Regression coverage:

- Contract core, supplier workflow, PO linking, signature persistence, real-PDF transaction and revision tests.
- Authenticated shipment access/handler/proxy tests and shipment/PO client tests.
- Supplier actions, eight-stage lifecycle, signing workspace, Contract handoff, PO Contract information and PO sequence UI tests.
- `scratch/clm-supplier-sequence-live.check.ts` and `.vitest.mjs`: read-only real ERP verification, including immutable original/Legal PDF hashes and saved approval evidence.

## Verification

- Final combined regression run: **416 tests passed across 20 files** (`tmp/clm-supplier-sequence-regression.log`), including the supplier overview correction and stale shipment retry cases.
- Production build succeeded; existing large-chunk advisory remains.
- Live initial ERP preflight passed for **CON-2026-00001 / PUR-ORD-2026-00028**. Actual persisted links: RFQ **PUR-RFQ-2026-00104**, Award **LDC2026-00027**, quotation **PUR-SQTN-2026-00273**, supplier **Atlantic Precision Manufacturing.**, value **USD 4,500**.
- Original PDF and Legal signature bytes verified; saved Finance approval and internal completed phase remain intact.
- Live Supplier Portal displays **Accept Contract**, hides **Sign Contract**, and disables **Accept Purchase Order** before acceptance. The actual approved two-page PDF loads in the acceptance modal.
- The open live modal has no console errors and no page-level horizontal overflow (779px viewport / 779px document width).

### Live acceptance test status

The binding actions have not yet been performed in this verification run. The user has been handed the real Contract acceptance modal to review and confirm. Full live acceptance → signature → PO acceptance is **pending**, not reported as passed.

The checker supports `CLM_SUPPLIER_EXPECT=accepted`, `signed`, and `po_accepted` after each user action. It compares the saved ERP Contract against `scratch/clm-supplier-sequence-before.json` and verifies the actual PDF artifacts. No production Contract terms or signature evidence are fabricated for a test.

## Deployment

Deploy the changed BidSphere API/server and frontend together using the existing deployment process. No bench installation, Frappe migration or new ERP schema is needed for these receipts; they use the existing Contract JSON and PO Shipment fields. The local Vite server serves the updated implementation. This report does not claim a separate production frontend/API release has been deployed.

## Follow-up: missing Sign Contract action

The supplier detail serializer returned `actions: sign` and `supplier_workflow.can_sign_contract` after acceptance, but omitted `signature_workflow`. The button and signing workspace additionally required `signature_workflow.can_sign`, a field previously projected only for internal users. Consequently a correct persisted acceptance could still leave the supplier without a visible Sign action. The earlier isolated UI fixture incorrectly supplied this internal projection and did not catch the mismatch.

The follow-up returns supplier signing readiness from the existing authorized action and version-bound receipts, removes the inappropriate dependency on internal Legal readiness, and explicitly displays the supplier next-action card. Backend ownership, acceptance, consent, version and duplicate-signature checks remain authoritative. Tests now cover the real backend aggregate rendered by the supplier component and the real-PDF signing transaction.

A read-only inspection for this follow-up found no saved supplier acceptance yet on CON-2026-00001. The live acceptance/signature completion test still requires the supplier's own binding confirmations; code tests are not presented as a live signature.

Follow-up regression: **423 tests passed across 21 files**, including the new actual backend aggregate → supplier action component test and the real PDF transaction. Results: `tmp/clm-supplier-next-step-regression.log`. The final production build also passed (`tmp/clm-supplier-next-step-build.log`); only the existing large-chunk advisory remains.

Follow-up files: `api/clmCore.ts`, `api/clmSupplierPoWorkflow.ts`, `src/types/clm.ts`; `src/components/contracts/SupplierContractActions.tsx`, `RfqContractSigning.tsx`, `ClmRecordWorkspace.tsx`; tests `api/clmSupplierPoWorkflow.test.ts`, `api/clmSignatureTransaction.test.ts`, `SupplierContractActions.test.tsx`, `SupplierContractActions.integration.test.tsx`, `RfqContractSigning.test.tsx`, `clmSupplierHandoff.test.tsx`; and the read-only live checker in `scratch`.

The optional declared Signatory Role is stored as receipt metadata separately from the server-assigned supplier authorization role. Both the supplier and Legal signature statuses, the signed PDF view/download, and the distinct next PO acceptance action are visible after the saved signature.

## Subsequent live verification completed

The supplier subsequently saved acceptance at 13:15:24, signed at 13:16:06 and accepted PO28 at 13:16:52 on 2026-09-29. The later PO Shipment supplier-link bug was diagnosed and repaired without changing those receipts or the signed PDF artifacts. Live Supplier Portal now confirms the complete acceptance → signature → PO acceptance sequence and Existing PO Processing. See `po-contract-acceptance-link-repair-2026-09-29.md` for the exact repair, proof, duplicate checks and final 473-test/build results. No shipment dispatch or later financial/procurement completion was fabricated.
