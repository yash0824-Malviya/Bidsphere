import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export interface SupplierSession {
  supplierName: string;
  loggedIn: boolean;
  loginTime?: string;
}

export function useSupplierSession(options?: { redirect?: boolean }) {
  const navigate = useNavigate();
  const redirect = options?.redirect !== false;
  const [session, setSession] = useState<SupplierSession | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("supplier_session");
    if (!raw) {
      setSession(null);
      setChecked(true);
      if (redirect) navigate("/supplier/login", { replace: true });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SupplierSession;
      if (!parsed.loggedIn || !parsed.supplierName) {
        sessionStorage.removeItem("supplier_session");
        setSession(null);
        setChecked(true);
        if (redirect) navigate("/supplier/login", { replace: true });
        return;
      }
      setSession(parsed);
      setChecked(true);
    } catch {
      sessionStorage.removeItem("supplier_session");
      setSession(null);
      setChecked(true);
      if (redirect) navigate("/supplier/login", { replace: true });
    }
  }, [navigate, redirect]);

  return {
    supplierName: session?.supplierName ?? "",
    session,
    isReady: checked,
    isAuthenticated: !!session?.supplierName,
  };
}
