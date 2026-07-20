import type { PortalClientMeta } from "../api/supplierOnboarding";

/** Best-effort browser / device labels for login history (no IP from browser). */
export function buildPortalClientMeta(): PortalClientMeta {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let browser = "Browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  const device = /Mobile|Android|iPhone|iPad/i.test(ua) ? "Mobile" : "Desktop";
  return { browser, device, user_agent: ua };
}
