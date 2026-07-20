import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createLegalDocumentReview,
  decideLegalDocumentReview,
  decideFinanceReview,
  listWorkflowRecords,
  resubmitLegalReview,
  resubmitFinanceReview,
  updateLegalDocumentFlags,
  LegalReviewError,
} from "./legalReviewCore.js";
import {
  RbacError,
  requireInternalAuth,
  requireRoles,
  LEGAL_REVIEW_ROLES,
  FINANCE_REVIEW_ROLES,
  type AppRole,
} from "./rbacAuth.js";

/** Roles allowed to read the shared Legal → Finance workflow dataset. */
const WORKFLOW_READ_ROLES: AppRole[] = [
  "admin",
  "legal",
  "finance",
  "finance_executive",
  "procurement",
];

/**
 * POST /api/legal-review/:action
 *
 * Writes + privileged workflow reads go through this gateway so Legal approve
 * and Finance queue share the same ERPNext credentials and never diverge.
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
    const principal = requireInternalAuth(
      req.headers as Record<string, unknown>,
      body as Record<string, unknown>,
    );

    switch (action) {
      case "list": {
        requireRoles(principal, WORKFLOW_READ_ROLES);
        const records = await listWorkflowRecords({
          limit: typeof body.limit === "number" ? body.limit : undefined,
        });
        res.status(200).json({ success: true, records });
        return;
      }
      case "create": {
        requireRoles(principal, ["admin", "legal", "procurement"]);
        const result = await createLegalDocumentReview(body);
        res.status(200).json({ success: true, ...result });
        return;
      }
      case "approve": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
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
        requireRoles(principal, LEGAL_REVIEW_ROLES);
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
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const record = await updateLegalDocumentFlags(body.name, body.updates ?? {});
        res.status(200).json({ success: true, record });
        return;
      }
      case "resubmit": {
        requireRoles(principal, ["admin", "legal", "procurement"]);
        const record = await resubmitLegalReview(body.name, body.resubmittedBy, body.note);
        res.status(200).json({ success: true, record });
        return;
      }
      case "finance-approve": {
        requireRoles(principal, FINANCE_REVIEW_ROLES);
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
        requireRoles(principal, FINANCE_REVIEW_ROLES);
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
        requireRoles(principal, ["admin", "finance", "procurement"]);
        const record = await resubmitFinanceReview(body.name, body.resubmittedBy, body.note);
        res.status(200).json({ success: true, record });
        return;
      }
      default:
        res.status(404).json({ error: `Unknown legal-review action: ${action}` });
        return;
    }
  } catch (err) {
    if (err instanceof RbacError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
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
