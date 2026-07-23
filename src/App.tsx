import { lazy, Suspense, useEffect, useRef } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { Loader2 } from "lucide-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";

import { queryClient } from "./queryClient";
import { useVoucherSyncStore } from "./store/voucherSyncStore";

import ErrorBoundary from "./components/ErrorBoundary";
import MainLayout from "./components/layout/MainLayout";
import Placeholder from "./components/Placeholder";
import ProtectedRoute from "./components/ProtectedRoute";
import SupplierPortalGuard from "./components/SupplierPortalGuard";
import SlaEngine from "./components/sla/SlaEngine";
import SupplierPortalLayout from "./pages/supplier-portal/SupplierPortalLayout";

// Eager — first-paint critical routes. Per the performance policy these are
// NOT lazy loaded so the primary workspace renders without a chunk fetch.
import DashboardPage from "./pages/dashboard/DashboardPage";
import RFQListPage from "./pages/sourcing/RFQListPage";

// Lazy — every other route is code-split into its own chunk so the initial
// bundle no longer ships the entire app (3D login hero, charts, PDF, etc.).
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const OtpVerificationPage = lazy(
  () => import("./pages/auth/OtpVerificationPage")
);

const RequisitionsPage = lazy(() => import("./pages/p2p/RequisitionsPage"));
const NewRequisitionPage = lazy(() => import("./pages/p2p/NewRequisitionPage"));
const RequisitionDetailPage = lazy(
  () => import("./pages/p2p/RequisitionDetailPage")
);
const MaterialRequestDashboardPage = lazy(
  () => import("./pages/material-requests/MaterialRequestDashboardPage")
);
const MaterialRequestsListPage = lazy(
  () => import("./pages/material-requests/MaterialRequestsListPage")
);
const MaterialRequestCreatePage = lazy(
  () => import("./pages/material-requests/MaterialRequestCreatePage")
);
const MaterialRequestDetailPage = lazy(
  () => import("./pages/material-requests/MaterialRequestDetailPage")
);
const MaterialRequestWarehousePage = lazy(
  () => import("./pages/material-requests/MaterialRequestWarehousePage")
);
const MaterialRequestProcurementPage = lazy(
  () => import("./pages/material-requests/MaterialRequestProcurementPage")
);
const MaterialRequestHistoryPage = lazy(
  () => import("./pages/material-requests/MaterialRequestHistoryPage")
);
const MaterialRequestIssuedPage = lazy(
  () => import("./pages/material-requests/MaterialRequestIssuedPage")
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
const TotalSpendDetailsPage = lazy(
  () => import("./pages/p2p/TotalSpendDetailsPage")
);
const OperationalReportsPage = lazy(
  () => import("./pages/reports/OperationalReportsPage")
);
const PurchaseOrderReportPage = lazy(
  () => import("./pages/reports/PurchaseOrderReportPage")
);
const PoStatusReportPage = lazy(
  () => import("./pages/reports/PoStatusReportPage")
);
const DeliveryReportPage = lazy(
  () => import("./pages/reports/DeliveryReportPage")
);
const GrnReportPage = lazy(() => import("./pages/reports/GrnReportPage"));
const SupplierPerformanceReportPage = lazy(
  () => import("./pages/reports/SupplierPerformanceReportPage")
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
const SupplierOnboardingListPage = lazy(
  () => import("./pages/supplier/SupplierOnboardingListPage"),
);
const SupplierOnboardingDetailPage = lazy(
  () => import("./pages/supplier/SupplierOnboardingDetailPage"),
);
const SupplierOnboardingPublicPage = lazy(
  () => import("./pages/public/SupplierOnboardingPublicPage"),
);
const SupplierChangePasswordPage = lazy(
  () => import("./pages/supplier-portal/SupplierChangePasswordPage"),
);
const SupplierSecurityPage = lazy(
  () => import("./pages/supplier-portal/SupplierSecurityPage"),
);
const SupplierForgotPasswordPage = lazy(
  () => import("./pages/supplier-portal/SupplierForgotPasswordPage"),
);
const SupplierPortalProfilePage = lazy(
  () => import("./pages/supplier-portal/SupplierPortalProfilePage"),
);
const SupplierLockedPage = lazy(
  () => import("./pages/supplier-portal/SupplierLockedPage"),
);

const NewRFQPage = lazy(() => import("./pages/sourcing/NewRFQPage"));
const RFQDetailPage = lazy(() => import("./pages/sourcing/RFQDetailPage"));
const RFQTemplatesPage = lazy(() => import("./pages/sourcing/RFQTemplatesPage"));
const UploadBomPage = lazy(() => import("./pages/sourcing/UploadBomPage"));
const RFIListPage = lazy(() => import("./pages/sourcing/RFIListPage"));
const NewRFIPage = lazy(() => import("./pages/sourcing/NewRFIPage"));
const RFIDetailPage = lazy(() => import("./pages/sourcing/RFIDetailPage"));
const RFIResponseDetailPage = lazy(
  () => import("./pages/sourcing/RFIResponseDetailPage")
);
const RFPListPage = lazy(() => import("./pages/sourcing/RFPListPage"));
const NewRFPPage = lazy(() => import("./pages/sourcing/NewRFPPage"));
const RFPDetailPage = lazy(() => import("./pages/sourcing/RFPDetailPage"));
const RFPResponseDetailPage = lazy(
  () => import("./pages/sourcing/RFPResponseDetailPage")
);
const ReverseBiddingListPage = lazy(
  () => import("./pages/sourcing/ReverseBiddingListPage")
);
const ReverseBiddingDetailPage = lazy(
  () => import("./pages/sourcing/ReverseBiddingDetailPage")
);
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
const SupplierAuctionsListPage = lazy(
  () => import("./pages/supplier-portal/SupplierAuctionsListPage")
);
const SupplierAuctionPage = lazy(
  () => import("./pages/supplier-portal/SupplierAuctionPage")
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
const SupplierRFIsPage = lazy(
  () => import("./pages/supplier-portal/SupplierRFIsPage")
);
const SupplierRFIDetailPage = lazy(
  () => import("./pages/supplier-portal/SupplierRFIDetailPage")
);
const SupplierRFPsPage = lazy(
  () => import("./pages/supplier-portal/SupplierRFPsPage")
);
const SupplierRFPDetailPage = lazy(
  () => import("./pages/supplier-portal/SupplierRFPDetailPage")
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
const PendingApprovalsPage = lazy(() => import("./pages/admin/PendingApprovalsPage"));
const ApprovedRequestsPage = lazy(() => import("./pages/admin/ApprovedRequestsPage"));
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
const SlaConfigurationPage = lazy(() => import("./pages/admin/SlaConfigurationPage"));
const SlaDashboardPage = lazy(() => import("./pages/admin/SlaDashboardPage"));
const SlaReportsPage = lazy(() => import("./pages/admin/SlaReportsPage"));

const BomManagementPage = lazy(
  () => import("./pages/manufacturing/BomManagementPage")
);
const BomFormPage = lazy(() => import("./pages/manufacturing/BomFormPage"));
const BomDetailPage = lazy(() => import("./pages/manufacturing/BomDetailPage"));
const FinishedProductsPage = lazy(
  () => import("./pages/manufacturing/FinishedProductsPage")
);

const WarehouseDashboardPage = lazy(
  () => import("./pages/warehouse/WarehouseDashboardPage")
);
const WarehousePendingReviewPage = lazy(
  () => import("./pages/warehouse/WarehousePendingReviewPage")
);
const WarehouseReviewDetailPage = lazy(
  () => import("./pages/warehouse/WarehouseReviewDetailPage")
);
const WarehouseMaterialIssuedPage = lazy(
  () => import("./pages/warehouse/WarehouseMaterialIssuedPage")
);
const WarehouseMaterialIssueDetailPage = lazy(
  () => import("./pages/warehouse/WarehouseMaterialIssueDetailPage")
);
const WarehouseIssueItemsPage = lazy(
  () => import("./pages/warehouse/WarehouseIssueItemsPage")
);
const WarehouseMaterialIssuePage = lazy(
  () => import("./pages/warehouse/WarehouseMaterialIssuePage")
);
const WarehouseIssueReceiptsPage = lazy(
  () => import("./pages/warehouse/WarehouseIssueReceiptsPage")
);
const WarehouseMaterialIssueReceiptPage = lazy(
  () => import("./pages/warehouse/WarehouseMaterialIssueReceiptPage")
);
const DepartmentMaterialIssueConfirmPage = lazy(
  () => import("./pages/material-requests/DepartmentMaterialIssueConfirmPage")
);
const DepartmentIssuedItemsPage = lazy(
  () => import("./pages/material-requests/DepartmentIssuedItemsPage"),
);
const MaterialIssueReceiptVerifyPage = lazy(
  () => import("./pages/verify/MaterialIssueReceiptVerifyPage")
);
const WarehouseForwardedRequestsPage = lazy(
  () => import("./pages/warehouse/WarehouseForwardedRequestsPage")
);
const WarehouseForwardedHistoryPage = lazy(
  () => import("./pages/warehouse/WarehouseForwardedHistoryPage")
);
const WarehouseStockOverviewPage = lazy(
  () => import("./pages/warehouse/WarehouseStockOverviewPage")
);
const WarehouseItemMasterPage = lazy(
  () => import("./pages/warehouse/WarehouseItemMasterPage")
);
const WarehouseReportsPage = lazy(
  () => import("./pages/warehouse/WarehouseReportsPage")
);
const WarehouseCreateGRNPage = lazy(
  () => import("./pages/warehouse/WarehouseCreateGRNPage")
);
const WarehouseGRNListPage = lazy(
  () => import("./pages/warehouse/WarehouseGRNListPage")
);
const HelpDeskPage = lazy(() => import("./pages/support/HelpDeskPage"));
const MyProfilePage = lazy(() => import("./pages/account/MyProfilePage"));
const ChangePasswordPage = lazy(
  () => import("./pages/account/ChangePasswordPage")
);
const BudgetDashboardPage = lazy(() => import("./pages/budget/BudgetDashboardPage"));
const BudgetPlansPage = lazy(() => import("./pages/budget/BudgetPlansPage"));
const BudgetMonitoringPage = lazy(() => import("./pages/budget/BudgetMonitoringPage"));
const BudgetApprovalsPage = lazy(() => import("./pages/budget/BudgetApprovalsPage"));
const FinanceReviewsPage = lazy(() => import("./pages/budget/FinanceReviewsPage"));
const BudgetCreatePage = lazy(() => import("./pages/budget/BudgetCreatePage"));
const MyBudgetsPage = lazy(() => import("./pages/budget/MyBudgetsPage"));
const BudgetRequestsPage = lazy(() => import("./pages/budget/BudgetRequestsPage"));
const BudgetHistoryPage = lazy(() => import("./pages/budget/BudgetHistoryPage"));
const BudgetDetailPage = lazy(() => import("./pages/budget/BudgetDetailPage"));
const NotificationCenterPage = lazy(() => import("./pages/notifications/NotificationCenterPage"));
import { useAuthStore } from "./store/authStore";
import { authLog, purgeStaleAuthStorage } from "./store/authStorage";
import { getRFQSchema } from "./api/rfqSchema";

/** Lightweight fallback shown while a lazily-loaded route chunk downloads. */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
    </div>
  );
}

function AuthBootstrap() {
  useEffect(() => {
    let cancelled = false;

    const abortRestore = (message: string) => {
      if (cancelled) return;
      const { isVerifying, hasHydrated } = useAuthStore.getState();
      if (hasHydrated && !isVerifying) return;
      cancelled = true;
      useAuthStore.getState().clearSession();
      useAuthStore.setState({
        isVerifying: false,
        hasHydrated: true,
        sessionRestoreError: message,
      });
    };

    const safetyTimer = window.setTimeout(
      () => abortRestore("Unable to restore session."),
      5_000
    );

    void (async () => {
      try {
        purgeStaleAuthStorage();
        authLog("bootstrap", "rehydrate start");
        await useAuthStore.persist.rehydrate();
        if (cancelled) return;
        await useAuthStore.getState().restoreSession();
      } catch {
        abortRestore("Unable to restore session.");
      } finally {
        cancelled = true;
        window.clearTimeout(safetyTimer);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
    };
  }, []);

  return null;
}

function RFQSchemaBootstrap() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    getRFQSchema().catch((err) => {
      console.warn("[RFQSchema] Schema fetch failed (non-fatal):", err);
    });
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
  const setHydrated = useVoucherSyncStore((s) => s.setHydrated);

  useEffect(() => {
    setHydrated();
  }, [setHydrated]);

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
        <SlaEngine />
        <Toaster position="top-right" />
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/warehouse/login"
            element={<LoginPage portal="warehouse" />}
          />
          <Route
            path="/procurement/login"
            element={<LoginPage portal="procurement" />}
          />
          <Route
            path="/department/login"
            element={<LoginPage portal="department" />}
          />
          <Route path="/verify-otp" element={<OtpVerificationPage />} />
          <Route
            path="/verify/material-issue"
            element={<MaterialIssueReceiptVerifyPage />}
          />
          <Route
            path="/verify/material-issue-receipt/:token"
            element={<MaterialIssueReceiptVerifyPage />}
          />

          {/*
            Public Supplier Portal — outside ProtectedRoute / MainLayout.
            SupplierPortalGuard clears staff sessions on /supplier/* (never
            redirects to warehouse/procurement homes) and requires a supplier
            session for operational pages.
          */}
          <Route path="/supplier/login" element={<SupplierLoginPage />} />
          <Route
            path="/supplier/forgot-password"
            element={<SupplierForgotPasswordPage />}
          />
          <Route
            path="/onboarding/:token"
            element={<SupplierOnboardingPublicPage />}
          />
          <Route element={<SupplierPortalGuard />}>
            {/* One shared shell — sidebar + header persist across supplier pages */}
            <Route element={<SupplierPortalLayout />}>
              <Route path="/supplier/change-password" element={<SupplierChangePasswordPage />} />
              <Route path="/supplier/security" element={<SupplierSecurityPage />} />
              <Route path="/supplier/profile" element={<SupplierPortalProfilePage />} />
              <Route path="/supplier/locked" element={<SupplierLockedPage />} />
              <Route path="/supplier/dashboard" element={<SupplierDashboard />} />
              <Route path="/supplier/rfqs" element={<SupplierRFQsPage />} />
              <Route path="/supplier/rfis" element={<SupplierRFIsPage />} />
              <Route path="/supplier/rfis/:id" element={<SupplierRFIDetailPage />} />
              <Route path="/supplier/rfps" element={<SupplierRFPsPage />} />
              <Route path="/supplier/rfps/:id" element={<SupplierRFPDetailPage />} />
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
              <Route path="/supplier/auctions" element={<SupplierAuctionsListPage />} />
              <Route
                path="/supplier/auctions/:auctionName"
                element={<SupplierAuctionPage />}
              />
            </Route>
          </Route>

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

            {/* Material Request workflow (pre-RFQ) */}
            <Route
              path="/material-requests"
              element={<MaterialRequestDashboardPage />}
            />
            <Route
              path="/material-requests/list"
              element={<MaterialRequestsListPage />}
            />
            <Route
              path="/material-requests/new"
              element={<MaterialRequestCreatePage />}
            />
            <Route
              path="/material-requests/warehouse"
              element={<MaterialRequestWarehousePage />}
            />
            <Route
              path="/material-requests/procurement"
              element={<MaterialRequestProcurementPage />}
            />
            <Route
              path="/material-requests/history"
              element={<MaterialRequestHistoryPage />}
            />
            <Route
              path="/material-requests/issued"
              element={<MaterialRequestIssuedPage />}
            />
            {/* Department Issued Items — canonical routes */}
            <Route
              path="/department/issued-items"
              element={
                <Navigate
                  to="/department/issued-items/pending-acceptance"
                  replace
                />
              }
            />
            <Route
              path="/department/issued-items/pending-acceptance"
              element={<DepartmentIssuedItemsPage mode="pending" />}
            />
            <Route
              path="/department/issued-items/accepted-items"
              element={<DepartmentIssuedItemsPage mode="accepted" />}
            />
            <Route
              path="/department/issued-items/issue-receipts"
              element={<DepartmentIssuedItemsPage mode="all" />}
            />
            <Route
              path="/department/issued-items/receipts/:name"
              element={<DepartmentMaterialIssueConfirmPage />}
            />
            {/* Legacy Issued Items / receipt paths → department module */}
            <Route
              path="/material-requests/receipts"
              element={
                <Navigate
                  to="/department/issued-items/pending-acceptance"
                  replace
                />
              }
            />
            <Route
              path="/material-requests/receipts/:name"
              element={<DepartmentMaterialIssueConfirmPage />}
            />
            <Route
              path="/material-requests/issued-items/pending"
              element={
                <Navigate
                  to="/department/issued-items/pending-acceptance"
                  replace
                />
              }
            />
            <Route
              path="/material-requests/issued-items/accepted"
              element={
                <Navigate
                  to="/department/issued-items/accepted-items"
                  replace
                />
              }
            />
            <Route
              path="/material-requests/issued-items/receipts"
              element={
                <Navigate
                  to="/department/issued-items/issue-receipts"
                  replace
                />
              }
            />
            <Route
              path="/material-requests/:name"
              element={<MaterialRequestDetailPage />}
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
            <Route path="/p2p/total-spend" element={<TotalSpendDetailsPage />} />
            <Route
              path="/reports/operations"
              element={<OperationalReportsPage />}
            />
            <Route
              path="/reports/operations/purchase-orders"
              element={<PurchaseOrderReportPage />}
            />
            <Route
              path="/reports/operations/po-status"
              element={<PoStatusReportPage />}
            />
            <Route
              path="/reports/operations/deliveries"
              element={<DeliveryReportPage />}
            />
            <Route
              path="/reports/operations/grn"
              element={<GrnReportPage />}
            />
            <Route
              path="/reports/operations/supplier-performance"
              element={<SupplierPerformanceReportPage />}
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
            <Route
              path="/suppliers/onboarding"
              element={<SupplierOnboardingListPage />}
            />
            <Route
              path="/suppliers/onboarding/:id"
              element={<SupplierOnboardingDetailPage />}
            />
            <Route path="/suppliers/:name" element={<SupplierDetailPage />} />

            {/* Sourcing — Smart RFQ */}
            <Route
              path="/sourcing"
              element={<Navigate to="/sourcing/rfq" replace />}
            />
            <Route path="/sourcing/rfq" element={<RFQListPage />} />
            <Route path="/sourcing/rfq/new" element={<NewRFQPage />} />
            <Route path="/sourcing/rfq/:id" element={<RFQDetailPage />} />
            <Route path="/sourcing/rfi" element={<RFIListPage />} />
            <Route path="/sourcing/rfi/new" element={<NewRFIPage />} />
            <Route
              path="/sourcing/rfi/:id/responses/:responseId"
              element={<RFIResponseDetailPage />}
            />
            <Route path="/sourcing/rfi/:id" element={<RFIDetailPage />} />
            <Route path="/sourcing/rfp" element={<RFPListPage />} />
            <Route path="/sourcing/rfp/new" element={<NewRFPPage />} />
            <Route
              path="/sourcing/rfp/:id/responses/:responseId"
              element={<RFPResponseDetailPage />}
            />
            <Route path="/sourcing/rfp/:id" element={<RFPDetailPage />} />
            <Route path="/upload-bom" element={<UploadBomPage />} />
            <Route
              path="/sourcing/upload-bom"
              element={<Navigate to="/upload-bom" replace />}
            />
            <Route
              path="/sourcing/reverse-bidding"
              element={<ReverseBiddingListPage />}
            />
            <Route
              path="/sourcing/reverse-bidding/:id"
              element={<ReverseBiddingDetailPage />}
            />
            <Route path="/sourcing/rfq-templates" element={<RFQTemplatesPage />} />
            {/* Legacy RFQ-custom-field-backed Legal Reviews page — superseded by
                /legal/reviews, which reads/writes the ERPNext Legal Document
                Review DocType (the single source of truth). Redirect so no
                page ever displays stale Legal/Finance status again. */}
            <Route
              path="/sourcing/legal-reviews"
              element={<Navigate to="/legal/reviews" replace />}
            />
            <Route path="/legal/reviews/:rfqId" element={<LegalReviewDetailPage />} />
            <Route path="/legal/reviews" element={<LegalReviewsListPage />} />
            <Route path="/legal/review/:sqName" element={<LegalReviewDetailPage />} />

            {/* Budget — finance & admin */}
            <Route path="/budget" element={<BudgetDashboardPage />} />
            <Route path="/budget/create" element={<BudgetCreatePage />} />
            <Route path="/budget/my-budgets" element={<MyBudgetsPage />} />
            <Route path="/budget/requests" element={<BudgetRequestsPage />} />
            <Route path="/budget/detail/:budgetId" element={<BudgetDetailPage />} />
            <Route path="/budget/plans" element={<BudgetPlansPage />} />
            <Route path="/budget/monitoring" element={<BudgetMonitoringPage />} />
            <Route path="/budget/approvals" element={<BudgetApprovalsPage />} />
            <Route path="/budget/history" element={<BudgetHistoryPage />} />
            <Route path="/budget/pending-reviews" element={<FinanceReviewsPage />} />
            <Route path="/finance/reviews/:rfqId" element={<FinanceReviewDetailPage />} />
            <Route path="/contracts" element={<Navigate to="/dashboard" replace />} />
            <Route path="/contracts/:name" element={<Navigate to="/dashboard" replace />} />
            <Route path="/assets" element={<Navigate to="/dashboard" replace />} />

            {/* Warehouse */}
            <Route
              path="/warehouse"
              element={<Navigate to="/warehouse/dashboard" replace />}
            />
            <Route path="/warehouse/dashboard" element={<WarehouseDashboardPage />} />
            <Route
              path="/warehouse/material-requests/pending"
              element={<WarehousePendingReviewPage />}
            />
            <Route
              path="/warehouse/material-requests/review/:mrNumber"
              element={<WarehouseReviewDetailPage />}
            />
            <Route
              path="/warehouse/material-requests/issued"
              element={<WarehouseMaterialIssuedPage />}
            />
            <Route
              path="/warehouse/material-requests/issued/:name"
              element={<WarehouseMaterialIssueDetailPage />}
            />
            <Route
              path="/warehouse/material-issue-receipts/:name"
              element={<WarehouseMaterialIssueReceiptPage />}
            />
            <Route
              path="/warehouse/material-requests/forwarded"
              element={<WarehouseForwardedRequestsPage />}
            />
            <Route
              path="/warehouse/material-requests/history"
              element={<WarehouseForwardedHistoryPage />}
            />
            <Route
              path="/warehouse/issue-items"
              element={<WarehouseIssueItemsPage />}
            />
            <Route
              path="/warehouse/issue-items/pending-acceptance"
              element={
                <WarehouseIssueReceiptsPage mode="pending-acceptance" />
              }
            />
            <Route
              path="/warehouse/issue-items/receipts"
              element={<WarehouseIssueReceiptsPage mode="all" />}
            />
            <Route
              path="/warehouse/issue-items/:mrName"
              element={<WarehouseMaterialIssuePage />}
            />
            <Route
              path="/warehouse/inventory/stock-overview"
              element={<WarehouseStockOverviewPage />}
            />
            <Route
              path="/warehouse/inventory/stock"
              element={<WarehouseStockOverviewPage />}
            />
            <Route
              path="/warehouse/inventory/create-grn"
              element={<WarehouseCreateGRNPage />}
            />
            <Route
              path="/warehouse/grn-list"
              element={<WarehouseGRNListPage />}
            />
            <Route
              path="/warehouse/inventory/items"
              element={<WarehouseItemMasterPage />}
            />
            <Route path="/warehouse/reports" element={<WarehouseReportsPage />} />

            {/* Admin */}
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/approvals/pending" element={<PendingApprovalsPage />} />
            <Route path="/admin/approvals/approved" element={<ApprovedRequestsPage />} />
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
            <Route path="/admin/sla-configuration" element={<SlaConfigurationPage />} />
            <Route path="/admin/sla-dashboard" element={<SlaDashboardPage />} />
            <Route path="/admin/sla-reports" element={<SlaReportsPage />} />
            <Route path="/admin/integrations" element={<IntegrationsPage />} />

            {/* Manufacturing — BOM (Bill of Materials) workspace */}
            <Route path="/manufacturing" element={<Navigate to="/manufacturing/boms" replace />} />
            <Route path="/manufacturing/boms" element={<BomManagementPage />} />
            <Route path="/manufacturing/boms/list" element={<BomManagementPage />} />
            <Route path="/manufacturing/boms/new" element={<BomFormPage />} />
            <Route path="/manufacturing/boms/:name/edit" element={<BomFormPage />} />
            <Route path="/manufacturing/boms/:name" element={<BomDetailPage />} />
            <Route
              path="/manufacturing/finished-products"
              element={<FinishedProductsPage />}
            />

            {/* Inventory */}
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/:code" element={<ItemDetailPage />} />

            {/* Notifications */}
            <Route path="/notifications" element={<NotificationCenterPage />} />

            {/* Account — profile + change password only; Help uses /support/help-desk */}
            <Route
              path="/account"
              element={<Navigate to="/account/profile" replace />}
            />
            <Route path="/account/profile" element={<MyProfilePage />} />
            <Route
              path="/account/change-password"
              element={<ChangePasswordPage />}
            />
            <Route
              path="/account/help"
              element={<Navigate to="/support/help-desk" replace />}
            />
            <Route
              path="/account/activity"
              element={<Navigate to="/account/profile" replace />}
            />
            <Route
              path="/account/settings"
              element={<Navigate to="/account/profile" replace />}
            />
            <Route
              path="/account/security"
              element={<Navigate to="/account/change-password" replace />}
            />
            <Route
              path="/account/preferences"
              element={<Navigate to="/account/profile" replace />}
            />

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
