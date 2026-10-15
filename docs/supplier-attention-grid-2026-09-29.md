# Supplier attention grid correction

## Change

The prior dashboard removed every attention card with a zero count. With only RFQs requiring attention, the four-column grid contained one card and three empty slots.

`src/pages/supplier-portal/SupplierDashboard.tsx` now always renders the four configured supplier categories: RFQs Awaiting Response, Contracts Awaiting Acceptance, Documents Required, Orders Awaiting Acknowledgement. Each uses its existing supplier route. RFQs show the existing calculated count, with a loading placeholder during the initial request.

The current dashboard payload does not supply pending contract acceptance, required-document or PO acknowledgement counts. Those three cards use the zero fallback explicitly requested in the brief. These zeros are presentation fallbacks, not verified totals from those separate workflows. No task counts were inferred from unrelated statuses, and no APIs or new queries were added.

`src/pages/supplier-portal/SupplierDashboard.css` explicitly stretches attention cards and recent panels equally, with equal-height grid rows. Existing 4/2/1 attention breakpoints, six desktop Quick Actions, 14px card gaps and 22px section gaps remain intact.

## Verification

- `npm run build`: PASS, TypeScript and Vite. Existing large-bundle advisory remains.
- CSS parsing and source whitespace check: PASS.
- Independent audit against `tmp/supplier-attention-grid-before`: queries, authentication, onboarding, refresh guards, KPI calculations, Quick Actions and Recent Activity unchanged.
- Desktop 1440px: four attention cards, counts 14/0/0/0, each 270px wide and 162px high; six Quick Actions; recent panels each 552px wide and 460px high with matching top alignment.
- Tablet 768px: attention cards in two rows of two, equal heights.
- Mobile 320px: four equal-height cards stacked in one column; recent panels in one column.
- No horizontal main-content overflow at any tested width; browser console contained no errors.
- All four card destinations match existing routes. No backend records or workflow states changed.

Evidence: `tmp/supplier-attention-grid-desktop.png`, `tmp/supplier-attention-grid-build.log`. Temporary viewport overrides were reset.
