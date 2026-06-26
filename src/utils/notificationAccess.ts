import type {
  EnterpriseNotification,
  NotificationModule,
  NotificationTargetRole,
  NotificationViewerContext,
} from "../types/notification";
import {
  FINANCE_MODULES,
  PROCUREMENT_MODULES,
  ROLE_ALLOWED_MODULES,
  SUPPLIER_ALLOWED_MODULES,
  WAREHOUSE_MODULES,
} from "../types/notification";

function normalizeEmail(email?: string): string | undefined {
  return email?.trim().toLowerCase() || undefined;
}

function normalizeSupplierId(id?: string): string | undefined {
  return id?.trim().toLowerCase() || undefined;
}

/** Stable key for deduplicating notifications. */
export function notificationDedupeKey(n: EnterpriseNotification): string {
  return [
    n.event_type,
    n.document_name,
    n.target_role,
    n.supplier_id ?? "",
    n.target_user ?? "",
    n.module,
  ].join("|");
}

export function dedupeNotifications(
  list: EnterpriseNotification[]
): EnterpriseNotification[] {
  const seen = new Map<string, EnterpriseNotification>();
  for (const item of list) {
    const key = notificationDedupeKey(item);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }
    const itemTime = new Date(item.created_at).getTime();
    const existingTime = new Date(existing.created_at).getTime();
    if (itemTime >= existingTime) {
      seen.set(key, {
        ...item,
        read_status: existing.read_status && item.read_status,
      });
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function isModuleAllowedForRole(
  role: NotificationTargetRole,
  module: NotificationModule
): boolean {
  if (role === "supplier") {
    return SUPPLIER_ALLOWED_MODULES.has(module);
  }
  if (!ROLE_ALLOWED_MODULES[role].has(module)) {
    return false;
  }
  if (role === "finance" && (WAREHOUSE_MODULES.has(module) || PROCUREMENT_MODULES.has(module))) {
    return false;
  }
  if (role === "warehouse" && FINANCE_MODULES.has(module)) {
    return false;
  }
  return true;
}

/** Whether a notification is visible to the current viewer. */
export function canViewNotification(
  notification: EnterpriseNotification,
  viewer: NotificationViewerContext
): boolean {
  if (!isModuleAllowedForRole(viewer.role, notification.module)) {
    return false;
  }

  const targetUser = normalizeEmail(notification.target_user);
  const viewerEmail = normalizeEmail(viewer.userEmail);
  if (targetUser && viewerEmail && targetUser !== viewerEmail) {
    return false;
  }

  if (viewer.role === "supplier") {
    if (notification.target_role !== "supplier") return false;
    const notifSupplier = normalizeSupplierId(notification.supplier_id);
    const viewerSupplier = normalizeSupplierId(viewer.supplierId);
    if (notifSupplier && viewerSupplier && notifSupplier !== viewerSupplier) {
      return false;
    }
    return true;
  }

  if (notification.target_role === "supplier") {
    return false;
  }

  if (notification.target_role !== viewer.role) {
    return false;
  }

  return true;
}

export function filterNotificationsForViewer(
  notifications: EnterpriseNotification[],
  viewer: NotificationViewerContext
): EnterpriseNotification[] {
  return dedupeNotifications(
    notifications.filter((n) => canViewNotification(n, viewer))
  );
}

export function countUnread(
  notifications: EnterpriseNotification[]
): number {
  return notifications.filter((n) => !n.read_status).length;
}
