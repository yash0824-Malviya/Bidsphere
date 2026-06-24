import { useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Cloud,
  Database,
  Globe,
  Link2,
  Mail,
  Server,
  Webhook,
} from "lucide-react";

import { getSystemSettings } from "../../api/admin";
import { Skeleton } from "../../components/Skeleton";
import { useOptionalLayout } from "../../contexts/LayoutContext";

interface Integration {
  name: string;
  description: string;
  icon: typeof Server;
  iconBg: string;
  iconColor: string;
  status: "connected" | "not_configured" | "error";
  detail: string;
}

export default function IntegrationsPage() {
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

  const integrations: Integration[] = [
    {
      name: "ERPNext Backend",
      description: "Core ERP system for documents, workflows, and business logic",
      icon: Database,
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
      status: "connected",
      detail: "Active connection via REST API",
    },
    {
      name: "Email Service",
      description: "Outbound email for notifications, approvals, and reports",
      icon: Mail,
      iconBg: "bg-rose-50",
      iconColor: "text-rose-600",
      status: settings?.outgoing_mail_server ? "connected" : "not_configured",
      detail: settings?.outgoing_mail_server ? String(settings.outgoing_mail_server) : "No mail server configured",
    },
    {
      name: "AI Recommendation Engine",
      description: "Supplier scoring, bid analysis, and procurement intelligence",
      icon: Cloud,
      iconBg: "bg-violet-50",
      iconColor: "text-violet-600",
      status: "connected",
      detail: "Internal engine — active",
    },
    {
      name: "Webhooks",
      description: "Event-driven notifications to external systems",
      icon: Webhook,
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
      status: "not_configured",
      detail: "No webhooks configured",
    },
    {
      name: "External APIs",
      description: "Third-party service integrations (payment gateways, logistics)",
      icon: Globe,
      iconBg: "bg-emerald-50",
      iconColor: "text-emerald-600",
      status: "not_configured",
      detail: "No external APIs connected",
    },
    {
      name: "SSO / LDAP",
      description: "Single sign-on and directory service integration",
      icon: Link2,
      iconBg: "bg-indigo-50",
      iconColor: "text-indigo-600",
      status: "not_configured",
      detail: "Using local authentication",
    },
  ];

  const connected = integrations.filter((i) => i.status === "connected").length;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50">
          <Link2 className="h-4 w-4 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-neutral-900">Integrations</h1>
          <p className="text-[11px] text-neutral-500">Manage external service connections and APIs</p>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs text-neutral-500">Connected Services</p>
            <p className="text-lg font-bold text-neutral-900">{connected} / {integrations.length}</p>
          </div>
          <div className="h-8 w-px bg-neutral-200" />
          <div>
            <p className="text-xs text-neutral-500">Status</p>
            <span className="rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
              Core Systems Online
            </span>
          </div>
        </div>
      </div>

      {/* Integration Cards */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>
      ) : (
        <div className="space-y-2">
          {integrations.map((intg) => (
            <div
              key={intg.name}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm transition hover:shadow-md"
            >
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${intg.iconBg}`}>
                <intg.icon className={`h-5 w-5 ${intg.iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-neutral-900">{intg.name}</p>
                <p className="text-[11px] text-neutral-500">{intg.description}</p>
                <p className="mt-0.5 text-[10px] text-neutral-400">{intg.detail}</p>
              </div>
              <StatusPill status={intg.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: "connected" | "not_configured" | "error" }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
        <Server className="h-3 w-3" /> Error
      </span>
    );
  }
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
      Not Configured
    </span>
  );
}
