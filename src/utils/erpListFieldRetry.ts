/**
 * Helpers for ERPNext list queries that may request optional custom fields.
 * Missing / non-permitted fields return HTTP 417 — strip and retry instead of
 * failing the whole Item search.
 */

export function erpErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    const ax = err as {
      response?: { data?: { message?: unknown; exc?: unknown; exception?: unknown } };
      message?: unknown;
    };
    const data = ax.response?.data;
    if (data) {
      const parts = [data.message, data.exception, data.exc]
        .map((v) => (typeof v === "string" ? v : ""))
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    if (typeof ax.message === "string") return ax.message;
  }
  return String(err ?? "Unknown error");
}

export function extractForbiddenField(err: unknown): string | null {
  const msg = erpErrorMessage(err);
  const match = /Field not permitted in query:\s*([A-Za-z0-9_]+)/i.exec(msg);
  return match?.[1] ?? null;
}

export function isFieldPermissionError(err: unknown): boolean {
  return /Field not permitted in query|DataError|Unknown column|No field named|Could not find .* in/i.test(
    erpErrorMessage(err),
  );
}

/**
 * After a field-permission failure, return the next field list to try.
 * Prefer stripping the named forbidden field; otherwise drop all custom_*.
 */
export function nextFieldsAfterPermissionError(
  fields: string[],
  err: unknown,
): { fields: string[]; removed: string[] } | null {
  const forbidden = extractForbiddenField(err);
  if (forbidden && fields.includes(forbidden)) {
    return {
      fields: fields.filter((f) => f !== forbidden),
      removed: [forbidden],
    };
  }
  if (isFieldPermissionError(err)) {
    const custom = fields.filter((f) => f.startsWith("custom_"));
    if (custom.length > 0) {
      return {
        fields: fields.filter((f) => !f.startsWith("custom_")),
        removed: custom,
      };
    }
  }
  return null;
}
