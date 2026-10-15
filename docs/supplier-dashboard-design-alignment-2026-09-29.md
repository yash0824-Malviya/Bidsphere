# Supplier dashboard design alignment

## Scope

Aligned the supplier dashboard with the existing Procurement Manager dashboard's design patterns: compact white page header, uppercase section headings, 10px card corners, small icon tiles, navy sidebar, consistent action links and restrained status badges. Used the supplier brief's navy/blue/background colors and 28px title / 30px metrics.

### Files changed in this pass

- `src/pages/supplier-portal/SupplierDashboard.tsx`: compact Supplier Dashboard header; Supplier Overview heading; positive-count attention cards using existing dashboard counts.
- `src/pages/supplier-portal/SupplierDashboard.css`: compact cards, RFI strip, quick actions, attention cards and recent panels; responsive 6/3/2/1 KPI layout.
- `src/pages/supplier-portal/SupplierDashboardShell.css`: staff-style 240px dashboard sidebar, navigation rhythm and hover states.
- `src/pages/supplier-portal/SupplierPortalHeader.css`: aligned header controls, typography and account menu presentation.
- `src/pages/supplier-portal/SupplierPortalLayout.tsx`: dashboard sidebar offset changed from 256px to 240px to match its new width. Other routes retain their existing sidebar offset.

No API, database, authentication, permission, route or workflow implementation changed. The current Profile/Support header controls and business-only sidebar were preserved. Logout still calls the existing handler; it was not clicked during verification so the supplier session stayed available.

## Data and attention cards

The authenticated Atlantic Precision Manufacturing dashboard retained:

| Metric | Value observed |
| --- | ---: |
| Total RFQs | 61 |
| Awaiting | 14 |
| Submitted | 47 |
| Active POs | 2 |
| Pending Pay | 0 |
| Live Auctions | 0 |
| Pending Tasks | 14 |

Account status remained Approved. RFI values remained Draft 0, Submitted 1, Approved 0, Rejected 0. Values continue to come from existing queries and calculations; none are hardcoded.

Attention cards reuse only the existing `awaitingCount`, `pendingPaymentsCount` and `liveAuctions` values and appear only when positive. The live account therefore showed one RFQ attention card with 14. Payment wording describes tracking payments, not an obligation for the supplier to pay. No contract/document/PO acceptance counts were inferred from unavailable data, and no extra APIs were introduced.

## Verification

- `npm run build`: PASS (TypeScript and Vite production build). Existing large-chunk advisory remains.
- `npm test -- src/api/supplierPortalPO.test.ts`: PASS, 3 tests.
- `git diff --check` for the changed source files: PASS.
- Independent source audit against `tmp/supplier-design-alignment-before/SupplierDashboard.tsx`: queries, query options, session/authentication guards, locked onboarding branch, all original KPI calculations, recent-item sorting/slicing, RFI filters, and KPI/quick-action route arrays preserved exactly.
- Browser viewport checks: 1440px = six KPI columns; 768px = three; 640px = two; 320px = one. Main content scroll width equaled client width at every size; no overflowing dashboard descendants found. Recent panels stack on small screens.
- Desktop sidebar measured 240px; header measured approximately 65px including border.
- Live Profile menu: company name, Account Status, Profile and Company Information links preserved. Mobile language selector and Logout entry available.
- Support menu: existing Help & Support, Contact Support, Support Tickets routes present. Mobile English selection worked.
- Mobile drawer: only Workspace, Sourcing and Operations business navigation; opens/closes with keyboard.
- Create Quotation quick action: opens the existing supplier RFQ list, which loaded real records. All remaining action destinations were checked against unchanged route arrays.
- Browser console: no errors captured during verification. No records or workflow states changed.

## Evidence

- `tmp/supplier-design-desktop.png`
- `tmp/supplier-design-mobile.png`
- `tmp/supplier-design-final.png`
- `tmp/supplier-design-build.log`

Temporary viewport overrides were reset after responsive verification.
