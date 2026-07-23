import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

import { useAuthStore } from "../store/authStore";
import { LiveAuctionStartedNotifier } from "../hooks/useLiveAuctionStartedNotification";
import { readSupplierSession } from "../hooks/useSupplierSession";
import {
  ensureSupplierAccessToken,
  forceSupplierRelogin,
} from "../utils/supplierAccessAuth";
import {
  logPortalAuthDecision,
  PORTAL_LOGIN_PATH,
  replacePreviousStaffSession,
} from "../utils/portalAuth";

/**
 * Guards `/supplier/*` routes (except login).
 * - Internal staff sessions are cleared (never redirected to staff dashboards).
 * - Unauthenticated visitors without a supplier session go to supplier login.
 * - Active supplier sessions must hold a supplier JWT.
 */
export default function SupplierPortalGuard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [staffBlocked, setStaffBlocked] = useState(false);
  const [supplierAuth, setSupplierAuth] = useState<
    "checking" | "ready" | "relogin"
  >("checking");

  useEffect(() => {
    if (!hasHydrated) return;
    if (!(isAuthenticated && user)) return;

    replacePreviousStaffSession("replace-staff-on-supplier-portal");
    logPortalAuthDecision({
      username: user.name || user.email,
      requestedPortal: "supplier",
      previousPortal: "staff",
      newPortal: null,
      redirectTarget: PORTAL_LOGIN_PATH.supplier,
      currentUrl: location.pathname,
      currentRole: user.role,
      reason: "replace-staff-on-supplier-portal",
    });
    setStaffBlocked(true);
  }, [hasHydrated, isAuthenticated, user, location.pathname]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (isAuthenticated && user) return;
    if (staffBlocked) return;

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
      forceSupplierRelogin();
      setSupplierAuth("relogin");
    });

    return () => {
      cancelled = true;
    };
  }, [hasHydrated, isAuthenticated, user, staffBlocked, location.pathname]);

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 text-sm text-neutral-600">
        Loading…
      </div>
    );
  }

  // Never bounce staff into their warehouse/procurement home from /supplier/*
  if (staffBlocked || (isAuthenticated && user)) {
    return (
      <Navigate
        to={PORTAL_LOGIN_PATH.supplier}
        replace
        state={{ from: location.pathname }}
      />
    );
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
        to={PORTAL_LOGIN_PATH.supplier}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  const session = readSupplierSession();
  if (!session?.loggedIn) {
    return (
      <Navigate
        to={PORTAL_LOGIN_PATH.supplier}
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
