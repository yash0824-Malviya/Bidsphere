import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createLegalDocumentReview,
  decideLegalDocumentReview,
  decideFinanceReview,
  resubmitLegalReview,
  resubmitFinanceReview,
  updateLegalDocumentFlags,
  LegalReviewError,
} from "./legalReviewCore";

/**
 * POST /api/legal-review/create
 * POST /api/legal-review/approve
 * POST /api/legal-review/reject
 * POST /api/legal-review/update-flags
 * POST /api/legal-review/resubmit
 * POST /api/legal-review/finance-approve
 * POST /api/legal-review/finance-reject
 * POST /api/legal-review/finance-resubmit
 *
 * Routed here via the `/api/legal-review/(.*)` rewrite in vercel.json
 * (mirrored for local dev by the Vite plugin in vite.config.ts). The
 * React app never talks to `/api/resource/Legal Document Review` for
 * writes — this is the only server-side entry point allowed to do so.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};

  try {
    switch (action) {
      case "create": {
        const result = await createLegalDocumentReview(body);
        res.status(200).json({ success: true, ...result });
        return;
      }
      case "approve": {
        const record = await decideLegalDocumentReview({
          name: body.name,
          status: "Approved",
          reviewedBy: body.reviewedBy,
          comments: body.comments,
        });
        res.status(200).json({ success: true, record });
        return;
      }
      case "reject": {
        const record = await decideLegalDocumentReview({
          name: body.name,
          status: "Rejected",
          reviewedBy: body.reviewedBy,
          comments: body.comments,
          rejectionReason: body.rejectionReason,
        });
        res.status(200).json({ success: true, record });
        return;
      }
      case "update-flags": {
        const record = await updateLegalDocumentFlags(body.name, body.updates ?? {});
        res.status(200).json({ success: true, record });
        return;
      }
      case "resubmit": {
        const record = await resubmitLegalReview(body.name, body.resubmittedBy, body.note);
        res.status(200).json({ success: true, record });
        return;
      }
      case "finance-approve": {
        const record = await decideFinanceReview({
          name: body.name,
          status: "Approved",
          reviewedBy: body.reviewedBy,
          comments: body.comments,
        });
        res.status(200).json({ success: true, record });
        return;
      }
      case "finance-reject": {
        const record = await decideFinanceReview({
          name: body.name,
          status: "Rejected",
          reviewedBy: body.reviewedBy,
          comments: body.comments,
          rejectionReason: body.rejectionReason,
        });
        res.status(200).json({ success: true, record });
        return;
      }
      case "finance-resubmit": {
        const record = await resubmitFinanceReview(body.name, body.resubmittedBy, body.note);
        res.status(200).json({ success: true, record });
        return;
      }
      default:
        res.status(404).json({ error: `Unknown legal-review action: ${action}` });
        return;
    }
  } catch (err) {
    const status = err instanceof LegalReviewError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Legal review request failed.";
    // eslint-disable-next-line no-console
    console.error(`[legal-review] action=${action} FAILED:`, message);
    res.status(status >= 400 && status < 600 ? status : 500).json({ success: false, error: message });
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
