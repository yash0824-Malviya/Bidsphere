import type { AxiosRequestConfig } from "axios";
import {
  apiGet,
  apiPost,
  apiPut,
  buildListConfig,
  buildResourceUrl,
  withSilent,
} from "./erpnext";
import type { Filter } from "./erpnext";
import type { AppNotification, Voucher } from "../types/voucher";

/**
 * Shared persistence for the voucher / invoice / payment workflow.
 *
 * WHY THIS EXISTS
 * ---------------
 * Vouchers are stored in `localStorage`, which is scoped per browser *origin*
 * (and per device). That is exactly why the workflow looked correct on
 * `localhost` but stale on the `ngrok` URL: they are different origins, so each
 * keeps its own private voucher store. The ERPNext data (POs / GRNs) is shared
 * because it comes from the same Frappe backend — only the voucher layer was
 * local, so the two environments diverged.
 *
 * THE FIX
 * -------
 * Mirror the voucher store into a single shared ERPNext `Note` document
 * (a stock doctype available on every Frappe site). On load / focus we PULL the
 * shared copy and merge it into localStorage; after every mutation we PUSH the
 * merged store back. Both `localhost` and `ngrok` therefore read and write the
 * same underlying record and converge on identical workflow state.
 *
 * Reads elsewhere stay synchronous (`getAllVouchers()` reads the localStorage
 * cache); this module only keeps that cache in sync with the backend.
 *
 * If the backend isn't writable (permissions / offline), sync disables itself
 * silently and the app keeps working exactly as before (localStorage only).
 */

const STORE_TITLE = "NETLINK_VOUCHER_STORE";
const VOUCHERS_KEY = "netlink_vouchers";
const NOTIF_KEY = "netlink_notifications";

let cachedNoteName: string | null = null;
let syncDisabled = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightPush: Promise<void> | null = null;

interface StorePayload {
  vouchers: Voucher[];
  notifications: AppNotification[];
  updated_at: string;
}

interface NoteRow {
  name: string;
  content?: string | null;
}

/** UTF-8-safe base64 so the JSON survives the Note's rich-text field intact. */
function encodePayload(payload: StorePayload): string {
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)));
}

function decodePayload(content: string): StorePayload | null {
  try {
    // Tolerate any HTML wrapping the rich-text field may have added.
    const b64 = content.replace(/<[^>]*>/g, "").trim();
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json) as StorePayload;
  } catch {
    return null;
  }
}

function readLocal(): { vouchers: Voucher[]; notifications: AppNotification[] } {
  let vouchers: Voucher[] = [];
  let notifications: AppNotification[] = [];
  try {
    vouchers = JSON.parse(localStorage.getItem(VOUCHERS_KEY) ?? "[]") as Voucher[];
  } catch {
    vouchers = [];
  }
  try {
    notifications = JSON.parse(
      localStorage.getItem(NOTIF_KEY) ?? "[]"
    ) as AppNotification[];
  } catch {
    notifications = [];
  }
  return { vouchers, notifications };
}

/**
 * Merge two voucher lists by id, keeping the most-advanced copy of each
 * (more history entries = later workflow state). Prevents either side from
 * clobbering progress the other side has made.
 */
function mergeVouchers(remote: Voucher[], local: Voucher[]): Voucher[] {
  const map = new Map<string, Voucher>();
  for (const v of [...remote, ...local]) {
    if (!v?.id) continue;
    const existing = map.get(v.id);
    if (
      !existing ||
      (v.history?.length ?? 0) >= (existing.history?.length ?? 0)
    ) {
      map.set(v.id, v);
    }
  }
  return [...map.values()];
}

function mergeNotifications(
  remote: AppNotification[],
  local: AppNotification[]
): AppNotification[] {
  const map = new Map<string, AppNotification>();
  for (const n of [...remote, ...local]) {
    if (!n?.id) continue;
    const existing = map.get(n.id);
    // A notification once read stays read on either side.
    if (!existing) map.set(n.id, n);
    else if (n.read) map.set(n.id, { ...existing, read: true });
  }
  return [...map.values()]
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 100);
}

function silentList(filters: Filter[], fields: string[]): AxiosRequestConfig {
  return withSilent(
    buildListConfig({ filters, fields, limit_page_length: 1 })
  );
}

function handleSyncError(err: unknown): void {
  const status = (err as { response?: { status?: number } })?.response?.status;
  // Permission / not-allowed → give up quietly and fall back to local-only.
  if (status === 403 || status === 401) {
    syncDisabled = true;
  }
  // eslint-disable-next-line no-console
  console.warn("[voucherSync] backend sync unavailable, using local cache", err);
}

/**
 * Pull the shared store and merge it into localStorage.
 * @returns true if the local cache changed (callers should re-render/refetch).
 */
export async function pullVoucherStore(): Promise<boolean> {
  if (syncDisabled) return false;
  try {
    const rows = await apiGet<NoteRow[]>(
      buildResourceUrl("Note"),
      silentList([["title", "=", STORE_TITLE]], ["name", "content"])
    );
    const doc = Array.isArray(rows) ? rows[0] : undefined;
    if (!doc) return false; // shared store not created yet
    cachedNoteName = doc.name;
    if (!doc.content) return false;

    const remote = decodePayload(doc.content);
    if (!remote) return false;

    const local = readLocal();
    const beforeV = JSON.stringify(local.vouchers);
    const beforeN = JSON.stringify(local.notifications);

    const mergedVouchers = mergeVouchers(
      remote.vouchers ?? [],
      local.vouchers ?? []
    );
    const mergedNotifs = mergeNotifications(
      remote.notifications ?? [],
      local.notifications ?? []
    );

    const afterV = JSON.stringify(mergedVouchers);
    const afterN = JSON.stringify(mergedNotifs);
    localStorage.setItem(VOUCHERS_KEY, afterV);
    localStorage.setItem(NOTIF_KEY, afterN);

    return beforeV !== afterV || beforeN !== afterN;
  } catch (err) {
    handleSyncError(err);
    return false;
  }
}

/** Write the current localStorage store back to the shared Note (upsert). */
export async function pushVoucherStore(): Promise<void> {
  if (syncDisabled) return;
  // Coalesce concurrent pushes so we never race two writes to the same doc.
  if (inFlightPush) {
    await inFlightPush;
  }
  inFlightPush = (async () => {
    const { vouchers, notifications } = readLocal();
    const content = encodePayload({
      vouchers,
      notifications,
      updated_at: new Date().toISOString(),
    });
    try {
      if (!cachedNoteName) {
        const rows = await apiGet<NoteRow[]>(
          buildResourceUrl("Note"),
          silentList([["title", "=", STORE_TITLE]], ["name"])
        );
        cachedNoteName =
          Array.isArray(rows) && rows[0] ? rows[0].name : null;
      }
      if (cachedNoteName) {
        await apiPut(
          buildResourceUrl("Note", cachedNoteName),
          { content },
          withSilent()
        );
      } else {
        const created = await apiPost<{ name?: string }>(
          buildResourceUrl("Note"),
          { title: STORE_TITLE, content, public: 1 },
          withSilent()
        );
        if (created?.name) cachedNoteName = created.name;
      }
    } catch (err) {
      handleSyncError(err);
    }
  })();
  try {
    await inFlightPush;
  } finally {
    inFlightPush = null;
  }
}

/** Debounced push — safe to call after every voucher/notification mutation. */
export function scheduleVoucherPush(): void {
  if (syncDisabled) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushVoucherStore();
  }, 700);
}

export function isVoucherSyncEnabled(): boolean {
  return !syncDisabled;
}
