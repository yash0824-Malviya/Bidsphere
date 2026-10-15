# Supplier Portal shared layout — 2026-09-29

## Cause and correction

Supplier routes already used one parent layout, but that layout applied the new sidebar stylesheet and 240px width only to Dashboard. Other pages used the old 280px sidebar and a separate mobile navigation bar. Route-level session revalidation also unmounted the shell, and a pathname key remounted header controls.

The shared layout now uses the current Dashboard sidebar/header styling on every authenticated supplier route. Navigation groups open their existing landing pages; separate disclosure buttons preserve access to their existing child links. Active navigation recognizes RFQ, quotation and PO detail paths. Profile and Support remain in the shared header.

Session validation and rejection rules are unchanged. Once a supplier session has passed verification, revalidation retains the shell but withholds page content, notification queries and the auction notifier until the same existing check succeeds. Initial verification still blocks the whole layout.

## Files changed for this request

- `src/pages/supplier-portal/SupplierPortalLayout.tsx`: shared width, header, drawer and content gating; remove alternate mobile navigation and pathname key.
- `src/pages/supplier-portal/SupplierPortalSidebar.tsx`: common account block, section headings, footer/version and group navigation.
- `src/pages/supplier-portal/SupplierPortalShell.css`: renamed from `SupplierDashboardShell.css`; scope current Dashboard styling to all supplier pages; reserve scrollbar space to prevent width shifts.
- `src/pages/supplier-portal/supplierPortalNavigation.ts`: route matching for existing canonical/detail paths and aliases.
- `src/pages/supplier-portal/supplierPortalNavigation.test.ts`: 31 navigation regression cases.
- `src/components/SupplierPortalGuard.tsx`: preserve the verified shell during existing route revalidation.
- `src/components/SupplierPortalGuard.test.tsx`: 8 cases rendering the actual layout, including protection during verification and rejected sessions.
- `src/App.tsx`: aliases for `/supplier/live-auctions`, `/supplier/orders` and `/supplier/finance` redirect to existing protected destinations. Existing canonical routes remain intact.

No APIs, database records, authentication decisions, permissions or procurement workflows were changed. Dashboard content TSX/CSS hashes match the pre-change originals.

## Verification

- `npm test -- src/pages/supplier-portal/supplierPortalNavigation.test.ts src/components/SupplierPortalGuard.test.tsx src/api/supplierPortalPO.test.ts`: **42 passed** across 3 files.
- `npm run build`: **passed**. Existing large-chunk advisory remains.
- Scoped `git diff --check`: **passed**.
- Authenticated browser sequence: Dashboard → Contracts → RFQs → RFIs → RFPs → Live Auctions → Orders → Finance → Dashboard: **passed**.
- Every desktop page measured a 240px sidebar, 65px header including border, 32px outer content inset and identical background. Correct active item on every page; expanded sidebar state persisted across navigation. No desktop main-area horizontal overflow in these checks.
- RFQ `PUR-RFQ-2026-00104` and PO `PUR-ORD-2026-00028` detail pages retained the shell and highlighted RFQs/Orders respectively.
- Support and Profile menus opened on PO detail with existing actions/routes.
- At 320px, the shared drawer opened from a non-Dashboard page, navigated to Contracts, closed after navigation, and restored focus on Escape. Contracts had no page-level horizontal overflow. Existing wide PO detail content was not redesigned.
- All three alias URLs resolved to their existing protected canonical pages.
- Browser console error log was empty at the end of verification.
- Temporary viewport overrides were reset and the browser returned to Dashboard.

Proof: `tmp/supplier-shared-shell-contracts.png`, `tmp/supplier-shared-shell-mobile.png`, and `tmp/supplier-shared-shell-checks.json`.
