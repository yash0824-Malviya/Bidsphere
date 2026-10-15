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
  recordLegalDocumentViewed,
  saveLegalChecklist,
  requestLegalChanges,
  beginLegalSignature,
  completeLegalSignature,
  getLegalReview,
  verifyLegalDocumentIntegrity,
  getLegalSignatureEligibility,
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
  "procurement_team",
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
          excludeInitialClmHeld: principal.role === "legal" || principal.role === "finance",
        });
        res.status(200).json({ success: true, records: principal.role === "procurement_team"
          ? records.filter(record => record.review_status === "Approved" && record.finance_status === "Approved" && record.workflow_state === "Completed")
          : records });
        return;
      }
      case "get": {
        requireRoles(principal, WORKFLOW_READ_ROLES);
        const record = await getLegalReview(body.name, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "verify-integrity": {
        requireRoles(principal, WORKFLOW_READ_ROLES);
        const result = await verifyLegalDocumentIntegrity(body.name, principal);
        res.status(200).json({ success: true, ...result });
        return;
      }
      case "signature-eligibility": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const result = await getLegalSignatureEligibility(body.name, principal);
        res.status(200).json({ success: true, ...result });
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
          comments: body.comments,
        }, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "reject": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const record = await decideLegalDocumentReview({
          name: body.name,
          status: "Rejected",
          comments: body.comments,
          rejectionReason: body.rejectionReason,
        }, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "update-flags": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const record = await updateLegalDocumentFlags(body.name, body.updates ?? {}, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "resubmit": {
        requireRoles(principal, ["admin", "legal", "procurement"]);
        const record = await resubmitLegalReview(body.name, principal.email || principal.sub, body.note, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "finance-approve": {
        requireRoles(principal, FINANCE_REVIEW_ROLES);
        const record = await decideFinanceReview({
          name: body.name,
          status: "Approved",
          comments: body.comments,
        }, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "finance-reject": {
        requireRoles(principal, FINANCE_REVIEW_ROLES);
        const record = await decideFinanceReview({
          name: body.name,
          status: "Rejected",
          comments: body.comments,
          rejectionReason: body.rejectionReason,
        }, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "finance-resubmit": {
        requireRoles(principal, ["admin", "finance", "procurement"]);
        const record = await resubmitFinanceReview(body.name, principal.email || principal.sub, body.note, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "document-viewed": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const record = await recordLegalDocumentViewed(body.name, body.documentKey, body.hash, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "save-checklist": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const record = await saveLegalChecklist(body.name, body.items, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "request-changes": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const record = await requestLegalChanges(body.name, body.comments, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "begin-signature": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const record = await beginLegalSignature(body.name, body.documentKey, principal);
        res.status(200).json({ success: true, record });
        return;
      }
      case "complete-signature": {
        requireRoles(principal, LEGAL_REVIEW_ROLES);
        const record = await completeLegalSignature(body.name, body.documentKey, body.requestId, body.signature, principal);
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
    const status = err instanceof LegalReviewError ? err.status : Number((err as { status?: number })?.status) || 500;
    const message = status >= 500 ? "Unable to save or verify the legal review. Refresh and try again." : err instanceof Error ? err.message : "Legal review request failed.";
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
