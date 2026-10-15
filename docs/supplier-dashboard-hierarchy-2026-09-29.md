# Supplier dashboard hierarchy and card refinement

## Changes

- `src/pages/supplier-portal/SupplierDashboard.tsx`
  - Ordered primary sections: Supplier Overview, Requires Your Attention, Quick Actions, Recent Activity.
  - Kept the existing RFI summary as a compact secondary row inside Supplier Overview.
  - Added full KPI labels and supporting descriptions, using unchanged existing values.
  - Added a compact Refresh control using the four existing queries and their original authentication/supplier guards.
  - Added View Contracts; relabeled Invoices to View Invoices. Support tickets remain available through the existing header Support menu.
  - Displayed saved RFQ titles using the existing `parseRfqMessage` utility, plus supplier-order labels and existing amounts in Recent Activity.
  - Kept statuses verbatim and displayed neutral statuses such as Draft in grey.
- `src/pages/supplier-portal/SupplierDashboard.css`
  - Matched Procurement Manager's 24px page title, 15px uppercase section titles, compact icon/card styling and divided attention-card action links.
  - Added responsive four/two/one-column attention layout and description rows in the six/three/two/one-column KPI layout.
  - Aligned all desktop KPI values and preserved narrow-screen wrapping without page overflow.

No API, database, authentication, permission, route or workflow implementation changed. No new endpoints or queries were added. Existing Profile, Support, notification, language and logout controls were untouched.

## Data boundaries

The main KPI calculations and RFI status calculations are unchanged. Live values observed: 61 total RFQs, 14 awaiting response, 47 submitted quotations, 2 active POs, 0 pending payments, 0 live auctions. Pending Tasks remained 14 and account status Approved.

Only positive existing attention counts are shown. The current account therefore displays its RFQ attention card. Missing contract acceptance, document requirement and PO acknowledgement counts are omitted, rather than inferred from unrelated statuses. The auction description is "Auctions live now" because the existing count intentionally excludes scheduled auctions.

## Verification

- Production TypeScript/Vite build: PASS. Existing bundle-size advisory remains.
- `npm test -- src/api/supplierPortalPO.test.ts`: PASS, three tests.
- Final CSS parsed successfully with PostCSS; source whitespace check passed.
- Independent source audit: all existing query definitions, session/auth guards, onboarding branch, KPI calculations, RFI filters and recent-item sorting unchanged.
- Desktop: six KPI columns, four attention columns, two recent panels; all six KPI values share the same vertical position. No horizontal overflow.
- Tablet: three KPI columns and two attention columns. No header or main-content overflow.
- Mobile: one/two KPI columns and one/two attention columns as width permits; recent panels stack. The 320px header, Refresh control and cards fit within the viewport.
- Refresh clicked in authenticated supplier session: existing data reloaded and counts preserved.
- View Contracts opened the existing supplier Contracts list containing CON-2026-00001.
- View Invoices opened the existing All Invoices page containing two real invoice records.
- No records were submitted or workflow states changed during verification.

Evidence: `tmp/supplier-hierarchy-desktop.png`, `tmp/supplier-hierarchy-mobile.png`, `tmp/supplier-dashboard-hierarchy-build.log`.
