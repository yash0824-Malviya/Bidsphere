import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Building2,
  ChevronDown,
  Hash,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";

import { apiGet, buildResourceUrl } from "../../api/erpnext";
import { portalLogin, legacyPinIssueToken } from "../../api/supplierOnboarding";
import {
  writeSupplierAccessToken,
  clearSupplierAccessToken,
  clearAccessToken,
} from "../../utils/accessToken";
import SupplierLoginHeroPanel from "../../components/supplier-portal/SupplierLoginHeroPanel";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  readSupplierSession,
  writeSupplierSession,
} from "../../hooks/useSupplierSession";
import { buildPortalClientMeta } from "../../utils/supplierClientMeta";
import { useAuthStore } from "../../store/authStore";
import {
  detectAuthSource,
  getActivePortal,
  logPortalAuthDecision,
  PORTAL_LOGIN_PATH,
  replacePreviousStaffSession,
  setActivePortal,
  setLoginPortalAffinity,
} from "../../utils/portalAuth";
import { NETLINK_LOGO_PATH, COMPANY_NAME } from "../../config/branding";

const SUPPORT_EMAIL = "support@bidsphere.com";
const SUPPORT_PHONE = "+91 98765 43210";
const TAB_STORAGE_KEY = "supplier_login_tab";

type LoginTab = "account" | "pin";

interface SupplierOption {
  name: string;
  supplier_name?: string;
}

function readStoredTab(): LoginTab {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    if (raw === "pin" || raw === "account") return raw;
  } catch {
    /* ignore */
  }
  return "pin";
}

function postAccountLoginPath(session: {
  firstLogin?: boolean;
  unlocked?: boolean;
  displayStatus?: string;
}): string {
  if (session.firstLogin) return "/supplier/change-password";
  const status = String(session.displayStatus || "");
  if (session.unlocked || status === "Approved") return "/supplier/dashboard";
  return "/supplier/profile";
}

interface PinInputProps {
  value: string;
  onChange: (pin: string) => void;
  disabled?: boolean;
}

function PinInput({ value, onChange, disabled }: PinInputProps) {
  const digits = Array.from({ length: 5 }, (_, i) => value[i] || "");
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, val: string) => {
    const numericVal = val.replace(/\D/g, "");
    if (!numericVal) {
      const nextDigits = [...digits];
      nextDigits[index] = "";
      onChange(nextDigits.join(""));
      return;
    }

    if (numericVal.length > 1) {
      const pasted = numericVal.slice(0, 5);
      onChange(pasted);
      const nextFocus = Math.min(pasted.length, 4);
      inputsRef.current[nextFocus]?.focus();
      return;
    }

    const nextDigits = [...digits];
    nextDigits[index] = numericVal;
    const newPin = nextDigits.join("");
    onChange(newPin);

    if (index < 4) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-[48px] w-[44px] shrink-0 items-center justify-center rounded-[10px] border border-[#D0D5DD] bg-[#F9FAFB] text-[#667085] supplier-login-field-icon">
        <KeyRound className="h-4 w-4" />
      </div>
      <div className="flex flex-1 items-center justify-between gap-1 sm:gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={digits[i]}
            disabled={disabled}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className="h-[48px] w-[48px] rounded-[10px] border border-[#D0D5DD] bg-white text-center font-bold text-lg text-[#101828] focus:border-[#146CE8] focus:ring-2 focus:ring-[#146CE8]/20 disabled:bg-[#F2F4F7] outline-none transition-all placeholder:text-[#98A2B3] supplier-login-pin-box"
            placeholder="•"
          />
        ))}
      </div>
    </div>
  );
}

export default function SupplierLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  useDocumentTitle();
  const [tab, setTab] = useState<LoginTab>(() => readStoredTab());

  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  // Account login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountSubmitting, setAccountSubmitting] = useState(false);

  // Company PIN login
  const [supplierName, setSupplierName] = useState("");
  const [supplierCode, setSupplierCode] = useState("");
  const [pin, setPin] = useState("");
  const [pinSubmitting, setPinSubmitting] = useState(false);

  useEffect(() => {
    setLoginPortalAffinity("supplier");
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    if (isAuthenticated && user) {
      const previousPortal = getActivePortal();
      replacePreviousStaffSession("replace-staff-on-supplier-login");
      logPortalAuthDecision({
        username: user.name || user.email,
        requestedPortal: "supplier",
        previousPortal,
        newPortal: null,
        redirectTarget: PORTAL_LOGIN_PATH.supplier,
        currentUrl: location.pathname,
        currentRole: user.role,
        reason: "replace-staff-on-supplier-login",
      });
      return;
    }

    const existing = readSupplierSession();
    if (!existing?.loggedIn) return;

    const destination =
      existing.authMode === "account"
        ? postAccountLoginPath(existing)
        : "/supplier/dashboard";
    setActivePortal("supplier");
    logPortalAuthDecision({
      username:
        existing.portalUser ??
        existing.companyName ??
        existing.supplierName ??
        null,
      requestedPortal: "supplier",
      previousPortal: getActivePortal(),
      newPortal: "supplier",
      redirectTarget: destination,
      currentUrl: location.pathname,
      currentRole: "supplier",
      authSource: detectAuthSource(),
      reason: "supplier-session-on-supplier-login",
    });
    navigate(destination, { replace: true });
  }, [hasHydrated, isAuthenticated, user, navigate, location.pathname]);

  function selectTab(next: LoginTab) {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const suppliersQuery = useQuery<SupplierOption[]>({
    queryKey: ["supplier-portal-supplier-list"],
    queryFn: () =>
      apiGet<SupplierOption[]>(buildResourceUrl("Supplier"), {
        params: {
          fields: JSON.stringify([
            "name",
            "supplier_name",
            "supplier_group",
            "country",
          ]),
          filters: JSON.stringify([["disabled", "=", 0]]),
          limit_page_length: 100,
        },
      }),
    enabled: tab === "pin",
  });

  const suppliers = useMemo(() => {
    return [...(suppliersQuery.data ?? [])].sort((a, b) =>
      (a.supplier_name || a.name).localeCompare(b.supplier_name || b.name),
    );
  }, [suppliersQuery.data]);

  function handleCompanyChange(name: string) {
    setSupplierName(name);
    setSupplierCode(name);
  }

  function handleSupplierCodeChange(code: string) {
    setSupplierCode(code);
    const match = suppliers.find(
      (s) =>
        s.name.toLowerCase() === code.trim().toLowerCase() ||
        (s.supplier_name ?? "").toLowerCase() === code.trim().toLowerCase(),
    );
    if (match) setSupplierName(match.name);
    else if (!code.trim()) setSupplierName("");
  }

  function resolveSupplier(): SupplierOption | undefined {
    if (supplierName) {
      return suppliers.find((s) => s.name === supplierName);
    }
    const code = supplierCode.trim();
    if (!code) return undefined;
    return suppliers.find(
      (s) =>
        s.name.toLowerCase() === code.toLowerCase() ||
        (s.supplier_name ?? "").toLowerCase() === code.toLowerCase(),
    );
  }

  async function handleAccountSubmit(e: FormEvent) {
    e.preventDefault();
    const username = email.trim().toLowerCase();
    if (!username || !username.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (!password) {
      toast.error("Enter your password.");
      return;
    }

    setAccountSubmitting(true);
    try {
      if (useAuthStore.getState().isAuthenticated) {
        replacePreviousStaffSession("replace-staff-before-supplier-login");
      }
      const res = await portalLogin({
        username,
        password,
        client: buildPortalClientMeta(),
      });
      if (!res.access_token) {
        clearSupplierAccessToken();
        throw new Error(
          "Sign-in succeeded but no access token was issued. Please try again or contact support.",
        );
      }
      writeSupplierAccessToken(res.access_token);
      const session = {
        supplierName: res.linked_supplier || res.company_name || username,
        companyName: res.company_name || username,
        linkedSupplier: res.linked_supplier || "",
        portalUser: res.portal_user || username,
        onboardingName: res.record?.name,
        sessionToken: res.session_token,
        firstLogin: !!res.first_login,
        unlocked: !!res.unlocked,
        displayStatus: res.display_status || res.record?.status,
        authMode: "account" as const,
        loggedIn: true,
        loginTime: new Date().toISOString(),
      };
      writeSupplierSession(session);
      setActivePortal("supplier");
      toast.success(`Welcome, ${res.company_name || username}`);
      navigate(postAccountLoginPath(session), { replace: true });
    } catch (err) {
      clearSupplierAccessToken();
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setAccountSubmitting(false);
    }
  }

  function handleForgotPassword() {
    const q = email.trim() ? `?email=${encodeURIComponent(email.trim())}` : "";
    navigate(`/supplier/forgot-password${q}`);
  }

  function handlePinSubmit(e: FormEvent) {
    e.preventDefault();

    const supplier = resolveSupplier();

    if (!supplier) {
      toast.error("Please select your company or enter a valid supplier code.");
      return;
    }
    if (!pin || pin.length < 4) {
      toast.error("Portal PIN must be 4 or 5 digits.");
      return;
    }

    setPinSubmitting(true);

    void (async () => {
      try {
        if (useAuthStore.getState().isAuthenticated) {
          replacePreviousStaffSession("replace-staff-before-supplier-pin-login");
        }
        const tokenRes = await legacyPinIssueToken(
          supplier.name,
          pin,
          buildPortalClientMeta(),
        );
        if (!tokenRes.access_token) {
          throw new Error(
            "Sign-in succeeded but no access token was issued. Please try again.",
          );
        }
        writeSupplierAccessToken(tokenRes.access_token);
      } catch (err) {
        clearSupplierAccessToken();
        clearAccessToken();
        const message =
          err instanceof Error ? err.message : "Could not start supplier session. Please try again.";
        toast.error(message);
        setPinSubmitting(false);
        return;
      }

      writeSupplierSession({
        supplierName: supplier.name,
        companyName: supplier.supplier_name || supplier.name,
        linkedSupplier: supplier.name,
        authMode: "pin",
        unlocked: true,
        firstLogin: false,
        displayStatus: "Approved",
        loggedIn: true,
        loginTime: new Date().toISOString(),
      });
      setActivePortal("supplier");

      toast.success(`Welcome, ${supplier.supplier_name || supplier.name}`);
      navigate("/supplier/dashboard", { replace: true });
      setPinSubmitting(false);
    })();
  }

  return (
    <div
      className="relative w-full overflow-x-hidden font-sans"
      style={{ minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif" }}
    >
      {/* Full-screen logistics background */}
      <img
        src="/supplier-logistics-bg.jpg"
        alt="BidSphere Logistics"
        style={{
          position: "absolute",
          inset: 0,
          height: "100%",
          width: "100%",
          objectFit: "cover",
          objectPosition: "center",
          zIndex: 0,
        }}
      />

      {/* Subtle global overlay — image remains clearly visible */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(5, 20, 45, 0.18)",
          zIndex: 1,
        }}
      />

      {/* Faint blue radial glow for network depth */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 32% 48%, rgba(20, 108, 232, 0.18) 0%, rgba(14, 165, 233, 0.08) 45%, transparent 75%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Digital Supply Chain Network Effect (Subtle, 26% opacity) */}
      <svg
        style={{
          position: "absolute",
          inset: 0,
          height: "100%",
          width: "100%",
          pointerEvents: "none",
          zIndex: 2,
          opacity: 0.26,
        }}
        viewBox="0 0 1000 800"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <filter id="glow-cyan" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Curved connection lines connecting logistics hubs */}
        <path
          id="path-air-hub"
          d="M 120 160 Q 220 210 380 260"
          fill="none"
          stroke="rgba(56,189,248,0.5)"
          strokeWidth="1.5"
          strokeDasharray="4 6"
        />
        <path
          id="path-hub-logistics"
          d="M 380 260 Q 310 360 260 460"
          fill="none"
          stroke="rgba(56,189,248,0.4)"
          strokeWidth="1.5"
          strokeDasharray="5 5"
        />
        <path
          id="path-crane-logistics"
          d="M 80 380 Q 170 410 260 460"
          fill="none"
          stroke="rgba(56,189,248,0.45)"
          strokeWidth="1.5"
          strokeDasharray="4 6"
        />
        <path
          id="path-ship-truck"
          d="M 140 590 Q 220 650 320 680"
          fill="none"
          stroke="rgba(56,189,248,0.4)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
        />
        <path
          id="path-truck-hub2"
          d="M 320 680 Q 390 620 440 540"
          fill="none"
          stroke="rgba(56,189,248,0.35)"
          strokeWidth="1.5"
          strokeDasharray="4 6"
        />
        <path
          id="path-logistics-gw2"
          d="M 260 460 Q 400 480 560 380"
          fill="none"
          stroke="rgba(56,189,248,0.45)"
          strokeWidth="1.5"
          strokeDasharray="4 6"
        />
        <path
          id="path-air-sky"
          d="M 120 160 Q 210 130 310 140"
          fill="none"
          stroke="rgba(56,189,248,0.35)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
        />
        <path
          id="path-gw-reg"
          d="M 440 540 Q 480 600 510 660"
          fill="none"
          stroke="rgba(56,189,248,0.4)"
          strokeWidth="1.5"
          strokeDasharray="5 5"
        />

        {/* Animated glowing particles travelling along paths */}
        <circle r="3.5" fill="#38bdf8" filter="url(#glow-cyan)">
          <animateMotion dur="5.5s" repeatCount="indefinite">
            <mpath href="#path-air-hub" />
          </animateMotion>
        </circle>
        <circle r="3.5" fill="#38bdf8" filter="url(#glow-cyan)">
          <animateMotion dur="7s" repeatCount="indefinite">
            <mpath href="#path-logistics-gw2" />
          </animateMotion>
        </circle>
        <circle r="3" fill="#ffffff" filter="url(#glow-cyan)">
          <animateMotion dur="6.2s" repeatCount="indefinite">
            <mpath href="#path-ship-truck" />
          </animateMotion>
        </circle>

        {/* 10 Glowing Logistics Nodes */}
        {[
          { cx: 120, cy: 160, r: 5.5, pulse: true, speed: "3.2s" }, // Airplane Node
          { cx: 80, cy: 380, r: 5, pulse: false },                // Crane Node
          { cx: 140, cy: 590, r: 6, pulse: true, speed: "4.5s" },  // Cargo Ship Node
          { cx: 320, cy: 680, r: 5.5, pulse: true, speed: "3.8s" },// Freight Truck Node
          { cx: 260, cy: 460, r: 6.5, pulse: true, speed: "4.0s" },// Central Logistics Hub
          { cx: 440, cy: 540, r: 5, pulse: false },               // Distribution Hub
          { cx: 380, cy: 260, r: 6, pulse: true, speed: "3.5s" },  // Data Gateway Node
          { cx: 560, cy: 380, r: 5.5, pulse: true, speed: "4.8s" },// Supply Network Hub
          { cx: 310, cy: 140, r: 4.5, pulse: false },              // Sky Freight Node
          { cx: 510, cy: 660, r: 5, pulse: false },               // Regional Port Node
        ].map((node, idx) => (
          <g key={idx}>
            {node.pulse && (
              <circle
                cx={node.cx}
                cy={node.cy}
                r={node.r * 2.4}
                fill="rgba(56,189,248,0.22)"
                className="animate-ping"
                style={{ animationDuration: node.speed || "3.5s" }}
              />
            )}
            <circle cx={node.cx} cy={node.cy} r={node.r} fill="#38bdf8" filter="url(#glow-cyan)" />
            <circle cx={node.cx} cy={node.cy} r={node.r * 0.45} fill="#ffffff" />
          </g>
        ))}
      </svg>

      {/* Top-left Netlink logo — white compact box */}
      <div
        style={{
          position: "absolute",
          top: "28px",
          left: "44px",
          zIndex: 20,
        }}
      >
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: "14px",
            padding: "8px 14px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={NETLINK_LOGO_PATH}
            alt={`${COMPANY_NAME} Logo`}
            style={{ height: "38px", width: "auto", objectFit: "contain" }}
          />
        </div>
      </div>

      {/* Main layout — hero left (60%), login card right (40%) */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          minHeight: "100vh",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: "64px",
          paddingRight: "68px",
          paddingTop: "40px",
          paddingBottom: "28px",
          boxSizing: "border-box",
        }}
        className="supplier-login-layout"
      >
        {/* Left hero content (60% visual space) */}
        <section
          className="supplier-login-hero"
          style={{ display: "flex", flexShrink: 1, flex: "0 1 60%", maxWidth: "580px" }}
        >
          <SupplierLoginHeroPanel />
        </section>

        {/* Solid white refined enterprise login card - 410px width, 26px padding */}
        <aside
          className="supplier-login-card"
          style={{
            width: "410px",
            maxWidth: "420px",
            height: "auto",
            background: "#FFFFFF",
            opacity: 1,
            backdropFilter: "none",
            WebkitBackdropFilter: "none",
            borderRadius: "22px",
            border: "1px solid #E5E7EB",
            boxShadow: "0 18px 60px rgba(0,0,0,0.16)",
            padding: "26px",
            overflow: "visible",
            flexShrink: 0,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            marginTop: "12px",
          }}
        >
          {/* Card header */}
          <div className="supplier-login-card-header" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: "18px" }}>
            <img
              src={NETLINK_LOGO_PATH}
              alt={`${COMPANY_NAME} Logo`}
              className="supplier-login-card-logo"
              style={{ height: "36px", width: "auto", objectFit: "contain", marginBottom: "14px" }}
            />
            <h2
              className="supplier-login-card-title"
              style={{
                fontSize: "23px",
                fontWeight: 700,
                color: "#101828",
                marginBottom: "6px",
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              Welcome, Supplier
            </h2>
            <p
              className="supplier-login-card-subtitle"
              style={{
                fontSize: "14px",
                fontWeight: 400,
                color: "#667085",
                marginTop: "0px",
                marginBottom: 0,
              }}
            >
              Sign in to access your collaboration portal
            </p>
          </div>

          {/* Tab switcher - 46px height */}
          <div
            className="supplier-login-tab-switcher"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px",
              borderRadius: "12px",
              background: "#F1F5F9",
              padding: "4px",
              height: "46px",
              marginBottom: "18px",
              boxSizing: "border-box",
            }}
          >
            <button
              type="button"
              onClick={() => selectTab("account")}
              style={{
                borderRadius: "9px",
                fontSize: "13px",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                transition: "all 150ms ease",
                background: tab === "account" ? "#146CE8" : "transparent",
                color: tab === "account" ? "#FFFFFF" : "#667085",
              }}
            >
              Account Login
            </button>
            <button
              type="button"
              onClick={() => selectTab("pin")}
              style={{
                borderRadius: "9px",
                fontSize: "13px",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                transition: "all 150ms ease",
                background: tab === "pin" ? "#146CE8" : "transparent",
                color: tab === "pin" ? "#FFFFFF" : "#667085",
              }}
            >
              Company PIN Login
            </button>
          </div>

          {tab === "account" ? (
            /* ── Account Login Form ── */
            <form onSubmit={(e) => void handleAccountSubmit(e)}>
              {/* Email */}
              <div className="supplier-login-form-group" style={{ marginBottom: "14px" }}>
                <label
                  htmlFor="supplier-email"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: "#344054",
                    marginBottom: "6px",
                    textTransform: "uppercase",
                  }}
                >
                  Email Address
                </label>
                <div style={{ display: "flex", alignItems: "stretch" }}>
                  <div
                    className="supplier-login-field-icon"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "48px",
                      width: "44px",
                      flexShrink: 0,
                      borderRadius: "10px 0 0 10px",
                      border: "1px solid #D0D5DD",
                      borderRight: "1px solid #E4E7EC",
                      background: "#F9FAFB",
                      color: "#667085",
                    }}
                  >
                    <Mail className="h-4 w-4" />
                  </div>
                  <input
                    id="supplier-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="supplier@company.com"
                    autoComplete="username"
                    required
                    style={{
                      height: "48px",
                      flex: 1,
                      borderRadius: "0 10px 10px 0",
                      border: "1px solid #D0D5DD",
                      borderLeft: "none",
                      background: "#FFFFFF",
                      padding: "0 14px",
                      fontSize: "14px",
                      color: "#101828",
                      outline: "none",
                    }}
                    className="supplier-login-field-input placeholder:text-[#98A2B3] focus:border-[#146CE8] focus:ring-2 focus:ring-[#146CE8]/20"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="supplier-login-form-group" style={{ marginBottom: "18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <label
                    htmlFor="supplier-password"
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      color: "#344054",
                      textTransform: "uppercase",
                    }}
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#146CE8",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    className="hover:underline"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "stretch" }}>
                  <div
                    className="supplier-login-field-icon"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "48px",
                      width: "44px",
                      flexShrink: 0,
                      borderRadius: "10px 0 0 10px",
                      border: "1px solid #D0D5DD",
                      borderRight: "1px solid #E4E7EC",
                      background: "#F9FAFB",
                      color: "#667085",
                    }}
                  >
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <input
                    id="supplier-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    style={{
                      height: "48px",
                      flex: 1,
                      borderRadius: "0 10px 10px 0",
                      border: "1px solid #D0D5DD",
                      borderLeft: "none",
                      background: "#FFFFFF",
                      padding: "0 14px",
                      fontSize: "14px",
                      color: "#101828",
                      outline: "none",
                    }}
                    className="supplier-login-field-input placeholder:text-[#98A2B3] focus:border-[#146CE8] focus:ring-2 focus:ring-[#146CE8]/20"
                  />
                </div>
              </div>

              {/* Sign In - 48px height */}
              <button
                type="submit"
                disabled={accountSubmitting}
                style={{
                  width: "100%",
                  height: "48px",
                  background: "#146CE8",
                  borderRadius: "10px",
                  color: "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px",
                  border: "none",
                  cursor: accountSubmitting ? "not-allowed" : "pointer",
                  opacity: accountSubmitting ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  transition: "all 180ms ease",
                  marginBottom: "12px",
                }}
                className="supplier-login-btn hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(20,108,232,0.22)] active:translate-y-0"
              >
                {accountSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                <span>{accountSubmitting ? "Signing in…" : "Sign In"}</span>
              </button>
            </form>
          ) : (
            /* ── Company PIN Login Form ── */
            <form onSubmit={handlePinSubmit}>
              {/* Company */}
              <div className="supplier-login-form-group" style={{ marginBottom: "14px" }}>
                <label
                  htmlFor="supplier-select"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: "#344054",
                    marginBottom: "6px",
                    textTransform: "uppercase",
                  }}
                >
                  Company
                </label>
                <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
                  <div
                    className="supplier-login-field-icon"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "48px",
                      width: "44px",
                      flexShrink: 0,
                      borderRadius: "10px 0 0 10px",
                      border: "1px solid #D0D5DD",
                      borderRight: "1px solid #E4E7EC",
                      background: "#F9FAFB",
                      color: "#667085",
                    }}
                  >
                    <Building2 className="h-4 w-4" />
                  </div>
                  <select
                    id="supplier-select"
                    value={supplierName}
                    onChange={(e) => handleCompanyChange(e.target.value)}
                    disabled={suppliersQuery.isLoading}
                    style={{
                      height: "48px",
                      flex: 1,
                      borderRadius: "0 10px 10px 0",
                      border: "1px solid #D0D5DD",
                      borderLeft: "none",
                      background: "#FFFFFF",
                      padding: "0 36px 0 14px",
                      fontSize: "14px",
                      color: "#101828",
                      outline: "none",
                      appearance: "none",
                    }}
                    className="supplier-login-field-input focus:border-[#146CE8] focus:ring-2 focus:ring-[#146CE8]/20 disabled:bg-[#F9FAFB]"
                  >
                    <option value="">
                      {suppliersQuery.isLoading ? "Loading companies…" : "Select your company"}
                    </option>
                    {suppliers.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.supplier_name || s.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3.5 h-4 w-4 text-[#667085]" style={{ top: "50%", transform: "translateY(-50%)" }} />
                </div>
              </div>

              {/* Supplier Code */}
              <div className="supplier-login-form-group" style={{ marginBottom: "14px" }}>
                <label
                  htmlFor="supplier-code"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: "#344054",
                    marginBottom: "6px",
                    textTransform: "uppercase",
                  }}
                >
                  Supplier Code
                </label>
                <div style={{ display: "flex", alignItems: "stretch" }}>
                  <div
                    className="supplier-login-field-icon"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "48px",
                      width: "44px",
                      flexShrink: 0,
                      borderRadius: "10px 0 0 10px",
                      border: "1px solid #D0D5DD",
                      borderRight: "1px solid #E4E7EC",
                      background: "#F9FAFB",
                      color: "#667085",
                    }}
                  >
                    <Hash className="h-4 w-4" />
                  </div>
                  <input
                    id="supplier-code"
                    type="text"
                    value={supplierCode}
                    onChange={(e) => handleSupplierCodeChange(e.target.value)}
                    placeholder="e.g. SUP-00001"
                    autoComplete="organization"
                    disabled={suppliersQuery.isLoading}
                    style={{
                      height: "48px",
                      flex: 1,
                      borderRadius: "0 10px 10px 0",
                      border: "1px solid #D0D5DD",
                      borderLeft: "none",
                      background: "#FFFFFF",
                      padding: "0 14px",
                      fontSize: "14px",
                      fontFamily: "monospace",
                      color: "#101828",
                      outline: "none",
                    }}
                    className="supplier-login-field-input placeholder:text-[#98A2B3] focus:border-[#146CE8] focus:ring-2 focus:ring-[#146CE8]/20 disabled:bg-[#F9FAFB]"
                  />
                </div>
              </div>

              {/* Portal PIN */}
              <div className="supplier-login-form-group" style={{ marginBottom: "18px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    color: "#344054",
                    marginBottom: "6px",
                    textTransform: "uppercase",
                  }}
                >
                  Portal PIN
                </label>
                <PinInput value={pin} onChange={setPin} disabled={pinSubmitting} />
              </div>

              {/* Sign In - 48px height */}
              <button
                type="submit"
                disabled={pinSubmitting || suppliersQuery.isLoading}
                style={{
                  width: "100%",
                  height: "48px",
                  background: "#146CE8",
                  borderRadius: "10px",
                  color: "#FFFFFF",
                  fontWeight: 600,
                  fontSize: "14px",
                  border: "none",
                  cursor: pinSubmitting || suppliersQuery.isLoading ? "not-allowed" : "pointer",
                  opacity: pinSubmitting || suppliersQuery.isLoading ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  transition: "all 180ms ease",
                  marginBottom: "12px",
                }}
                className="supplier-login-btn hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(20,108,232,0.22)] active:translate-y-0"
              >
                {pinSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                <span>{pinSubmitting ? "Signing in…" : "Sign In"}</span>
              </button>
            </form>
          )}

          {/* Secure access bar - 38px height */}
          <div
            className="supplier-login-secure-bar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              height: "38px",
              background: "#F8FAFC",
              border: "1px solid #E2E8F0",
              borderRadius: "10px",
              color: "#146CE8",
              fontSize: "12px",
              fontWeight: 600,
              marginBottom: "14px",
            }}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span>Secure supplier portal access</span>
          </div>

          {/* Support footer */}
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: "11px", color: "#98A2B3", marginBottom: "4px", marginTop: 0 }}>Need Help?</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#475467", textDecoration: "none" }}
                className="hover:text-[#146CE8] transition-colors"
              >
                <Mail className="h-3 w-3" style={{ color: "#98A2B3" }} />
                <span>{SUPPORT_EMAIL}</span>
              </a>
              <span style={{ color: "#D0D5DD" }}>|</span>
              <a
                href={`tel:${SUPPORT_PHONE.replace(/\s+/g, "")}`}
                style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#475467", textDecoration: "none" }}
                className="hover:text-[#146CE8] transition-colors"
              >
                <Phone className="h-3 w-3" style={{ color: "#98A2B3" }} />
                <span>{SUPPORT_PHONE}</span>
              </a>
            </div>
          </div>
        </aside>
      </div>

      {/* Responsive overrides */}
      <style>{`
        @media (max-width: 1279px) {
          .supplier-login-hero h1 { font-size: 48px !important; }
          .supplier-login-card { width: 400px !important; }
          .supplier-login-layout { padding-left: 40px !important; padding-right: 40px !important; }
        }
        @media (max-width: 767px) {
          .supplier-login-hero { display: none !important; }
          .supplier-login-layout {
            justify-content: center !important;
            padding-left: 16px !important;
            padding-right: 16px !important;
          }
          .supplier-login-card {
            width: calc(100% - 32px) !important;
            margin: 16px auto !important;
          }
        }
        @media (max-height: 850px) {
          .supplier-login-layout {
            padding-top: 24px !important;
            padding-bottom: 16px !important;
          }
          .supplier-login-card {
            padding: 24px !important;
            margin-top: 10px !important;
          }
        }
      `}</style>
    </div>
  );
}
