import type { VercelRequest } from "@vercel/node";

export interface RfqApiLogContext {
  endpoint: string;
  rfqName?: string;
  action?: string;
  payload?: unknown;
  extra?: Record<string, unknown>;
}

/** Structured server-side logging for RFQ-related API routes. */
export function logRfqApiRequest(
  req: VercelRequest,
  ctx: RfqApiLogContext,
): void {
  // eslint-disable-next-line no-console
  console.info("[RFQ API · request]", {
    endpoint: ctx.endpoint,
    method: req.method ?? "GET",
    action: ctx.action ?? req.query.action ?? null,
    rfq: ctx.rfqName ?? req.query.rfq ?? req.query.rfq_name ?? null,
    query: req.query,
    ...ctx.extra,
  });
}

export function logRfqApiFailure(
  req: VercelRequest,
  err: unknown,
  ctx: RfqApiLogContext,
): void {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const stack = err instanceof Error ? err.stack : null;

  // eslint-disable-next-line no-console
  console.error("[RFQ API · failed]", {
    endpoint: ctx.endpoint,
    method: req.method ?? "GET",
    action: ctx.action ?? req.query.action ?? null,
    rfq: ctx.rfqName ?? req.query.rfq ?? req.query.rfq_name ?? null,
    query: req.query,
    payload: ctx.payload ?? null,
    httpStatus:
      err && typeof err === "object" && "status" in err
        ? (err as { status?: number }).status
        : null,
    message,
    stack,
    responseBody:
      err && typeof err === "object" && "responseBody" in err
        ? (err as { responseBody?: unknown }).responseBody
        : null,
    ...ctx.extra,
  });
}
