import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CheckCheck,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  syncFinanceGrnQueue,
  syncGrnCompletedAlerts,
  syncOverduePayables,
  syncWarehouseAlerts,
} from "../api/notifications";
import { apiGet } from "../api/erpnext";
import type { Filter } from "../api/erpnext";
import { getGRNsAwaitingInvoice } from "../api/financeWorkflow";
import { useVoucherSyncStore } from "../store/voucherSyncStore";
import { getIncomingPurchaseOrders, getPurchaseReceipts } from "../api/purchasing";
import { useAuthStore } from "../store/authStore";
import { buildUpcomingDeliveries } from "../utils/upcomingDeliveries";
import { formatCurrency, todayIso } from "../utils/format";
import { useRoleNotifications } from "../hooks/useRoleNotifications";
import type { EnterpriseNotification, NotificationModule } from "../types/notification";

interface InvoiceRow {
  name: string;
  supplier: string;
  due_date?: string;
  outstanding_amount?: number;
  grand_total?: number;
  currency?: string;
}

const MODULE_TONE: Partial<Record<NotificationModule, string>> = {
  System: "bg-neutral-100 text-neutral-600",
  Audit: "bg-violet-50 text-violet-700",
  "Outstanding Payables": "bg-danger-50 text-danger-600",
  "PO Ready for GRN": "bg-amber-50 text-amber-600",
  GRN: "bg-success-50 text-success-600",
  Voucher: "bg-primary-50 text-primary",
  Payment: "bg-success-50 text-success-600",
  "Legal Review": "bg-amber-50 text-amber-700",
  RFQ: "bg-blue-50 text-blue-700",
};

function toneForModule(module: NotificationModule): string {
  return MODULE_TONE[module] ?? "bg-primary-50 text-primary";
}

/**
 * Header bell — shows only notifications visible to the logged-in user's role.
 */
export default function NotificationsBell() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const voucherVersion = useVoucherSyncStore((s) => s.version);
  const { notifications, unreadCount, markRead, markAllRead, refresh } =
    useRoleNotifications();

  const showWarehouse = role === "warehouse";
  const showFinance = role === "finance";
  const today = todayIso();

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

  const { data: incomingPOs = [] } = useQuery({
    queryKey: ["notifications-incoming-pos", today],
    enabled: showWarehouse,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: getIncomingPurchaseOrders,
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

  const { data: awaitingInvoices = [] } = useQuery({
    queryKey: ["notifications-awaiting-invoice", today],
    enabled: showFinance,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: () => getGRNsAwaitingInvoice(10),
  });

  const { data: overdueInvoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ["notifications-overdue-invoices", today],
    enabled: showFinance,
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

  useEffect(() => {
    if (!showWarehouse) return;
    const alerts = [];
    for (const d of buildUpcomingDeliveries(incomingPOs)) {
      const supplier = d.supplier_name ?? d.supplier ?? "Supplier";
      if (d.urgency === "overdue") {
        alerts.push({
          poName: d.name,
          supplier,
          urgency: "overdue" as const,
          scheduleDate: d.schedule_date,
        });
      } else if (d.urgency === "due-today") {
        alerts.push({
          poName: d.name,
          supplier,
          urgency: "due-today" as const,
          scheduleDate: d.schedule_date,
        });
      } else if (d.urgency === "due-tomorrow") {
        alerts.push({
          poName: d.name,
          supplier,
          urgency: "due-tomorrow" as const,
          scheduleDate: d.schedule_date,
        });
      } else if ((d.per_received ?? 0) === 0) {
        alerts.push({
          poName: d.name,
          supplier: `${supplier} • ${formatCurrency(d.grand_total)}`,
          urgency: "awaiting" as const,
          scheduleDate: d.schedule_date,
        });
      }
    }
    if (alerts.length) syncWarehouseAlerts(alerts);
    if (completedGrns.length) {
      syncGrnCompletedAlerts(
        completedGrns.map((g) => ({
          name: g.name,
          supplier: g.supplier_name ?? g.supplier ?? "Goods received",
          postingDate: g.posting_date,
        }))
      );
    }
    refresh();
  }, [showWarehouse, incomingPOs, completedGrns, voucherVersion, refresh]);

  useEffect(() => {
    if (!showFinance) return;
    if (awaitingInvoices.length) {
      syncFinanceGrnQueue(
        awaitingInvoices.map((g) => ({
          grnName: g.name,
          supplier: g.supplier_name ?? g.supplier ?? "Supplier",
          postingDate: g.posting_date,
        }))
      );
    }
    if (overdueInvoices.length) {
      syncOverduePayables(
        overdueInvoices.map((inv) => ({
          invoiceName: inv.name,
          supplier: inv.supplier,
          amount:
            inv.outstanding_amount && inv.outstanding_amount > 0
              ? inv.outstanding_amount
              : inv.grand_total ?? 0,
          dueDate: inv.due_date,
        }))
      );
    }
    refresh();
  }, [showFinance, awaitingInvoices, overdueInvoices, voucherVersion, refresh]);

  function handleClick(n: EnterpriseNotification) {
    markRead(n.id);
    setOpen(false);
    if (n.route_path) navigate(n.route_path);
  }

  const preview = notifications.slice(0, 12);

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

          {preview.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-neutral-500">
              <Clock className="h-6 w-6 text-neutral-400" />
              <p>No alerts right now.</p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {preview.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 ${
                      n.read_status ? "opacity-70" : ""
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${toneForModule(n.module)}`}
                    >
                      <Bell className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={`truncate text-sm ${
                            n.read_status
                              ? "text-neutral-700"
                              : "font-semibold text-neutral-900"
                          }`}
                        >
                          {n.title}
                        </p>
                        {!n.read_status && (
                          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary-500" />
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
                        {n.description}
                      </p>
                      <p className="mt-0.5 text-[10px] text-neutral-400">
                        {n.module}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
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
