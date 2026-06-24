import { lazy, Suspense, useEffect, useRef } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";

import { isDocNotFoundError } from "./api/erpnext";
import { pullVoucherStore, pushVoucherStore } from "./api/voucherSync";
import { runVoucherStoreMigration } from "./api/vouchers";
import { cleanupOversizedLegalDocs } from "./api/legalDocs";
import { useVoucherSyncStore } from "./store/voucherSyncStore";

import ErrorBoundary from "./components/ErrorBoundary";
import MainLayout from "./components/layout/MainLayout";
import Placeholder from "./components/Placeholder";
import ProtectedRoute from "./components/ProtectedRoute";

// Eager — first-paint critical routes. Per the performance policy these are
// NOT lazy loaded so the primary workspace renders without a chunk fetch.
import DashboardPage from "./pages/dashboard/DashboardPage";
import RFQListPage from "./pages/sourcing/RFQListPage";

// Lazy — every other route is code-split into its own chunk so the initial
// bundle no longer ships the entire app (3D login hero, charts, PDF, etc.).
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));

const RequisitionsPage = lazy(() => import("./pages/p2p/RequisitionsPage"));
const NewRequisitionPage = lazy(() => import("./pages/p2p/NewRequisitionPage"));
const RequisitionDetailPage = lazy(
  () => import("./pages/p2p/RequisitionDetailPage")
);
const PurchaseOrdersPage = lazy(() => import("./pages/p2p/PurchaseOrdersPage"));
const NewPOQueuePage = lazy(() => import("./pages/p2p/NewPOQueuePage"));
const RFQtoPOConversionPage = lazy(() => import("./pages/p2p/RFQtoPOConversionPage"));
const NewPurchaseOrderPage = lazy(
  () => import("./pages/p2p/NewPurchaseOrderPage")
);
const PurchaseOrderDetailPage = lazy(
  () => import("./pages/p2p/PurchaseOrderDetailPage")
);
const GRNPage = lazy(() => import("./pages/p2p/GRNPage"));
const GRNDetailPage = lazy(() => import("./pages/p2p/GRNDetailPage"));
const NewGRNPage = lazy(() => import("./pages/p2p/NewGRNPage"));
const InvoiceListPage = lazy(() => import("./pages/invoices/InvoiceListPage"));
const InvoiceDetailRoutePage = lazy(
  () => import("./pages/invoices/InvoiceDetailRoutePage")
);
const PaymentsPage = lazy(() => import("./pages/p2p/PaymentsPage"));
const NewPaymentPage = lazy(() => import("./pages/p2p/NewPaymentPage"));
const PaymentDetailPage = lazy(() => import("./pages/p2p/PaymentDetailPage"));
const PaymentProcessingPage = lazy(
  () => import("./pages/payments/PaymentProcessingPage")
);
const P2PIndexRedirect = lazy(() => import("./pages/p2p/P2PIndexRedirect"));

const VouchersPage = lazy(() => import("./pages/vouchers/VouchersPage"));
const CreateVoucherPage = lazy(() => import("./pages/vouchers/CreateVoucherPage"));
const VoucherDetailPage = lazy(() => import("./pages/vouchers/VoucherDetailPage"));

const SuppliersPage = lazy(() => import("./pages/supplier/SuppliersPage"));
const NewSupplierPage = lazy(() => import("./pages/supplier/NewSupplierPage"));
const SupplierDetailPage = lazy(() => import("./pages/supplier/SupplierDetailPage"));

const NewRFQPage = lazy(() => import("./pages/sourcing/NewRFQPage"));
const RFQDetailPage = lazy(() => import("./pages/sourcing/RFQDetailPage"));
const RFQTemplatesPage = lazy(() => import("./pages/sourcing/RFQTemplatesPage"));
const LegalReviewsPage = lazy(() => import("./pages/sourcing/LegalReviewsPage"));
const LegalReviewDetailPage = lazy(() => import("./pages/legal/LegalReviewDetailPage"));
const LegalReviewsListPage = lazy(() => import("./pages/legal/LegalReviewsListPage"));
const FinanceReviewDetailPage = lazy(() => import("./pages/finance/FinanceReviewDetailPage"));

const SupplierLoginPage = lazy(
  () => import("./pages/supplier-portal/SupplierLoginPage")
);
const SupplierDashboard = lazy(
  () => import("./pages/supplier-portal/SupplierDashboard")
);
const SupplierRFQPage = lazy(
  () => import("./pages/supplier-portal/SupplierRFQPage")
);
const SupplierLegalUploadPage = lazy(
  () => import("./pages/supplier-portal/SupplierLegalUploadPage")
);
const SupplierPOPage = lazy(
  () => import("./pages/supplier-portal/SupplierPOPage")
);
const SupplierRFQsPage = lazy(
  () => import("./pages/supplier-portal/SupplierRFQsPage")
);
const SupplierQuotationsPage = lazy(
  () => import("./pages/supplier-portal/SupplierQuotationsPage")
);
const SupplierQuotationDetailPage = lazy(
  () => import("./pages/supplier-portal/SupplierQuotationDetailPage")
);
const SupplierPOListPage = lazy(
  () => import("./pages/supplier-portal/SupplierPOListPage")
);
const SupplierDeliverySchedulePage = lazy(
  () => import("./pages/supplier-portal/SupplierDeliverySchedulePage")
);
const SupplierGRNListPage = lazy(
  () => import("./pages/supplier-portal/SupplierGRNListPage")
);
const SupplierGRNDetailPage = lazy(
  () => import("./pages/supplier-portal/SupplierGRNDetailPage")
);
const SupplierInvoiceListPage = lazy(
  () => import("./pages/supplier-portal/SupplierInvoiceListPage")
);
const SupplierInvoiceDetailPage = lazy(
  () => import("./pages/supplier-portal/SupplierInvoiceDetailPage")
);
const SupplierPaymentListPage = lazy(
  () => import("./pages/supplier-portal/SupplierPaymentListPage")
);
const SupplierPaymentDetailPage = lazy(
  () => import("./pages/supplier-portal/SupplierPaymentDetailPage")
);
const SupplierVoucherListPage = lazy(
  () => import("./pages/supplier-portal/SupplierVoucherListPage")
);
const SupplierVoucherDetailPage = lazy(
  () => import("./pages/supplier-portal/SupplierVoucherDetailPage")
);
const SupplierHelpDeskPage = lazy(
  () => import("./pages/supplier-portal/SupplierHelpDeskPage")
);
const SupplierContactSupportPage = lazy(
  () => import("./pages/supplier-portal/SupplierContactSupportPage")
);

const InventoryPage = lazy(() => import("./pages/inventory/InventoryPage"));
const ItemDetailPage = lazy(() => import("./pages/inventory/ItemDetailPage"));

const AdminDashboardPage = lazy(() => import("./pages/admin/AdminDashboardPage"));
const UserManagementPage = lazy(() => import("./pages/admin/UserManagementPage"));
const RoleManagementPage = lazy(() => import("./pages/admin/RoleManagementPage"));
const AuditTrailPage = lazy(() => import("./pages/admin/AuditTrailPage"));
const ProcurementAuditPage = lazy(() => import("./pages/admin/ProcurementAuditPage"));
const WorkflowManagementPage = lazy(() => import("./pages/admin/WorkflowManagementPage"));
const ReportsPage = lazy(() => import("./pages/admin/ReportsPage"));
const SystemSettingsPage = lazy(() => import("./pages/admin/SystemSettingsPage"));
const AccessLogsPage = lazy(() => import("./pages/admin/AccessLogsPage"));
const SecuritySettingsPage = lazy(() => import("./pages/admin/SecuritySettingsPage"));
const ProcurementOverviewPage = lazy(() => import("./pages/admin/ProcurementOverviewPage"));
const SupplierOverviewPage = lazy(() => import("./pages/admin/SupplierOverviewPage"));
const InventoryOverviewPage = lazy(() => import("./pages/admin/InventoryOverviewPage"));
const BudgetControlPage = lazy(() => import("./pages/admin/BudgetControlPage"));
const IntegrationsPage = lazy(() => import("./pages/admin/IntegrationsPage"));
const HelpDeskPage = lazy(() => import("./pages/support/HelpDeskPage"));
const BudgetDashboardPage = lazy(() => import("./pages/budget/BudgetDashboardPage"));
const BudgetPlansPage = lazy(() => import("./pages/budget/BudgetPlansPage"));
const BudgetMonitoringPage = lazy(() => import("./pages/budget/BudgetMonitoringPage"));
const BudgetApprovalsPage = lazy(() => import("./pages/budget/BudgetApprovalsPage"));
const FinanceReviewsPage = lazy(() => import("./pages/budget/FinanceReviewsPage"));
const NotificationCenterPage = lazy(() => import("./pages/notifications/NotificationCenterPage"));
import { useAuthStore } from "./store/authStore";
import { getRFQSchema } from "./api/rfqSchema";

/** Lightweight fallback shown while a lazily-loaded route chunk downloads. */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isDocNotFoundError(error)) return false;
        return failureCount < 1;
      },
      retryDelay: 2_000,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60_000,
      gcTime: 10 * 60_000,
    },
  },
});

function AuthBootstrap() {
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void checkAuth();
  }, [checkAuth]);

  return null;
}

function RFQSchemaBootstrap() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    getRFQSchema().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[RFQSchema] Schema fetch failed (non-fatal):", err);
    });
    cleanupOversizedLegalDocs();
  }, []);

  return null;
}

/**
 * Keeps the voucher/invoice/payment store in sync with the shared ERPNext
 * backend so localhost and ngrok (and any other device) show identical
 * workflow state. Pulls on load and whenever the tab regains focus; bumps the
 * version + invalidates dependent queries so stale "Awaiting Voucher Creation"
 * rows refresh immediately.
 */
function VoucherStoreSync() {
  const queryClient = useQueryClient();
  const bump = useVoucherSyncStore((s) => s.bump);
  const setHydrated = useVoucherSyncStore((s) => s.setHydrated);

  useEffect(() => {
    let active = true;

    // One-time migration: purge stale demo/test voucher data that may have
    // accumulated in localStorage during development.
    const purged = runVoucherStoreMigration();

    const sync = async () => {
      // If we just purged stale data, push the empty store to the shared
      // ERPNext Note so every device converges on a clean state.
      if (purged) {
        await pushVoucherStore();
      }

      const changed = await pullVoucherStore();
      if (!active) return;
      setHydrated();
      if (changed || purged) {
        bump();
        void queryClient.invalidateQueries({
          predicate: (q) =>
            /invoice|voucher|payment|dashboard/i.test(
              String(q.queryKey[0] ?? "")
            ),
        });
      }
    };
    void sync();
    const onFocus = () => void sync();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [bump, setHydrated, queryClient]);

  return null;
}

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthBootstrap />
        <RFQSchemaBootstrap />
        <VoucherStoreSync />
        <Toaster position="top-right" />
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/*
            Public Supplier Portal — these routes sit OUTSIDE the
            ProtectedRoute / MainLayout chrome. Suppliers share a single
            entry point (`/supplier/login`), pick their company from a
            dropdown, and authenticate with a portal PIN. Each page below
            independently checks `sessionStorage.supplier_session`.
          */}
          <Route path="/supplier/login" element={<SupplierLoginPage />} />
          <Route path="/supplier/dashboard" element={<SupplierDashboard />} />
          <Route path="/supplier/rfqs" element={<SupplierRFQsPage />} />
          <Route path="/supplier/quotations" element={<SupplierQuotationsPage />} />
          <Route path="/supplier/quotations/:id" element={<SupplierQuotationDetailPage />} />
          <Route path="/supplier/quotation/:sqName/legal-docs" element={<SupplierLegalUploadPage />} />
          <Route path="/supplier/purchase-orders" element={<SupplierPOListPage />} />
          <Route path="/supplier/delivery-schedule" element={<SupplierDeliverySchedulePage />} />
          <Route path="/supplier/grn" element={<SupplierGRNListPage />} />
          <Route path="/supplier/grn/:id" element={<SupplierGRNDetailPage />} />
          <Route path="/supplier/invoices" element={<SupplierInvoiceListPage />} />
          <Route
            path="/supplier/invoices/:id"
            element={<SupplierInvoiceDetailPage />}
          />
          <Route path="/supplier/payments" element={<SupplierPaymentListPage />} />
          <Route
            path="/supplier/payments/:id"
            element={<SupplierPaymentDetailPage />}
          />
          <Route path="/supplier/vouchers" element={<SupplierVoucherListPage />} />
          <Route
            path="/supplier/vouchers/:id"
            element={<SupplierVoucherDetailPage />}
          />
          <Route path="/supplier/help-desk" element={<SupplierHelpDeskPage />} />
          <Route
            path="/supplier/contact-support"
            element={<SupplierContactSupportPage />}
          />
          <Route path="/supplier/rfq/:rfqName" element={<SupplierRFQPage />} />
          <Route path="/supplier/po/:poName" element={<SupplierPOPage />} />

          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />

            {/* P2P Core */}
            <Route path="/p2p" element={<P2PIndexRedirect />} />
            <Route path="/p2p/requisitions" element={<RequisitionsPage />} />
            <Route
              path="/p2p/requisitions/new"
              element={<NewRequisitionPage />}
            />
            <Route
              path="/p2p/requisitions/:name"
              element={<RequisitionDetailPage />}
            />

            <Route
              path="/p2p/purchase-orders"
              element={<PurchaseOrdersPage />}
            />
            <Route
              path="/p2p/purchase-orders/create"
              element={<NewPOQueuePage />}
            />
            <Route
              path="/p2p/purchase-orders/convert/:rfqId"
              element={<RFQtoPOConversionPage />}
            />
            <Route
              path="/p2p/purchase-orders/new"
              element={<NewPurchaseOrderPage />}
            />
            <Route
              path="/p2p/purchase-orders/:name"
              element={<PurchaseOrderDetailPage />}
            />

            <Route path="/p2p/grn" element={<GRNPage />} />
            <Route path="/p2p/grn/new" element={<NewGRNPage />} />
            <Route path="/p2p/grn/:id" element={<GRNDetailPage />} />

            <Route path="/p2p/vouchers" element={<VouchersPage />} />
            <Route path="/p2p/vouchers/new" element={<CreateVoucherPage />} />
            <Route path="/p2p/vouchers/:id" element={<VoucherDetailPage />} />

            <Route path="/p2p/invoices" element={<InvoiceListPage />} />
            <Route
              path="/p2p/invoices/:id"
              element={<InvoiceDetailRoutePage />}
            />

            <Route path="/p2p/payments" element={<PaymentsPage />} />
            <Route path="/p2p/payments/new" element={<NewPaymentPage />} />
            <Route path="/p2p/payments/:id" element={<PaymentDetailPage />} />
            <Route
              path="/payments/process/:invoiceId"
              element={<PaymentProcessingPage />}
            />

            {/* Suppliers */}
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/suppliers/new" element={<NewSupplierPage />} />
            <Route path="/suppliers/:name" element={<SupplierDetailPage />} />

            {/* Sourcing — Smart RFQ */}
            <Route
              path="/sourcing"
              element={<Navigate to="/sourcing/rfq" replace />}
            />
            <Route path="/sourcing/rfq" element={<RFQListPage />} />
            <Route path="/sourcing/rfq/new" element={<NewRFQPage />} />
            <Route path="/sourcing/rfq/:id" element={<RFQDetailPage />} />
            <Route path="/sourcing/rfq-templates" element={<RFQTemplatesPage />} />
            <Route path="/sourcing/legal-reviews" element={<LegalReviewsPage />} />
            <Route path="/legal/reviews/:rfqId" element={<LegalReviewDetailPage />} />
            <Route path="/legal/reviews" element={<LegalReviewsListPage />} />
            <Route path="/legal/review/:sqName" element={<LegalReviewDetailPage />} />

            {/* Budget — finance & admin */}
            <Route path="/budget" element={<BudgetDashboardPage />} />
            <Route path="/budget/plans" element={<BudgetPlansPage />} />
            <Route path="/budget/monitoring" element={<BudgetMonitoringPage />} />
            <Route path="/budget/approvals" element={<BudgetApprovalsPage />} />
            <Route path="/budget/pending-reviews" element={<FinanceReviewsPage />} />
            <Route path="/finance/reviews/:rfqId" element={<FinanceReviewDetailPage />} />
            <Route path="/contracts" element={<Navigate to="/dashboard" replace />} />
            <Route path="/contracts/:name" element={<Navigate to="/dashboard" replace />} />
            <Route path="/assets" element={<Navigate to="/dashboard" replace />} />

            {/* Admin */}
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/users" element={<UserManagementPage />} />
            <Route path="/admin/roles" element={<RoleManagementPage />} />
            <Route path="/admin/procurement" element={<ProcurementOverviewPage />} />
            <Route path="/admin/suppliers" element={<SupplierOverviewPage />} />
            <Route path="/admin/inventory" element={<InventoryOverviewPage />} />
            <Route path="/admin/budget" element={<BudgetControlPage />} />
            <Route path="/admin/audit-trail" element={<AuditTrailPage />} />
            <Route path="/admin/procurement-audit" element={<ProcurementAuditPage />} />
            <Route path="/admin/workflows" element={<WorkflowManagementPage />} />
            <Route path="/admin/reports" element={<ReportsPage />} />
            <Route path="/admin/access-logs" element={<AccessLogsPage />} />
            <Route path="/admin/security-settings" element={<SecuritySettingsPage />} />
            <Route path="/admin/settings" element={<SystemSettingsPage />} />
            <Route path="/admin/integrations" element={<IntegrationsPage />} />

            {/* Inventory */}
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/:code" element={<ItemDetailPage />} />

            {/* Notifications */}
            <Route path="/notifications" element={<NotificationCenterPage />} />

            {/* Support */}
            <Route
              path="/support"
              element={<Navigate to="/support/help-desk" replace />}
            />
            {/* About has been retired — redirect any old links to Dashboard. */}
            <Route
              path="/support/about"
              element={<Navigate to="/dashboard" replace />}
            />
            <Route path="/support/help-desk" element={<HelpDeskPage />} />

            <Route
              path="*"
              element={
                <Placeholder
                  title="Page not found"
                  description="The page you requested does not exist."
                />
              }
            />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
