import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearSupplierAccessToken } from "../utils/accessToken";

export interface SupplierSession {
  /** ERP Supplier name when approved; otherwise company/onboarding label */
  supplierName: string;
  loggedIn: boolean;
  loginTime?: string;
  /** "pin" = legacy company+PIN; "account" = portal username/password */
  authMode?: "pin" | "account";
  sessionToken?: string;
  onboardingName?: string;
  companyName?: string;
  portalUser?: string;
  firstLogin?: boolean;
  unlocked?: boolean;
  displayStatus?: string;
  linkedSupplier?: string;
}

const SESSION_KEY = "supplier_session";

export function readSupplierSession(): SupplierSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SupplierSession;
    if (!parsed.loggedIn || !parsed.supplierName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSupplierSession(session: SupplierSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSupplierSession() {
  sessionStorage.removeItem(SESSION_KEY);
  try {
    clearSupplierAccessToken();
    // Also drop the mirrored shared token written at supplier login.
    sessionStorage.removeItem("bidsphere-access-token");
  } catch {
    /* ignore */
  }
}

export function useSupplierSession(options?: {
  redirect?: boolean;
  requirePasswordChange?: boolean;
}) {
  const navigate = useNavigate();
  const redirect = options?.redirect !== false;
  const [session, setSession] = useState<SupplierSession | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const parsed = readSupplierSession();
    if (!parsed) {
      setSession(null);
      setChecked(true);
      if (redirect) navigate("/supplier/login", { replace: true });
      return;
    }

    setSession(parsed);
    setChecked(true);

    if (parsed.firstLogin && options?.requirePasswordChange !== false) {
      if (!window.location.pathname.startsWith("/supplier/change-password")) {
        navigate("/supplier/change-password", { replace: true });
      }
    }
  }, [navigate, redirect, options?.requirePasswordChange]);

  const unlocked =
    !!session?.unlocked || session?.authMode === "pin";
  /**
   * ERPNext Link value for Supplier (`Purchase Order.supplier`, RFQ child table).
   * Never use company display name — ERPNext stores Supplier.name, not supplier_name.
   */
  const linked = String(session?.linkedSupplier || "").trim();
  const storedId = String(session?.supplierName || "").trim();
  const companyLabel = String(session?.companyName || "").trim();
  // Prefer explicit Supplier Master link; fall back to stored id (PIN / account).
  const erpSupplierName = linked || storedId || "";

  return {
    /** Display label for UI chrome only — never use for ERPNext Link filters. */
    supplierName: companyLabel || storedId || "",
    /** ERPNext Supplier.name — use for all PO/RFQ/SQ/GRN/Voucher API filters. */
    erpSupplierName,
    session,
    authMode: session?.authMode || (session?.sessionToken ? "account" : "pin"),
    isReady: checked,
    isAuthenticated: !!session?.supplierName,
    unlocked,
    firstLogin: !!session?.firstLogin,
    sessionToken: session?.sessionToken || "",
    displayStatus: session?.displayStatus || (unlocked ? "Approved" : "Onboarding Pending"),
    refreshSession: () => setSession(readSupplierSession()),
  };
}
