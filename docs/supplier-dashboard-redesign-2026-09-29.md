# Supplier Portal dashboard redesign

## Scope

Presentation changes only on `/supplier/dashboard`. The existing Netlink logo, data sources, route targets, permission checks, notifications, authentication and procurement workflows are preserved. Other supplier pages retain their existing presentation.

## Files

- `src/pages/supplier-portal/SupplierDashboard.tsx`: compact welcome, six overview cards, compact RFI strip, quick actions, recent RFQ/order rows with original statuses, dates and amounts.
- `src/pages/supplier-portal/SupplierDashboard.css`: isolated navy/blue dashboard styling and responsive grids.
- `src/pages/supplier-portal/SupplierPortalLayout.tsx`: dashboard-only header/sidebar variant and accessible mobile drawer.
- `src/pages/supplier-portal/SupplierPortalSidebar.tsx`: dashboard-only navigation hierarchy and supplier account presentation. All existing destinations and locks remain.
- `src/pages/supplier-portal/SupplierDashboardShell.css`: dashboard-scoped 256px sidebar, compact header and navigation styling.

## Verification

- Production TypeScript/Vite build: `npm run build`.
- Existing supplier PO data tests: `npm test -- src/api/supplierPortalPO.test.ts` — 3 passed.
- Independent comparison against saved original files: all four dashboard queries, all 15 data derivations, KPI/RFI counts, recent-record sort/limit, routes, permission checks, session handling, notification query and logout handler are unchanged.
- Live authenticated supplier: Atlantic Precision Manufacturing.
- Before and after KPI values: Total RFQs **61**, Awaiting **14**, Submitted **47**, Active POs **2**, Pending Pay **0**, Live Auctions **0**. Pending Tasks **14**. RFI counts **0 / 1 / 0 / 0**. These remain derived from backend data.
- Live navigation verified: Create Quotation/RFQs, RFI drawer link, RFPs, Orders, Profile/Documents, Track Orders, Invoices and Support Ticket. Existing destinations loaded; no records were submitted or modified during the checks.
- Language menu opens and shows the existing languages. Notification count continues updating from its existing query.
- Mobile drawer opens, expands navigation groups, navigates, closes with Escape and restores focus.
- Responsive widths checked: **320, 375, 768, 1440, 1920px**. Dashboard/main content has no horizontal overflow after responsive transitions. KPI layout uses 2, 3 or 6 columns. Small-screen RFI content wraps into a compact two-line layout.
- No current browser console errors were reported during final navigation checks.
- Logout was verified by unchanged handler/wiring comparison; it was not clicked, preserving the user's authenticated preview session.
- Targeted ESLint: dashboard has zero errors and three existing dependency warnings; shell retains two pre-existing `set-state-in-effect` findings. No new findings were introduced.

Screenshots: `tmp/supplier-dashboard-desktop.png` and `tmp/supplier-dashboard-mobile.png`. Original file snapshots and detailed behavior audit: `tmp/supplier-dashboard-before/`.

No backend or API code was changed for this redesign.
