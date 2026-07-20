import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

import { getRoleHome } from "../config/roles";
import { useAuthStore } from "../store/authStore";
import { LiveAuctionStartedNotifier } from "../hooks/useLiveAuctionStartedNotification";
import { readSupplierSession } from "../hooks/useSupplierSession";
import { notifyAccessDenied } from "../utils/rbacNavigate";
import {
  ensureSupplierAccessToken,
  forceSupplierRelogin,
} from "../utils/supplierAccessAuth";

/**
 * Guards `/supplier/*` routes (except login).
 * - Internal authenticated users are redirected to their own dashboard.
 * - Unauthenticated visitors without a supplier session go to supplier login.
 * - Active supplier sessions must hold a supplier JWT (same principal used by
 *   voucher view and Create Invoice). Account sessions mint via session_token;
 *   PIN sessions without a JWT are forced to re-login.
 */
export default function SupplierPortalGuard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const deniedRef = useRef(false);
  const [supplierAuth, setSupplierAuth] = useState<
    "checking" | "ready" | "relogin"
  >("checking");

  useEffect(() => {
    if (!hasHydrated) return;
    if (isAuthenticated && user) return;

    const session = readSupplierSession();
    if (!session?.loggedIn) {
      setSupplierAuth("relogin");
      return;
    }

    let cancelled = false;
    setSupplierAuth("checking");
    void ensureSupplierAccessToken().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSupplierAuth("ready");
        return;
      }
      // Session cannot produce a supplier JWT — clear stale UI session.
      forceSupplierRelogin();
      setSupplierAuth("relogin");
    });

    return () => {
      cancelled = true;
    };
  }, [hasHydrated, isAuthenticated, user, location.pathname]);

  // Wait for internal auth hydration so we don't flash supplier UI for staff
  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 text-sm text-neutral-600">
        Loading…
      </div>
    );
  }

  // Procurement / Finance / Warehouse / Admin / etc. must never open supplier URLs
  if (isAuthenticated && user) {
    if (!deniedRef.current) {
      deniedRef.current = true;
      notifyAccessDenied(location.pathname);
    }
    return <Navigate to={getRoleHome(user.role ?? "procurement")} replace />;
  }

  if (supplierAuth === "checking") {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 text-sm text-neutral-600">
        Verifying supplier session…
      </div>
    );
  }

  if (supplierAuth === "relogin") {
    return (
      <Navigate
        to="/supplier/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  const session = readSupplierSession();
  if (!session?.loggedIn) {
    return (
      <Navigate
        to="/supplier/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  const erpSupplierId = (
    session.linkedSupplier ||
    session.supplierName ||
    ""
  ).trim();

  return (
    <>
      {erpSupplierId ? (
        <LiveAuctionStartedNotifier supplierId={erpSupplierId} />
      ) : null}
      <Outlet />
    </>
  );
}
