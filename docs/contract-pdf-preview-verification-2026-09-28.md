# Contract PDF preview verification — 2026-09-28

## Scope

Presentation only. No API, ERPNext schema, contract data, signature payload,
signature persistence, status, or workflow changes were made for this fix.
The viewer uses the existing authorized PDF bytes and existing PDF.js renderer.

## Root causes and changes

- The Documents preview used a z-index of 50 inside the app shell, below the
  sidebar's z-index of 100. The shared dialog now portals to `document.body` at
  z-index 1300, above the app and E-Sign workspace.
- The PDF bitmap was rendered at a capped scale, then stretched by `w-full`.
  Canvas CSS dimensions now match PDF.js viewport dimensions and retain each
  page's aspect ratio. Device pixel density affects bitmap resolution only.
- The renderer measured width once and had a nested 55vh scroll region.
  ResizeObserver and browser resize events now recalculate the available space.
  The standalone dialog uses fit-to-page and one bounded, keyboard-accessible
  scrolling area. Its header stays fixed.
- E-Sign's View Contract PDF link opened a separate browser viewer. It now opens
  the same shared preview used by Documents, with the same already-loaded bytes.
- The dialog locks both root and body scrolling, then restores their previous
  overflow and keyboard focus on close. Download and existing attachment previews
  remain available.

## Production files

- `src/components/contracts/ContractPdfPreviewModal.tsx` — shared responsive modal.
- `src/components/contracts/ClmPdfPreview.tsx` — canvas sizing and resize handling.
- `src/components/contracts/ClmDocuments.tsx` — shared preview integration.
- `src/components/contracts/RfqContractSigning.tsx` — shared E-Sign preview.

Tests added/updated:

- `src/components/contracts/ContractPdfPreviewModal.test.tsx`
- `src/components/contracts/ClmPdfPreview.test.tsx`
- `src/components/contracts/RfqContractSigning.test.tsx`

## Live browser checks

Contract: `CON-2026-00001`, using the existing two-page approved PDF.

- Opened View Contract PDF from the existing E-Sign workspace.
- Closed and reopened the nested preview; the E-Sign workspace remained open.
- Opened the original PDF through Contract > Documents > Preview.
- Desktop 1440×900: panel 1200×852 at x=120/y=24, above sidebar; page aspect ratio
  preserved, no CSS transform scaling, first page fully visible horizontally.
- Scrolled to page 2: header remained at y=24.8 while viewer scrollTop became 732.
- Tablet 768×600: panel 736×568, no viewer or page horizontal overflow.
- Mobile 375×700: panel approximately 355×680, both Close and Download visible,
  viewer scrollWidth equaled clientWidth, root scrollWidth equaled clientWidth.
- Landscape 667×375: panel approximately 635×343, fitted page and Close control
  stayed within the viewport.
- Escape closed the preview and restored focus to View Contract PDF.
- Temporary viewport override was reset after testing.
- No PDF renderer console errors were observed. Browser logs contained unrelated
  earlier ERP ping timeouts and ECR permission errors.

Browser zoom limitation: the embedded browser ignored Ctrl+0/Ctrl+plus, so actual
125% and 150% browser zoom could not be verified live. Automated tests cover
remeasurement at pixel ratios 1, 1.25, and 1.5 and proportional canvas sizing.

## Commands and results

```text
npm run build
PASS (existing large-chunk warning)

npx vitest run src/components/contracts/ClmPdfPreview.test.tsx src/components/contracts/ContractPdfPreviewModal.test.tsx src/components/contracts/ClmDocuments.test.tsx src/components/contracts/RfqContractSigning.test.tsx src/components/contracts/ClmRecordWorkspace.request.test.tsx
PASS — 5 files, 88 tests

npm test -- --reporter=dot
248 files passed, 1 failed, 4 skipped
3723 tests passed, 4 failed, 5 skipped
```

All four full-suite failures are in `src/api/approvalWorkflow.test.ts`; the same
failures also exist in historical `scratch/clm-baseline-tests.log` and
`scratch/clm-final-tests.log`. An isolated rerun reproduces them. They concern
persisted Finance Review/Completed states taking precedence over readiness gates
in `src/api/approvalWorkflow.ts`. Those files do not depend on the preview, and
were left unchanged under this UI-only request.

Local output logs: `tmp/contract-pdf-preview-build.log`,
`tmp/contract-pdf-preview-focused-tests.log`, `tmp/contract-pdf-preview-tests.log`.
