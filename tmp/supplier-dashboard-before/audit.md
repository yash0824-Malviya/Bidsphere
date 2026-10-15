# Supplier dashboard behavior baseline (2026-09-29)

Read-only audit of `SupplierDashboard.tsx`, `SupplierPortalLayout.tsx`, `SupplierPortalSidebar.tsx`, related CSS, routes and available test scripts. Existing workspace has extensive unrelated modifications; compare against the task's captured working-tree baseline rather than HEAD.

## Query and session invariants

| Query | Function and enabling condition | Options |
| --- | --- | --- |
| `[portal-profile, sessionToken]` | `portalGetProfile(sessionToken)`; authenticated and token | retry 1 |
| `[supplier-portal-dashboard, erpSupplierName]` | `getSupplierDashboardData(erpSupplierName)`; authenticated, unlocked and supplier | retry 1 |
| `[supplier-portal-auctions-kpi, erpSupplierName]` | `getSupplierAuctions(erpSupplierName)`; authenticated, unlocked and supplier | retry 1, interval 2000 ms, stale 1000 ms, window-focus refetch true |
| `[supplier-portal-rfis, erpSupplierName]` | `getSupplierRFIs(erpSupplierName)`; authenticated, unlocked and supplier | stale 15000 ms, mount refetch always |
| `[supplier-portal-notifications, erpSupplierId]` (layout) | `getNotificationsForViewer({role: supplier, supplierId: erpSupplierId})`; supplier ID exists | interval 5000 ms, stale 2000 ms |

Profile query continues updating the current supplier session with unlocked, displayStatus, linkedSupplier fallback, companyName fallback, firstLogin. Dashboard returns null until ready and authenticated. Locked suppliers see onboarding, progress/checklist, profile link and pending-approval notice. Approved/unlocked dashboard status prefers profile response then session display status then `Approved` fallback.

Layout retains session resolution, locked-path redirect to `/supplier/locked`, pathname-triggered mobile menu close and content scroll reset, menu-open body overflow handling. Logout clears supplier session then navigates to `/supplier/login` with replace. Notification unread badge uses `countUnread` and still links to `/supplier/dashboard`.

## Calculation invariants

- Total RFQs: `rfqs.length` (not only published).
- Submitted: quotation statuses matching `/submit/i`.
- Published RFQs: docstatus exactly 1 and status not `Cancelled`.
- Awaiting: `Math.max(0, publishedRfqs.length - submittedCount)`.
- Active POs: existing `countActivePOs(pos)` helper.
- Pending Pay: `data?.pendingPayments ?? 0`.
- Live Auctions: auctions whose existing `deriveAuctionStatus` returns `Live`.
- Pending Tasks: awaiting + pendingPayments + liveAuctions.
- Recent RFQs and orders: copies sorted by descending modified/transaction_date timestamp, first five; existing fallback/date behavior must remain.
- RFI status source: `deriveSupplierRfiFacingStatus` for each row; Draft exact; Submitted combines Submitted and Under Review; Approved/Rejected exact.
- Onboarding progress: six existing boolean steps, rounded completion percentage. Company, contact, business, bank, documents and review; GST/PAN regex checks remain.

## Dashboard destinations

| Control | Destination |
| --- | --- |
| Total RFQs, Awaiting | `/supplier/rfqs` |
| Submitted | `/supplier/quotations` |
| Active POs | `/supplier/purchase-orders` |
| Pending Pay | `/supplier/payments` |
| Live Auctions | `/supplier/auctions` |
| All four RFI counters and view all | `/supplier/rfis` |
| Create Quotation, View RFQs | `/supplier/rfqs` |
| Upload Documents | `/supplier/profile?tab=documents` |
| Track Orders | `/supplier/delivery-schedule` |
| Invoices | `/supplier/invoices` |
| Support Ticket | `/supplier/help-desk` |
| Recent RFQ row | `/supplier/rfq/${encodeURIComponent(rfq.name)}` |
| Recent order row | `/supplier/po/${encodeURIComponent(po.name)}` |

Recent RFQ rows expose reference, existing status or Open, company when present, transaction date. Orders expose reference, `formatCurrency(grand_total)`, status or em dash, transaction date. Preserve these existing values while regrouping display. Both panels retain loading and empty states, all five rows, existing view-all routes and fetching indicator. No supporting statistics or descriptions exist per KPI/action.

## Navigation invariants

Ten groups: Dashboard, Contracts, Profile, RFQs, RFIs, RFPs, Live Auctions, Orders, Finance, Support. Groups with children toggle expansion rather than navigate directly. Profile children are profile, documents query tab, security. RFQs children are RFQs and quotations. Orders children are purchase orders, delivery schedule and GRN. Finance children are vouchers, invoices and payments. Support children are help desk and contact support. Every existing child link and lock redirect remains. Mobile tab destinations are dashboard, profile, RFQs, auctions, purchase orders, vouchers, help desk and contact support, plus drawer access to full navigation.

## CSS interactions

- `src/index.css:2827–3236` defines all existing `.supplier-portal-dash .spd-*` selectors; specificity can override new single-class rules. Includes 96px fixed KPI cards, icon absolute positions, title/value height slots, caption hiding, desktop breakpoints and primary six-column grid at 1100px.
- Shared KPI styling starts at index.css:860 (`.kpi-card` and associated slots). Avoid changing it globally for this task.
- Shared shell classes start near index.css:1081: app-shell 100dvh and overflow hidden; main min-height/min-width zero; content owns vertical scrolling; desktop sidebar fixed full height and nav separately scrollable.
- index.css:222 locks body scroll for app shells. Check content width measurements, not just body overflow, because horizontal overflow is hidden globally.
- PageContainer adds global page-container styles; dashboard already uses `bare` (suppresses only automatic stack spacing).
- Sidebar/header are shared across supplier routes. Scope visual changes explicitly to dashboard to satisfy no redesign outside dashboard.

## Verification recommendation

- `npm run build` runs `tsc -b && vite build` (no dedicated typecheck script).
- `npm test -- <paths>` runs Vitest. Config uses node environment and discovers src/api/scripts tests. No existing SupplierDashboard or SupplierPortalLayout/Sidebar tests found; staff `Sidebar.test.ts` does not validate supplier shell.
- UI-only redesign most usefully verified by TypeScript/build, browser desktop/tablet/mobile checks, baseline-vs-after query/derivation/route audit and current real rendered KPI values. Adding implementation-mirroring tests is unnecessary.
- Existing nearby unit suite: `src/api/supplierPortalPO.test.ts` (three PO-filter tests); `src/pages/supplier-portal/SupplierPOPage.contractSequence.test.tsx` (unrelated contract workflow regression).
- Confirm all 6 KPI and quick-action links, 4 RFI links, top/header links, drawer/group navigation, RFQ/RFI/RFP routes, Orders, Finance, profile and logout handler wiring.
- Check 1440/1920 desktop, intermediate tablet and 390/320 mobile widths; recent panels stack, 6/3/2-column KPI layouts, no clipped action labels or document horizontal overflow. Long supplier name must not force header overflow.

## After-change code audit

Compared the three edited TSX files with the saved copies in this directory, using `git diff --no-index` and TypeScript AST/printer comparisons (comments excluded). No source changes were made by this audit.

- Entire `SupplierDashboard` function is identical, including all four queries, profile session updates, readiness/auth checks and locked/onboarding branch.
- All 15 unlocked data-source/count/sort derivation initializers are identical. RFI/KPI numeric expressions and route properties are preserved. SupplierMetric now receives each same `to` prop via spread and forwards it to Link.
- Six quick actions, four RFI routes, dynamic recent-row routes and view-all routes are preserved. RFQ company, PO formatted amount, status fallback text and dates are preserved in new markup. ActivityStatus only derives a CSS tone; displays the original status string.
- Layout LOCKED_PATH_PREFIXES, session/company/status/unlocked/supplier ID, notification query, unread count, locked redirect, content resolution and logout handler are AST-identical. New drawer focus/Escape behavior is dashboard-only presentation/accessibility behavior.
- Sidebar NAV, lock and active calculations, active helpers and entire SupplierPortalMobileNav function remain identical. Dashboard removes the duplicate mobile horizontal tabs in favor of the existing full drawer. New profile and footer Help links use existing destinations.
- New styles are scoped to `.supplier-dashboard` and `.supplier-dashboard-shell`; non-dashboard shared chrome keeps its existing visual branch.
- Existing narrow suite run: `npm test -- src/api/supplierPortalPO.test.ts` succeeded: 1 test file, 3 tests passed, process exit 0.
- No confirmed functional regressions found. Browser checks remain necessary for final spacing, overflow and visual behavior. Suggested extra narrow-width check: RFI Submitted cell at 320px due to its icon/text/count/padding width.
