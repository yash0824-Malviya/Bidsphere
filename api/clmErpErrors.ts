type ErpError = Record<string, unknown>;

function record(value: unknown): ErpError {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ErpError : {};
}

function plain(value: string): string {
  return value.replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, entity => {
      const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " };
      if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
      const code = entity[2].toLowerCase() === "x" ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }).trim();
}

function messages(payload: ErpError): string[] {
  let server: unknown = payload._server_messages;
  if (typeof server === "string") { try { server = JSON.parse(server); } catch { server = []; } }
  const result: string[] = [];
  for (let item of Array.isArray(server) ? server : []) {
    if (typeof item === "string") { try { item = JSON.parse(item); } catch { continue; } }
    const message = record(item).message;
    if (typeof message === "string" && message.trim()) result.push(message);
  }
  if (typeof payload.message === "string" && payload.message.trim()) result.push(payload.message);
  return result;
}

const sensitiveDiagnostic = /\b(?:Traceback|stack\s*trace|pymysql|psycopg\d?|SQLSTATE)\b|\bfrappe\.exceptions\.|\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET)\b|(?:^|\n)\s*(?:at\s+\S+|File\s+["'])|\b(?:api[_\s-]?(?:key|secret)|password|passwd|authorization|private[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|client[_\s-]?secret|cookie|set-cookie)\s*[:=]|\b(?:Bearer|Basic|token)\s+[A-Za-z0-9+/_=.:-]{6,}|-----BEGIN [^-]*PRIVATE KEY-----|https?:\/\/[^/\s:@]+:[^/\s@]+@/i;

export function clmErpFailure(value: unknown, status: number, secrets: string[] = []): { status: number; message: string } {
  const payload = record(value);
  const candidates = messages(payload);
  const conflict = [payload.exc_type, payload.exception, ...candidates].some(part => typeof part === "string" && /TimestampMismatchError|modified after you have opened/i.test(part));
  if (conflict) return { status: 409, message: "This record changed. Refresh before saving." };
  if (status === 404) return { status, message: "Document not found." };
  for (const candidate of candidates) {
    const message = plain(candidate);
    // Inspect the full diagnostic before truncation, including configured secrets
    // that may have been echoed without a credential label by an upstream server.
    if (message && !sensitiveDiagnostic.test(message) && !secrets.some(secret => secret && message.includes(secret))) {
      return { status, message: message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 500) };
    }
  }
  const message = [401, 403].includes(status)
    ? "ERPNext denied the Contract action. Ask an administrator to verify the gateway user's permissions."
    : [400, 417, 422].includes(status)
      ? "ERPNext rejected the Contract action. Check the required fields and current workflow stage; ask an administrator to inspect the ERP error log if it continues."
      : "ERPNext could not complete the Contract action. Ask an administrator to inspect the ERP error log, then refresh the RFQ or Contract before retrying.";
  return { status, message };
}
