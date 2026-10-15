# Contract signing modal layout

## Scope and cause

UI-only change. The signing overlay had z-index 40 while the fixed application sidebar uses 100. Its unbounded panel scrolled as a whole, taking the header and confirmation buttons out of view. The inline PDF height was based on 55vh rather than a bounded document pane.

## Production files changed

- `src/components/contracts/RfqContractSigning.tsx`: body portal above the app shell; centered maximum 1100px panel; responsive 10/16/24px viewport gutters; bounded height; non-scrolling header and footer; scrollable body; compact responsive summary; close icon; existing submit button associated with the unchanged form through its unique ID.
- `src/components/contracts/ClmPdfPreview.tsx`: optional maximum-height presentation prop. Signing workspace passes 420px. Other viewers retain their previous height and scroll behavior.
- `src/components/legal/LegalESignModal.tsx`: Contract-only capture dialog uses a viewport height limit, scrollable body and non-scrolling header/footer. RFQ and Business Case modal layouts retain their existing classes.

No API, backend, permissions, signature payload, readiness validation, PDF generation, signature persistence or workflow transitions changed.

## Verification

- Focused contract/signing UI suite: **113/113 passed**, 10 files. Report: `scratch/contract-signing-layout-tests.json`.
- After the nested capture layout change, Contract capture and existing Legal render tests: **9/9 passed**. These overlap the focused suite, rather than adding nine distinct tests. Report: `scratch/contract-signing-layout-preview/capture-tests.json`.
- `npm run build`: passed; existing large-chunk advisory remains.
- Browser QA used the real production components and PDF renderer in `scratch/contract-signing-layout-preview`, with an isolated sample document and API stubs. No ERPNext requests or writes were made.
- Desktop frame: panel capped at 1100px; sidebar stays underneath the overlay; PDF pane measured 420px.
- Laptop 1024x640 frame: panel within viewport, header/footer remain visible after scrolling to signature controls.
- Mobile 375x700 frame: 10px gutters, single-column summary, panel/body/footer scroll widths equal their client widths, footer stays within the frame.
- Landscape 667x375 frame: nested capture panel fits within 16px gutters; body scrolls while adoption controls remain visible.
- Full legal name, separate typed-signature capture/adoption and consent still enable confirmation. External footer button reaches the existing form handler. The isolated handler deliberately rejects with `Layout preview only; no signature was submitted.` and leaves entered values intact.
- Canceling signature capture revokes confirmation as before. Supporting-document preview opens/closes above the parent modal. Close/reopen works. No console errors in the successful preview session.

The live CON-2026-00001 page was not signed or modified. Responsive checks were isolated layout checks, not a claim of a live persisted signature.
