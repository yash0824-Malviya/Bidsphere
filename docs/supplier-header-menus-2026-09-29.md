# Supplier Portal header entry points

## Changes

- Removed Profile and Support from desktop sidebar, mobile drawer, duplicate mobile navigation and sidebar footer.
- Kept Dashboard, Contracts, RFQs, RFIs, RFPs, Live Auctions, Orders and Finance, with their existing permissions and routes.
- Header order: Language, Notifications, Support, Supplier Profile, Logout. Tablet places Logout inside Profile; mobile also moves Language inside Profile.
- Profile menu includes Profile, the actual Account Status, Company Information and Logout. Profile/company links reuse `/supplier/profile`.
- Support menu includes Help & Support, Contact Support and Support Tickets. It reuses `/supplier/help-desk` and `/supplier/contact-support`; Support Tickets retains the existing dashboard Support Ticket destination. No new ticket system or page was created.
- Moved the existing Account Security entry to the Profile page, preserving access to `/supplier/security` without adding a fifth account-menu option.

## Files

- `src/pages/supplier-portal/SupplierPortalLayout.tsx`
- `src/pages/supplier-portal/SupplierPortalSidebar.tsx`
- `src/pages/supplier-portal/SupplierPortalProfilePage.tsx`
- `src/pages/supplier-portal/SupplierPortalHeaderActions.tsx`
- `src/pages/supplier-portal/SupplierPortalHeader.css`

## Verification

- `npm run build`: passed, with existing bundle-size warning.
- `npx eslint src/pages/supplier-portal/SupplierPortalHeaderActions.tsx`: passed without findings.
- Independent source comparison: supplier identity, session/account-status derivation, permission checks, notification query and refresh intervals, and the original logout handler are unchanged. Both Logout controls invoke that handler.
- Desktop 1440px: requested five actions visible in order; Profile and Support dropdowns show their requested entries; sidebar contains only eight business sections.
- Tablet 768px: Language, Notifications, Support and Profile visible; Logout is available inside Profile.
- Mobile 320px: Notifications, Support and Profile visible; header approximately 65px including border; header scroll width equals viewport width. Language selector opens inside Profile without exceeding viewport edges.
- Mobile drawer: only the eight business sections; Escape closes menus/drawer. Keyboard opening focuses Profile/Help first, rather than Logout.
- Live Profile and Contact Support navigation verified. Company data and saved Approved status display unchanged. Existing Account Security link remains accessible from Profile.
- Logout was checked through unchanged handler and callback wiring rather than ending the user's current authenticated session.

No API, authentication, permissions, profile form, support implementation, procurement workflow or stored data was changed. Baseline snapshots are in `tmp/supplier-header-before/`.
