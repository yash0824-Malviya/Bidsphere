import { useLayoutEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  ChevronDown,
  Clock,
  FileText,
  Mail,
  MailCheck,
  Search,
  Trash2,
} from "lucide-react";

import {
  clearNotificationsForViewer,
  EMAIL_TEMPLATES,
} from "../../api/notifications";
import type { NotificationModule } from "../../types/notification";
import { useOptionalLayout } from "../../contexts/LayoutContext";
import { formatDateTime } from "../../utils/format";
import hotToast from "react-hot-toast";
import { useRoleNotifications } from "../../hooks/useRoleNotifications";
import { ROLE_ALLOWED_MODULES, SUPPLIER_ALLOWED_MODULES } from "../../types/notification";

const MODULE_COLORS: Partial<Record<NotificationModule, string>> = {
  System: "bg-neutral-100 text-neutral-600",
  Audit: "bg-violet-50 text-violet-700",
  Users: "bg-blue-50 text-blue-700",
  Workflow: "bg-cyan-50 text-cyan-700",
  RFQ: "bg-blue-50 text-blue-700",
  "Supplier Quotation": "bg-violet-50 text-violet-700",
  "Legal Review": "bg-amber-50 text-amber-700",
  "Finance Approval": "bg-emerald-50 text-emerald-700",
  "Purchase Order": "bg-cyan-50 text-cyan-700",
  Voucher: "bg-orange-50 text-orange-700",
  Invoice: "bg-rose-50 text-rose-700",
  Payment: "bg-green-50 text-green-700",
  "Outstanding Payables": "bg-red-50 text-red-700",
  "PO Ready for GRN": "bg-amber-50 text-amber-700",
  GRN: "bg-teal-50 text-teal-700",
  Compliance: "bg-amber-50 text-amber-700",
};

type Tab = "notifications" | "templates";

export default function NotificationCenterPage() {
  const layout = useOptionalLayout();
  const navigate = useNavigate();
  const {
    viewer,
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    refresh,
  } = useRoleNotifications();

  useLayoutEffect(() => {
    layout?.registerPageHeader();
    return () => layout?.unregisterPageHeader();
  }, [layout]);

  const [tab, setTab] = useState<Tab>("notifications");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [readFilter, setReadFilter] = useState("");

  const moduleOptions = useMemo(() => {
    if (!viewer) return [];
    if (viewer.role === "supplier") {
      return [...SUPPLIER_ALLOWED_MODULES];
    }
    return [...ROLE_ALLOWED_MODULES[viewer.role]];
  }, [viewer]);

  const filtered = useMemo(() => {
    let list = notifications;
    if (moduleFilter) list = list.filter((n) => n.module === moduleFilter);
    if (readFilter === "unread") list = list.filter((n) => !n.read_status);
    if (readFilter === "read") list = list.filter((n) => n.read_status);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.description.toLowerCase().includes(q) ||
          n.document_name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [notifications, moduleFilter, readFilter, search]);

  function handleMarkAllRead() {
    markAllRead();
    hotToast.success("All notifications marked as read");
  }

  function handleClearAll() {
    if (!viewer) return;
    clearNotificationsForViewer(viewer);
    refresh();
    hotToast.success("Notification history cleared");
  }

  function handleOpen(id: string, route: string) {
    markRead(id);
    navigate(route);
  }

  return (
    <div className="-mt-1">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">
            <Bell className="h-4 w-4 text-primary-600" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-900">Notification Center</h1>
            <p className="text-[10px] text-neutral-500">
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}`
                : "All caught up"}{" "}
              &middot; Role-filtered &middot; Email templates
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {tab === "notifications" && notifications.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50 cursor-pointer border-none"
              >
                <CheckCheck className="h-3 w-3" /> Mark All Read
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-[11px] font-semibold text-red-600 ring-1 ring-neutral-200 hover:bg-red-50 cursor-pointer border-none"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-2 flex items-center gap-0 border-b border-neutral-200">
        <TabBtn
          active={tab === "notifications"}
          onClick={() => setTab("notifications")}
          label="Notifications"
          count={unreadCount}
        />
        <TabBtn
          active={tab === "templates"}
          onClick={() => setTab("templates")}
          label="Email Templates"
        />
      </div>

      {tab === "notifications" ? (
        <>
          <div className="mb-2 flex items-center gap-1.5">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notifications..."
                className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-200"
              />
            </div>
            <Sel
              value={moduleFilter}
              onChange={setModuleFilter}
              options={[
                { value: "", label: "All Modules" },
                ...moduleOptions.map((m) => ({ value: m, label: m })),
              ]}
            />
            <Sel
              value={readFilter}
              onChange={setReadFilter}
              options={[
                { value: "", label: "All" },
                { value: "unread", label: "Unread" },
                { value: "read", label: "Read" },
              ]}
            />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white py-14 text-center shadow-sm">
              <Bell className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-700">No notifications</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                Workflow events for your role will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleOpen(n.id, n.route_path)}
                  className={`w-full rounded-lg border bg-white shadow-sm transition-all text-left cursor-pointer ${
                    n.read_status
                      ? "border-neutral-100 opacity-75"
                      : "border-neutral-200 hover:border-primary-200"
                  }`}
                >
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <div
                      className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
                        MODULE_COLORS[n.module] ?? "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {n.email_sent ? (
                        <MailCheck className="h-3.5 w-3.5" />
                      ) : (
                        <Mail className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-bold text-neutral-900">
                          {n.title}
                        </span>
                        <span
                          className={`rounded px-1.5 py-px text-[9px] font-semibold ${
                            MODULE_COLORS[n.module] ??
                            "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {n.module}
                        </span>
                        {!n.read_status && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-600 leading-relaxed">
                        {n.description}
                      </p>
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-neutral-400">
                        <span className="inline-flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />{" "}
                          {formatDateTime(n.created_at)}
                        </span>
                        {n.document_name && (
                          <span className="inline-flex items-center gap-0.5">
                            <FileText className="h-2.5 w-2.5" /> {n.document_name}
                          </span>
                        )}
                        {n.email_sent && (
                          <span className="inline-flex items-center gap-0.5 text-emerald-500">
                            <MailCheck className="h-2.5 w-2.5" /> Email sent
                          </span>
                        )}
                      </div>
                    </div>
                    {!n.read_status && (
                      <span
                        role="presentation"
                        onClick={(e) => {
                          e.stopPropagation();
                          markRead(n.id);
                        }}
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                        title="Mark read"
                      >
                        <CheckCheck className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          {EMAIL_TEMPLATES.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-neutral-200 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
                    <Mail className="h-3 w-3" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-neutral-900">{t.name}</h3>
                    <p className="text-[10px] text-neutral-500">
                      Trigger: {t.triggerEvent}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                    t.enabled
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-neutral-100 text-neutral-500"
                  }`}
                >
                  {t.enabled ? "Active" : "Disabled"}
                </span>
              </div>
              <div className="px-3 py-2.5 space-y-1.5">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="w-16 flex-shrink-0 font-semibold text-neutral-500">
                    Subject:
                  </span>
                  <span className="text-neutral-800 font-mono text-[11px]">
                    {t.subject}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="w-16 flex-shrink-0 font-semibold text-neutral-500">
                    To:
                  </span>
                  <span className="text-neutral-700">{t.recipients}</span>
                </div>
                <div className="text-xs">
                  <span className="font-semibold text-neutral-500">Body:</span>
                  <pre className="mt-1 whitespace-pre-wrap rounded border border-neutral-100 bg-neutral-50 px-2.5 py-2 text-[11px] text-neutral-700 leading-relaxed font-sans">
                    {t.body}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-2 text-xs font-semibold cursor-pointer bg-transparent border-none transition-colors ${
        active ? "text-primary-700" : "text-neutral-500 hover:text-neutral-700"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-1 rounded-full bg-primary-600 px-1.5 py-px text-[9px] font-bold text-white">
          {count}
        </span>
      )}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 rounded-t" />
      )}
    </button>
  );
}

function Sel({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-neutral-200 bg-white py-1.5 pl-2.5 pr-7 text-xs text-neutral-700 focus:border-primary-400 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
    </div>
  );
}
