# Inteva P2P

A modern Procure‑to‑Pay (P2P) frontend for ERPNext / Frappe, built with **React + Vite + TypeScript** and styled with **Tailwind CSS**. It provides a focused, opinionated UI on top of the standard ERPNext doctypes used in purchasing — Purchase Requisitions, Purchase Orders, Goods Receipts, Invoices, Payments — plus suppliers, sourcing, contracts, budgets, inventory and assets.

---

## Features

- **Dashboard** — KPIs (open PRs/POs, pending GRNs, overdue invoices), monthly spend bar chart, top‑5 supplier donut, recent activity, and quick actions.
- **P2P core** — Requisitions, Purchase Orders, Goods Receipts (GRN), Invoices, Payments. List + detail + create flows with filters, status badges, totals, progress bars and activity timelines.
- **Supplier management** — Card grid catalogue, supplier detail with tabs (Overview, POs, Invoices, Contacts, Documents) and onboarding form.
- **Strategic sourcing (RFx)** — RFQ list, multi‑supplier RFQ creation, side‑by‑side quotation comparison, one‑click PO from a winning quote.
- **Budget** — Summary cards, budget vs. actual bar chart by cost center, variance table with utilization bars, and a header alert banner when any budget is at 80%+.
- **Contracts** — Date‑driven status badges (Active / Expiring Soon / Expired), expiry filter, contract detail with terms, renewal alert and linked POs.
- **Inventory** — Item catalog with multi‑warehouse on‑hand totals, reorder badge, item detail with per‑warehouse stock and the latest 50 stock ledger entries.
- **Assets** — Status‑mapped asset register (In Use / Under Maintenance / Disposed) with category and location filters.
- **Global header** — Persistent search across suppliers, POs, invoices and PRs; notifications bell aggregating budget, contract and invoice alerts.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Build | Vite 8 |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS 3 with a custom green theme |
| Routing | react-router-dom 7 |
| Data fetching | @tanstack/react-query 5 |
| State (auth) | zustand 5 with `persist` |
| HTTP | axios with response/error interceptors |
| Charts | recharts 3 |
| Icons | lucide-react |
| Notifications | react-hot-toast |
| Dates | date-fns |

---

## Setup

### 1. Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm 9+ (or pnpm/yarn — instructions below use npm)
- An ERPNext instance you can connect to. Either:
  - A self‑hosted Frappe site running on `http://localhost:8081` (the default proxy target), or
  - A Frappe Cloud / hosted instance accessible over HTTPS.

You also need an **ERPNext API key + secret** for the user that the app will impersonate. In ERPNext:

1. Open the user record.
2. Scroll to **API Access** and click **Generate Keys**.
3. Save the API key and secret somewhere safe (the secret is shown only once).

### 2. Clone & install

```bash
git clone <your-repo-url> inteva-p2p
cd inteva-p2p
npm install
```

### 3. Environment variables

Copy the example file and fill in the values you need:

```bash
cp .env.example .env
```

```env
# .env

# Where the Vite dev server forwards /api/* requests. Required only if you're
# running ERPNext somewhere other than http://localhost:8081 (e.g. Frappe Cloud).
VITE_PROXY_TARGET=http://localhost:8081

# Optional pre-fills for the login screen. Leave blank to type credentials manually.
VITE_API_KEY=your_api_key_here
VITE_API_SECRET=your_api_secret_here

# Optional company filter (e.g. used by the Budget page).
VITE_COMPANY=Inteva Products LLC

# Anthropic Claude API key — required only for the Smart RFQ "AI Recommendation"
# panel. WARNING: this key is used directly from the browser, so anyone with
# DevTools open can read it. See the Smart RFQ section below before deploying
# this anywhere except an internal staging environment.
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

> All requests from the SPA go to the **same origin** (`/api/*`). In dev that's the Vite server, which proxies to `VITE_PROXY_TARGET`. There is no `VITE_ERPNEXT_URL` — the URL is no longer entered on the login screen because hitting ERPNext directly from the browser triggers CORS.

### 4. Run

```bash
npm run dev
```

Then visit `http://localhost:5173`. Sign in with the URL / API key / API secret. Credentials are persisted to `localStorage` for the browser session; there is no separate backend.

### 5. Production build

```bash
npm run build      # type-checks then builds to dist/
npm run preview    # serves the production build locally
```

---

## Configuring for Frappe Cloud (or any hosted instance)

The SPA always issues requests against its own origin (`/api/*`) — never directly against ERPNext. This avoids CORS in **every** environment, but it does mean the SPA needs to be served from somewhere that forwards `/api` to ERPNext.

### Development

Just point the dev proxy at the hosted instance:

```env
# .env
VITE_PROXY_TARGET=https://your-site.frappe.cloud
```

Restart `npm run dev`. The browser still hits `http://localhost:5175/api/...`; Vite forwards each call to `https://your-site.frappe.cloud/api/...`. No CORS, no preflight, no `allow_cors` configuration needed on the ERPNext side.

### Production

You have two clean options for production deployments:

**A. Reverse proxy in front of the static build (recommended).** Deploy the `dist/` folder behind any HTTP server that can rewrite `/api/*` to your ERPNext host. nginx example:

```nginx
server {
  listen 443 ssl;
  server_name app.example.com;
  root /var/www/inteva-p2p/dist;
  index index.html;

  location /api/ {
    proxy_pass https://your-site.frappe.cloud;
    proxy_set_header Host your-site.frappe.cloud;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

The browser still talks to `app.example.com`. CORS never enters the picture.

**B. Serve from inside ERPNext.** Build the SPA, drop `dist/` into a custom Frappe app's `public/` folder, and serve it from the same hostname as ERPNext. The `/api/*` calls hit ERPNext directly because they're same-origin.

### Generate API keys

In ERPNext (Frappe Cloud or self-hosted): open the user's record → **API Access** → **Generate Keys**. The client sends `Authorization: token <api_key>:<api_secret>` exactly as Frappe expects.

---

## Module overview

| Module | Routes | Purpose |
| --- | --- | --- |
| **Dashboard** | `/dashboard` | KPIs, monthly spend chart, top‑5 supplier donut, recent activity, quick actions. |
| **P2P Core** | `/p2p/requisitions`, `/p2p/purchase-orders`, `/p2p/grn`, `/p2p/invoices`, `/p2p/payments` (+ `/new` and `/:name` for each) | Procurement transaction lifecycle from requisition → PO → GRN → invoice → payment. |
| **Suppliers** | `/suppliers`, `/suppliers/new`, `/suppliers/:name` | Supplier master, onboarding form, multi‑tab supplier 360. |
| **Sourcing (RFx)** | `/sourcing/rfq`, `/sourcing/rfq/new`, `/sourcing/rfq/:id` | Smart RFQ — 3‑step wizard, per‑supplier quotation entry, color‑coded comparison and **Anthropic Claude** AI recommendation. |
| **Budget** | `/budget` | Summary cards, recharts bar chart, variance table with utilization meter; powers the budget alert banner. |
| **Contracts** | `/contracts`, `/contracts/:name` | Date‑driven status, expiring filter, contract detail with terms / linked POs / renewal alert. |
| **Inventory** | `/inventory`, `/inventory/:code` | Item catalog with stock totals, reorder badge, per‑warehouse stock and stock ledger. |
| **Assets** | `/assets` | Asset register with status mapping and category/location filters. |

### Cross‑cutting

| Component | Where | Purpose |
| --- | --- | --- |
| `BudgetAlertBanner` | `MainLayout` (every page) | Header banner when any budget is at 80%+ utilization. Click → `/budget`. |
| `GlobalSearch` | `Header` | ⌘K / Ctrl+K opens a debounced multi‑doctype search across suppliers, POs, invoices, requisitions. |
| `NotificationsBell` | `Header` | Aggregates budget alerts, expiring contracts (≤30 days) and overdue invoices into one dropdown. |
| `ProtectedRoute` | `App` | Redirects unauthenticated users to `/login`. |
| `components/ui/*` | Anywhere | Reusable primitives: `StatusBadge`, `StatCard`, `DataTable`, `PageHeader`, `EmptyState`, `LoadingSkeleton`, `ConfirmDialog`. |

---

## ERPNext doctypes used per module

| Module | Primary doctypes | Method calls |
| --- | --- | --- |
| **Authentication** | `User` | `frappe.auth.get_logged_user`, `/api/resource/User/<email>` |
| **Dashboard** | `Purchase Requisition`, `Purchase Order`, `Purchase Receipt`, `Purchase Invoice` | `frappe.client.get_count`, list endpoints |
| **P2P — Requisitions** | `Purchase Requisition`, `Purchase Requisition Item`, `Cost Center`, `Item`, `UOM` | `frappe.client.submit` |
| **P2P — Purchase Orders** | `Purchase Order`, `Purchase Order Item`, `Supplier`, `Item` | `frappe.client.submit` |
| **P2P — GRN** | `Purchase Receipt`, `Purchase Receipt Item`, `Purchase Order` | `frappe.client.submit` |
| **P2P — Invoices** | `Purchase Invoice`, `Purchase Invoice Item`, `Purchase Receipt`, `Purchase Order` | `frappe.client.submit` |
| **P2P — Payments** | `Payment Entry`, `Payment Entry Reference`, `Purchase Invoice` | `frappe.client.submit` |
| **Suppliers** | `Supplier`, `Supplier Group`, `Address`, `Contact`, `Country`, `Payment Term` | — |
| **Sourcing (RFx) — Smart RFQ** | `Request for Quotation` (+ child `Item` / `Supplier`), `Supplier Quotation` (+ child `Item`), `Item`, `Purchase Order` (PO‑count metric) | `frappe.client.submit`; **Anthropic Claude** (`claude-sonnet-4-5-20250929`) for `AIRecommendation` |
| **Budget** | `Budget`, `Budget Account`, `Cost Center`, `Account`, `Fiscal Year` | `erpnext.accounts.utils.get_balance_on` |
| **Contracts** | `Contract`, `Purchase Order` (linked POs by supplier within window) | — |
| **Inventory** | `Item`, `Item Group`, `Bin`, `Stock Ledger Entry` | — |
| **Assets** | `Asset`, `Asset Category`, `Location` | — |

> The `Contract` doctype ships with stock ERPNext but isn't always enabled per site — the contracts pages handle a missing doctype gracefully with an error state and retry.

---

## Smart RFQ (AI Recommendation)

The Sourcing module ships a **3-page Smart RFQ** flow:

1. **`/sourcing/rfq`** — list of every RFQ with date, item count, supplier count, status and the best-priced supplier hint.
2. **`/sourcing/rfq/new`** — 3-step wizard:
   - *RFQ Details*: title, valid-till, terms.
   - *Add Items*: `ItemPicker`-driven rows pulled from `/api/resource/Item`.
   - *Select Suppliers*: searchable cards with past PO count, multi-select (min 2).
3. **`/sourcing/rfq/:id`** — RFQ header, per-supplier inline quotation entry, color-coded comparison table (lowest = green, highest = red, lowest total bold green), and an **AI Recommendation panel**.

### AI Recommendation panel

The "Get AI Recommendation" button calls Anthropic Claude **directly from the browser**:

```
POST https://api.anthropic.com/v1/messages
model: claude-sonnet-4-5-20250929
system: "You are a procurement specialist AI. Analyze supplier quotations …"
```

Claude returns a structured JSON `AIRecommendation` (recommended supplier, confidence, reason, cost savings, risk factors and per-item recommendation). The panel renders:

- The recommended supplier with a confidence badge.
- A green cost-savings tile.
- Orange chips for each risk factor.
- A per-item recommendation table.
- A **Create PO with Recommended Supplier** button that pre-fills `/p2p/purchase-orders/new` via `sessionStorage`.

### ⚠️ Security note about `VITE_ANTHROPIC_API_KEY`

The Anthropic call lives in `src/api/ai.ts`. **The key is bundled into the browser**, so anyone with DevTools can extract it. That's fine for an internal staging tool but **must not** ship to a public production deployment. For production:

1. Move `getAIRecommendation` server-side (e.g. an Express/Cloud Function endpoint).
2. Read the key from a secret manager.
3. Validate the user is authenticated to your SPA before forwarding the request.
4. Update `src/api/ai.ts` to call your own endpoint — the function signature does not need to change.

### Optional ERPNext schema tweaks

Two non-standard fields make the comparison flow round-trip cleanly:

| Doctype | Field | Type | Purpose |
| --- | --- | --- | --- |
| Request for Quotation | `valid_till` | Date | Surfaced as "Valid Till" on the wizard and detail page. |
| Supplier Quotation | `rfq_no` | Link → Request for Quotation | Filter `getSupplierQuotations(rfqName)`. |

If you don't add them, the UI still works — `valid_till` simply won't display on existing RFQs, and the comparison table will start empty (you'll re-enter quotations once per browser session).

---

## Project structure

```
inteva-p2p/
├── public/
├── src/
│   ├── api/                 # Axios + typed service layer
│   │   ├── erpnext.ts       # axios instance, auth, list/url helpers, getCount
│   │   ├── supplier.ts
│   │   ├── purchasing.ts    # PR / PO / RFQ / Receipt
│   │   ├── sourcing.ts      # Smart RFQ — RFQ + Supplier Quotation + Item search
│   │   ├── ai.ts            # Anthropic Claude — AI recommendation
│   │   ├── accounts.ts      # Invoice / Payment Entry
│   │   └── budget.ts        # Budget / Cost Center
│   ├── components/
│   │   ├── ui/              # StatusBadge, StatCard, DataTable, PageHeader,
│   │   │                    # EmptyState, LoadingSkeleton, ConfirmDialog
│   │   ├── layout/          # MainLayout, Sidebar, Header
│   │   ├── BudgetAlertBanner.tsx
│   │   ├── GlobalSearch.tsx
│   │   ├── NotificationsBell.tsx
│   │   ├── ItemPicker.tsx
│   │   ├── SupplierMultiPicker.tsx
│   │   ├── Tabs.tsx
│   │   └── ProtectedRoute.tsx
│   ├── hooks/
│   │   ├── useBudgetAlerts.ts
│   │   └── useDebounce.ts
│   ├── pages/
│   │   ├── auth/            # LoginPage
│   │   ├── dashboard/       # DashboardPage
│   │   ├── p2p/             # Requisitions, POs, GRN, Invoices, Payments
│   │   ├── supplier/        # SuppliersPage, SupplierDetail, NewSupplier
│   │   ├── sourcing/        # RFQListPage, NewRFQPage (3-step), RFQDetailPage
│   │   ├── budget/          # BudgetPage
│   │   ├── contract/        # ContractsPage, ContractDetail
│   │   ├── inventory/       # InventoryPage, ItemDetail
│   │   └── assets/          # AssetsPage
│   ├── store/               # zustand stores (authStore)
│   ├── types/               # ERPNext doctype interfaces
│   ├── utils/               # routes, format helpers
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── .env.example
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts           # includes /api proxy for local dev
└── package.json
```

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts Vite dev server on `http://localhost:5173` with the `/api` proxy. |
| `npm run build` | Type-checks (`tsc -b`) and produces an optimized `dist/`. |
| `npm run preview` | Serves the production build locally for verification. |
| `npm run lint` | Runs ESLint over the project. |

---

## Conventions

- **Read APIs**: every list/detail page fetches via `react-query` with stable `queryKey`s, allowing automatic caching, background refresh and request deduplication.
- **Write APIs**: every form uses controlled React state and surfaces feedback through `react-hot-toast`. Doc submission goes through `frappe.client.submit` so ERPNext workflow rules and validations are honored.
- **Loading**: every async surface renders a `Skeleton` / `TableSkeleton` while loading; errors render an `ErrorState` with a retry button; empty lists render an `EmptyState`.
- **Statuses**: ERPNext status strings are mapped to colored `StatusBadge` tones in one place (`src/components/StatusBadge.tsx`). Date‑driven statuses (e.g. contracts, invoices, assets) are derived from the dates rather than the raw status field, so the UI stays accurate even if the backend hasn't yet flipped a flag.
- **Theming**: the green palette is defined in `tailwind.config.js`. Stick to `primary-*`, `accent-*`, `warning-*`, `danger-*`, `neutral-*` for new components.

---

## Troubleshooting

**`401 Unauthorized` on every request** — your API key/secret is wrong or the user is disabled. Regenerate the keys and re‑login.

**`CORS`-related errors against a hosted ERPNext** — the host hasn't whitelisted the app origin. Set `allow_cors` in the site config (see "Configuring for Frappe Cloud").

**Charts missing on the dashboard / budget page** — there are no submitted Purchase Invoices in the last 6 months yet, or no Budget records exist. The pages render an empty state by design.

**`frappe.client.get_count` returns `0` for everything** — the user lacks read permission on those doctypes. Either grant the role or use a service account with **System Manager** / **Purchase Manager** roles.

**The `Contract` doctype doesn't exist** — some ERPNext deployments disable it. The contracts pages will surface an error state with a retry button; everything else continues to work.
#   N e t l i n k  
 