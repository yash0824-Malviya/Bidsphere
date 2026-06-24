import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Key,
  Lock,
  Shield,
  ShieldCheck,
  Timer,
} from "lucide-react";

import { getSystemSettings } from "../../api/admin";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";

export default function SecuritySettingsPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-system-settings"],
    queryFn: getSystemSettings,
    staleTime: 5 * 60_000,
  });

  const sessionTimeout = settings?.session_expiry
    ? String(settings.session_expiry)
    : "06:00:00";

  const passwordMinLength = settings?.password_min_length
    ? Number(settings.password_min_length)
    : 8;

  const forceStrongPw = settings?.enable_password_policy ? true : false;

  return (
    <div className="-mt-1">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50">
          <ShieldCheck className="h-4 w-4 text-red-600" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">Security Settings</h1>
          <p className="text-[10px] text-neutral-500">Encryption &middot; Authentication &middot; Compliance policies</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2 lg:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {/* TLS Encryption */}
          <SecurityCard
            icon={Lock}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            title="TLS Encryption"
            status="enabled"
          >
            <Row label="Protocol" value="TLS 1.2 / 1.3" />
            <Row label="HTTPS Enforced" value="Yes" badge="emerald" />
            <Row label="Certificate" value="Valid" badge="emerald" />
            <Row label="HSTS Header" value="Enabled" badge="emerald" />
          </SecurityCard>

          {/* Session Timeout */}
          <SecurityCard
            icon={Timer}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            title="Session Management"
            status="configured"
          >
            <Row label="Session Timeout" value={sessionTimeout} />
            <Row label="Idle Timeout" value="30 minutes" />
            <Row label="Concurrent Sessions" value="Allowed" />
            <Row label="Session Cookie" value="HttpOnly, Secure" badge="emerald" />
          </SecurityCard>

          {/* Password Policy */}
          <SecurityCard
            icon={Key}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            title="Password Policy"
            status={forceStrongPw ? "enabled" : "warning"}
          >
            <Row label="Minimum Length" value={`${passwordMinLength} characters`} />
            <Row label="Strong Password" value={forceStrongPw ? "Enforced" : "Not Enforced"} badge={forceStrongPw ? "emerald" : "amber"} />
            <Row label="Password Expiry" value="90 days" />
            <Row label="History Check" value="Last 5 passwords" />
          </SecurityCard>

          {/* Data Retention */}
          <SecurityCard
            icon={Database}
            iconBg="bg-violet-50"
            iconColor="text-violet-600"
            title="Data Retention Policy"
            status="configured"
          >
            <Row label="Audit Log Retention" value="365 days" />
            <Row label="Access Log Retention" value="180 days" />
            <Row label="Document Versions" value="All retained" />
            <Row label="Backup Frequency" value="Daily" badge="emerald" />
          </SecurityCard>

          {/* MFA */}
          <SecurityCard
            icon={Shield}
            iconBg="bg-rose-50"
            iconColor="text-rose-600"
            title="Multi-Factor Authentication"
            status="disabled"
          >
            <Row label="MFA Status" value="Not Enabled" badge="red" />
            <Row label="Available Methods" value="TOTP, Email OTP" />
            <Row label="Enforcement" value="Optional" />
            <Row label="Admin MFA" value="Recommended" badge="amber" />
          </SecurityCard>

          {/* Compliance */}
          <SecurityCard
            icon={CheckCircle2}
            iconBg="bg-cyan-50"
            iconColor="text-cyan-600"
            title="Compliance & Audit"
            status="enabled"
          >
            <Row label="Audit Trail" value="Enabled" badge="emerald" />
            <Row label="Access Logging" value="Enabled" badge="emerald" />
            <Row label="Change Tracking" value="All DocTypes" badge="emerald" />
            <Row label="Export Capability" value="CSV, Excel" />
          </SecurityCard>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function SecurityCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  status,
  children,
}: {
  icon: typeof Lock;
  iconBg: string;
  iconColor: string;
  title: string;
  status: "enabled" | "configured" | "warning" | "disabled";
  children: React.ReactNode;
}) {
  const statusConfig = {
    enabled: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Enabled", icon: <CheckCircle2 className="h-3 w-3" /> },
    configured: { bg: "bg-blue-50", text: "text-blue-700", label: "Configured", icon: <Clock className="h-3 w-3" /> },
    warning: { bg: "bg-amber-50", text: "text-amber-700", label: "Review", icon: <AlertTriangle className="h-3 w-3" /> },
    disabled: { bg: "bg-red-50", text: "text-red-700", label: "Disabled", icon: <AlertTriangle className="h-3 w-3" /> },
  }[status];

  return (
    <div className="rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-md ${iconBg}`}>
            <Icon className={`h-3 w-3 ${iconColor}`} />
          </div>
          <h3 className="text-xs font-bold text-neutral-900">{title}</h3>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${statusConfig.bg} ${statusConfig.text}`}>
          {statusConfig.icon} {statusConfig.label}
        </span>
      </div>
      <div className="divide-y divide-neutral-100 px-3">{children}</div>
    </div>
  );
}

function Row({ label, value, badge }: { label: string; value: string; badge?: "emerald" | "amber" | "red" }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-neutral-500">{label}</span>
      {badge ? (
        <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${
          badge === "emerald" ? "bg-emerald-50 text-emerald-700"
            : badge === "amber" ? "bg-amber-50 text-amber-700"
            : "bg-red-50 text-red-700"
        }`}>
          {value}
        </span>
      ) : (
        <span className="font-medium text-neutral-900">{value}</span>
      )}
    </div>
  );
}
