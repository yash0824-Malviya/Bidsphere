import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Check,
  Coins,
  Globe,
  Mail,
  Bell,
  Server,
  Settings,
  Send,
} from "lucide-react";

import { APP_NAME } from "../../config/branding";
import { getCompanyInfo, getSystemSettings } from "../../api/admin";
import { getEmailConfig, saveEmailConfig } from "../../api/notifications";
import type { EmailConfig } from "../../api/notifications";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import hotToast from "react-hot-toast";

export default function SystemSettingsPage() {
  const layout = useOptionalLayout();
  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const { data: company, isLoading: loadingCompany } = useQuery({
    queryKey: ["admin-company"],
    queryFn: getCompanyInfo,
    staleTime: 5 * 60_000,
  });

  const { data: sysSettings, isLoading: loadingSys } = useQuery({
    queryKey: ["admin-system-settings"],
    queryFn: getSystemSettings,
    staleTime: 5 * 60_000,
  });

  const isLoading = loadingCompany || loadingSys;

  const [emailCfg, setEmailCfg] = useState<EmailConfig>(getEmailConfig);
  const [emailSaving, setEmailSaving] = useState(false);

  function handleEmailSave() {
    setEmailSaving(true);
    saveEmailConfig(emailCfg);
    setTimeout(() => {
      setEmailSaving(false);
      hotToast.success("Email configuration saved");
    }, 400);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100">
          <Settings className="h-4 w-4 text-neutral-600" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">System Settings</h1>
          <p className="text-[11px] text-neutral-500">Company information, currency, email configuration, and system settings</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Company Info */}
          <SettingsCard icon={Building2} iconBg="bg-blue-50" iconColor="text-blue-600" title="Company Information">
            <FieldRow label="Company Name" value={company?.company_name ?? "—"} />
            <FieldRow label="Domain" value={company?.domain ?? "—"} />
            <FieldRow label="Country" value={company?.country ?? "—"} />
          </SettingsCard>

          {/* Currency */}
          <SettingsCard icon={Coins} iconBg="bg-amber-50" iconColor="text-amber-600" title="Currency">
            <FieldRow label="Default Currency" value={company?.default_currency ?? "—"} />
            <FieldRow label="Currency Symbol" value={getCurrencySymbol(company?.default_currency)} />
          </SettingsCard>

          {/* Email Settings */}
          <SettingsCard icon={Mail} iconBg="bg-rose-50" iconColor="text-rose-600" title="Email Settings">
            <FieldRow label="Email Provider" value={safeStr(sysSettings?.email_provider) || "Default"} />
            <FieldRow label="Outgoing Mail Server" value={safeStr(sysSettings?.outgoing_mail_server) || "smtp.example.com"} />
            <FieldRow label="Email Notifications" value={sysSettings?.enable_email_notifications ? "Enabled" : "Disabled"} />
          </SettingsCard>

          {/* Notification Settings */}
          <SettingsCard icon={Bell} iconBg="bg-violet-50" iconColor="text-violet-600" title="Notification Settings">
            <FieldRow label="System Notifications" value={sysSettings?.enable_notifications === 0 ? "Disabled" : "Enabled"} />
            <FieldRow label="Email Digest" value={sysSettings?.email_digest_enabled ? "Enabled" : "Disabled"} />
            <FieldRow label="Chat Notifications" value="Enabled" />
          </SettingsCard>

          {/* Email Configuration */}
          <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-50">
                  <Send className="h-3.5 w-3.5 text-cyan-600" />
                </div>
                <h3 className="text-xs font-bold text-neutral-900">Email Configuration (SMTP)</h3>
              </div>
              <button type="button" onClick={handleEmailSave} disabled={emailSaving} className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50 cursor-pointer border-none">
                <Check className="h-3 w-3" /> {emailSaving ? "Saving…" : "Save"}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <EmailField label="SMTP Host" value={emailCfg.smtpHost} onChange={(v) => setEmailCfg((c) => ({ ...c, smtpHost: v }))} placeholder="smtp.gmail.com" />
              <EmailField label="SMTP Port" value={String(emailCfg.smtpPort)} onChange={(v) => setEmailCfg((c) => ({ ...c, smtpPort: Number(v) || 587 }))} placeholder="587" type="number" />
              <EmailField label="Email Address" value={emailCfg.emailAddress} onChange={(v) => setEmailCfg((c) => ({ ...c, emailAddress: v }))} placeholder="notifications@company.com" />
              <EmailField label="Password" value={emailCfg.password} onChange={(v) => setEmailCfg((c) => ({ ...c, password: v }))} placeholder="••••••••" type="password" />
              <EmailField label="Sender Name" value={emailCfg.senderName} onChange={(v) => setEmailCfg((c) => ({ ...c, senderName: v }))} placeholder={`${APP_NAME} Notifications`} />
              <div className="flex items-center gap-3 pt-4">
                <label className="inline-flex items-center gap-2 text-xs text-neutral-700 cursor-pointer">
                  <input type="checkbox" checked={emailCfg.enableNotifications} onChange={(e) => setEmailCfg((c) => ({ ...c, enableNotifications: e.target.checked }))} className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
                  Enable Emails
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-neutral-700 cursor-pointer">
                  <input type="checkbox" checked={emailCfg.enableEmailDigest} onChange={(e) => setEmailCfg((c) => ({ ...c, enableEmailDigest: e.target.checked }))} className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600 focus:ring-primary-500" />
                  Daily Digest
                </label>
              </div>
            </div>
          </div>

          {/* System Info */}
          <SettingsCard icon={Server} iconBg="bg-neutral-100" iconColor="text-neutral-600" title="System Information">
            <FieldRow label="Platform" value={`${APP_NAME} v1.0`} />
            <FieldRow label="Backend" value="ERPNext / Frappe" />
            <FieldRow label="Frontend" value="React + TypeScript" />
          </SettingsCard>

          {/* Localization */}
          <SettingsCard icon={Globe} iconBg="bg-emerald-50" iconColor="text-emerald-600" title="Localization">
            <FieldRow label="Date Format" value={safeStr(sysSettings?.date_format) || "dd-mm-yyyy"} />
            <FieldRow label="Time Format" value={safeStr(sysSettings?.time_format) || "HH:mm:ss"} />
            <FieldRow label="Time Zone" value={safeStr(sysSettings?.time_zone) || "Asia/Kolkata"} />
          </SettingsCard>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function safeStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function getCurrencySymbol(code?: string | null): string {
  const map: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", AED: "د.إ", SAR: "﷼" };
  return code ? (map[code] ?? code) : "—";
}

function SettingsCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  children,
}: {
  icon: typeof Building2;
  iconBg: string;
  iconColor: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <h3 className="text-xs font-bold text-neutral-900">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium text-neutral-900">{value}</span>
    </div>
  );
}

function EmailField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-semibold text-neutral-500">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200" />
    </div>
  );
}
