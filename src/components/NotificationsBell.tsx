import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  PackageCheck,
  PackagePlus,
  Receipt,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getNotifications } from "../api/notifications";

import { apiGet } from "../api/erpnext";
import type { Filter } from "../api/erpnext";
import { getGRNsAwaitingInvoice } from "../api/financeWorkflow";
import { getNotificationsForRole } from "../api/vouchers";
import { useVoucherSyncStore } from "../store/voucherSyncStore";
import { getIncomingPurchaseOrders, getPurchaseReceipts } from "../api/purchasing";
import { useAuthStore } from "../store/authStore";
import { buildUpcomingDeliveries } from "../utils/upcomingDeliveries";
import { formatCurrency, todayIso } from "../utils/format";

type NotificationTone = "warning" | "danger" | "info" | "success";

interface Notification {
  id: string;
  tone: NotificationTone;
  icon: LucideIcon;
  title: string;
  description: string;
  to: string;
  date?: string;
}

interface InvoiceRow {
  name: string;
  supplier: string;
  due_date?: string;
  outstanding_amount?: number;
  grand_total?: number;
  currency?: string;
}

const READ_KEY = "inteva-notifications-read";

function loadRead(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(READ_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveRead(set: Set<string>) {
  try {
    sessionStorage.setItem(READ_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

const TONE_STYLES: Record<NotificationTone, string> = {
  warning: "bg-amber-50 text-amber-600",
  danger: "bg-danger-50 text-danger-600",
  info: "bg-primary-50 text-primary",
  success: "bg-success-50 text-success-600",
};

/**
 * Header bell that surfaces overdue purchase invoice alerts.
 * Badge shows the count of unread items (sessionStorage-backed).
 */
export default function NotificationsBell() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => loadRead());
  // Re-render when the shared voucher store syncs so workflow alerts refresh.
  useVoucherSyncStore((s) => s.version);

  // Warehouse sees inbound-receiving alerts.
  const showWarehouse = role === "warehouse" || role === "admin";
  // Overdue ERPNext purchase-invoice alerts are admin-only now that the
  // Finance workflow is driven by Vouchers.
  const showInvoices = role === "admin";
  // Finance (and Admin) see GRNs awaiting a voucher.
  const showFinanceQueue = role === "finance" || role === "admin";
  // Voucher workflow notifications (created/sent/raised/paid/settled).
  const showVouchers =
    role === "finance" || role === "procurement" || role === "admin";

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const today = todayIso();

  const { data: overdueInvoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ["notifications-overdue-invoices", today],
    enabled: showInvoices,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: () => {
      const filters: Filter[] = [
        ["status", "=", "Overdue"],
        ["docstatus", "=", 1],
      ];
      return apiGet<InvoiceRow[]>("/api/resource/Purchase Invoice", {
        params: {
          filters: JSON.stringify(filters),
          fields: JSON.stringify([
            "name",
            "supplier",
            "due_date",
            "outstanding_amount",
            "grand_total",
            "currency",
          ]),
          limit_page_length: 20,
          order_by: "due_date asc",
        },
      });
    },
  });

  const { data: incomingPOs = [] } = useQuery({
    queryKey: ["notifications-incoming-pos", today],
    enabled: showWarehouse,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: getIncomingPurchaseOrders,
  });

  const { data: awaitingInvoices = [] } = useQuery({
    queryKey: ["notifications-awaiting-invoice", today],
    enabled: showFinanceQueue,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: () => getGRNsAwaitingInvoice(10),
  });

  const { data: completedGrns = [] } = useQuery({
    queryKey: ["notifications-completed-grns", today],
    enabled: showWarehouse,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: () =>
      getPurchaseReceipts({
        filters: [
          ["docstatus", "=", 1],
          ["status", "in", ["To Bill", "Completed"]],
        ],
        fields: [
          "name",
          "supplier",
          "supplier_name",
          "posting_date",
          "status",
          "grand_total",
        ],
        order_by: "posting_date desc, modified desc",
        limit_page_length: 5,
      }),
  });

  const notifications: Notification[] = [];

  if (showWarehouse) {
    for (const d of buildUpcomingDeliveries(incomingPOs)) {
      const supplier = d.supplier_name ?? d.supplier ?? "Supplier";
      const poPath = `/p2p/grn/new?po=${encodeURIComponent(d.name)}`;
      if (d.urgency === "overdue") {
        const n = Math.abs(d.daysRemaining ?? 0);
        notifications.push({
          id: `po-overdue-${d.name}`,
          tone: "danger",
          icon: AlertTriangle,
          title: `Overdue receipt: ${d.name}`,
          description: `${supplier} • ${n} day${n === 1 ? "" : "s"} overdue`,
          to: poPath,
          date: d.schedule_date,
        });
      } else if (d.urgency === "due-today") {
        notifications.push({
          id: `po-today-${d.name}`,
          tone: "warning",
          icon: Truck,
          title: `Delivery due today: ${d.name}`,
          description: `${supplier} • receive goods now`,
          to: poPath,
          date: d.schedule_date,
        });
      } else if (d.urgency === "due-tomorrow") {
        notifications.push({
          id: `po-tomorrow-${d.name}`,
          tone: "info",
          icon: Truck,
          title: `Delivery due tomorrow: ${d.name}`,
          description: `${supplier} • prepare to receive`,
          to: poPath,
          date: d.schedule_date,
        });
      } else if ((d.per_received ?? 0) === 0) {
        notifications.push({
          id: `po-awaiting-${d.name}`,
          tone: "info",
          icon: PackagePlus,
          title: `New PO awaiting receipt: ${d.name}`,
          description: `${supplier} • ${formatCurrency(d.grand_total)}`,
          to: poPath,
          date: d.schedule_date,
        });
      }
    }

    for (const g of completedGrns) {
      notifications.push({
        id: `grn-done-${g.name}`,
        tone: "success",
        icon: PackageCheck,
        title: `GRN completed: ${g.name}`,
        description: `${g.supplier_name ?? g.supplier ?? "Goods received"}`,
        to: `/p2p/grn/${encodeURIComponent(g.name)}`,
        date: g.posting_date,
      });
    }
  }

  if (showFinanceQueue) {
    for (const g of awaitingInvoices) {
      notifications.push({
        id: `awaiting-voucher-${g.name}`,
        tone: "info",
        icon: FileText,
        title: "GRN Awaiting Voucher",
        description: `${g.supplier_name ?? g.supplier ?? "Supplier"} • ${formatCurrency(
          g.grand_total
        )} • GRN ${g.name}`,
        to: `/p2p/grn/${encodeURIComponent(g.name)}`,
        date: g.posting_date,
      });
    }
  }

  if (showVouchers) {
    for (const vn of getNotificationsForRole(role ?? "")) {
      notifications.push({
        id: `vch-notif-${vn.id}`,
        tone: vn.read ? "info" : "success",
        icon: Receipt,
        title: `Voucher ${vn.voucher_id}`,
        description: vn.message,
        to: `/p2p/vouchers/${encodeURIComponent(vn.voucher_id)}`,
        date: vn.timestamp,
      });
    }
  }

  if (showInvoices) {
    for (const inv of overdueInvoices) {
      const amount =
        inv.outstanding_amount && inv.outstanding_amount > 0
          ? inv.outstanding_amount
          : inv.grand_total ?? 0;
      notifications.push({
        id: `invoice-${inv.name}`,
        tone: "danger",
        icon: Receipt,
        title: `Overdue: ${inv.name}`,
        description: `${inv.supplier} • ${formatCurrency(amount)} outstanding`,
        to: `/p2p/invoices/${encodeURIComponent(inv.name)}`,
        date: inv.due_date,
      });
    }
  }

  const WORKFLOW_TONE_MAP: Record<string, NotificationTone> = {
    rfq_created: "info",
    quotation_submitted: "info",
    legal_review_required: "warning",
    finance_review_required: "warning",
    po_created: "success",
    payment_released: "success",
  };
  for (const wn of getNotifications().filter((n) => !n.read).slice(0, 8)) {
    notifications.push({
      id: `wf-${wn.id}`,
      tone: WORKFLOW_TONE_MAP[wn.type] ?? "info",
      icon: Mail,
      title: wn.title,
      description: wn.message,
      to: wn.to ?? "/notifications",
      date: wn.timestamp,
    });
  }

  const unread = notifications.filter((n) => !readIds.has(n.id));
  const unreadCount = unread.length;

  function markRead(id: string) {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveRead(next);
      return next;
    });
  }

  function markAllRead() {
    const all = new Set([
      ...readIds,
      ...notifications.map((n) => n.id),
    ]);
    setReadIds(all);
    saveRead(all);
  }

  function handleClick(n: Notification) {
    markRead(n.id);
    setOpen(false);
    navigate(n.to);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[360px] max-h-[70vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Notifications
              </h3>
              <p className="text-xs text-neutral-500">
                {notifications.length === 0
                  ? "You're all caught up"
                  : `${unreadCount} unread of ${notifications.length}`}
              </p>
            </div>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-neutral-500">
              <Clock className="h-6 w-6 text-neutral-400" />
              <p>No alerts right now.</p>
              <p className="text-xs text-neutral-400">
                {showWarehouse
                  ? "All deliveries are on schedule."
                  : "All invoices are on time."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {notifications.map((n) => {
                const isRead = readIds.has(n.id);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 ${
                        isRead ? "opacity-70" : ""
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${TONE_STYLES[n.tone]}`}
                      >
                        <n.icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className={`truncate text-sm ${
                              isRead
                                ? "text-neutral-700"
                                : "font-semibold text-neutral-900"
                            }`}
                          >
                            {n.title}
                          </p>
                          {!isRead && (
                            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary-500" />
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
                          {n.description}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-neutral-200">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-primary-700 hover:bg-primary-50 transition-colors no-underline"
            >
              <ExternalLink className="h-3 w-3" />
              View All Notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
