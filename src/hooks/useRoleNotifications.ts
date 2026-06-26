import { useCallback, useMemo, useState } from "react";
import {
  getNotificationsForViewer,
  getUnreadCountForViewer,
  markAllNotificationsReadForViewer,
  markNotificationRead,
} from "../api/notifications";
import type { EnterpriseNotification } from "../types/notification";
import type { NotificationViewerContext } from "../types/notification";
import { useAuthStore } from "../store/authStore";
import { useVoucherSyncStore } from "../store/voucherSyncStore";

export function buildViewerContext(
  role?: string,
  userEmail?: string,
  supplierId?: string
): NotificationViewerContext | null {
  if (!role) return null;
  if (role === "supplier") {
    if (!supplierId) return null;
    return { role: "supplier", supplierId, userEmail };
  }
  return {
    role: role as NotificationViewerContext["role"],
    userEmail,
  };
}

export function useRoleNotifications(supplierId?: string) {
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? (supplierId ? "supplier" : undefined);
  const voucherVersion = useVoucherSyncStore((s) => s.version);
  const [tick, setTick] = useState(0);

  const viewer = useMemo(
    () =>
      buildViewerContext(
        role,
        user?.email,
        supplierId ?? user?.email
      ),
    [role, user?.email, supplierId]
  );

  const notifications = useMemo(() => {
    if (!viewer) return [] as EnterpriseNotification[];
    void voucherVersion;
    void tick;
    return getNotificationsForViewer(viewer);
  }, [viewer, voucherVersion, tick]);

  const unreadCount = useMemo(
    () => (viewer ? getUnreadCountForViewer(viewer) : 0),
    [viewer, notifications]
  );

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const markRead = useCallback(
    (id: string) => {
      markNotificationRead(id);
      refresh();
    },
    [refresh]
  );

  const markAllRead = useCallback(() => {
    if (!viewer) return;
    markAllNotificationsReadForViewer(viewer);
    refresh();
  }, [viewer, refresh]);

  return {
    viewer,
    notifications,
    unreadCount,
    refresh,
    markRead,
    markAllRead,
  };
}
