/**
 * Generate a unique id for client-side row keys, correlation IDs, and request IDs.
 * `crypto.randomUUID()` is unavailable on non-HTTPS origins (e.g. deployed VM over HTTP),
 * so we fall back to cryptographically secure `getRandomValues` or an RFC4122 v4 UUID fallback.
 */
export function generateId(): string {
  const c =
    typeof globalThis !== "undefined" && globalThis.crypto
      ? globalThis.crypto
      : typeof crypto !== "undefined"
      ? crypto
      : undefined;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
